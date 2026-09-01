#!/usr/bin/env node
"use strict";

/**
 * #70: 운영 파이프라인 실행 전 프리플라이트. 외부 API를 호출하기 전에 실패할 조건을
 * 먼저 걸러 API 예산·시간 낭비를 막는다. 인증 값은 존재 여부만 확인하고 절대 출력하지
 * 않는다.
 *
 * 검사 항목:
 * - 필수 환경변수 5종이 비어 있지 않은지
 * - --state-dir(영구 디스크)가 존재하고 쓰기 가능한지(프로브 파일 생성·삭제)
 * - Node 20 이상인지
 * - 이전 실행이 남긴 heartbeat 마커 — 영구 디스크가 실제로 유지되는지 신호
 *
 * 사용법:
 *   node scripts/checkOperationalEnv.js --state-dir <경로> [--json] [--write-heartbeat] [--env-path <.env 경로>]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadEnv } = require("../03-match-trademarks/lib/loadEnv");

const REQUIRED_ENV = [
  "GI_API_KEY",
  "NONGSARO_API_KEY",
  "NONGSARO_LOCAL_BRAND_API_KEY",
  "KIPRIS_API_KEY",
  "IP_REGISTRY_API_KEY",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--json") args.json = true;
    else if (value === "--write-heartbeat") args.writeHeartbeat = true;
    else if (value === "--state-dir") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("--state-dir 값이 필요합니다.");
      args.stateDir = argv[++i];
    } else if (value === "--env-path") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("--env-path 값이 필요합니다.");
      args.envFile = argv[++i];
    } else if (value === "--help" || value === "-h") args.help = true;
    else if (value.startsWith("--")) throw new Error(`지원하지 않는 옵션입니다: ${value}`);
  }
  return args;
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "node_version",
    ok: major >= 20,
    detail: `node ${process.versions.node}`,
    fix: major >= 20 ? null : "Node 20 이상이 필요합니다.",
  };
}

function checkRequiredEnv() {
  const missing = REQUIRED_ENV.filter((key) => !String(process.env[key] || "").trim());
  return {
    name: "required_env",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${REQUIRED_ENV.length}종 모두 설정됨` : `누락: ${missing.join(", ")}`,
    fix: missing.length === 0 ? null : "GitHub Actions secret 또는 러너 .env에 위 키를 설정하세요(값은 로그에 남기지 않음).",
  };
}

function checkStateDir(stateDir) {
  if (!stateDir) {
    return { name: "state_dir", ok: false, detail: "미지정", fix: "--state-dir로 영구 디스크 경로를 주세요." };
  }
  const resolved = path.resolve(stateDir);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probe = path.join(resolved, `.preflight-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe);
  } catch (error) {
    return { name: "state_dir", ok: false, detail: resolved, fix: `쓰기 불가: ${error.message}` };
  }
  return { name: "state_dir", ok: true, detail: resolved, fix: null };
}

function checkHeartbeat(stateDir, writeHeartbeat) {
  if (!stateDir) return { name: "persistence_heartbeat", ok: true, detail: "state_dir 없음 — 건너뜀", fix: null };
  const markerPath = path.join(path.resolve(stateDir), "operational-heartbeat.json");
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    previous = null;
  }
  if (writeHeartbeat) {
    const marker = { lastSeenAt: new Date().toISOString(), host: os.hostname() };
    try {
      fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    } catch {
      /* state_dir 검사에서 이미 잡힘 */
    }
  }
  return {
    name: "persistence_heartbeat",
    // 첫 실행이면 previous가 없는 게 정상이라 경고만 하고 통과시킨다.
    ok: true,
    detail: previous
      ? `이전 실행 heartbeat 확인: ${previous.lastSeenAt} (${previous.host || "host 미기록"})`
      : "이전 heartbeat 없음 — 첫 실행이거나 영구 디스크가 유지되지 않았을 수 있음",
    fix: null,
  };
}

function currentCommit() {
  try {
    return fs
      .readFileSync(path.join(__dirname, "..", ".git", "HEAD"), "utf8")
      .trim();
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("사용법: node scripts/checkOperationalEnv.js --state-dir <경로> [--json] [--write-heartbeat] [--env-path <path>]");
    return;
  }
  // CI에서는 secret이 process.env로 주입되고, 러너·로컬에서는 .env에 있다. loadEnv는
  // 이미 설정된 값을 덮어쓰지 않으므로 둘 다 안전하게 지원한다. --env-path로 경로를
  // 재정의할 수 있다(기본: 저장소 루트 .env).
  loadEnv(args.envFile ? path.resolve(args.envFile) : path.join(__dirname, "..", ".env"));
  const checks = [
    checkNodeVersion(),
    checkRequiredEnv(),
    checkStateDir(args.stateDir),
    checkHeartbeat(args.stateDir, args.writeHeartbeat),
  ];
  const ok = checks.every((check) => check.ok);
  const report = { ok, checkedAt: new Date().toISOString(), commit: currentCommit(), checks };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of checks) {
      console.log(`${check.ok ? "  ok  " : "  FAIL"} ${check.name}: ${check.detail}${check.fix ? ` — ${check.fix}` : ""}`);
    }
    console.log(ok ? "[checkOperationalEnv] 프리플라이트 통과" : "[checkOperationalEnv] 프리플라이트 실패");
  }
  if (!ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[checkOperationalEnv] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { REQUIRED_ENV, parseArgs, checkNodeVersion, checkRequiredEnv, checkStateDir };
