#!/usr/bin/env node
"use strict";

// 이슈 #29: 대표 특산품 인정 기준은 2026-08-26 이 스크립트로 1건/3건을 실측 비교한 뒤
// 2026-08-31 1건으로 완화 확정됐다(scorer.js의 REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD
// 기본값이 1). 이 스크립트는 그 결정을 재현하거나, 앞으로 다른 대안값과 비교할 때 계속 쓴다
// — scorer.js/detectBrandGap.js 코드를 그대로 재사용하므로 로직을 따로 재구현하지 않는다
// (재구현하면 실제 정책 판단과 다른 답이 나올 위험이 있음).
//
// 사용법:
//   node scripts/compareRepresentativeThresholds.js --input <04단계 analysis.json> [--compareTo <n>]
//   (--compareTo 생략 시 완화 전 기존 기준인 3건과 비교한다)

const fs = require("fs");
const path = require("path");
const { detectGaps } = require("../05-detect-brand-gap/detectBrandGap");

function parseArgs(argv) {
  const args = {};
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

function rowKey(row) {
  return `${row.region}${row.itemName}`;
}

function representativeSet(result) {
  return new Set(result.rows.filter((row) => row.representative).map(rowKey));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("사용법: node scripts/compareRepresentativeThresholds.js --input <04단계 analysis.json> [--compareTo <n>]");
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8").replace(/^﻿/, ""));
  const compareTo = args.compareTo !== undefined ? Number(args.compareTo) : 3;

  const confirmed = detectGaps(analysis); // 기본값 = 확정 기준(1건, #29 2026-08-31)
  const alternative = detectGaps(analysis, { representativeThreshold: compareTo });

  const confirmedSet = representativeSet(confirmed);
  const alternativeSet = representativeSet(alternative);
  const onlyInConfirmed = confirmed.rows.filter(
    (row) => row.representative && !alternativeSet.has(rowKey(row))
  );
  const onlyInAlternative = alternative.rows.filter(
    (row) => row.representative && !confirmedSet.has(rowKey(row))
  );
  const singleApplicationOnlyInConfirmed = onlyInConfirmed.filter(
    (row) => (row.regionalUniqueTrademarkCount ?? row.uniqueTrademarkCount) === 1
  );

  const observedRegions = (rows) => new Set(rows.map((row) => row.region)).size;

  console.log(`=== #29: 확정 기준(1건, scoreVersion=${confirmed.scoreVersion}) vs 비교값(${compareTo}건, scoreVersion=${alternative.scoreVersion}) ===`);
  console.log(`입력: ${args.input}`);
  console.log(`전체 지역×품목 행: ${confirmed.rows.length}`);
  console.log("");
  console.log(`[확정 기준 1건] 대표 특산품 수: ${confirmedSet.size}`);
  console.log(`[비교값 ${compareTo}건] 대표 특산품 수: ${alternativeSet.size}`);
  console.log(`확정 기준에만 있는 품목(비교값 기준에서는 탈락): ${onlyInConfirmed.length}`);
  console.log(`  - 그중 단발(고유 상표 정확히 1건) 노이즈 후보: ${singleApplicationOnlyInConfirmed.length}`);
  console.log(`비교값 기준에만 있는 품목(확정 기준에서는 탈락): ${onlyInAlternative.length}`);
  console.log(`관측 지역 수 — 확정 기준: ${observedRegions(confirmed.ranking)}, 비교값: ${observedRegions(alternative.ranking)}`);
  console.log("");
  console.log("확정 기준에만 있는 품목 샘플(최대 15개):");
  for (const row of onlyInConfirmed.slice(0, 15)) {
    console.log(
      `  ${row.region} / ${row.itemName} — 고유상표 ${row.regionalUniqueTrademarkCount ?? row.uniqueTrademarkCount}건, ` +
        `GI ${(row.sources || []).includes("지리적표시") ? "O" : "X"}`
    );
  }
}

main();
