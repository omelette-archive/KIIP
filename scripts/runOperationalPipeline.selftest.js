#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  buildPlan,
  executePlan,
  parseArgs,
  publicPlan,
  validateRunId,
} = require("./runOperationalPipeline");

const ROOT = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-operational-runner-"));

try {
  console.log("1) 계획은 ①~⑦→검증→후보 HTML 순서와 영구 상태 경로를 고정한다");
  const plan = buildPlan({
    runId: "test-plan",
    runsDir: path.join(tempDir, "runs"),
    stateDir: path.join(tempDir, "state"),
    maxRequests: 7,
    maxPages: 2,
    maxHitsPerQuery: 11,
  });
  assert.deepStrictEqual(plan.stages.map((stage) => stage.id), [
    "01_collect",
    "02_normalize",
    "03_match",
    "04_analyze",
    "05_gap",
    "06_strategy",
    "07_snapshot",
    "validate",
    "render_candidate",
  ]);
  assert.strictEqual(path.dirname(plan.state.specialtiesDb), plan.stateDir);
  assert.strictEqual(path.dirname(plan.state.trademarkCheckpoint), plan.stateDir);
  assert.ok(plan.publication.automatic === false);
  const analyzeStage = plan.stages.find((stage) => stage.id === "04_analyze");
  assert.ok(analyzeStage.args.includes("--raw-goods-review"));
  assert.strictEqual(
    analyzeStage.args[analyzeStage.args.indexOf("--raw-goods-review") + 1],
    plan.inputs.rawGoodsReview
  );
  const serialized = JSON.stringify(publicPlan(plan));
  assert.ok(!serialized.includes("API_KEY"));
  assert.ok(!serialized.includes("--apiKey"));

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
  assert.deepStrictEqual(invoked, ["01_collect", "02_normalize"]);
  assert.strictEqual(result.manifest.status, "failed");
  assert.strictEqual(result.manifest.stages[0].status, "succeeded");
  assert.strictEqual(result.manifest.stages[1].status, "failed");
  assert.strictEqual(result.manifest.stages[2].status, "pending");
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

  console.log("운영 실행기 자체 테스트 통과");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
