#!/usr/bin/env node
"use strict";
/**
 * 실제 API 키 없이 파이프라인을 검증하는 자체 테스트. 두 축으로 나뉜다:
 * - normalizeItems.js가 쓰는 규칙 기반 매칭(ruleBasedMatch)은 네트워크 없이 동기 로직만
 *   검증한다.
 * - reviewWithAi.js가 쓰는 reviewClient는 fetch를 모킹해서 요청/응답 파싱만 검증한다
 *   (llmClient.js 테스트와 동일한 패턴, 역할만 "결정"에서 "검토"로 바뀜).
 * 실행: node 02-normalize-items/selftest.js
 */

const assert = require("assert");
const { parseCsvLine, bigrams } = require("./lib/noticeDictionary");
const { findCandidates } = require("./lib/candidateSearch");
const { isServiceClass } = require("./lib/filters");
const { matchItem, EXCLUDE_KEYWORD_RE, JACCARD_ONLY_THRESHOLD } = require("./lib/ruleBasedMatch");
const { createClient, TOOL, MESSAGES_URL } = require("./lib/reviewClient");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function makeDictionary(entries) {
  return entries.map((e) => ({ ...e, bigrams: bigrams(e.item) }));
}

async function run() {
  console.log("1) noticeDictionary.parseCsvLine — 따옴표 안 콤마 처리");
  {
    // 실제 사전 CSV에서 확인된 패턴: 유사군코드가 "G3402,G3404"처럼 따옴표로 묶여 온다.
    const line = '35MM 카메라,09,"G3402,G3404",35mm cameras';
    const fields = parseCsvLine(line);
    assert.deepStrictEqual(fields, ["35MM 카메라", "09", "G3402,G3404", "35mm cameras"]);
    ok("따옴표로 묶인 콤마가 컬럼을 깨지 않고 한 필드로 파싱됨");
  }

  console.log("2) noticeDictionary.bigrams");
  {
    assert.deepStrictEqual([...bigrams("사과")], ["사과"]);
    assert.deepStrictEqual([...bigrams("가")], ["가"]);
    ok("2글자/1글자 입력에 대해 bigram 집합이 올바름");
  }

  console.log("3) candidateSearch.findCandidates — 지역명 제거 + 35류 기본 제외");
  {
    const dictionary = makeDictionary([
      { item: "사과", niceClass: "31", similarGroupCode: "G0101" },
      { item: "안동", niceClass: "35", similarGroupCode: "S2001" }, // 서비스업(35류) — 기본 제외돼야 함
      { item: "탈", niceClass: "28", similarGroupCode: "G0301" },
      { item: "밀가루", niceClass: "30", similarGroupCode: "G0401" },
    ]);

    // 지역명(sigungu)을 넘기지 않으면 "안동사과"에 "안동"이라는 부분 문자열이 그대로
    // 남아있어 35류 항목 "안동"과도 텍스트상 겹친다 — 이 조건에서 35류 필터링 자체를 검증한다.
    const withoutServiceClass = findCandidates("안동사과", dictionary, {}, { topK: 5 });
    assert.ok(
      !withoutServiceClass.some((c) => c.item === "안동"),
      "35류(서비스업)는 기본적으로 후보에서 제외돼야 함"
    );
    const withServiceClass = findCandidates("안동사과", dictionary, {}, { topK: 5, includeServiceClass: true });
    assert.ok(
      withServiceClass.some((c) => c.item === "안동"),
      "includeServiceClass:true면 35류도 후보에 포함돼야 함"
    );

    // 지역명을 넘기면 "안동"이 쿼리에서 제거되어 무관한 지역명 후보 대신 진짜 품목("사과")이
    // 최상위 후보가 된다.
    const withRegionStrip = findCandidates(
      "안동사과",
      dictionary,
      { sido: "경상북도", sigungu: "안동" },
      { topK: 5 }
    );
    assert.strictEqual(withRegionStrip[0].item, "사과", "지역명을 제거하면 '사과'가 최상위 후보여야 함");
    ok("지역명 제거로 정확한 후보를 찾고, 35류는 기본 제외/옵션으로 포함 가능");
  }

  console.log("4) filters.isServiceClass");
  {
    assert.strictEqual(isServiceClass("35"), true);
    assert.strictEqual(isServiceClass("08"), false);
    assert.strictEqual(isServiceClass("45"), true);
    assert.strictEqual(isServiceClass(""), false);
    ok("NICE 35류 이상 판별 정상 동작 (zero-padding 값 포함)");
  }

  console.log("5) ruleBasedMatch.matchItem — substring 매칭은 LLM 없이 결정론적으로 확정");
  {
    const dictionary = makeDictionary([
      { item: "사과", niceClass: "31", similarGroupCode: "G0101" },
      { item: "사과나무", niceClass: "31", similarGroupCode: "G0102" },
    ]);
    const result = matchItem("안동사과, 부사", dictionary, { sido: "경상북도", sigungu: "안동" }, {});
    assert.strictEqual(result.noticeName, "사과", "지역명·품종 접미어를 제거하면 '사과'가 substring으로 확정돼야 함");
    assert.strictEqual(result.niceClass, "31");
    assert.strictEqual(result.itemName, "사과");
    assert.strictEqual(result.excluded, false);
    assert.strictEqual(typeof result.matchScore, "number");
    ok("원문에 후보 품목명이 그대로 포함되면 AI 호출 없이 매칭 확정");
  }

  console.log("6) ruleBasedMatch.matchItem — 애매한 건 noticeName:null로 남겨 AI 검토 대상으로 넘김");
  {
    const dictionary = makeDictionary([{ item: "밀가루", niceClass: "30", similarGroupCode: "G0401" }]);
    const result = matchItem("정체불명특산품, 참고사항", dictionary, {}, {});
    assert.strictEqual(result.noticeName, null, "관련 없는 사전 항목만 있으면 자동 확정하면 안 됨");
    assert.strictEqual(result.niceClass, null);
    assert.strictEqual(result.itemName, "정체불명특산품", "매칭 실패해도 콤마 뒤 부가정보는 잘라 최소 정제");
    assert.strictEqual(result.matchScore, null);
    ok("확신 없는 매칭은 자동 확정하지 않고 콤마 기준 최소 정제만 수행");
  }

  console.log("7) ruleBasedMatch.matchItem — 재배용 파생 형태는 규칙으로 즉시 제외");
  {
    const dictionary = makeDictionary([{ item: "사과", niceClass: "31", similarGroupCode: "G0101" }]);
    const treeResult = matchItem("안동사과나무", dictionary, { sido: "경상북도", sigungu: "안동" }, {});
    assert.strictEqual(treeResult.excluded, true, "'나무'가 포함되면 매칭 성공 여부와 무관하게 제외돼야 함");
    const seedlingResult = matchItem("고흥유자묘목", dictionary, { sido: "전라남도", sigungu: "고흥" }, {});
    assert.strictEqual(seedlingResult.excluded, true);
    assert.strictEqual(matchItem("안동사과", dictionary, { sido: "경상북도", sigungu: "안동" }, {}).excluded, false);
    assert.ok(EXCLUDE_KEYWORD_RE.test("사과묘목"));
    ok("묘목/나무 등 파생 형태 키워드가 있으면 excluded:true, 일반 품목은 false");
  }

  console.log("8) ruleBasedMatch — jaccard-only 임계값 상수 노출 확인");
  {
    assert.strictEqual(JACCARD_ONLY_THRESHOLD, 0.8);
    ok("substring이 아닌 순수 유사도 매칭은 0.8 이상일 때만 자동 확정(오탐 방지)");
  }

  console.log("9) reviewClient.createClient — apiKey 없으면 즉시 throw");
  {
    assert.throws(() => createClient({}), /ANTHROPIC_API_KEY/);
    ok("apiKey 누락 시 첫 호출 전에 즉시 에러 발생 (llmClient.js/kiprisClient.js와 동일 패턴)");
  }

  console.log("10) reviewClient.reviewItem — 요청 구성(forced tool_choice + strict) + ok 판정");
  {
    const row = { rawItemName: "안동사과, 부사", itemName: "사과", noticeName: "사과", niceClass: "31", excluded: false };
    const candidates = [{ item: "사과", niceClass: "31", similarGroupCode: "G0101" }];
    let capturedUrl;
    let capturedBody;
    const fakeFetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "submit_review",
              input: { verdict: "ok", note: "", suggestedCandidateIndex: -1, suggestedExcluded: false },
            },
          ],
        }),
      };
    };
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.reviewItem(row, candidates);

    assert.strictEqual(capturedUrl, MESSAGES_URL);
    assert.strictEqual(capturedBody.model, "claude-haiku-4-5");
    assert.deepStrictEqual(capturedBody.tool_choice, { type: "tool", name: TOOL.name });
    assert.strictEqual(capturedBody.tools[0].strict, true);
    assert.strictEqual(capturedBody.tools[0].input_schema.additionalProperties, false);
    assert.strictEqual(result.verdict, "ok");
    assert.strictEqual(result.suggestedNoticeName, null);
    ok("이미 확정된 결과를 검토만 하는 요청 구성 정상 동작, ok 판정 정상 파싱");
  }

  console.log("11) reviewClient.reviewItem — flag 판정 시 대안 후보 제안");
  {
    const row = { rawItemName: "정체불명특산품", itemName: "정체불명특산품", noticeName: "", niceClass: "", excluded: false };
    const candidates = [
      { item: "밀가루", niceClass: "30", similarGroupCode: "G0401" },
      { item: "정체불명나물", niceClass: "31", similarGroupCode: "G0102" },
    ];
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "submit_review",
            input: { verdict: "flag", note: "후보 중 정체불명나물이 더 적절함", suggestedCandidateIndex: 1, suggestedExcluded: false },
          },
        ],
      }),
    });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.reviewItem(row, candidates);
    assert.strictEqual(result.verdict, "flag");
    assert.strictEqual(result.suggestedNoticeName, "정체불명나물");
    assert.strictEqual(result.suggestedNiceClass, "31");
    ok("flag 판정 시 후보 목록에서 고른 대안이 결과에 반영됨");
  }

  console.log("12) reviewClient.reviewItem — 모델이 범위 밖 인덱스를 보내도 방어적으로 처리");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_3",
            name: "submit_review",
            input: { verdict: "flag", note: "이상한 응답", suggestedCandidateIndex: 5, suggestedExcluded: false },
          },
        ],
      }),
    });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.reviewItem(
      { rawItemName: "품목", itemName: "품목", noticeName: "", niceClass: "", excluded: false },
      [{ item: "후보1", niceClass: "01", similarGroupCode: "G0001" }]
    );
    assert.strictEqual(result.suggestedNoticeName, null, "범위 밖 인덱스는 제안 없음으로 취급돼야 함");
    ok("범위를 벗어난 suggestedCandidateIndex를 안전하게 무시");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
