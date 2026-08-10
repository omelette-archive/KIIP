#!/usr/bin/env node
"use strict";
/**
 * ③ 배치 결과(matchTrademarks.js --input ... --out ...)와 농사로 지역브랜드 목록
 * (fetchAreaBrands.js 산출물)을 출원번호로 조인해, hit마다 areaBrandMatch(지역 판정 근거)를
 * 붙인 새 파일을 만든다. 원본 배치 결과 파일은 건드리지 않는다(이슈 #24: 원본 분리).
 *
 * 이 결과를 ④ 통계에 자동 반영하지 않는다 — 소규모로 먼저 검토한 뒤 반영 여부를 정한다.
 *
 * 사용법:
 *   node 03-match-trademarks/joinAreaBrands.js \
 *     --input 03-match-trademarks/output/result.json \
 *     --area-brands 03-match-trademarks/output/area-brand-sample.json \
 *     --out 03-match-trademarks/output/result-with-area-brand.json
 */

const fs = require("fs");
const path = require("path");
const { loadAdminCodes, DEFAULT_CSV_PATH: ADMIN_CODES_PATH } = require("./lib/adminCodes");
const { joinAreaBrandEvidence } = require("./lib/areaBrandRegion");

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

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 03-match-trademarks/joinAreaBrands.js --input <③ 배치결과.json>",
      "    --area-brands <fetchAreaBrands.js 산출물.json> [--out <path>]",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`${label}을 읽을 수 없습니다 (${filePath}): ${error.message}`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");
  if (!args["area-brands"]) printUsageAndExit("--area-brands 는 필수입니다.");

  const inputPath = path.resolve(args.input);
  const areaBrandsPath = path.resolve(args["area-brands"]);
  const outPath = path.resolve(
    args.out || path.join(__dirname, "output", "result-with-area-brand.json")
  );

  const batch = readJson(inputPath, "③ 배치 결과");
  if (!Array.isArray(batch.results)) {
    throw new Error("--input 파일은 matchTrademarks.js 배치 결과(results 배열 포함)여야 합니다.");
  }
  const areaBrandFile = readJson(areaBrandsPath, "지역브랜드 목록");
  if (!Array.isArray(areaBrandFile.brands)) {
    throw new Error("--area-brands 파일은 fetchAreaBrands.js 산출물(brands 배열 포함)이어야 합니다.");
  }

  const adminList = loadAdminCodes();
  const { entries, matchedHitCount } = joinAreaBrandEvidence({
    entries: batch.results,
    areaBrands: areaBrandFile.brands,
    adminList,
  });

  const output = {
    ...batch,
    // 조인에 쓴 산출물의 출처·건수·시각을 남겨 결과를 감사할 수 있게 한다(이슈 #24 완료 조건).
    areaBrandJoin: {
      areaBrandFile: areaBrandsPath,
      areaBrandSource: areaBrandFile.source || null,
      areaBrandService: areaBrandFile.service || null,
      areaBrandFetchedAt: areaBrandFile.fetchedAt || null,
      areaBrandCount: areaBrandFile.brands.length,
      adminCodesFile: ADMIN_CODES_PATH,
      matchedHitCount,
      joinedAt: new Date().toISOString(),
    },
    results: entries,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.error(
    `[joinAreaBrands] areaBrands=${areaBrandFile.brands.length}, matchedHits=${matchedHitCount} -> ${outPath}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[joinAreaBrands] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs };
