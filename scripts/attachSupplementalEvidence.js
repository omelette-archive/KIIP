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
const {
  attachForestPrimaryRegionEvidence,
  buildSupplementalCollectionSummary,
  union,
} = require("./lib/supplementalScopes");
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
  let forestRegionEvidence = null;
  if (fs.existsSync(forestPath)) {
    forestRegionEvidence = readJson(forestPath);
    forestCoverage = attachForestPrimaryRegionEvidence(snapshot.regions, forestRegionEvidence);
  }
  let rdaMatched = 0;
  let rdaCropReference = null;
  if (fs.existsSync(rdaPath)) {
    rdaCropReference = readJson(rdaPath);
    rdaMatched = attachRegionalSpecialtyCropBadges(snapshot, rdaCropReference).matched;
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

  // #70(2026-09-04): mergeSupplementalDashboardData.js가 별도 검색분으로 만들던
  // supplementalCollection 프로비넌스를, 통합 파이프라인의 ③d 산출물에서 파생한다.
  if (args["match-doc"] && fs.existsSync(path.resolve(args["match-doc"])) && snapshot.pipelineStatus) {
    const matchDoc = readJson(path.resolve(args["match-doc"]));
    snapshot.pipelineStatus.supplementalCollection = buildSupplementalCollectionSummary(matchDoc, {
      rdaCropReference,
      rdaCropCoverage: { matched: rdaMatched },
    });
  }

  // 보완 소스가 스냅샷 sources 목록에 빠지지 않게 보강한다.
  const knownSources = new Map((snapshot.sources || []).map((source) => [source.sourceId, source]));
  const ensureSource = (source) => { if (!knownSources.has(source.sourceId)) knownSources.set(source.sourceId, source); };
  if (forestRegionEvidence) {
    ensureSource({
      sourceId: "forest_product_production_survey",
      sourceLabel: "2024년 임산물생산조사",
      sourceContractVersion: forestRegionEvidence.schemaVersion || null,
      sourceFetchedAt: forestRegionEvidence.generatedAt || null,
      sourceUrl: forestRegionEvidence.sourceUrl || null,
      sourceLastVerifiedAt: "2026-08-25",
      idOrigin: "upstream",
    });
  }
  const hasNfqsCatalogItem = snapshot.regions
    .filter((region) => region.sido === "전국")
    .some((region) => region.items.some((item) => (item.sources || []).includes("nfqs_quality_cert")));
  if (hasNfqsCatalogItem) {
    ensureSource({
      sourceId: "nfqs_quality_cert",
      sourceLabel: "해양수산부 국립수산물품질관리원 품질인증수산물",
      sourceContractVersion: "provider-live-api",
      sourceLastVerifiedAt: "2026-08-25",
      idOrigin: "upstream",
    });
  }
  snapshot.sources = [...knownSources.values()];

  // NFQS 인증사업장 소재지·jisokaddr 관련 경고를 보존한다(mergeSupplementalDashboardData.js에서 이전).
  const supplementalWarnings = [];
  if (hasNfqsCatalogItem) {
    supplementalWarnings.push(
      "NFQS jisokaddr는 인증사업장 소재지이므로 지역 특산품 귀속에 사용하지 않고 전국 인증 수산물 카탈로그로만 표시합니다."
    );
  }
  const regionalGeoCount = snapshot.regions
    .filter((region) => region.sido !== "전국")
    .flatMap((region) => region.items)
    .filter((item) => (item.sources || []).includes("nfqs_geographical_indication")).length;
  if (regionalGeoCount > 0) {
    supplementalWarnings.push(
      `NFQS 지리적표시수산물 중 등록명칭과 공식 단체 주소의 행정구역이 교차 확인된 ${regionalGeoCount}건만 지역 특산품으로 반영하고, 복수 지역 가능성이 있는 건은 지역 검토대기로 보존합니다.`
    );
  }
  if (supplementalWarnings.length) {
    snapshot.warnings = union([...(snapshot.warnings || []), ...supplementalWarnings]);
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
