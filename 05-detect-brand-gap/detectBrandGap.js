#!/usr/bin/env node
"use strict";
/**
 * ④단계 분석 JSON(regionItems)만 입력으로 받아 결정론적 브랜드 공백 점수를 계산한다.
 * 외부 생성형 AI를 쓰지 않는다(이슈 #16) — 동일 입력은 항상 동일 출력을 낸다.
 *
 * 사용법:
 *   node 05-detect-brand-gap/detectBrandGap.js --input 04-analyze-brand/output/analysis.json \
 *     --out 05-detect-brand-gap/output/gap.json
 */

const fs = require("fs");
const path = require("path");
const {
  GAP_SCORE_VERSION,
  REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD,
  regionalMetricAvailable,
  regionalTrademarkCount,
  regionalRegistrationRate,
  scoreBucket,
} = require("./lib/scorer");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    args[key] = hasValue ? next : true;
    if (hasValue) i++;
  }
  return args;
}

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 05-detect-brand-gap/detectBrandGap.js --input <04단계 analysis.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>   결과 JSON 저장 경로 (기본: 05-detect-brand-gap/output/gap.json)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

/**
 * @param {object} analysis ④단계 analyzeEntries() 출력
 */
function detectGaps(analysis) {
  if (!analysis || !Array.isArray(analysis.regionItems)) {
    throw new Error("입력은 ④단계 analysis.json이어야 합니다 (regionItems 배열 필요).");
  }

  const rows = analysis.regionItems.map((bucket) => {
    const scored = scoreBucket(bucket);
    return {
      region: bucket.region,
      sido: bucket.sido,
      sigungu: bucket.sigungu,
      itemName: bucket.itemName,
      noticeName: bucket.noticeName,
      niceClass: bucket.niceClass,
      sources: bucket.sources,
      sourceProvenance: bucket.sourceProvenance || [],
      uniqueTrademarkCount: regionalMetricAvailable(bucket) ? regionalTrademarkCount(bucket) : null,
      registrationRate: regionalMetricAvailable(bucket) ? regionalRegistrationRate(bucket) : null,
      nationwideSearchTrademarkCount:
        bucket.nationwideSearchTrademarkCount ?? bucket.uniqueTrademarkCount ?? 0,
      regionalUniqueTrademarkCount: bucket.regionalUniqueTrademarkCount ?? null,
      regionalMetricAvailability:
        bucket.regionalMetricAvailability || (regionalMetricAvailable(bucket) ? "available" : "blocked"),
      regionalMetricBlockingReasons: bucket.regionalMetricBlockingReasons || [],
      // ③단계 페이지·hit·요청 상한에 걸려 부분 수집된 검색 수 — ⑥-2가 "사람이 봐야 할" 후보를
      // 고를 때 근거가 불완전한 행을 가려내는 데 쓴다(이슈 #16).
      partialQueryCount: bucket.partialQueryCount || 0,
      regionMatchVerified: regionalMetricAvailable(bucket),
      localApplicantShare: bucket.localApplicantShare,
      goodsMatchCounts: bucket.goodsMatchCounts || null,
      goodsConfirmedHitCount: bucket.goodsConfirmedHitCount || 0,
      goodsReviewRequiredHitCount: bucket.goodsReviewRequiredHitCount || 0,
      goodsMismatchHitCount: bucket.goodsMismatchHitCount || 0,
      goodsVerificationRate: bucket.goodsVerificationRate ?? null,
      ...scored,
    };
  });

  const ranking = rows
    .filter((row) => row.representative && row.gapScore !== null)
    .slice()
    .sort(
      (a, b) =>
        b.gapScore - a.gapScore ||
        String(a.region).localeCompare(String(b.region), "ko") ||
        String(a.itemName).localeCompare(String(b.itemName), "ko")
    );

  const warnings = [
    "대표 특산품 판정 기준(GI 출처 또는 상표 출원 3건 이상)은 #29에서 확정됐지만, 활용도 " +
      "포화 건수·가중치는 아직 예시값이다(scoreVersion 참고) — 실제 기준 확정 후 " +
      "05-detect-brand-gap/lib/scorer.js만 교체하면 된다.",
    "지역 상표 건수·등록률·공백 점수는 ③단계 --enrich-registry 주소 귀속과 검색 수집이 모두 " +
      "완료된 행만 계산한다. 미검증 전국 검색 hit는 nationwideSearchTrademarkCount 참고값으로만 보존한다.",
    "지정상품 normalized_contains/class_only 후보는 #12 기준 확정 전 고유 상표 합계에서 자동 제외하지 않는다.",
  ];
  const blockedCount = rows.filter((row) => row.scoreAvailability === "blocked").length;
  if (blockedCount > 0) {
    warnings.push(
      `${blockedCount}개 지역×품목은 지역 귀속 또는 검색 수집이 불완전해 공백 점수를 차단했습니다(#50).`
    );
  }
  const nonRepresentativeCount = rows.filter((row) => row.representative === false).length;
  if (nonRepresentativeCount > 0) {
    warnings.push(
      `${nonRepresentativeCount}개 지역×품목은 대표 특산품 판정 기준을 충족하지 않아 순위에서 제외됨.`
    );
  }

  return {
    schemaVersion: "1.0",
    scoreVersion: GAP_SCORE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: analysis.generatedAt || null,
    provenance: {
      inputSchemaVersion: analysis.schemaVersion || null,
      inputAnalysisVersion: analysis.analysisVersion || null,
      upstream: analysis.provenance || null,
    },
    methodology: {
      representativeBasis:
        `sources에 지리적표시가 포함되었거나 고유 상표 출원이 ${REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD}건 ` +
        "이상인 지역×품목을 대표 특산품으로 인정(#29 확정, 2026-08-11)",
      activityBasis: "고유 상표 5건을 포화 1.0으로 정규화(예시 기준, 미확정)",
      weights: { activity: 0.7, registration: 0.3 },
      weightsConfirmed: false,
      regionalCountBasis: "출원인 주소가 해당 지역 inside로 검증된 고유 출원만 사용",
      regionalMetricGate: "검색 수집과 모든 저장 hit의 주소 귀속이 완료된 행만 점수 계산(#50)",
      localApplicantShareIncluded: false,
      designatedGoodsPolicy:
        "normalized_exact만 확정 근거; 후보·불일치는 메타데이터로 보존하고 점수 입력은 기존 합계 유지",
      designatedGoodsCriteriaIssue: "#12",
      rationale: "전국 검색 결과를 지역 활동량으로 오인하지 않도록 미검증 행의 점수를 차단",
      criteriaIssue: "#29",
      lastUpdatedAt: "2026-08-11",
    },
    warnings,
    rows,
    ranking,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "gap.json"));

  let analysis;
  try {
    analysis = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`입력 JSON을 읽을 수 없습니다 (${inputPath}): ${error.message}`);
  }

  const result = detectGaps(analysis);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.error(
    `[detectBrandGap] rows=${result.rows.length}, ranked=${result.ranking.length} -> ${outPath}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[detectBrandGap] 실패: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { detectGaps, parseArgs };
