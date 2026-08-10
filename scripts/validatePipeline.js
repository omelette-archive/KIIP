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
            applicationDate: "20250102",
            applicationStatus: "등록",
            classificationCode: "31",
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
    "--dry-run",
    "--out",
    planPath,
  ]);

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.strictEqual(plan.mode, "batch-dry-run");
  assert.strictEqual(plan.inputCount, 5);
  assert.strictEqual(plan.searchableRowCount, 3);
  assert.strictEqual(plan.uniqueQueryCount, 3);
  assert.strictEqual(plan.duplicateQueryRowCount, 0);
  assert.strictEqual(plan.estimatedMinRequestCount, 3);
  assert.strictEqual(plan.estimatedMaxRequestCount, 15);
  assert.strictEqual(plan.skippedCount, 2);
  assert.deepStrictEqual(
    plan.results.map((row) => row.status),
    ["planned", "planned", "planned", "skipped", "skipped"]
  );
  console.log("[validatePipeline] ②→③ 계약 통과 (5행: 호출 예정 3, 건너뜀 2)");

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
  const andongApple = analysis.regionItems.find((row) => row.itemName === "신선한 사과");
  assert.deepStrictEqual(andongApple.sources, ["지리적표시"], "③의 source가 ④ 버킷까지 전파돼야 함");
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
  assert.strictEqual(gap.ranking[0].itemName, "신선한 사과");
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
}

function main() {
  validateSyntax();
  for (const phase of ["01", "02", "03", "04", "05", "06"]) {
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
