#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { analyzeEntries } = require("./lib/analyzer");

function parseArgs(argv) {
  const args = { recentYears: 3, maxRecentBrands: 10 };
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
      "  node 04-analyze-brand/analyzeBrands.js --input <03단계 결과.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>              출력 경로 (기본: 04-analyze-brand/output/analysis.json)",
      "  --asOfYear <year>         분석 기준 연도 (기본: 현재 UTC 연도)",
      "  --recentYears <n>         최근/직전 비교 기간 길이 (기본: 3년)",
      "  --maxRecentBrands <n>     집계별 최근 브랜드 예시 최대 개수 (기본: 10)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input) usage("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "analysis.json"));
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`입력 JSON을 읽을 수 없습니다 (${inputPath}): ${error.message}`);
  }

  const analysis = analyzeEntries(parsed, {
    asOfYear: args.asOfYear,
    recentYears: args.recentYears,
    maxRecentBrands: args.maxRecentBrands,
  });
  analysis.provenance.inputFile = inputPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2), "utf8");
  console.error(
    `[analyzeBrands] query=${analysis.summary.queryCount}, unique=${analysis.summary.uniqueTrademarkCount}, ` +
      `regionItem=${analysis.regionItems.length} -> ${outPath}`
  );
}

try {
  main();
} catch (error) {
  console.error(`[analyzeBrands] 실패: ${error.message}`);
  process.exit(1);
}
