#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readReviewCsv, summarizeReviewRows, summaryCsv } = require("./lib/reviewClusters");

function parseArgs(argv) {
  const args = { "top-candidates": 5, examples: 3 };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      index++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error([
    "사용법:",
    "  node 02-normalize-items/summarizeReviews.js --input <review-required.csv> [옵션]",
    "",
    "옵션:",
    "  --out <path>             군집 JSON 경로 (기본: 입력 파일 옆 review-summary.json)",
    "  --csv-out <path>         사람이 검토할 요약 CSV 경로 (기본: 입력 파일 옆 review-summary.csv)",
    "  --top-candidates <n>     군집별 보존 후보 수 (기본 5)",
    "  --examples <n>           군집별 원본 예시 수 (기본 3)",
  ].join("\n"));
  process.exit(message ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input) usage("--input은 필수입니다.");
  const inputPath = path.resolve(args.input);
  const outputDirectory = path.dirname(inputPath);
  const outPath = path.resolve(args.out || path.join(outputDirectory, "review-summary.json"));
  const csvOutPath = path.resolve(args["csv-out"] || path.join(outputDirectory, "review-summary.csv"));
  const topCandidates = Number(args["top-candidates"]);
  const examples = Number(args.examples);
  if (!Number.isInteger(topCandidates) || topCandidates < 1 || topCandidates > 20) {
    usage("--top-candidates는 1~20 정수여야 합니다.");
  }
  if (!Number.isInteger(examples) || examples < 1 || examples > 20) {
    usage("--examples는 1~20 정수여야 합니다.");
  }

  const summary = summarizeReviewRows(readReviewCsv(inputPath), { topCandidates, examples });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(csvOutPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(csvOutPath, summaryCsv(summary), "utf8");
  console.error(
    `[summarizeReviews] review=${summary.reviewRowCount}, clusters=${summary.uniqueItemClusterCount} ` +
      `-> ${outPath}, ${csvOutPath}`
  );
}

if (require.main === module) main();

module.exports = { main, parseArgs };
