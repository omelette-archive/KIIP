#!/usr/bin/env node
"use strict";
/**
 * 실제 API 키 없이 파이프라인(사전 CSV 파싱 -> 후보 검색 -> LLM 클라이언트 요청/응답
 * 파싱)을 검증하는 자체 테스트. fetch를 모킹해서 네트워크 없이 돌린다.
 * 실행: node 02-normalize-items/selftest.js
 */

const assert = require("assert");
const { parseCsvLine, bigrams } = require("./lib/noticeDictionary");
const { findCandidates } = require("./lib/candidateSearch");
const { isServiceClass } = require("./lib/filters");
const { createClient, TOOL, MESSAGES_URL } = require("./lib/llmClient");

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

  console.log("5) llmClient.createClient — apiKey 없으면 즉시 throw");
  {
    assert.throws(() => createClient({}), /ANTHROPIC_API_KEY/);
    ok("apiKey 누락 시 첫 호출 전에 즉시 에러 발생 (kiprisClient.js와 동일 패턴)");
  }

  console.log("6) llmClient.normalizeItem — 요청 구성(forced tool_choice + strict) 확인");
  {
    const candidates = [
      { item: "사과", niceClass: "31", similarGroupCode: "G0101" },
      { item: "사과나무", niceClass: "31", similarGroupCode: "G0102" },
    ];
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
              name: "submit_normalization",
              input: { itemName: "사과", candidateIndex: 0, excluded: false },
            },
          ],
        }),
      };
    };
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.normalizeItem({ rawItemName: "안동사과, 부사", candidates });

    assert.strictEqual(capturedUrl, MESSAGES_URL);
    assert.strictEqual(capturedBody.model, "claude-haiku-4-5");
    assert.deepStrictEqual(capturedBody.tool_choice, { type: "tool", name: TOOL.name });
    assert.strictEqual(capturedBody.tools[0].strict, true);
    assert.strictEqual(capturedBody.tools[0].input_schema.additionalProperties, false);
    assert.strictEqual(capturedBody.output_config, undefined, "Haiku 4.5는 effort를 지원하지 않으므로 output_config를 보내면 안 됨");
    assert.strictEqual(capturedBody.thinking, undefined, "Haiku 4.5는 thinking 파라미터도 보내지 않음");

    assert.strictEqual(result.itemName, "사과");
    assert.strictEqual(result.noticeName, "사과");
    assert.strictEqual(result.niceClass, "31");
    assert.strictEqual(result.similarGroupCode, "G0101");
    assert.strictEqual(result.excluded, false);
    ok("forced tool_choice + strict 스키마로 요청 구성, candidateIndex로 후보를 정확히 매칭");
  }

  console.log("7) llmClient.normalizeItem — candidateIndex -1 (고시명칭 없음)");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "submit_normalization",
            input: { itemName: "희귀품목", candidateIndex: -1, excluded: false },
          },
        ],
      }),
    });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.normalizeItem({
      rawItemName: "희귀품목",
      candidates: [{ item: "무관항목", niceClass: "01", similarGroupCode: "G0001" }],
    });
    assert.strictEqual(result.itemName, "희귀품목");
    assert.strictEqual(result.noticeName, null);
    assert.strictEqual(result.niceClass, null);
    ok("후보 중 일치하는 게 없으면 noticeName/niceClass가 null (비고시명칭으로 단순화)");
  }

  console.log("8) llmClient.normalizeItem — 모델이 범위 밖 인덱스를 보내도 방어적으로 -1 처리");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_3",
            name: "submit_normalization",
            // strict:true라도 방어적으로 검증 — candidates 길이(1)를 벗어난 인덱스
            input: { itemName: "품목", candidateIndex: 5, excluded: false },
          },
        ],
      }),
    });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.normalizeItem({
      rawItemName: "품목",
      candidates: [{ item: "후보1", niceClass: "01", similarGroupCode: "G0001" }],
    });
    assert.strictEqual(result.noticeName, null, "범위 밖 인덱스는 -1(고시명칭 없음)로 취급돼야 함");
    ok("범위를 벗어난 candidateIndex를 안전하게 -1로 처리");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
