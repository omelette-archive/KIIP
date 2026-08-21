#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeReviewDocument } = require("./lib/rawGoodsReview");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`지원하지 않는 인수입니다: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} 값이 필요합니다.`);
    args[arg.slice(2)] = value;
    index++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.out) {
    throw new Error("--input <검토 결과.json>과 --out <승인 manifest.json>이 필요합니다.");
  }
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out);
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  const normalized = normalizeReviewDocument(source);
  const manifest = {
    schemaVersion: normalized.schemaVersion,
    methodVersion: normalized.methodVersion,
    reviewId: normalized.reviewId,
    reviewedAt: args["reviewed-at"] || normalized.reviewedAt,
    source: args.source || path.basename(inputPath),
    rows: normalized.rows,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const applicationCount = manifest.rows.reduce((sum, row) => sum + row.apps.length, 0);
  console.error(
    `[importRawGoodsReview] rows=${manifest.rows.length}, applications=${applicationCount}, reviewId=${manifest.reviewId} -> ${outPath}`
  );
}

try {
  main();
} catch (error) {
  console.error(`[importRawGoodsReview] 실패: ${error.message}`);
  process.exit(1);
}
