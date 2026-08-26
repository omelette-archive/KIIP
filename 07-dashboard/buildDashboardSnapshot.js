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
      "  --stage <sample|alpha|production>  실행 단계 표시",
      "  --unique-query-count <n>  고유 고시명칭+NICE 검색 조합 수",
      "  --complete-unique-query-count <n>  완전 수집된 고유 검색 조합 수",
      "  --partial-unique-query-count <n>  부분 수집된 고유 검색 조합 수",
      "  --query-hit-cap <n>  이번 실행의 검색 조합별 저장 상한",
      "  --serialization-failure-observed-at-or-above <n>  직렬화 실패가 관측된 상한",
      "  --geometry <path>  지도 도형 GeoJSON 산출물(map-geometry.json). 주면 #80 목표 목록",
      "                     대조를 통과할 때만 map.availability를 available로 전환한다.",
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
    {
      mode: args.mode,
      stage: args.stage,
      uniqueQueryCount: args["unique-query-count"],
      completeUniqueQueryCount: args["complete-unique-query-count"],
      partialUniqueQueryCount: args["partial-unique-query-count"],
      queryHitCap: args["query-hit-cap"],
      serializationFailureObservedAtOrAbove:
        args["serialization-failure-observed-at-or-above"],
      geometry: args.geometry ? readJson(args.geometry, "지도 도형") : undefined,
    }
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
