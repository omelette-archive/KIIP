#!/usr/bin/env node
"use strict";

/**
 * #70: ⑦ 뒤 단계. 완성된 대시보드 스냅샷에
 * - KOFPI 임산물 품목: 2024년 임산물생산조사 공식 주산지 근거를 붙이고
 * - 농촌진흥청 지역특화작목: 등급·공식명칭 배지를 붙인다.
 * API 호출 없음. 스냅샷 JSON만 읽고 다시 쓴다.
 *
 * 사용법:
 *   node scripts/attachSupplementalEvidence.js --input <스냅샷> --out <경로> [--forest-regions <json>] [--rda-crops <json>]
 */

const fs = require("fs");
const path = require("path");
const { attachForestPrimaryRegionEvidence } = require("./lib/supplementalScopes");
const { attachRegionalSpecialtyCropBadges } = require("./attachRegionalSpecialtyCropBadges");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_FOREST_REGIONS = path.join(ROOT, "02-normalize-items", "data", "kofpi-primary-regions-2024.json");
const DEFAULT_RDA_CROPS = path.join(ROOT, "02-normalize-items", "data", "regional-specialty-crops-2025.json");

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

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || !args.input || !args.out) {
    console.error(
      "사용법: node scripts/attachSupplementalEvidence.js --input <스냅샷> --out <경로> [--forest-regions <json>] [--rda-crops <json>]"
    );
    process.exit(args.help || args.h ? 0 : 1);
  }
  const snapshot = readJson(args.input);
  if (snapshot.schemaVersion !== "dashboard-snapshot-v1" || !Array.isArray(snapshot.regions)) {
    throw new Error("dashboard-snapshot-v1 스냅샷이 아닙니다.");
  }

  const forestPath = path.resolve(args["forest-regions"] || DEFAULT_FOREST_REGIONS);
  const rdaPath = path.resolve(args["rda-crops"] || DEFAULT_RDA_CROPS);

  let forestCoverage = { matchedItems: 0, evidenceRows: 0 };
  if (fs.existsSync(forestPath)) {
    forestCoverage = attachForestPrimaryRegionEvidence(snapshot.regions, readJson(forestPath));
  }
  let rdaMatched = 0;
  if (fs.existsSync(rdaPath)) {
    rdaMatched = attachRegionalSpecialtyCropBadges(snapshot, readJson(rdaPath)).matched;
  }

  // #70: buildDashboardSnapshot는 "전국" 의사 지역(NFQS 인증사업장·주산지 근거 없는 KOFPI)까지
  // regionItemCount·gate에 포함한다. 대시보드·감사는 "전국 제외" 지역 통계를 쓰므로
  // auditDashboardSnapshot 계약(regionItemCount = 실지역 행 수 등)에 맞춰 다시 계산한다.
  const regionalRegions = snapshot.regions.filter((region) => region.sido !== "전국");
  const nationwideRegions = snapshot.regions.filter((region) => region.sido === "전국");
  const regionalItems = regionalRegions.flatMap((region) => region.items);
  const regionalItemCount = regionalItems.length;
  const nationwideCatalogItemCount = nationwideRegions.reduce((sum, region) => sum + region.items.length, 0);
  const isAvailable = (item) => item.metrics?.uniqueTrademarkCount?.availability === "available";
  const availableRegionItemCount = regionalItems.filter(isAvailable).length;
  const partialRegionItemCount = regionalItems.filter((item) => item.metrics?.uniqueTrademarkCount?.partial).length;

  snapshot.coverage = {
    ...snapshot.coverage,
    observedRegionCount: regionalRegions.filter((region) => region.items.length > 0).length,
    regionItemCount: regionalItemCount,
    catalogItemCount: regionalItemCount + nationwideCatalogItemCount,
    nationwideCatalogItemCount,
    nationwideCatalogItemsWithRegionalEvidence: forestCoverage.matchedItems,
    regionalEvidenceRows: forestCoverage.evidenceRows,
  };
  if (snapshot.pipelineStatus?.regionalMetricGate) {
    snapshot.pipelineStatus.regionalMetricGate = {
      ...snapshot.pipelineStatus.regionalMetricGate,
      availableRegionItemCount,
      partialRegionItemCount,
      blockedRegionItemCount: Math.max(0, regionalItemCount - availableRegionItemCount),
    };
  }
  if (snapshot.pipelineStatus) {
    snapshot.pipelineStatus.supplementalEvidence = {
      forestPrimaryRegionItems: forestCoverage.matchedItems,
      forestPrimaryRegionEvidenceRows: forestCoverage.evidenceRows,
      rdaRegionalSpecialtyCropBadges: rdaMatched,
      attachedAt: new Date().toISOString(),
    };
  }

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.error(
    `[attachSupplementalEvidence] KOFPI 주산지 ${forestCoverage.matchedItems}품목 · RDA 배지 ${rdaMatched} -> ${outPath}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[attachSupplementalEvidence] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, main };
