#!/usr/bin/env node
"use strict";

// 이슈 #29 후속 비교 실험: 같은 ④단계 analysis.json에 대해 대표 특산품 인정 기준을
// 1건/3건(기존)으로 바꿔가며 detectGaps()를 두 번 돌리고 비교 지표를 뽑는다.
// scorer.js/detectBrandGap.js 코드를 그대로 재사용하므로 로직을 따로 재구현하지 않는다
// (재구현하면 실제 정책 판단과 다른 답이 나올 위험이 있음).
//
// 사용법:
//   node scripts/compareRepresentativeThresholds.js --input <04단계 analysis.json>

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
  return `${row.region}${row.itemName}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("사용법: node scripts/compareRepresentativeThresholds.js --input <04단계 analysis.json>");
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8").replace(/^﻿/, ""));

  const baseline = detectGaps(analysis); // 기본값 = 확정 기준(3건)
  const relaxed = detectGaps(analysis, { representativeThreshold: 1 });

  const baselineRepresentative = new Set(
    baseline.rows.filter((row) => row.representative).map(rowKey)
  );
  const relaxedRepresentative = new Set(
    relaxed.rows.filter((row) => row.representative).map(rowKey)
  );
  const newlyAdded = relaxed.rows.filter(
    (row) => row.representative && !baselineRepresentative.has(rowKey(row))
  );
  const giRegisteredAmongNew = newlyAdded.filter((row) =>
    (row.sources || []).includes("지리적표시")
  );
  const giMissingAmongNew = newlyAdded.filter(
    (row) => !(row.sources || []).includes("지리적표시")
  );
  const singleApplicationNewlyAdded = newlyAdded.filter(
    (row) => (row.regionalUniqueTrademarkCount ?? row.uniqueTrademarkCount) === 1
  );

  const observedRegions = (rows) => new Set(rows.map((row) => row.region)).size;

  console.log("=== #29 후속 비교 실험: 대표 특산품 인정 기준(3건 vs 1건) ===");
  console.log(`입력: ${args.input}`);
  console.log(`전체 지역×품목 행: ${baseline.rows.length}`);
  console.log("");
  console.log(`[기준선] 대표 특산품 수(3건 기준, scoreVersion=${baseline.scoreVersion}): ${baselineRepresentative.size}`);
  console.log(`[완화안] 대표 특산품 수(1건 기준, scoreVersion=${relaxed.scoreVersion}): ${relaxedRepresentative.size}`);
  console.log(`신규 포함 품목 수(1건 기준에서만 대표성 인정): ${newlyAdded.length}`);
  console.log(`  - GI 등록 상태로 신규 포함(원래도 GI로 인정됐어야 함, 참고용): ${giRegisteredAmongNew.length}`);
  console.log(`  - GI 미등록이면서 1건 기준으로만 신규 포함: ${giMissingAmongNew.length}`);
  console.log(`  - 그중 단발(고유 상표 정확히 1건) 노이즈 후보: ${singleApplicationNewlyAdded.length}`);
  console.log(`관측 지역 수 — 기준선: ${observedRegions(baseline.ranking)}, 완화안: ${observedRegions(relaxed.ranking)}`);
  console.log("");
  console.log("신규 포함 품목 샘플(최대 15개):");
  for (const row of newlyAdded.slice(0, 15)) {
    console.log(
      `  ${row.region} / ${row.itemName} — 고유상표 ${row.regionalUniqueTrademarkCount ?? row.uniqueTrademarkCount}건, ` +
        `GI ${(row.sources || []).includes("지리적표시") ? "O" : "X"}`
    );
  }
}

main();
