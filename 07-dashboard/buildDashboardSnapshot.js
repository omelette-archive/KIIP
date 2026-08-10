#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildDashboardSnapshot } = require("./lib/snapshot");

function parseArgs(argv) {
  const args = { mode: "sample" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    args[key] = hasValue ? next : true;
    if (hasValue) i++;
  }
  return args;
}

function usage(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 07-dashboard/buildDashboardSnapshot.js --analysis <04.json> --gap <05.json> --strategy <06.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>       출력 경로 (기본: 07-dashboard/output/dashboard-snapshot.json)",
      "  --mode <sample|full>  데이터 범위 (기본: sample)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function readJson(filePath, label) {
  const resolved = path.resolve(filePath);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${label} JSON을 읽을 수 없습니다 (${resolved}): ${error.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  for (const required of ["analysis", "gap", "strategy"]) {
    if (!args[required]) usage(`--${required} 은 필수입니다.`);
  }
  const outPath = path.resolve(
    args.out || path.join(__dirname, "output", "dashboard-snapshot.json")
  );
  const snapshot = buildDashboardSnapshot(
    {
      analysis: readJson(args.analysis, "④ analysis"),
      gap: readJson(args.gap, "⑤ gap"),
      strategy: readJson(args.strategy, "⑥ strategy"),
    },
    { mode: args.mode }
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.error(
    `[buildDashboardSnapshot] mode=${snapshot.mode}, regions=${snapshot.regions.length}, ` +
      `items=${snapshot.coverage.regionItemCount}, alerts=${snapshot.alerts.length} -> ${outPath}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[buildDashboardSnapshot] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { main, parseArgs, readJson };
