#!/usr/bin/env node
"use strict";

/**
 * ①~⑦ 운영 배치를 한 프로세스에서 순서대로 실행하는 최소 실행기다.
 * 인증 값은 명령행에 넣지 않고 각 단계가 기존 환경 변수/.env 로더를 사용하게 한다.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OPERATION_ROOT = path.join(ROOT, ".kiip-operations");

function parseArgs(argv) {
  const options = {
    dryRun: false,
    maxRequests: 100,
    maxPages: 5,
    maxHitsPerQuery: 100,
  };
  const valueFlags = new Map([
    ["--run-id", "runId"],
    ["--runs-dir", "runsDir"],
    ["--state-dir", "stateDir"],
    ["--max-requests", "maxRequests"],
    ["--max-pages", "maxPages"],
    ["--max-hits-per-query", "maxHitsPerQuery"],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (valueFlags.has(arg)) {
      if (index + 1 >= argv.length) throw new Error(`${arg} 값이 필요합니다.`);
      options[valueFlags.get(arg)] = argv[++index];
    } else {
      throw new Error(`지원하지 않는 옵션입니다: ${arg}`);
    }
  }
  for (const key of ["maxRequests", "maxPages", "maxHitsPerQuery"]) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 1) {
      throw new Error(`${key}는 1 이상의 정수여야 합니다.`);
    }
  }
  return options;
}

function printUsage() {
  console.log(
    [
      "사용법:",
      "  node scripts/runOperationalPipeline.js --dry-run [옵션]",
      "  node scripts/runOperationalPipeline.js [옵션]",
      "",
      "옵션:",
      "  --dry-run                    API 호출·파일 변경 없이 실행 계획만 출력",
      "  --run-id <id>                실행 식별자(영문/숫자/._-)",
      "  --runs-dir <path>            실행별 산출물·로그 디렉터리",
      "  --state-dir <path>           SQLite·검색 체크포인트 영구 디렉터리",
      "  --max-requests <n>           이번 ③ 검색 실행의 요청 상한(기본 100)",
      "  --max-pages <n>              ③ 검색 조합별 페이지 상한(기본 5)",
      "  --max-hits-per-query <n>     ③ 검색 조합별 저장 상한(기본 100)",
      "",
      "주의: --dry-run 없이 실행하면 기존 단계 CLI가 외부 API를 호출합니다.",
    ].join("\n")
  );
}

function defaultRunId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function validateRunId(value) {
  const runId = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
    throw new Error("run-id는 영문/숫자로 시작하는 80자 이하의 영문·숫자·점·밑줄·하이픈이어야 합니다.");
  }
  return runId;
}

function nodeStage(id, description, script, args, outputs = []) {
  return {
    id,
    description,
    executable: process.execPath,
    args: [path.join(ROOT, script), ...args],
    outputs,
  };
}

function buildPlan(options = {}) {
  const runId = validateRunId(options.runId || defaultRunId(options.now));
  const runsDir = path.resolve(options.runsDir || path.join(DEFAULT_OPERATION_ROOT, "runs"));
  const stateDir = path.resolve(options.stateDir || path.join(DEFAULT_OPERATION_ROOT, "state"));
  const runDir = path.join(runsDir, runId);
  const files = {
    collected: path.join(runDir, "01-specialties.csv"),
    normalized: path.join(runDir, "02-normalized.csv"),
    review: path.join(runDir, "02-review-required.csv"),
    trademarks: path.join(runDir, "03-trademarks.json"),
    analysis: path.join(runDir, "04-analysis.json"),
    gap: path.join(runDir, "05-gap.json"),
    strategy: path.join(runDir, "06-strategy.json"),
    snapshot: path.join(runDir, "07-dashboard-snapshot.json"),
    dashboardCandidate: path.join(runDir, "dashboard.candidate.html"),
    manifest: path.join(runDir, "run-manifest.json"),
  };
  const state = {
    specialtiesDb: path.join(stateDir, "specialties.sqlite"),
    trademarkCheckpoint: path.join(stateDir, "kipris-search-checkpoint.json"),
  };
  const matchArgs = [
    "--input",
    files.normalized,
    "--out",
    files.trademarks,
    "--checkpoint",
    state.trademarkCheckpoint,
    "--max-requests",
    String(options.maxRequests ?? 100),
    "--max-pages",
    String(options.maxPages ?? 5),
    "--max-hits-per-query",
    String(options.maxHitsPerQuery ?? 100),
  ];
  if (fs.existsSync(state.trademarkCheckpoint)) matchArgs.push("--resume");

  const stages = [
    nodeStage(
      "01_collect",
      "GI·농사로 특산품 수집과 누적 SQLite 갱신",
      "01-collect-specialties/collectSpecialties.js",
      ["--out", files.collected, "--db", state.specialtiesDb],
      [files.collected, state.specialtiesDb]
    ),
    nodeStage(
      "02_normalize",
      "고시상품명칭 기준 결정론적 정규화",
      "02-normalize-items/normalizeItems.js",
      ["--input", files.collected, "--out", files.normalized, "--review-out", files.review],
      [files.normalized, files.review]
    ),
    nodeStage(
      "03_match",
      "KIPRIS 상표 검색(기존 체크포인트가 있으면 재개)",
      "03-match-trademarks/matchTrademarks.js",
      matchArgs,
      [files.trademarks, state.trademarkCheckpoint]
    ),
    nodeStage(
      "04_analyze",
      "지역×품목 상표 분석",
      "04-analyze-brand/analyzeBrands.js",
      ["--input", files.trademarks, "--out", files.analysis],
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
      "전체 입력 범위 알파 스냅샷 생성",
      "07-dashboard/buildDashboardSnapshot.js",
      [
        "--analysis",
        files.analysis,
        "--gap",
        files.gap,
        "--strategy",
        files.strategy,
        "--mode",
        "full",
        "--stage",
        "alpha",
        "--out",
        files.snapshot,
      ],
      [files.snapshot]
    ),
    nodeStage(
      "validate",
      "외부 호출 없는 전체 회귀 검증",
      "scripts/validatePipeline.js",
      [],
      []
    ),
    nodeStage(
      "render_candidate",
      "검증된 스냅샷으로 게시 전 후보 HTML 생성",
      "07-dashboard/web/scripts/build-standalone-html.mjs",
      [files.snapshot, files.dashboardCandidate],
      [files.dashboardCandidate]
    ),
  ];

  return {
    schemaVersion: "operational-pipeline-plan-v1",
    runId,
    root: ROOT,
    runDir,
    stateDir,
    files,
    state,
    stages,
    publication: {
      automatic: false,
      candidate: files.dashboardCandidate,
      reason: "검증된 후보만 만들며 저장소 dashboard.html과 공개 페이지는 이 실행기가 덮어쓰지 않음",
    },
    limitations: [
      "출원인 주소·등록원부 보강 재조회는 #73 작업과 겹치지 않도록 이번 실행기 범위에 포함하지 않음",
      "정기 스케줄·알림·승인 게시 정책은 아직 연결하지 않음",
    ],
  };
}

function publicPlan(plan) {
  return {
    ...plan,
    stages: plan.stages.map((stage) => ({
      id: stage.id,
      description: stage.description,
      command: [stage.executable === process.execPath ? "node" : stage.executable, ...stage.args],
      outputs: stage.outputs,
    })),
  };
}

function writeManifest(filePath, manifest) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function runStageCommand(stage) {
  return spawnSync(stage.executable, stage.args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function executePlan(plan, options = {}) {
  if (fs.existsSync(plan.runDir)) {
    throw new Error(`같은 run-id 실행 디렉터리가 이미 있습니다: ${plan.runDir}`);
  }
  fs.mkdirSync(plan.runDir, { recursive: true });
  fs.mkdirSync(plan.stateDir, { recursive: true });
  const manifest = {
    schemaVersion: "operational-pipeline-run-v1",
    runId: plan.runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "running",
    stateDir: plan.stateDir,
    publication: plan.publication,
    limitations: plan.limitations,
    stages: plan.stages.map((stage) => ({
      id: stage.id,
      description: stage.description,
      command: [stage.executable === process.execPath ? "node" : stage.executable, ...stage.args],
      outputs: stage.outputs,
      status: "pending",
      startedAt: null,
      completedAt: null,
      exitCode: null,
      logFile: path.join(plan.runDir, `${stage.id}.log`),
    })),
  };
  writeManifest(plan.files.manifest, manifest);
  const runner = options.runStage || runStageCommand;

  for (let index = 0; index < plan.stages.length; index++) {
    const stage = plan.stages[index];
    const record = manifest.stages[index];
    record.status = "running";
    record.startedAt = new Date().toISOString();
    writeManifest(plan.files.manifest, manifest);
    let result;
    try {
      result = runner(stage);
    } catch (error) {
      result = { status: 1, stdout: "", stderr: error.stack || error.message };
    }
    const log = `${result.stdout || ""}${result.stderr || ""}`;
    fs.writeFileSync(record.logFile, log, "utf8");
    record.completedAt = new Date().toISOString();
    record.exitCode = Number.isInteger(result.status) ? result.status : 1;
    if (record.exitCode !== 0) {
      record.status = "failed";
      manifest.status = "failed";
      manifest.completedAt = record.completedAt;
      writeManifest(plan.files.manifest, manifest);
      return { ok: false, failedStage: stage.id, manifest };
    }
    record.status = "succeeded";
    writeManifest(plan.files.manifest, manifest);
  }

  manifest.status = "succeeded";
  manifest.completedAt = new Date().toISOString();
  writeManifest(plan.files.manifest, manifest);
  return { ok: true, manifest };
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
  const result = executePlan(plan);
  if (!result.ok) {
    console.error(`[operational-pipeline] ${result.failedStage} 실패; 후속 단계와 게시는 실행하지 않았습니다.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[operational-pipeline] run=${plan.runId} 성공; 게시 전 후보=${plan.files.dashboardCandidate}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[operational-pipeline] 실패: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPlan,
  defaultRunId,
  executePlan,
  parseArgs,
  publicPlan,
  validateRunId,
};
