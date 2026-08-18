#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readReviewCsv } = require("./lib/reviewClusters");
const { summarizeDecisions, algorithmPairsCsv, reportMarkdown } = require("./lib/decisionReport");

function parseArgs(argv) {
  const args = {};
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
  console.error(
    [
      "사용법:",
      "  node 02-normalize-items/reportNormalizationDecisions.js --input <normalized.csv> [옵션]",
      "",
      "입력은 --review-out이 아니라 normalizeItems.js의 전체 결과(--out) CSV입니다",
      "(status=ok/review_required/error 모든 행 포함).",
      "",
      "옵션:",
      "  --out <path>          JSON 리포트 경로 (기본: 입력 파일 옆 normalization-decisions.json)",
      "  --md-out <path>       Markdown 리포트 경로 (기본: normalization-decisions.md)",
      "  --csv-out <path>      algorithm 판정 조합 CSV 경로 (기본: normalization-decisions-algorithm.csv)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input) usage("--input은 필수입니다.");
  const inputPath = path.resolve(args.input);
  const outputDirectory = path.dirname(inputPath);
  const outPath = path.resolve(args.out || path.join(outputDirectory, "normalization-decisions.json"));
  const mdOutPath = path.resolve(args["md-out"] || path.join(outputDirectory, "normalization-decisions.md"));
  const csvOutPath = path.resolve(
    args["csv-out"] || path.join(outputDirectory, "normalization-decisions-algorithm.csv")
  );

  const rows = readReviewCsv(inputPath);
  const summary = summarizeDecisions(rows);
  const generatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ ...summary, generatedAt }, null, 2) + "\n", "utf8");
  fs.writeFileSync(mdOutPath, reportMarkdown(summary, { generatedAt }), "utf8");
  fs.writeFileSync(csvOutPath, algorithmPairsCsv(summary), "utf8");

  console.error(
    `[reportNormalizationDecisions] total=${summary.totalRowCount}, ` +
      `algorithm=${summary.algorithmConfirmedRowCount}(${summary.algorithmConfirmedPairCount}조합) ` +
      `-> ${outPath}, ${mdOutPath}, ${csvOutPath}`
  );
}

if (require.main === module) main();

module.exports = { main, parseArgs };
