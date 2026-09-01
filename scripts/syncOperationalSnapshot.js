#!/usr/bin/env node
"use strict";

/**
 * #70: 운영 실행기의 게시 승격 단계. 검증을 통과한 실행별 스냅샷을 저장소의 웹 입력
 * 경로로 복사한다. 07-dashboard/web/scripts/sync-snapshot.mjs와 목적은 같지만 cwd에
 * 의존하지 않고 경로를 명시적으로 받는다. schemaVersion·mode·regions 형태만 확인하고
 * 그 외 변형은 하지 않는다(그대로 복사).
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
  return args;
}

function usage(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node scripts/syncOperationalSnapshot.js --snapshot <실행별 스냅샷> --web-target <저장소 웹 입력 경로>",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.snapshot || !args["web-target"]) usage("--snapshot과 --web-target은 필수입니다.");

  const snapshotPath = path.resolve(args.snapshot);
  const targetPath = path.resolve(args["web-target"]);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8").replace(/^﻿/, ""));

  if (snapshot.schemaVersion !== "dashboard-snapshot-v1" || !Array.isArray(snapshot.regions)) {
    throw new Error("dashboard-snapshot-v1(regions 배열 포함) 스냅샷이 아닙니다.");
  }
  if (snapshot.mode !== "sample" && snapshot.mode !== "full") {
    throw new Error("snapshot.mode는 sample 또는 full이어야 합니다.");
  }
  if (snapshot.mode !== "full") {
    throw new Error("운영 게시 승격은 mode=full 스냅샷만 허용합니다.");
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, targetPath);
  console.error(`[syncOperationalSnapshot] ${snapshot.snapshotId} -> ${targetPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[syncOperationalSnapshot] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, main };
