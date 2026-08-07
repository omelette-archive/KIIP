#!/usr/bin/env node
"use strict";
/**
 * 실제 API 키 없이 규칙 기반 정규화와 선택적 AI 검토 클라이언트를 검증한다.
 * 실행: node 02-normalize-items/selftest.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseCsvLine, bigrams } = require("./lib/noticeDictionary");
const { findCandidates } = require("./lib/candidateSearch");
const { isServiceClass } = require("./lib/filters");
const { createClient, TOOL, MESSAGES_URL } = require("./lib/reviewClient");
const { normalizeRow, OUTPUT_FIELDS } = require("./normalizeItems");
const { cleanItemName, normalizeByRules } = require("./lib/ruleNormalizer");
const { readReviewCsv, parseCandidates } = require("./reviewWithAi");

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

  console.log("5) reviewClient.createClient — apiKey 없으면 즉시 throw");
  {
    assert.throws(() => createClient({}), /ANTHROPIC_API_KEY/);
    ok("apiKey 누락 시 첫 호출 전에 즉시 에러 발생 (kiprisClient.js와 동일 패턴)");
  }

  console.log("6) reviewClient.reviewItem — 요청 구성(forced tool_choice + strict) 확인, 후보 확정");
  {
    const candidates = [
      { item: "탈", niceClass: "28", similarGroupCode: "G0301" },
      { item: "부채", niceClass: "20", similarGroupCode: "G0501" },
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
              name: "submit_item_review",
              input: { candidateIndex: 0, note: "하회탈은 탈의 일종" },
            },
          ],
        }),
      };
    };
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.reviewItem(
      { sido: "경상북도", sigungu: "안동시", rawItemName: "안동하회탈", itemName: "하회탈", reviewReason: "정확히 일치하는 고시명칭이 없음" },
      candidates
    );

    assert.strictEqual(capturedUrl, MESSAGES_URL);
    assert.strictEqual(capturedBody.model, "claude-haiku-4-5");
    assert.deepStrictEqual(capturedBody.tool_choice, { type: "tool", name: TOOL.name });
    assert.strictEqual(capturedBody.tools[0].strict, true);
    assert.strictEqual(capturedBody.tools[0].input_schema.additionalProperties, false);

    assert.strictEqual(result.noticeName, "탈");
    assert.strictEqual(result.niceClass, "28");
    assert.strictEqual(result.note, "하회탈은 탈의 일종");
    ok("forced tool_choice + strict 스키마로 요청 구성, candidateIndex로 후보를 정확히 확정");
  }

  console.log("7) reviewClient.reviewItem — candidateIndex -1 (해당 후보 없음)");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "submit_item_review",
            input: { candidateIndex: -1, note: "후보 중 일치하는 게 없음" },
          },
        ],
      }),
    });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.reviewItem(
      { rawItemName: "희귀품목", itemName: "희귀품목" },
      [{ item: "무관항목", niceClass: "01", similarGroupCode: "G0001" }]
    );
    assert.strictEqual(result.noticeName, null);
    assert.strictEqual(result.niceClass, null);
    ok("후보 중 일치하는 게 없으면 noticeName이 null로 남음(새 이름을 지어내지 않음)");
  }

  console.log("8) reviewClient.reviewItem — 모델이 범위 밖 인덱스를 보내도 방어적으로 -1 처리");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            id: "toolu_3",
            name: "submit_item_review",
            // strict:true라도 방어적으로 검증 — candidates 길이(1)를 벗어난 인덱스
            input: { candidateIndex: 5, note: "이상한 응답" },
          },
        ],
      }),
    });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.reviewItem(
      { rawItemName: "품목", itemName: "품목" },
      [{ item: "후보1", niceClass: "01", similarGroupCode: "G0001" }]
    );
    assert.strictEqual(result.noticeName, null, "범위 밖 인덱스는 -1(해당 없음)로 취급돼야 함");
    ok("범위를 벗어난 candidateIndex를 안전하게 -1로 처리");
  }

  console.log("9) ruleNormalizer — 정확 매칭과 검토 대기열 분리");
  {
    const dictionary = makeDictionary([
      { item: "신선한 사과", niceClass: "31", similarGroupCode: "G0211" },
      { item: "사과나무", niceClass: "31", similarGroupCode: "G0102" },
      { item: "탈", niceClass: "28", similarGroupCode: "G0301" },
    ]);
    const region = { sido: "경상북도", sigungu: "안동시" };
    assert.strictEqual(cleanItemName("안동사과, 부사", region), "사과");

    const exact = normalizeByRules(
      { ...region, rawItemName: "안동사과, 부사", source: "농사로" },
      dictionary,
      { topK: 5 }
    );
    assert.strictEqual(exact.status, "ok");
    assert.strictEqual(exact.noticeName, "신선한 사과");
    assert.strictEqual(exact.niceClass, "31");
    assert.strictEqual(exact.matchMethod, "rule_fresh");
    assert.strictEqual(exact.source, "농사로");

    const excluded = normalizeByRules(
      { ...region, rawItemName: "안동사과나무" },
      dictionary,
      { topK: 5 }
    );
    assert.strictEqual(excluded.status, "ok");
    assert.strictEqual(excluded.excluded, true);
    assert.strictEqual(excluded.matchMethod, "rule_excluded");

    const unresolved = normalizeByRules(
      { ...region, rawItemName: "안동하회탈" },
      dictionary,
      { topK: 5 }
    );
    assert.strictEqual(unresolved.status, "review_required");
    assert.match(unresolved.reviewCandidates, /"item":"탈"/);
    ok("확실한 행만 규칙으로 확정하고 애매한 행은 후보와 함께 별도 검토 대상으로 남김");
  }

  console.log("10) normalizeRow — 규칙 처리 오류를 행별로 보존");
  {
    const result = normalizeRow(
      { sido: "경상북도", sigungu: "안동시", rawItemName: "안동사과", source: "농사로" },
      { dictionary: null, topK: 5 }
    );
    assert.strictEqual(result.status, "error");
    assert.ok(result.error);
    assert.strictEqual(result.source, "농사로");
    ok("규칙 처리 오류도 원본·출처와 함께 결과 행에 보존됨");
  }

  console.log("11) normalizeItems CLI — API 키 없이 결과와 검토 대기열 생성");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-normalize-rules-"));
    const inputPath = path.join(tempDir, "input.csv");
    const outputPath = path.join(tempDir, "normalized.csv");
    const reviewPath = path.join(tempDir, "review-required.csv");
    try {
      fs.writeFileSync(
        inputPath,
        "\ufeffsido,sigungu,rawItemName,source\n경상북도,안동시,\"안동사과, 부사\",test\n경상북도,안동시,안동하회탈,test\n",
        "utf8"
      );
      const result = spawnSync(
        process.execPath,
        [
          path.join(__dirname, "normalizeItems.js"),
          "--input", inputPath,
          "--out", outputPath,
          "--review-out", reviewPath,
        ],
        { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } }
      );
      assert.strictEqual(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /flush/, "Node 로그에 Python식 flush 옵션이 출력되면 안 됨");
      const output = fs.readFileSync(outputPath, "utf8");
      const review = fs.readFileSync(reviewPath, "utf8");
      assert.match(output, /rule_fresh/);
      assert.match(output, /review_required/);
      assert.strictEqual(review.trim().split(/\r?\n/).length, 2, "검토 CSV에는 헤더와 미확정 1행만 있어야 함");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    ok("Anthropic 키 없이 규칙 결과와 검토 전용 CSV를 분리 생성함");
  }

  console.log("12) reviewWithAi.parseCandidates — reviewCandidates JSON 안전 파싱");
  {
    assert.deepStrictEqual(
      parseCandidates({ reviewCandidates: '[{"item":"탈","niceClass":"28","similarGroupCode":"G0301","score":0.5}]' }),
      [{ item: "탈", niceClass: "28", similarGroupCode: "G0301", score: 0.5 }]
    );
    assert.deepStrictEqual(parseCandidates({ reviewCandidates: "" }), []);
    assert.deepStrictEqual(parseCandidates({ reviewCandidates: "깨진 json" }), [], "파싱 실패 시 빈 배열로 안전하게 처리");
    ok("reviewCandidates 컬럼을 안전하게 파싱하고, 손상된 값은 빈 배열로 처리");
  }

  console.log("13) reviewWithAi CLI — review-required.csv만 검토하고 규칙 결과는 그대로 보존");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-review-ai-"));
    const reviewInputPath = path.join(tempDir, "review-required.csv");
    const outputPath = path.join(tempDir, "review-required-ai.csv");
    try {
      const row = {
        sido: "경상북도",
        sigungu: "안동시",
        rawItemName: "안동하회탈",
        source: "gi",
        itemName: "하회탈",
        noticeName: "",
        niceClass: "",
        similarGroupCode: "",
        excluded: "false",
        status: "review_required",
        matchMethod: "rule_unresolved",
        confidence: "",
        reviewReason: "정확히 일치하는 고시명칭이 없음",
        reviewCandidates: '[{"item":"탈","niceClass":"28","similarGroupCode":"G0301","score":0.5}]',
        error: "",
      };
      const csvLine = OUTPUT_FIELDS.map((f) => {
        const v = String(row[f] ?? "");
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",");
      fs.writeFileSync(reviewInputPath, `﻿${OUTPUT_FIELDS.join(",")}\n${csvLine}\n`, "utf8");

      const rows = readReviewCsv(reviewInputPath);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].status, "review_required");
      const candidates = parseCandidates(rows[0]);
      assert.strictEqual(candidates[0].item, "탈");
      ok("review-required.csv를 읽어 후보를 그대로 복원함 — 실제 API 호출은 reviewClient 단위 테스트로 커버");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
