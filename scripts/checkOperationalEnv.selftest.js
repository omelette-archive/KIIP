#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  REQUIRED_ENV,
  checkNodeVersion,
  checkRequiredEnv,
  checkStateDir,
} = require("./checkOperationalEnv");

const ROOT = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-preflight-"));

try {
  console.log("1) checkRequiredEnv — 누락 키를 이름만 보고하고 값은 절대 노출하지 않는다");
  {
    const saved = {};
    for (const key of REQUIRED_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env[REQUIRED_ENV[0]] = "super-secret-value-should-not-leak";
    const result = checkRequiredEnv();
    assert.strictEqual(result.ok, false);
    assert.ok(result.detail.includes(REQUIRED_ENV[1]), "누락 키 이름은 보고");
    assert.ok(!result.detail.includes("super-secret-value"), "값은 절대 detail에 안 들어감");
    assert.ok(!JSON.stringify(result).includes("super-secret-value"), "리포트 어디에도 값 없음");
    for (const key of REQUIRED_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    console.log("  ok - 누락 키 이름만 보고, 실제 값은 리포트에 포함되지 않음");
  }

  console.log("2) checkStateDir — 쓰기 가능하면 ok, 프로브 파일은 남기지 않는다");
  {
    const dir = path.join(tempDir, "state");
    const before = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const result = checkStateDir(dir);
    assert.strictEqual(result.ok, true);
    const after = fs.readdirSync(dir);
    assert.deepStrictEqual(after, before, "프로브 파일이 남으면 안 됨");
    assert.strictEqual(checkStateDir(undefined).ok, false, "미지정이면 실패");
    console.log("  ok - 쓰기 프로브 후 흔적 없이 정리, 미지정은 실패");
  }

  console.log("3) checkNodeVersion — 현재 런타임 기준");
  {
    const result = checkNodeVersion();
    assert.strictEqual(typeof result.ok, "boolean");
    assert.ok(result.detail.startsWith("node "));
    console.log("  ok - node 버전 검사 동작");
  }

  console.log("4) CLI — 필수 키가 없으면 exit 1, --json 리포트 형태 고정");
  {
    const env = { ...process.env };
    for (const key of REQUIRED_ENV) delete env[key];
    const noEnvFile = path.join(tempDir, "no-such.env");
    const missing = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts/checkOperationalEnv.js"),
        "--state-dir",
        path.join(tempDir, "s2"),
        "--env-path",
        noEnvFile,
        "--json",
      ],
      { cwd: ROOT, env, encoding: "utf8" }
    );
    assert.strictEqual(missing.status, 1);
    const report = JSON.parse(missing.stdout);
    assert.strictEqual(report.ok, false);
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.checks.some((c) => c.name === "required_env" && !c.ok));

    const full = { ...process.env };
    for (const key of REQUIRED_ENV) full[key] = "x";
    const okRun = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts/checkOperationalEnv.js"),
        "--state-dir",
        path.join(tempDir, "s3"),
        "--env-path",
        noEnvFile,
        "--write-heartbeat",
      ],
      { cwd: ROOT, env: full, encoding: "utf8" }
    );
    assert.strictEqual(okRun.status, 0, okRun.stdout + okRun.stderr);
    assert.ok(fs.existsSync(path.join(tempDir, "s3", "operational-heartbeat.json")), "--write-heartbeat가 마커를 남김");
    console.log("  ok - 키 누락 시 exit 1, 정상 시 heartbeat 마커 기록");
  }

  console.log("\n운영 프리플라이트 자체 테스트 통과");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
