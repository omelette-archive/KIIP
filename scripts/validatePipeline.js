#!/usr/bin/env node
"use strict";

/**
 * 외부 API 키 없이 실행하는 전체 파이프라인 회귀 검증.
 * 로컬과 GitHub Actions가 같은 진입점을 사용하도록 의존성 없는 Node 스크립트로 유지한다.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PHASE_DIR_PATTERN = /^\d{2}-/;

function runNode(label, args) {
  console.log(`\n[validatePipeline] ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} 실패 (exit=${result.status})`);
  }
}

function collectJavaScriptFiles(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJavaScriptFiles(fullPath, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(fullPath);
  }
  return output;
}

function validateSyntax() {
  const phaseDirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PHASE_DIR_PATTERN.test(entry.name))
    .map((entry) => path.join(ROOT, entry.name));
  const files = phaseDirs.flatMap((dir) => collectJavaScriptFiles(dir));
  files.push(...collectJavaScriptFiles(path.join(ROOT, "scripts")));
  files.sort();

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const result = spawnSync(process.execPath, ["--check", relative], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || "");
      throw new Error(`JavaScript 구문 검사 실패: ${relative}`);
    }
  }
  console.log(`[validatePipeline] JavaScript 구문 검사 ${files.length}개 통과`);
}

function writeStage3Fixture(filePath) {
  const fixture = {
    mode: "batch",
    schemaVersion: "1.1",
    ipRegistryEnrichment: {
      enabled: true,
      status: "complete",
      completeRegistrationCount: 1,
      errorRegistrationCount: 0,
      notCollectedRegistrationCount: 0,
      sourceMetadata: {
        sourceId: "ip_registry",
        contractVersion: "ip-registry-mark-history-v1",
        fetchedAt: "2026-08-11T00:00:00Z",
      },
      policy: {
        applicantRegionMatchVersion: "ip-registry-applicant-region-v1",
        goodsMatchVersion: "ip-registry-designated-goods-v0-review",
      },
    },
    inputCount: 2,
    successCount: 1,
    errorCount: 0,
    skippedCount: 1,
    results: [
      {
        status: "ok",
        collectionStatus: "complete",
        stopReason: "source_exhausted",
        inputIndex: 0,
        source: "지리적표시",
        input: {
          sido: "경상북도",
          sigungu: "안동시",
          rawItemName: "안동사과",
          itemName: "사과",
          noticeName: "신선한 사과",
          niceClass: "31",
          status: "ok",
          source: "지리적표시",
        },
        query: {
          region: "경상북도 안동시",
          regionMatch: "unverified",
          item: "신선한 사과",
          classCode: "31",
        },
        keywordTotalCount: 7,
        page: {
          number: 1,
          size: 20,
          unfilteredCount: 1,
          filteredCount: 1,
          hasMore: false,
        },
        hits: [
          {
            title: "안동사과",
            applicant: "예시 영농조합",
            applicationNumber: "40-2025-0000001",
            registrationNumber: "40-1234567-0000",
            applicationDate: "20250102",
            applicationStatus: "등록",
            classificationCode: "31",
            ipRegistryStatus: "complete",
            applicantRegionMatch: "inside",
            applicantRegionMatchSource: "ip_registry_applicant_address",
            goodsMatchMethod: "normalized_exact",
          },
        ],
      },
      {
        status: "skipped",
        inputIndex: 1,
        reason: "상위 단계 status=review_required",
        input: {
          sido: "경상북도",
          sigungu: "안동시",
          rawItemName: "안동하회탈",
          itemName: "하회탈",
          noticeName: "",
          niceClass: "",
          excluded: "false",
          status: "review_required",
        },
      },
    ],
  };
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), "utf8");
}

function validateContracts(tempDir) {
  const normalizedPath = path.join(tempDir, "normalized.csv");
  const reviewPath = path.join(tempDir, "review-required.csv");
  const planPath = path.join(tempDir, "batch-plan.json");
  const stage3Path = path.join(tempDir, "stage3-result.json");
  const analysisPath = path.join(tempDir, "analysis.json");
  const gapPath = path.join(tempDir, "gap.json");
  const strategyPath = path.join(tempDir, "strategy.json");
  const dashboardPath = path.join(tempDir, "dashboard-snapshot.json");

  runNode("② 샘플 정규화", [
    "02-normalize-items/normalizeItems.js",
    "--input",
    "samples/specialties.csv",
    "--out",
    normalizedPath,
    "--review-out",
    reviewPath,
  ]);
  runNode("③ 배치 dry-run", [
    "03-match-trademarks/matchTrademarks.js",
    "--input",
    normalizedPath,
    "--include-review-required",
    "--dry-run",
    "--out",
    planPath,
  ]);

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.strictEqual(plan.mode, "batch-dry-run");
  assert.strictEqual(plan.inputCount, 5);
  // 검토대기(review_required) 행도 고시명칭이 아니라 원물명(itemName)으로 검색 계획에
  // 포함한다(2026-08-12) — "안동하회탈"(하회탈)이 4번째 planned 행이다. excluded=true인
  // "안동사과나무"만 계속 건너뛴다.
  assert.strictEqual(plan.searchableRowCount, 4);
  assert.strictEqual(plan.uniqueQueryCount, 4);
  assert.strictEqual(plan.duplicateQueryRowCount, 0);
  assert.strictEqual(plan.estimatedMinRequestCount, 4);
  assert.strictEqual(plan.estimatedMaxRequestCount, 20);
  assert.strictEqual(plan.skippedCount, 1);
  assert.deepStrictEqual(
    plan.results.map((row) => row.status),
    ["planned", "planned", "planned", "skipped", "planned"]
  );
  assert.strictEqual(plan.results[4].query.item, "하회탈");
  assert.strictEqual(plan.results[4].query.classCode, null);
  console.log("[validatePipeline] ②→③ 계약 통과 (5행: 호출 예정 4[검토대기 원물명 포함], 건너뜀 1)");

  writeStage3Fixture(stage3Path);
  runNode("④ 분석 CLI", [
    "04-analyze-brand/analyzeBrands.js",
    "--input",
    stage3Path,
    "--out",
    analysisPath,
    "--asOfYear",
    "2026",
  ]);
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  assert.strictEqual(analysis.summary.queryCount, 2);
  assert.strictEqual(analysis.summary.successfulQueryCount, 1);
  assert.strictEqual(analysis.summary.skippedQueryCount, 1);
  assert.strictEqual(analysis.summary.sourceTotalCount, 7);
  assert.strictEqual(analysis.summary.uniqueTrademarkCount, 1);
  assert.ok(!analysis.regionItems.some((row) => row.region === "미지정 지역"));
  const andongApple = analysis.regionItems.find(
    (row) => row.itemName === "사과" && row.noticeName === "신선한 사과"
  );
  assert.deepStrictEqual(andongApple.sources, ["지리적표시"], "③의 source가 ④ 버킷까지 전파돼야 함");
  assert.strictEqual(andongApple.localApplicantShare, 1);
  assert.strictEqual(andongApple.goodsConfirmedHitCount, 1);
  assert.ok(analysis.provenance.sources.some((source) => source.sourceId === "ip_registry"));
  console.log("[validatePipeline] ③→④ 계약 통과 (성공/건너뜀/전체건수 보존, source 전파)");

  runNode("⑤ 브랜드 공백 점수 계산", [
    "05-detect-brand-gap/detectBrandGap.js",
    "--input",
    analysisPath,
    "--out",
    gapPath,
  ]);
  const gap = JSON.parse(fs.readFileSync(gapPath, "utf8"));
  assert.strictEqual(gap.rows.length, analysis.regionItems.length);
  assert.strictEqual(gap.ranking.length, 1, "지리적표시 출처 1건만 대표 특산품으로 랭킹에 남아야 함");
  assert.strictEqual(gap.ranking[0].itemName, "사과");
  assert.ok(typeof gap.ranking[0].gapScore === "number");
  console.log("[validatePipeline] ④→⑤ 계약 통과 (대표 특산품만 랭킹, 점수 산출)");

  runNode("⑥ 고정 템플릿 전략 초안", [
    "06-generate-business-strategy/generateStrategy.js",
    "--input",
    gapPath,
    "--out",
    strategyPath,
  ]);
  const strategy = JSON.parse(fs.readFileSync(strategyPath, "utf8"));
  assert.strictEqual(strategy.summary.briefingCount, gap.ranking.length);
  assert.ok(strategy.briefings[0].sentences.length > 0);
  assert.ok(!strategy.briefings[0].sentences[0].includes("은(는)"), "조사가 은/는 중 하나로 확정돼야 함");
  console.log("[validatePipeline] ⑤→⑥ 계약 통과 (고정 템플릿 문장 생성, AI 미사용)");

  runNode("⑦ 대시보드 통합 스냅샷", [
    "07-dashboard/buildDashboardSnapshot.js",
    "--analysis",
    analysisPath,
    "--gap",
    gapPath,
    "--strategy",
    strategyPath,
    "--mode",
    "sample",
    "--out",
    dashboardPath,
  ]);
  const dashboard = JSON.parse(fs.readFileSync(dashboardPath, "utf8"));
  assert.strictEqual(dashboard.schemaVersion, "dashboard-snapshot-v1");
  assert.strictEqual(dashboard.mode, "sample");
  assert.strictEqual(dashboard.coverage.regionItemCount, analysis.regionItems.length);
  assert.strictEqual(dashboard.rankings.length, gap.ranking.length);
  assert.strictEqual(dashboard.briefings.length, strategy.briefings.length);
  assert.ok(dashboard.regions.every((region) => region.regionCode));
  const dashboardItem = dashboard.regions[0].items.find(
    (item) => item.noticeName === "신선한 사과" || item.itemName === "신선한 사과"
  );
  assert.strictEqual(dashboardItem.metrics.localApplicantShare.availability, "available");
  assert.strictEqual(dashboardItem.metrics.confirmedGoodsMatchCount.value, 1);
  assert.ok(dashboardItem.metrics.confirmedGoodsMatchCount.sourceIds.includes("ip_registry"));
  assert.ok(dashboard.warnings.some((warning) => warning.includes("전국 모집단")));
  console.log("[validatePipeline] ④·⑤·⑥→⑦ 계약 통과 (샘플·상태·출처·버전 보존)");
}

function main() {
  // 2026-08-24: 로컬 보안 소프트웨어가 orca 폴더 안 데이터 파일을 주기적으로 잠그고
  // .sLDH로 격리하는 문제가 반복돼(사용자 보고), 검증을 시작하기 전에 먼저 자동 복구한다.
  // git 추적 파일은 여기서 즉시 복구되고, 미추적 파일이 남으면(있어선 안 되는 경우) 다른
  // 검증 단계처럼 실패로 처리해 사람이 확인하게 한다.
  runNode("잠긴 데이터 파일 자동 복구", ["scripts/restoreLockedDataFiles.js"]);
  validateSyntax();
  runNode("dashboard snapshot audit selftest", ["scripts/auditDashboardSnapshot.selftest.js"]);
  runNode("dashboard public snapshot audit", [
    "scripts/auditDashboardSnapshot.js",
    "--input",
    "07-dashboard/web/public/data/dashboard-snapshot.json",
  ]);
  runNode("운영 실행기 자체 테스트", ["scripts/runOperationalPipeline.selftest.js"]);
  runNode("③→⑦ 재생성 실행기 자체 테스트", ["scripts/regenerateAnalysisFromMatch.selftest.js"]);
  runNode("GitHub Pages 산출물 허브 생성", ["scripts/testArtifactSite.js"]);
  for (const phase of ["01", "02", "03", "04", "05", "06", "07"]) {
    const directory = fs
      .readdirSync(ROOT)
      .find((name) => name.startsWith(`${phase}-`));
    runNode(`${phase} 자체 테스트`, [path.join(directory, "selftest.js")]);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-pipeline-validation-"));
  try {
    validateContracts(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log("\n[validatePipeline] 모든 지속 검증 통과");
}

try {
  main();
} catch (error) {
  console.error(`\n[validatePipeline] 실패: ${error.message}`);
  process.exit(1);
}
