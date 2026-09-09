#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  acquireLock,
  buildPlan,
  executePlan,
  lockFilePath,
  parseArgs,
  publicPlan,
  releaseLock,
  validateRunId,
} = require("./runOperationalPipeline");

const ROOT = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-operational-runner-"));

try {
  console.log("1) 계획은 ①~③·③b·③c~⑦→검증→후보 HTML 순서와 영구 상태 경로를 고정한다");
  const plan = buildPlan({
    runId: "test-plan",
    runsDir: path.join(tempDir, "runs"),
    stateDir: path.join(tempDir, "state"),
    maxRequests: 7,
    maxPages: 2,
    maxHitsPerQuery: 11,
  });
  assert.deepStrictEqual(plan.stages.map((stage) => stage.id), [
    "00_preflight",
    "00_cleanup_outputs",
    "00c_archive_check",
    "01_collect",
    "02_normalize",
    "01b_area_brands",
    "03_match",
    "03b_applicant_region",
    "03c_ip_registry",
    "03d_supplemental_scopes",
    "03e_bibliography_goods",
    "04_analyze",
    "05_gap",
    "06_strategy",
    "07_snapshot",
    "07b_supplemental_attach",
    "07c_nationwide_flow",
    "07d_reconcile",
    "07e_archive_check",
    "validate",
    "render_candidate",
  ]);
  // #137: archive 무결성 스테이지 — 수집 앞(before)·reconcile 뒤(after, high-water 갱신)
  const beforeCheck = plan.stages.find((s) => s.id === "00c_archive_check");
  assert.ok(beforeCheck.args.includes("--phase") && beforeCheck.args.includes("before"));
  assert.ok(plan.stages.findIndex((s) => s.id === "00c_archive_check") < plan.stages.findIndex((s) => s.id === "01_collect"));
  const afterCheck = plan.stages.find((s) => s.id === "07e_archive_check");
  assert.ok(afterCheck.args.includes("after") && afterCheck.args.includes("--update"));
  assert.ok(plan.stages.findIndex((s) => s.id === "07d_reconcile") < plan.stages.findIndex((s) => s.id === "07e_archive_check"));
  assert.ok(plan.stages.findIndex((s) => s.id === "07e_archive_check") < plan.stages.findIndex((s) => s.id === "validate"));
  // #70: ① 수집은 소스를 명시 고정한다(collectSpecialties 기본값 변동과 무관하게 결정론적)
  const collectStage = plan.stages.find((stage) => stage.id === "01_collect");
  assert.ok(collectStage.args.includes("--sources"));
  const preflightStage = plan.stages.find((stage) => stage.id === "00_preflight");
  assert.strictEqual(preflightStage.args[preflightStage.args.indexOf("--state-dir") + 1], plan.stateDir);
  assert.strictEqual(path.dirname(plan.state.specialtiesDb), plan.stateDir);
  assert.strictEqual(path.dirname(plan.state.trademarkCheckpoint), plan.stateDir);
  // #70: 보강 캐시·일별 예산 상태도 실행 디렉터리가 아니라 영구 stateDir에 있어야 함
  assert.strictEqual(path.dirname(plan.state.applicantRegionCache), plan.stateDir);
  assert.strictEqual(path.dirname(plan.state.ipRegistryCache), plan.stateDir);
  assert.strictEqual(path.dirname(plan.state.ipRegistryBudget), plan.stateDir);
  const applicantStage = plan.stages.find((stage) => stage.id === "03b_applicant_region");
  assert.strictEqual(applicantStage.args[applicantStage.args.indexOf("--cache") + 1], plan.state.applicantRegionCache);
  const registryStage = plan.stages.find((stage) => stage.id === "03c_ip_registry");
  assert.strictEqual(registryStage.args[registryStage.args.indexOf("--budget-state") + 1], plan.state.ipRegistryBudget);
  assert.ok(registryStage.args.includes("--daily-budget"));
  assert.ok(plan.publication.automatic === false);
  const analyzeStage = plan.stages.find((stage) => stage.id === "04_analyze");
  assert.ok(analyzeStage.args.includes("--raw-goods-review"));
  assert.strictEqual(
    analyzeStage.args[analyzeStage.args.indexOf("--raw-goods-review") + 1],
    plan.inputs.rawGoodsReview
  );
  // ④는 03e 서지상세 지정상품 대조 결과를 입력으로 받아야 함(③c → 03d → 03e → ④)
  assert.strictEqual(analyzeStage.args[analyzeStage.args.indexOf("--input") + 1], plan.files.bibliographyGoodsEnriched);
  const scopeStage = plan.stages.find((stage) => stage.id === "03d_supplemental_scopes");
  assert.strictEqual(scopeStage.args[scopeStage.args.indexOf("--input") + 1], plan.files.registryEnriched);
  // #12(경로 C): 03d → 03e, 등록원부 authoritative 유지하며 미등록 출원까지 지정상품 대조
  const bibliographyStage = plan.stages.find((stage) => stage.id === "03e_bibliography_goods");
  assert.strictEqual(bibliographyStage.args[bibliographyStage.args.indexOf("--input") + 1], plan.files.scopedSearch);
  assert.strictEqual(bibliographyStage.args[bibliographyStage.args.indexOf("--out") + 1], plan.files.bibliographyGoodsEnriched);
  assert.strictEqual(bibliographyStage.args[bibliographyStage.args.indexOf("--cache") + 1], plan.state.bibliographyGoodsCache);
  assert.strictEqual(path.dirname(plan.state.bibliographyGoodsCache), plan.stateDir);
  assert.strictEqual(path.dirname(plan.state.bibliographyGoodsBudget), plan.stateDir);
  const attachStage = plan.stages.find((stage) => stage.id === "07b_supplemental_attach");
  assert.strictEqual(attachStage.args[attachStage.args.indexOf("--input") + 1], plan.files.snapshotRaw);
  assert.strictEqual(attachStage.args[attachStage.args.indexOf("--out") + 1], plan.files.snapshotAttached);
  assert.strictEqual(attachStage.args[attachStage.args.indexOf("--match-doc") + 1], plan.files.bibliographyGoodsEnriched);
  // 07c: 전국 흐름 연결이 07b 뒤. 07d: 직전 공개 스냅샷과 대조해 floor 유지·복원 후 최종 스냅샷.
  const flowStage = plan.stages.find((stage) => stage.id === "07c_nationwide_flow");
  assert.strictEqual(flowStage.args[flowStage.args.indexOf("--input") + 1], plan.files.snapshotAttached);
  assert.strictEqual(flowStage.args[flowStage.args.indexOf("--out") + 1], plan.files.snapshotFlowed);
  const reconcileStage = plan.stages.find((stage) => stage.id === "07d_reconcile");
  assert.strictEqual(reconcileStage.args[reconcileStage.args.indexOf("--input") + 1], plan.files.snapshotFlowed);
  assert.strictEqual(reconcileStage.args[reconcileStage.args.indexOf("--out") + 1], plan.files.snapshot);
  assert.ok(reconcileStage.args[reconcileStage.args.indexOf("--previous") + 1].endsWith(path.join("public", "data", "dashboard-snapshot.json")));
  assert.ok(plan.stages.findIndex((s) => s.id === "07d_reconcile") < plan.stages.findIndex((s) => s.id === "validate"));
  const collectSources = collectStage.args[collectStage.args.indexOf("--sources") + 1];
  assert.ok(collectSources.includes("kofpi_forest_product") && collectSources.includes("nfqs_quality_cert"));
  // --include-review-required 옵션
  assert.ok(!plan.stages.find((s) => s.id === "03_match").args.includes("--include-review-required"));
  const reviewPlan = buildPlan({ runId: "review-plan", runsDir: path.join(tempDir, "runs"), stateDir: path.join(tempDir, "state"), includeReviewRequired: true });
  assert.ok(reviewPlan.stages.find((s) => s.id === "03_match").args.includes("--include-review-required"));
  const serialized = JSON.stringify(publicPlan(plan));
  assert.ok(!serialized.includes("API_KEY"));
  assert.ok(!serialized.includes("--apiKey"));

  console.log("1b) --promote는 검증·후보 HTML 뒤에 게시 승격 단계를 붙인다");
  const promotePlan = buildPlan({
    runId: "promote-plan",
    runsDir: path.join(tempDir, "runs"),
    stateDir: path.join(tempDir, "state"),
    promote: true,
  });
  assert.deepStrictEqual(promotePlan.stages.slice(-3).map((stage) => stage.id), [
    "promote_snapshot",
    "promote_html",
    "promote_audit",
  ]);
  assert.strictEqual(promotePlan.publication.automatic, true);
  assert.ok(promotePlan.stages.findIndex((s) => s.id === "validate") < promotePlan.stages.findIndex((s) => s.id === "promote_snapshot"));

  console.log("2) --dry-run은 API 호출이나 실행/상태 디렉터리 생성을 하지 않는다");
  const dryRunsDir = path.join(tempDir, "dry-runs");
  const dryStateDir = path.join(tempDir, "dry-state");
  const dry = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/runOperationalPipeline.js"),
      "--dry-run",
      "--run-id",
      "dry-test",
      "--runs-dir",
      dryRunsDir,
      "--state-dir",
      dryStateDir,
    ],
    {
      cwd: ROOT,
      env: { ...process.env, KIPRIS_API_KEY: "must-not-appear" },
      encoding: "utf8",
    }
  );
  assert.strictEqual(dry.status, 0, dry.stderr);
  assert.strictEqual(fs.existsSync(dryRunsDir), false);
  assert.strictEqual(fs.existsSync(dryStateDir), false);
  assert.ok(!dry.stdout.includes("must-not-appear"));
  assert.strictEqual(JSON.parse(dry.stdout).schemaVersion, "operational-pipeline-plan-v1");

  console.log("3) 한 단계가 실패하면 후속 단계와 게시 후보 생성을 중단하고 manifest를 남긴다");
  const invoked = [];
  const result = executePlan(plan, {
    runStage(stage) {
      invoked.push(stage.id);
      if (stage.id === "02_normalize") return { status: 17, stdout: "", stderr: "fixture failure\n" };
      return { status: 0, stdout: `${stage.id} ok\n`, stderr: "" };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.failedStage, "02_normalize");
  assert.deepStrictEqual(invoked, ["00_preflight", "00_cleanup_outputs", "00c_archive_check", "01_collect", "02_normalize"]);
  assert.strictEqual(result.manifest.status, "failed");
  assert.strictEqual(result.manifest.stages[0].status, "succeeded");
  assert.strictEqual(result.manifest.stages[3].status, "succeeded");
  assert.strictEqual(result.manifest.stages[4].status, "failed");
  assert.strictEqual(result.manifest.stages[5].status, "pending");
  assert.strictEqual(fs.existsSync(plan.files.dashboardCandidate), false);
  assert.strictEqual(JSON.parse(fs.readFileSync(plan.files.manifest, "utf8")).status, "failed");

  console.log("4) run-id 경로 이탈 입력을 거부한다");
  assert.throws(() => validateRunId("../escape"), /run-id/);

  console.log("5) 값 플래그에 값이 없으면 다음 플래그를 값으로 삼키지 않고 오류를 던진다");
  assert.throws(
    () => parseArgs(["--state-dir", "--dry-run", "--run-id", "x"]),
    /--state-dir 값이 필요합니다/,
    "--state-dir 값이 없으면 --dry-run이 값으로 삼켜지지 않고 즉시 실패해야 함"
  );
  assert.throws(
    () => parseArgs(["--max-requests"]),
    /--max-requests 값이 필요합니다/,
    "마지막 토큰이 값 플래그면 값 누락으로 실패해야 함"
  );
  const parsed = parseArgs(["--dry-run", "--run-id", "x"]);
  assert.strictEqual(parsed.dryRun, true, "정상 입력에서는 --dry-run이 여전히 인식돼야 함");
  const customReview = parseArgs(["--raw-goods-review", "review.json"]);
  assert.strictEqual(customReview.rawGoodsReview, "review.json");

  console.log("6) 같은 run-id로 두 번 실행하면 두 번째는 원자적으로 실패한다(경쟁 없이)");
  const raceRunsDir = path.join(tempDir, "race-runs");
  const raceStateDir = path.join(tempDir, "race-state");
  const racePlan = buildPlan({
    runId: "race-test",
    runsDir: raceRunsDir,
    stateDir: raceStateDir,
    maxRequests: 1,
    maxPages: 1,
    maxHitsPerQuery: 1,
  });
  executePlan(racePlan, { runStage: () => ({ status: 0, stdout: "", stderr: "" }) });
  assert.throws(
    () => executePlan(racePlan, { runStage: () => ({ status: 0, stdout: "", stderr: "" }) }),
    /같은 run-id 실행 디렉터리가 이미 있습니다/,
    "같은 runDir을 두 번째로 만들려고 하면 EEXIST 기반으로 즉시 거부해야 함"
  );

  console.log(
    "7) 파일 락 — GH Actions·로컬 스케줄러처럼 트리거가 달라도 겹치는 실행은 건너뛴다(2026-09-09)"
  );
  const lockStateDir = path.join(tempDir, "lock-state");
  const first = acquireLock(lockStateDir, "run-a");
  assert.strictEqual(first.acquired, true, "락이 비어 있으면 첫 실행은 획득해야 함");
  const second = acquireLock(lockStateDir, "run-b");
  assert.strictEqual(second.acquired, false, "이미 실행 중인 락이 있으면 두 번째는 건너뛰어야 함");
  assert.strictEqual(second.existing.pid, process.pid);
  assert.strictEqual(second.existing.runId, "run-a");
  releaseLock(lockStateDir);
  assert.strictEqual(fs.existsSync(lockFilePath(lockStateDir)), false, "우리 프로세스의 락은 해제 시 지워져야 함");
  const third = acquireLock(lockStateDir, "run-c");
  assert.strictEqual(third.acquired, true, "해제 후에는 다시 획득할 수 있어야 함");
  releaseLock(lockStateDir);

  console.log("7b) 죽은 프로세스가 남긴 락은 회수해서 다음 실행이 이어받는다");
  fs.mkdirSync(lockStateDir, { recursive: true });
  // 존재할 수 없는 PID(운영체제 예약 범위 밖의 큰 값)로 "죽은 프로세스의 락"을 흉내낸다.
  fs.writeFileSync(
    lockFilePath(lockStateDir),
    JSON.stringify({ pid: 999999, runId: "stale-run", startedAt: new Date().toISOString(), host: "x" })
  );
  const afterStale = acquireLock(lockStateDir, "run-d");
  assert.strictEqual(afterStale.acquired, true, "죽은 PID가 남긴 락은 회수하고 새로 획득해야 함");
  releaseLock(lockStateDir);

  console.log("운영 실행기 자체 테스트 통과");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
