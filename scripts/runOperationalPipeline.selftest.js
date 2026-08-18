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

  console.log("운영 실행기 자체 테스트 통과");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
