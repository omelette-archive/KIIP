#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { analyzeEntries } = require("../04-analyze-brand/lib/analyzer");
const { buildDashboardSnapshot } = require("../07-dashboard/lib/snapshot");

const SUPPLEMENTAL_SOURCE_IDS = new Set([
  "nfqs_quality_cert",
  "nfqs_geographical_indication",
  "kofpi_forest_product",
  "forest_product_production_survey",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function combineMatchDocuments(documents) {
  const [first, ...rest] = documents;
  const combined = structuredClone(first);
  combined.queryFacts = { ...(combined.queryFacts || {}) };
  combined.results = [...(combined.results || [])];
  for (const [documentIndex, document] of rest.entries()) {
    Object.assign(combined.queryFacts, structuredClone(document.queryFacts || {}));
    combined.results.push(...(document.results || []).map((result) => ({
      ...structuredClone(result),
      inputIndex: `supplement-${documentIndex + 2}-${result.inputIndex}`,
    })));
  }

  const facts = Object.values(combined.queryFacts);
  const applicationNumbers = new Set();
  const registryStates = new Map();
  const registryPriority = { complete: 3, error: 2, not_collected: 1 };
  for (const fact of facts) {
    for (const hit of fact.hits || []) {
      if (hit.applicationNumber) applicationNumbers.add(hit.applicationNumber);
      if (hit.registrationNumber) {
        const status = hit.ipRegistryStatus || "not_collected";
        const previous = registryStates.get(hit.registrationNumber);
        if (!previous || (registryPriority[status] || 0) > (registryPriority[previous] || 0)) {
          registryStates.set(hit.registrationNumber, status);
        }
      }
    }
  }
  const applicantRegionCounts = {};
  for (const document of documents) {
    for (const [key, value] of Object.entries(document.applicationApplicantEnrichment?.applicantRegionCounts || {})) {
      applicantRegionCounts[key] = (applicantRegionCounts[key] || 0) + Number(value || 0);
    }
  }
  combined.inputCount = documents.reduce((sum, document) => sum + Number(document.inputCount || 0), 0);
  combined.searchableRowCount = documents.reduce((sum, document) => sum + Number(document.searchableRowCount || 0), 0);
  combined.uniqueQueryCount = facts.length;
  combined.completeUniqueQueryCount = facts.filter((fact) => fact.collectionStatus === "complete").length;
  combined.partialUniqueQueryCount = facts.filter((fact) => fact.collectionStatus === "partial").length;
  combined.erroredUniqueQueryCount = facts.filter((fact) => fact.status === "error").length;
  combined.requestCount = documents.reduce((sum, document) => sum + Number(document.requestCount || 0), 0);
  combined.completedAt = documents.map((document) => document.completedAt).filter(Boolean).sort().at(-1);
  combined.applicationApplicantEnrichment = {
    ...(combined.applicationApplicantEnrichment || {}),
    status: "complete",
    uniqueApplicationCount: applicationNumbers.size,
    completeApplicationCount: applicationNumbers.size,
    errorApplicationCount: 0,
    notCollectedApplicationCount: 0,
    applicantRegionCounts,
  };
  combined.ipRegistryEnrichment = {
    ...(combined.ipRegistryEnrichment || {}),
    status: [...registryStates.values()].every((status) => status === "complete") ? "complete" : "partial",
    completeRegistrationCount: [...registryStates.values()].filter((status) => status === "complete").length,
    errorRegistrationCount: [...registryStates.values()].filter((status) => status === "error").length,
    notCollectedRegistrationCount: [...registryStates.values()].filter((status) => status === "not_collected").length,
  };
  return combined;
}

function itemKey(item) {
  return `${String(item.itemName || item.noticeName || "").normalize("NFC").trim().toLowerCase()}\u001f${item.niceClass || ""}`;
}

function union(values) {
  return [...new Set(values.filter(Boolean))];
}

function successfulSearchPageRequestCount(document) {
  return Object.values(document.queryFacts || {}).reduce(
    (sum, fact) => sum + Number(fact.pages?.fetchedCount || 0),
    0
  );
}

function mergeMetric(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return { ...base, sourceIds: union([...(base.sourceIds || []), ...(extra.sourceIds || [])]) };
}

function mergeItem(base, extra) {
  const substantiveBaseSources = (base.sources || []).filter((sourceId) =>
    !sourceId.startsWith("label-") &&
    !SUPPLEMENTAL_SOURCE_IDS.has(sourceId)
  );
  if (substantiveBaseSources.length === 0 &&
      (base.sources || []).some((sourceId) => ["nfqs_quality_cert", "kofpi_forest_product"].includes(sourceId))) {
    return {
      ...structuredClone(extra),
      sources: union([...(base.sources || []), ...(extra.sources || [])]),
      regionalEvidence: base.regionalEvidence || extra.regionalEvidence,
    };
  }
  const metrics = { ...base.metrics };
  for (const [name, metric] of Object.entries(extra.metrics || {})) {
    metrics[name] = mergeMetric(metrics[name], metric);
  }
  return {
    ...base,
    sources: union([...(base.sources || []), ...(extra.sources || [])]),
    trademarkExamples: [...(base.trademarkExamples || []), ...(extra.trademarkExamples || [])]
      .filter((row, index, all) => all.findIndex((candidate) =>
        candidate.applicationNumber === row.applicationNumber) === index)
      .slice(0, 10),
    applicationYearCounts: base.applicationYearCounts || extra.applicationYearCounts || null,
    registrationYearCounts: base.registrationYearCounts || extra.registrationYearCounts || null,
    metrics,
  };
}

function stripPreviouslyMergedSupplementalRows(regions, nfqsFacilityRegionItemKeys = new Set()) {
  return regions.map((region) => ({
    ...structuredClone(region),
    items: region.items.flatMap((sourceItem) => {
      const item = structuredClone(sourceItem);
      const nonSupplementalSources = (item.sources || []).filter((sourceId) =>
        !SUPPLEMENTAL_SOURCE_IDS.has(sourceId));
      const substantiveSources = nonSupplementalSources.filter((sourceId) =>
        !sourceId.startsWith("label-"));
      const regionItemKey = `${region.region}\u001f${itemKey(item)}`;
      if (substantiveSources.length === 0 &&
          ((item.sources || []).some((sourceId) => SUPPLEMENTAL_SOURCE_IDS.has(sourceId)) ||
            nfqsFacilityRegionItemKeys.has(regionItemKey))) {
        return [];
      }
      item.sources = nonSupplementalSources;
      delete item.regionalEvidence;
      for (const metric of Object.values(item.metrics || {})) {
        if (Array.isArray(metric?.sourceIds)) {
          metric.sourceIds = metric.sourceIds.filter((sourceId) => !SUPPLEMENTAL_SOURCE_IDS.has(sourceId));
        }
      }
      return [item];
    }),
  })).filter((region) => region.items.length > 0);
}

function collectNfqsFacilityRegionItemKeys(document) {
  return new Set((document.results || [])
    .filter((result) => result.input?.sourceId === "nfqs_quality_cert")
    .map((result) => {
      const region = [result.input?.sido, result.input?.sigungu].filter(Boolean).join(" ");
      return `${region}\u001f${itemKey(result.input || {})}`;
    }));
}

function normalizeNfqsFacilityScopes(document) {
  for (const result of document.results || []) {
    if (result.input?.sourceId !== "nfqs_quality_cert") continue;
    result.input = {
      ...result.input,
      sido: "전국",
      sigungu: "지역 미제공",
      regionCode: "",
      regionMatchMethod: "facility_location_not_specialty_origin",
      sourceRegionName: "전국(인증사업장 소재지는 특산품 생산지 근거가 아님)",
      sourceScope: "nationwide_certified_product_catalog",
    };
    result.provenance = {
      ...(result.provenance || {}),
      sourceRegionName: result.input.sourceRegionName,
      regionMatchMethod: result.input.regionMatchMethod,
    };
    result.query = {
      ...(result.query || {}),
      region: "전국 지역 미제공",
      regionMatch: "not_applicable",
    };
  }
}

function normalizeNfqsGeoReviewScopes(document) {
  for (const result of document.results || []) {
    if (result.input?.sourceId !== "nfqs_geographical_indication" ||
        result.input?.sourceScope !== "geographical_indication_region_review") continue;
    result.input = {
      ...result.input,
      sido: "전국",
      sigungu: "지역 검토대기",
      regionCode: "",
    };
    result.query = {
      ...(result.query || {}),
      region: "전국 지역 검토대기",
      regionMatch: "not_applicable",
    };
  }
}

function expandForestRegionalResults(document, evidenceDocument) {
  const expanded = [];
  for (const result of document.results) {
    if (result.input?.sourceId !== "kofpi_forest_product") {
      expanded.push(result);
      continue;
    }
    const nationwide = structuredClone(result);
    nationwide.input.sido = "전국";
    nationwide.input.sigungu = "지역 미제공";
    nationwide.query = { ...(nationwide.query || {}), region: "전국 지역 미제공", regionMatch: "not_applicable" };
    expanded.push(nationwide);

    for (const evidence of evidenceDocument.items?.[result.input.itemName] || []) {
      const regional = structuredClone(result);
      regional.inputIndex = `forest-region-${evidence.tableNumber}-${result.inputIndex}`;
      regional.input = {
        ...regional.input,
        inputIndex: regional.inputIndex,
        sido: evidence.sido,
        sigungu: evidence.sigungu,
        regionCode: "",
        regionMatchMethod: evidence.evidenceType,
        sourceRegionName: evidence.region,
        sourceScope: "official_primary_region_evidence",
      };
      regional.provenance = {
        ...(regional.provenance || {}),
        sourceRegionName: evidence.region,
        regionMatchMethod: evidence.evidenceType,
      };
      regional.query = { ...(regional.query || {}), region: evidence.region, regionMatch: "official_primary_region_evidence" };
      expanded.push(regional);
    }
  }
  document.results = expanded;
  document.inputCount = expanded.length;
  document.searchableRowCount = expanded.filter((row) => row.status !== "skipped").length;
  document.successCount = expanded.filter((row) => row.status === "ok").length;
  document.partialCount = expanded.filter((row) => row.collectionStatus === "partial").length;
  document.errorCount = expanded.filter((row) => row.status === "error").length;
  document.skippedCount = expanded.filter((row) => row.status === "skipped").length;
}

function mergeRegions(baseRegions, extraRegions) {
  const regions = new Map(baseRegions.map((region) => [region.region, structuredClone(region)]));
  for (const extra of extraRegions) {
    const current = regions.get(extra.region);
    if (!current) {
      regions.set(extra.region, structuredClone(extra));
      continue;
    }
    const items = new Map(current.items.map((item) => [itemKey(item), item]));
    for (const item of extra.items) {
      const key = itemKey(item);
      items.set(key, items.has(key) ? mergeItem(items.get(key), item) : structuredClone(item));
    }
    current.items = [...items.values()].sort((a, b) =>
      String(a.itemName || "").localeCompare(String(b.itemName || ""), "ko-KR"));
  }
  return [...regions.values()].sort((a, b) => a.region.localeCompare(b.region, "ko-KR"));
}

function attachForestPrimaryRegionEvidence(regions, evidenceDocument) {
  let matchedItems = 0;
  let evidenceRows = 0;
  for (const region of regions) {
    for (const item of region.items) {
      if (!(item.sources || []).includes("kofpi_forest_product")) continue;
      const allEvidence = evidenceDocument.items?.[item.itemName] || [];
      const evidence = region.sido === "전국"
        ? allEvidence
        : allEvidence.filter((row) => row.region === region.region);
      if (!evidence.length) continue;
      item.regionalEvidence = evidence.map((row) => ({
        ...structuredClone(row),
        regionalMetricEligible: region.sido !== "전국" &&
          item.metrics?.uniqueTrademarkCount?.availability === "available",
        regionalMetricValidatedAt: region.sido !== "전국"
          ? "2026-08-25"
          : null,
      }));
      item.sources = union([...(item.sources || []), "forest_product_production_survey"]);
      if (region.sido === "전국") {
        matchedItems += 1;
        evidenceRows += evidence.length;
      }
    }
  }
  return { matchedItems, evidenceRows };
}

function main() {
  const root = path.resolve(__dirname, "..");
  const basePath = path.join(root, "07-dashboard", "web", "public", "data", "dashboard-snapshot.json");
  const matchPath = path.join(root, "03-match-trademarks", "output", "marine-forest-live-20260825-r3-enriched.json");
  const nfqsGeoMatchPath = path.join(root, "03-match-trademarks", "output", "nfqs-geo-live-20260826-v2-enriched.json");
  const forestRegionPath = path.join(root, "02-normalize-items", "data", "kofpi-primary-regions-2024.json");
  const base = readJson(basePath);
  const document = combineMatchDocuments([readJson(matchPath), readJson(nfqsGeoMatchPath)]);
  const forestRegionEvidence = readJson(forestRegionPath);
  const sourceInputRowCount = document.inputCount;
  const nfqsFacilityRegionItemKeys = collectNfqsFacilityRegionItemKeys(document);

  normalizeNfqsFacilityScopes(document);
  normalizeNfqsGeoReviewScopes(document);
  expandForestRegionalResults(document, forestRegionEvidence);

  const analysis = analyzeEntries(document, {
    asOfYear: 2026,
    recentYears: 3,
    maxRecentBrands: 10,
    regionalCoverageThreshold: 0.6,
  });
  const gap = {
    scoreVersion: "supplemental-source-catalog-no-gap-score",
    generatedAt: analysis.generatedAt,
    rows: analysis.regionItems.map((row) => ({ ...row, gapScore: null, isRepresentative: false })),
    ranking: [],
    warnings: [],
  };
  const strategy = {
    templateVersion: "supplemental-source-catalog-no-strategy",
    sourceScoreVersion: gap.scoreVersion,
    briefings: [],
    warnings: [],
  };
  const extra = buildDashboardSnapshot({ analysis, gap, strategy }, { mode: "full", stage: "alpha" });
  const regions = mergeRegions(
    stripPreviouslyMergedSupplementalRows(base.regions, nfqsFacilityRegionItemKeys),
    extra.regions
  );
  const forestEvidenceCoverage = attachForestPrimaryRegionEvidence(regions, forestRegionEvidence);
  const regionalRegions = regions.filter((region) => region.sido !== "전국");
  const nationwideCatalogRegions = regions.filter((region) => region.sido === "전국");
  const regionalItemCount = regionalRegions.reduce((sum, region) => sum + region.items.length, 0);
  const nationwideCatalogItemCount = nationwideCatalogRegions.reduce((sum, region) => sum + region.items.length, 0);
  const availableRegionItemCount = regionalRegions.reduce((sum, region) =>
    sum + region.items.filter((item) => item.metrics?.uniqueTrademarkCount?.availability === "available").length, 0);
  const generatedAt = new Date().toISOString();
  const merged = {
    ...base,
    snapshotId: `dashboard-${crypto.createHash("sha256").update(`${base.snapshotId}\n${generatedAt}\nmarine-forest-20260825`).digest("hex").slice(0, 20)}`,
    generatedAt,
    asOf: {
      ...base.asOf,
      sourceMaxFetchedAt: [
        document.completedAt,
        document.applicationApplicantEnrichment?.fetchedAt,
        document.ipRegistryEnrichment?.fetchedAt,
      ].filter(Boolean).sort().at(-1),
      analysisGeneratedAt: analysis.generatedAt,
    },
    coverage: {
      ...base.coverage,
      observedRegionCount: regionalRegions.length,
      regionItemCount: regionalItemCount,
      catalogItemCount: regionalItemCount + nationwideCatalogItemCount,
      nationwideCatalogItemCount,
      nationwideCatalogItemsWithRegionalEvidence: forestEvidenceCoverage.matchedItems,
      regionalEvidenceRows: forestEvidenceCoverage.evidenceRows,
    },
    pipelineStatus: {
      ...base.pipelineStatus,
      supplementalCollection: {
        sourceInputRowCount,
        regionalizedInputRowCount: document.inputCount,
        uniqueQueryCount: document.uniqueQueryCount,
        completeUniqueQueryCount: document.completeUniqueQueryCount,
        partialUniqueQueryCount: document.partialUniqueQueryCount,
        requestCount: successfulSearchPageRequestCount(document),
        requestAttemptCount: document.requestCount,
        uniqueApplicationCount: document.applicationApplicantEnrichment?.uniqueApplicationCount || 0,
        completeApplicationCount: document.applicationApplicantEnrichment?.completeApplicationCount || 0,
        applicantRegionCounts: document.applicationApplicantEnrichment?.applicantRegionCounts || null,
        registryCompleteCount: document.ipRegistryEnrichment?.completeRegistrationCount || 0,
        registryNotCollectedCount: document.ipRegistryEnrichment?.notCollectedRegistrationCount || 0,
        registryResumeNotBefore: document.ipRegistryEnrichment?.dailyBudget?.resumeNotBefore || null,
        nfqsGeographicalIndication: {
          registeredCount: 24,
          regionalizedCount: 23,
          regionReviewCount: 1,
          liveVerifiedAt: "2026-08-26",
        },
      },
      regionalMetricGate: {
        ...base.pipelineStatus.regionalMetricGate,
        availableRegionItemCount,
        blockedRegionItemCount: regionalItemCount - availableRegionItemCount,
      },
    },
    sources: [...new Map([...base.sources, ...extra.sources, {
      sourceId: "forest_product_production_survey",
      sourceLabel: "2024년 임산물생산조사",
      sourceContractVersion: forestRegionEvidence.schemaVersion,
      sourceFetchedAt: forestRegionEvidence.generatedAt,
      sourceUrl: forestRegionEvidence.sourceUrl,
      sourceLastVerifiedAt: "2026-08-25",
      idOrigin: "upstream",
    }].map((source) => [source.sourceId, source])).values()],
    warnings: union([
      ...base.warnings,
      "NFQS 품질인증수산물 290행과 KOFPI 임산물 90행을 2026-08-25 실 API로 수집하고 KIPRIS 검색 결과를 병합했습니다.",
      "NFQS jisokaddr는 인증사업장 소재지이므로 지역 특산품 귀속에 사용하지 않고 전국 인증 수산물 카탈로그로만 표시합니다.",
      "NFQS 지리적표시수산물 24건을 2026-08-26 실 API로 수집했습니다. 등록명칭과 공식 단체 주소의 행정구역이 교차 확인된 23건만 지역 특산품으로 반영하고, 여자만새고막 1건은 복수 지역 가능성이 있어 지역 검토대기로 보존합니다.",
      `KOFPI 임산물 ${forestEvidenceCoverage.matchedItems}개에는 2024년 임산물생산조사의 공식 주산지 근거 ${forestEvidenceCoverage.evidenceRows}건을 연결하고 출원인 주소를 주산지별로 재검증했습니다.`,
      `신규 수산·임산 KIPRIS 검색은 최대 750페이지·필터 통과 3,000건 범위로 재수집하고 출원인 주소 ${document.applicationApplicantEnrichment?.completeApplicationCount || 0}건을 보강했습니다. 범위 상한에 도달한 일반어는 부분 수집으로 계속 표시합니다.`,
    ]),
    regions,
  };
  fs.writeFileSync(basePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.error(`[mergeSupplementalDashboardData] regions=${regionalRegions.length}, regionalItems=${regionalItemCount}, nationwideCatalogItems=${nationwideCatalogItemCount}, snapshot=${merged.snapshotId}`);
}

main();
