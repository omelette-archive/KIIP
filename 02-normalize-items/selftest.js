#!/usr/bin/env node
"use strict";
/**
 * 실제 API 키 없이 규칙 기반 정규화 파이프라인을 검증한다. 외부 AI 호출은 이 단계에
 * 전혀 쓰지 않는다 — review_required로 남는 행은 별도 사람 검토 대상이며, 이 저장소는
 * 그 검토를 자동화하지 않는다(이유: docs/data-pipeline-contracts.md 참고).
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
const { normalizeRow } = require("./normalizeItems");
const { applyManualReviews } = require("./applyManualReviews");
const { cleanItemName, normalizeByRules } = require("./lib/ruleNormalizer");

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

  console.log("5) ruleNormalizer — 정확 매칭과 검토 대기열 분리");
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
    ok("확실한 행만 규칙으로 확정하고 애매한 행은 후보와 함께 별도 검토 대상으로 남김(AI 호출 없음)");
  }

  console.log("6) normalizeRow — 규칙 처리 오류를 행별로 보존");
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

  console.log("7) 수동 검토 결정 — 후보 승인/제외/감사 이력 검증");
  {
    const pending = {
      inputIndex: "3",
      sido: "경상북도",
      sigungu: "안동시",
      rawItemName: "안동하회탈",
      itemName: "하회탈",
      noticeName: "",
      niceClass: "",
      similarGroupCode: "",
      excluded: "false",
      status: "review_required",
      matchMethod: "rule_unresolved",
      confidence: "",
      reviewReason: "정확히 일치하는 고시명칭이 없음",
      reviewCandidates: JSON.stringify([
        { item: "탈", niceClass: "28", similarGroupCode: "G0301", score: 0.5 },
      ]),
      reviewDecision: "",
      selectedCandidateIndex: "",
      reviewNote: "",
      reviewedBy: "",
      reviewedAt: "",
      error: "",
    };
    const approved = applyManualReviews([pending], [{
      inputIndex: "3",
      reviewDecision: "approve_candidate",
      selectedCandidateIndex: "0",
      reviewNote: "고시명칭 후보 확인",
      reviewedBy: "reviewer@example.org",
      reviewedAt: "2026-08-07T01:00:00Z",
    }])[0];
    assert.strictEqual(approved.status, "ok");
    assert.strictEqual(approved.noticeName, "탈");
    assert.strictEqual(approved.matchMethod, "manual_candidate");
    assert.strictEqual(approved.reviewedBy, "reviewer@example.org");

    const excluded = applyManualReviews([pending], [{
      inputIndex: "3",
      reviewDecision: "exclude",
      reviewedBy: "reviewer@example.org",
      reviewedAt: "2026-08-07T01:00:00Z",
    }])[0];
    assert.strictEqual(excluded.status, "ok");
    assert.strictEqual(excluded.excluded, true);
    assert.strictEqual(excluded.matchMethod, "manual_excluded");

    assert.throws(
      () => applyManualReviews([pending], [{
        inputIndex: "3",
        reviewDecision: "approve_candidate",
        selectedCandidateIndex: "9",
        reviewedBy: "reviewer@example.org",
        reviewedAt: "2026-08-07T01:00:00Z",
      }]),
      /후보 9가 존재하지 않습니다/
    );
    assert.throws(
      () => applyManualReviews([pending], [{
        inputIndex: "3",
        reviewDecision: "exclude",
        reviewedAt: "2026-08-07T01:00:00Z",
      }]),
      /reviewedBy가 필요합니다/
    );
    ok("사람은 기존 후보 승인·제외·보류만 가능하고 최종 결정에는 검토자와 시각이 필수");
  }

  console.log("8) normalizeItems CLI — 외부 API 키 전혀 없이 결과와 검토 대기열 생성");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-normalize-rules-"));
    const inputPath = path.join(tempDir, "input.csv");
    const outputPath = path.join(tempDir, "normalized.csv");
    const reviewPath = path.join(tempDir, "review-required.csv");
    try {
      fs.writeFileSync(
        inputPath,
        "﻿sido,sigungu,rawItemName,source,sourceId,sourceContractVersion,sourceUrl,sourceLastVerifiedAt,collectedAt\n" +
        "경상북도,안동시,\"안동사과, 부사\",test,gi,provider-live-api,https://www.data.go.kr/data/15080629/openapi.do,2026-08-10,2026-08-10T01:00:00.000Z\n" +
        "경상북도,안동시,안동하회탈,test,gi,provider-live-api,https://www.data.go.kr/data/15080629/openapi.do,2026-08-10,2026-08-10T01:00:00.000Z\n",
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
        { encoding: "utf8" }
      );
      assert.strictEqual(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /flush/, "Node 로그에 Python식 flush 옵션이 출력되면 안 됨");
      const output = fs.readFileSync(outputPath, "utf8");
      const review = fs.readFileSync(reviewPath, "utf8");
      assert.match(output, /rule_fresh/);
      assert.match(output, /review_required/);
      assert.match(output, /^﻿?inputIndex,/);
      assert.match(output, /reviewDecision,selectedCandidateIndex,reviewNote,reviewedBy,reviewedAt/);
      assert.match(output, /specialty-normalization-rules-v1/);
      assert.match(output, /kipo-notice-goods-13-2026/);
      assert.match(output, /kipo\.go\.kr/);
      assert.match(output, /sourceId,sourceContractVersion,sourceUrl,sourceLastVerifiedAt,sourceFetchedAt/);
      assert.match(output, /provider-live-api/);
      assert.match(output, /2026-08-10T01:00:00.000Z/);
      assert.strictEqual(review.trim().split(/\r?\n/).length, 2, "검토 CSV에는 헤더와 미확정 1행만 있어야 함");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    ok("규칙 결과와 검토 전용 CSV를 API 키 없이 분리 생성함 — review-required.csv는 사람이 별도로 검토");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
