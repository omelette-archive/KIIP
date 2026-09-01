#!/usr/bin/env node
"use strict";
/**
 * #12 완료 조건 — 저장된 ③ 산출물에서 등록원부 지정상품 대조 분포
 * (normalized_exact / normalized_contains / class_only / mismatch / unverified)를
 * 자동 집계한다. `--before`/`--after`로 등록원부 보강 전후 변화도 계산한다.
 *
 * API 호출 없이 이미 저장된 JSON만 읽는다. 지정상품 대조는 hit의 지정상품명 대 품목명
 * 판정이라 지역과 무관하므로 factHitSources()로 storageMode 무관하게 처리한다.
 *
 * 판정 정책(#12, 2026-09-01): normalized_exact만 확정(confirmed), normalized_contains와
 * class_only는 사람 검토 후보(review). 04-analyze-brand/lib/analyzer.js와 동일 기준.
 */

const fs = require("fs");
const path = require("path");
const { factHitSources } = require("./lib/ipRegistryEnricher");

const METHODS = ["normalized_exact", "normalized_contains", "class_only", "mismatch", "unverified"];

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
      "  node 03-match-trademarks/summarizeGoodsMatchCoverage.js --input <③ 산출물 JSON> [--out <path>]",
      "  node 03-match-trademarks/summarizeGoodsMatchCoverage.js --before <이전> --after <이후> [--out <path>]",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function loadDocument(inputPath) {
  return JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8").replace(/^﻿/, ""));
}

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function summarizeDocument(document) {
  const byMethod = Object.fromEntries(METHODS.map((method) => [method, 0]));
  let evaluated = 0; // 등록원부 지정상품이 실제로 대조된 hit(unverified 제외)
  let goodsReferenced = 0; // designatedGoodsEvidence가 붙은 hit
  for (const entry of factHitSources(document)) {
    for (const hit of entry.hits || []) {
      const method = hit.goodsMatchMethod;
      if (byMethod[method] === undefined) continue;
      byMethod[method]++;
      if (method !== "unverified") evaluated++;
      if (hit.designatedGoodsEvidence) goodsReferenced++;
    }
  }
  const confirmed = byMethod.normalized_exact;
  const review = byMethod.normalized_contains + byMethod.class_only;
  return {
    byMethod,
    evaluated,
    goodsReferenced,
    confirmed,
    review,
    mismatch: byMethod.mismatch,
    ratios: {
      confirmed: ratio(confirmed, evaluated),
      review: ratio(review, evaluated),
      mismatch: ratio(byMethod.mismatch, evaluated),
    },
  };
}

function delta(before, after) {
  const d = (key) => after[key] - before[key];
  return {
    evaluated: d("evaluated"),
    confirmed: d("confirmed"),
    review: d("review"),
    mismatch: d("mismatch"),
    byMethod: Object.fromEntries(
      METHODS.map((method) => [method, after.byMethod[method] - before.byMethod[method]])
    ),
    ratios: {
      confirmed:
        after.ratios.confirmed !== null && before.ratios.confirmed !== null
          ? Number((after.ratios.confirmed - before.ratios.confirmed).toFixed(4))
          : null,
      review:
        after.ratios.review !== null && before.ratios.review !== null
          ? Number((after.ratios.review - before.ratios.review).toFixed(4))
          : null,
    },
  };
}

function printSummary(label, summary) {
  console.error(
    `[goodsMatchCoverage] ${label}: evaluated=${summary.evaluated} ` +
      `confirmed(exact)=${summary.confirmed}(${summary.ratios.confirmed ?? "n/a"}) ` +
      `review(contains+class_only)=${summary.review}(${summary.ratios.review ?? "n/a"}) ` +
      `mismatch=${summary.mismatch} byMethod=${JSON.stringify(summary.byMethod)}`
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();

  let report;
  if (args.before || args.after) {
    if (!args.before || !args.after) usage("--before와 --after는 함께 줘야 합니다.");
    const before = summarizeDocument(loadDocument(args.before));
    const after = summarizeDocument(loadDocument(args.after));
    printSummary("전(before)", before);
    printSummary("후(after)", after);
    report = {
      generatedAt: new Date().toISOString(),
      beforePath: path.resolve(args.before),
      afterPath: path.resolve(args.after),
      before,
      after,
      delta: delta(before, after),
    };
    console.error(`[goodsMatchCoverage] 변화: ${JSON.stringify(report.delta)}`);
  } else {
    if (!args.input) usage("--input 또는 --before/--after 중 하나는 필수입니다.");
    const summary = summarizeDocument(loadDocument(args.input));
    printSummary(path.basename(args.input), summary);
    report = { generatedAt: new Date().toISOString(), inputPath: path.resolve(args.input), summary };
  }

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(`[goodsMatchCoverage] -> ${outPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[goodsMatchCoverage] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { main, parseArgs, summarizeDocument, delta };
