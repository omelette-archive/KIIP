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
const { NORMALIZATION_VERSION, normalizeRow } = require("./normalizeItems");
const { applyManualReviews } = require("./applyManualReviews");
const { approvedAliases, cleanItemName, normalizeByRules } = require("./lib/ruleNormalizer");
const { summarizeReviewRows, summaryCsv } = require("./lib/reviewClusters");

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

  console.log("3-1) candidateSearch.findCandidates — 문자열 중간 우연 포함은 강한 신호로 인정하지 않음(#51)");
  {
    // "단감"이 "옷단감치는 기계"의 접두/접미가 아니라 문자열 중간에 우연히 끼어든
    // 사례(2026-08-14 검토대기 표본검사에서 발견). 접두/접미 경계 포함만 +0.5 보너스를
    // 받아야 하고, 이런 무관 항목이 최상위 후보로 올라오면 안 된다.
    const dictionary = makeDictionary([
      { item: "옷단감치는 기계", niceClass: "07", similarGroupCode: "G9901" },
      { item: "감", niceClass: "31", similarGroupCode: "G0101" },
    ]);
    const candidates = findCandidates("단감", dictionary, {}, { topK: 5 });
    const machine = candidates.find((c) => c.item === "옷단감치는 기계");
    assert.ok(!machine || machine.score < 0.5, "중간에 끼어든 문자열은 경계 포함 보너스를 받으면 안 됨");
    ok("접두/접미 경계에서 포함될 때만 강한 신호로 인정해 무관한 문자열 중간 일치를 걸러냄");
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
    assert.strictEqual(exact.verdictSource, "algorithm", "신선한/미가공 접두어 자동 매칭은 사람 승인이 아니라 알고리즘 판정으로 표시돼야 함(#51)");
    assert.strictEqual(exact.source, "농사로");

    const literalMatch = normalizeByRules(
      { ...region, rawItemName: "탈" },
      dictionary,
      { topK: 5 }
    );
    assert.strictEqual(literalMatch.matchMethod, "rule_exact");
    assert.strictEqual(literalMatch.verdictSource, "exact", "원물명이 사전과 완전히 같으면 판단의 여지가 없는 exact여야 함");

    const excluded = normalizeByRules(
      { ...region, rawItemName: "안동사과나무" },
      dictionary,
      { topK: 5 }
    );
    assert.strictEqual(excluded.status, "ok");
    assert.strictEqual(excluded.excluded, true);
    assert.strictEqual(excluded.matchMethod, "rule_excluded");
    assert.strictEqual(excluded.verdictSource, "excluded");

    const unresolved = normalizeByRules(
      { ...region, rawItemName: "안동하회탈" },
      dictionary,
      { topK: 5 }
    );
    assert.strictEqual(unresolved.status, "review_required");
    assert.strictEqual(unresolved.verdictSource, "unresolved");
    assert.match(unresolved.reviewCandidates, /"item":"탈"/);
    ok("확실한 행만 규칙으로 확정하고 애매한 행은 후보와 함께 별도 검토 대상으로 남김(AI 호출 없음)");
  }

  console.log("5-1) 사용자 승인 별칭 — 승인 묶음만 공식 고시명칭으로 자동 확정");
  {
    const dictionary = makeDictionary([
      { item: "신선한 고추", niceClass: "31", similarGroupCode: "G0202" },
      { item: "신선한 토마토", niceClass: "31", similarGroupCode: "G0202" },
      { item: "신선한 호박", niceClass: "31", similarGroupCode: "G0202" },
      { item: "신선한 멜론", niceClass: "31", similarGroupCode: "G0211" },
      { item: "생버섯", niceClass: "31", similarGroupCode: "G0202" },
      { item: "소고기", niceClass: "29", similarGroupCode: "G0701" },
      { item: "꿀", niceClass: "30", similarGroupCode: "G0302" },
      { item: "생밤", niceClass: "31", similarGroupCode: "G0211" },
      { item: "신선한 키위", niceClass: "31", similarGroupCode: "G0211" },
      { item: "꽃", niceClass: "31", similarGroupCode: "G0212" },
    ]);
    const expected = new Map([
      ["파프리카", "신선한 고추"],
      ["풋고추", "신선한 고추"],
      ["꽈리고추", "신선한 고추"],
      ["방울토마토", "신선한 토마토"],
      ["애호박", "신선한 호박"],
      ["단호박", "신선한 호박"],
      ["메론", "신선한 멜론"],
      ["느타리버섯", "생버섯"],
      ["새송이버섯", "생버섯"],
      ["팽이버섯", "생버섯"],
      ["한우", "소고기"],
      ["벌꿀", "꿀"],
      ["밤", "생밤"],
      ["참다래", "신선한 키위"],
      ["화훼", "꽃"],
    ]);
    for (const [rawItemName, noticeName] of expected) {
      const result = normalizeByRules({ rawItemName, source: "농사로" }, dictionary);
      assert.strictEqual(result.status, "ok", rawItemName);
      assert.strictEqual(result.itemName, rawItemName, `${rawItemName}: itemName은 원물명 그대로 유지해야 함(별칭이 대체하지 않음)`);
      assert.strictEqual(result.noticeName, noticeName, rawItemName);
      assert.strictEqual(result.matchMethod, "rule_approved_alias", rawItemName);
      assert.strictEqual(result.confidence, "1.0000", rawItemName);
      assert.strictEqual(result.verdictSource, "human_approved_alias", rawItemName);
    }
    for (const rawItemName of ["단감", "잡곡", "오미자", "매실", "대추"]) {
      const result = normalizeByRules({ rawItemName, source: "농사로" }, dictionary);
      assert.strictEqual(result.status, "review_required", `${rawItemName}은 미승인 상태여야 함`);
    }
    assert.strictEqual(approvedAliases.approvalIssue, "#51");
    assert.strictEqual(approvedAliases.approvedAt, "2026-08-12");
    ok("승인된 15개 표현만 자동 확정하고, itemName은 원물명 그대로 유지하며 noticeName만 연결, 미승인 의미 변경 후보는 검토대기에 유지");
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
      assert.ok(output.includes(NORMALIZATION_VERSION));
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

  console.log("9) 검토대기 군집 — 빈도·사유·후보 합의도와 원본 표현 보존");
  {
    const sharedCandidate = JSON.stringify([
      { item: "신선한 감", niceClass: "31", similarGroupCode: "G0211", score: 0.8 },
    ]);
    const summary = summarizeReviewRows([
      {
        inputIndex: "0", sido: "경상남도", sigungu: "창원시", rawItemName: "단감", itemName: "단감",
        sourceId: "nongsaro_local_specialty", status: "review_required",
        normalizationVersion: "rules-v1", dictionaryVersion: "dictionary-v1",
        reviewReason: "정확히 일치하는 고시명칭이 없음", reviewCandidates: sharedCandidate,
      },
      {
        inputIndex: "1", sido: "전라남도", sigungu: "나주시", rawItemName: "단 감", itemName: "단 감",
        sourceId: "nongsaro_local_specialty", status: "review_required",
        normalizationVersion: "rules-v1", dictionaryVersion: "dictionary-v1",
        reviewReason: "정확히 일치하는 고시명칭이 없음", reviewCandidates: sharedCandidate,
      },
      {
        inputIndex: "2", sido: "충청북도", sigungu: "제천시", rawItemName: "오미자", itemName: "오미자",
        sourceId: "nongsaro_local_specialty", status: "review_required",
        normalizationVersion: "rules-v1", dictionaryVersion: "dictionary-v1",
        reviewReason: "고시명칭 후보가 없음", reviewCandidates: "[]",
      },
      {
        inputIndex: "3", sido: "경상북도", sigungu: "안동시", rawItemName: "사과", itemName: "사과",
        status: "ok", reviewReason: "", reviewCandidates: "[]",
      },
    ], { topCandidates: 3, examples: 2 });
    assert.strictEqual(summary.inputRowCount, 4);
    assert.strictEqual(summary.reviewRowCount, 3);
    assert.strictEqual(summary.uniqueItemClusterCount, 2);
    assert.deepStrictEqual(summary.normalizationVersions, [{ name: "rules-v1", count: 3 }]);
    assert.deepStrictEqual(summary.dictionaryVersions, [{ name: "dictionary-v1", count: 3 }]);
    assert.strictEqual(summary.clusters[0].representativeItemName, "단감");
    assert.strictEqual(summary.clusters[0].rowCount, 2);
    assert.strictEqual(summary.clusters[0].regionCount, 2);
    assert.strictEqual(summary.clusters[0].candidateState, "same_candidate_present_in_all_rows");
    assert.strictEqual(summary.clusters[0].candidateOptions[0].coverage, 1);
    assert.strictEqual(summary.clusters[0].reviewDisposition, "human_review_required");
    assert.strictEqual(summary.clusters[1].candidateState, "no_candidates");
    const csv = summaryCsv(summary);
    assert.ok(csv.startsWith("\uFEFFgroupKey,"));
    assert.match(csv, /human_review_required/);
    ok("같은 원물명 변형을 결정론적으로 묶고 후보가 같아도 자동 승인하지 않음");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
