#!/usr/bin/env node
"use strict";

/**
 * #73 남은 범위 2 — 출원인 주소 재조회(경로 A/B) 또는 캐시 재적용을 마친 ③ 최종
 * 보강 JSON 하나로 ④ 분석 → ⑤ 공백 → ⑥ 전략 → ⑦ 스냅샷·후보 HTML을 한 번에
 * 재생성한다. 지금까지는 러너북 4.3절의 명령을 사람이 순서대로 직접 실행해야 했다.
 *
 * 외부 API를 호출하지 않는다. 입력은 이미 저장된 ③ 산출물이고, 각 단계는 기존
 * CLI를 그대로 부른다. runOperationalPipeline.js의 실행기(원자적 runDir 잠금,
 * 단계 실패 시 후속 중단, manifest 기록)를 재사용한다.
 *
 * 스냅샷 감사(audit_snapshot)는 계약 위반(errors)만 차단한다. 라이브 스냅샷에 이미
 * 있는 알려진 warnings(review 행 지역지표 노출, 미해결 행정코드 등)는 --strict로
 * 막으면 실제 데이터에서 항상 중단되므로, warnings는 regen-metadata.json에 기록만 한다.
 *
 * 함께 남기는 것(완료 조건: "④→⑦ 재생성 경로와 실행 메타데이터 기록"):
 * - region-match-coverage.json: ③ 스냅샷 기준 inside/outside/unverified 비율.
 *   --before를 주면 전후 델타까지.
 * - regen-metadata.json: 입력 파일 해시·계약/규칙 버전·실행시각·출력 경로·감사 결과.
 *
 * 사용법:
 *   node scripts/regenerateAnalysisFromMatch.js --input <③ 최종 보강 JSON> [옵션]
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  ROOT,
  defaultRunId,
  executePlan,
  nodeStage,
  publicPlan,
  validateRunId,
} = require("./runOperationalPipeline");

const DEFAULT_REGEN_ROOT = path.join(ROOT, ".kiip-operations", "regen");
const DEFAULT_RAW_GOODS_REVIEW = path.join(
  ROOT,
  "04-analyze-brand",
  "data",
  "raw-item-goods-review-v1.json"
);
const MAP_GEOMETRY = path.join(ROOT, "07-dashboard", "web", "public", "data", "map-geometry.json");
const STANDALONE_HTML_BUILDER = path.join(
  ROOT,
  "07-dashboard",
  "web",
  "scripts",
  "build-standalone-html.mjs"
);

const VALUE_FLAGS = new Map([
  ["--input", "input"],
  ["--before", "before"],
  ["--run-id", "runId"],
  ["--runs-dir", "runsDir"],
  ["--raw-goods-review", "rawGoodsReview"],
  ["--as-of-year", "asOfYear"],
  ["--mode", "mode"],
  ["--stage", "stage"],
]);

function parseArgs(argv) {
  const options = { dryRun: false, mode: "full", stage: "alpha" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (VALUE_FLAGS.has(arg)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} 값이 필요합니다.`);
      }
      options[VALUE_FLAGS.get(arg)] = argv[++index];
    } else {
      throw new Error(`지원하지 않는 옵션입니다: ${arg}`);
    }
  }
  if (!options.help && !options.input) throw new Error("--input 은 필수입니다.");
  if (!["sample", "full"].includes(options.mode)) {
    throw new Error("--mode 는 sample 또는 full 이어야 합니다.");
  }
  if (!["sample", "alpha", "production"].includes(options.stage)) {
    throw new Error("--stage 는 sample|alpha|production 중 하나여야 합니다.");
  }
  return options;
}

function printUsage() {
  console.log(
    [
      "사용법:",
      "  node scripts/regenerateAnalysisFromMatch.js --input <③ 최종 보강 JSON> [옵션]",
      "",
      "옵션:",
      "  --input <path>              재조회·캐시 재적용을 마친 ③ 산출물(필수)",
      "  --before <path>             전후 지역매칭 비율 델타의 기준선이 될 ③ 스냅샷",
      "  --run-id <id>               실행 식별자(기본: 타임스탬프)",
      "  --runs-dir <path>           실행별 산출물 디렉터리(기본: .kiip-operations/regen/runs)",
      "  --raw-goods-review <json>   ④ 승인 원물명 지정상품 검토본(기본: 저장소 검토본)",
      "  --as-of-year <year>         ④ 분석 기준 연도(기본: 현재 UTC 연도)",
      "  --mode <sample|full>        ⑦ 스냅샷 데이터 범위(기본: full)",
      "  --stage <sample|alpha|production>  ⑦ 실행 단계 표시(기본: alpha)",
      "  --dry-run                   실행 계획만 출력(파일 변경 없음)",
      "",
      "외부 API를 호출하지 않는다. 입력 ③ 산출물의 지역 근거를 그대로 ④~⑦에 흘려보낸다.",
    ].join("\n")
  );
}

function buildPlan(options = {}) {
  const runId = validateRunId(options.runId || defaultRunId(options.now));
  const runsDir = path.resolve(options.runsDir || path.join(DEFAULT_REGEN_ROOT, "runs"));
  const runDir = path.join(runsDir, runId);
  const inputPath = path.resolve(options.input);
  const beforePath = options.before ? path.resolve(options.before) : null;
  const rawGoodsReview = path.resolve(options.rawGoodsReview || DEFAULT_RAW_GOODS_REVIEW);
  const asOfYear = String(options.asOfYear || new Date().getUTCFullYear());

  const files = {
    analysis: path.join(runDir, "04-analysis.json"),
    gap: path.join(runDir, "05-gap.json"),
    strategy: path.join(runDir, "06-strategy.json"),
    snapshot: path.join(runDir, "07-dashboard-snapshot.json"),
    auditReport: path.join(runDir, "audit-report.json"),
    coverage: path.join(runDir, "region-match-coverage.json"),
    dashboardCandidate: path.join(runDir, "dashboard.candidate.html"),
    metadata: path.join(runDir, "regen-metadata.json"),
    manifest: path.join(runDir, "run-manifest.json"),
  };

  const coverageArgs = beforePath
    ? ["--before", beforePath, "--after", inputPath, "--out", files.coverage]
    : ["--input", inputPath, "--out", files.coverage];

  const stages = [
    nodeStage(
      "region_coverage",
      "③ 스냅샷 기준 inside/outside/unverified 비율(--before 주면 전후 델타)",
      "03-match-trademarks/summarizeRegionMatchCoverage.js",
      coverageArgs,
      [files.coverage]
    ),
    nodeStage(
      "04_analyze",
      "지역×품목 상표 분석(승인된 원물명 지정상품 검토 재적용)",
      "04-analyze-brand/analyzeBrands.js",
      [
        "--input",
        inputPath,
        "--out",
        files.analysis,
        "--asOfYear",
        asOfYear,
        "--raw-goods-review",
        rawGoodsReview,
      ],
      [files.analysis]
    ),
    nodeStage(
      "05_gap",
      "브랜드 공백 탐지",
      "05-detect-brand-gap/detectBrandGap.js",
      ["--input", files.analysis, "--out", files.gap],
      [files.gap]
    ),
    nodeStage(
      "06_strategy",
      "결정론적 전략 초안 생성",
      "06-generate-business-strategy/generateStrategy.js",
      ["--input", files.gap, "--out", files.strategy],
      [files.strategy]
    ),
    nodeStage(
      "07_snapshot",
      `${options.mode} 범위 · ${options.stage} 단계 스냅샷 생성`,
      "07-dashboard/buildDashboardSnapshot.js",
      [
        "--analysis",
        files.analysis,
        "--gap",
        files.gap,
        "--strategy",
        files.strategy,
        "--mode",
        options.mode,
        "--stage",
        options.stage,
        "--geometry",
        MAP_GEOMETRY,
        "--out",
        files.snapshot,
      ],
      [files.snapshot]
    ),
    nodeStage(
      "audit_snapshot",
      "재생성 스냅샷 계약 감사 — errors(exit 1)만 차단, 전체 리포트를 audit-report.json으로 저장",
      "scripts/auditDashboardSnapshot.js",
      ["--input", files.snapshot, "--out", files.auditReport],
      [files.auditReport]
    ),
    nodeStage(
      "render_candidate",
      "감사 통과 스냅샷으로 게시 전 후보 HTML 생성",
      path.relative(ROOT, STANDALONE_HTML_BUILDER),
      [files.snapshot, files.dashboardCandidate],
      [files.dashboardCandidate]
    ),
  ];

  return {
    schemaVersion: "regen-from-match-plan-v1",
    runId,
    root: ROOT,
    runDir,
    // executePlan이 mkdir하는 값. 이 실행기는 영구 상태를 만들지 않으므로 runDir로 둔다.
    stateDir: runDir,
    files,
    inputs: { input: inputPath, before: beforePath, rawGoodsReview, asOfYear },
    stages,
    publication: {
      automatic: false,
      candidate: files.dashboardCandidate,
      reason: "저장소 dashboard.html·공개 페이지는 이 실행기가 덮어쓰지 않음. 검토 후 수동 반영",
    },
    limitations: [
      "입력 ③ 산출물 자체의 재조회·캐시 병합은 이 실행기 범위 밖(러너북 4.4/4.5절)",
      "④ 이후 규칙/임계값이 바뀐 경우 계약 버전이 regen-metadata.json에 드러나므로 그것으로 해석",
    ],
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function writeMetadata(plan) {
  const input = readJsonSafe(plan.inputs.input) || {};
  const analysis = readJsonSafe(plan.files.analysis) || {};
  const gap = readJsonSafe(plan.files.gap) || {};
  const strategy = readJsonSafe(plan.files.strategy) || {};
  const snapshot = readJsonSafe(plan.files.snapshot) || {};
  const coverage = readJsonSafe(plan.files.coverage);
  // audit_snapshot 단계가 --out으로 이미 파일을 썼다. 여기서 다시 감사하지 않고 그 파일을 읽어
  // 요약만 뽑는다(단계 산출물과 메타데이터가 같은 실행 결과를 가리키도록).
  const auditReport = readJsonSafe(plan.files.auditReport);
  const audit = auditReport
    ? {
        reportPath: plan.files.auditReport,
        ok: auditReport.ok,
        errorCount: (auditReport.errors || []).length,
        warningCount: (auditReport.warnings || []).length,
        errors: (auditReport.errors || []).map((item) => item.code),
        warnings: (auditReport.warnings || []).map((item) => item.code),
      }
    : null;

  const metadata = {
    schemaVersion: "regen-from-match-metadata-v1",
    runId: plan.runId,
    generatedAt: new Date().toISOString(),
    input: {
      path: plan.inputs.input,
      sha256: sha256(plan.inputs.input),
      storageMode: input.storageMode || "results",
      // #73 완료조건: ③ 입력이 어떤 계약/규칙 버전으로 만들어졌는지 명시적으로 남긴다.
      contractVersions: {
        searchSchemaVersion: input.schemaVersion || null,
        trademarkSourceContractVersion: input.trademarkSourceMetadata?.contractVersion || null,
        applicantRegionMatchVersion:
          input.applicationApplicantEnrichment?.policy?.applicantRegionMatchVersion || null,
        ipRegistryApplicantRegionMatchVersion:
          input.ipRegistryEnrichment?.policy?.applicantRegionMatchVersion || null,
        ipRegistryGoodsMatchVersion:
          input.ipRegistryEnrichment?.policy?.goodsMatchVersion || null,
      },
    },
    before: plan.inputs.before
      ? { path: plan.inputs.before, sha256: sha256(plan.inputs.before) }
      : null,
    rawGoodsReview: {
      path: plan.inputs.rawGoodsReview,
      sha256: fs.existsSync(plan.inputs.rawGoodsReview) ? sha256(plan.inputs.rawGoodsReview) : null,
    },
    ruleVersions: {
      analysisVersion: analysis.analysisVersion || null,
      analysisParameters: analysis.parameters || null,
      gapScoreVersion: gap.scoreVersion || null,
      strategyTemplateVersion: strategy.templateVersion || null,
      snapshotSchemaVersion: snapshot.schemaVersion || null,
    },
    snapshot: {
      snapshotId: snapshot.snapshotId || null,
      generatedAt: snapshot.generatedAt || null,
      mode: snapshot.mode || null,
      stage: snapshot.stage || null,
    },
    regionMatchCoverage: coverage,
    snapshotAudit: audit,
    outputs: {
      analysis: plan.files.analysis,
      gap: plan.files.gap,
      strategy: plan.files.strategy,
      snapshot: plan.files.snapshot,
      auditReport: plan.files.auditReport,
      coverage: plan.files.coverage,
      dashboardCandidate: plan.files.dashboardCandidate,
    },
  };
  fs.writeFileSync(plan.files.metadata, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const plan = buildPlan(options);
  if (options.dryRun) {
    console.log(JSON.stringify(publicPlan(plan), null, 2));
    return;
  }
  if (!fs.existsSync(plan.inputs.input)) {
    throw new Error(`입력 ③ 산출물이 없습니다: ${plan.inputs.input}`);
  }
  const result = executePlan(plan);
  if (!result.ok) {
    console.error(
      `[regen-from-match] ${result.failedStage} 실패; 후속 단계와 후보 HTML은 만들지 않았습니다.`
    );
    process.exitCode = 1;
    return;
  }
  const metadata = writeMetadata(plan);
  const coverage = metadata.regionMatchCoverage;
  if (coverage && coverage.delta) {
    console.log(`[regen-from-match] 지역매칭 전후 변화: ${JSON.stringify(coverage.delta)}`);
  } else if (coverage && coverage.summary) {
    console.log(
      `[regen-from-match] 지역매칭: referenced=${coverage.summary.referenced} ` +
        `inside=${coverage.summary.inside} outside=${coverage.summary.outside} ` +
        `unverified=${coverage.summary.unverified}`
    );
  }
  console.log(
    `[regen-from-match] run=${plan.runId} 성공; 메타데이터=${plan.files.metadata} ` +
      `후보=${plan.files.dashboardCandidate}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[regen-from-match] 실패: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildPlan, parseArgs, publicPlan, writeMetadata };
