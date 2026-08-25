#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { analyzeEntries } = require("../04-analyze-brand/lib/analyzer");
const { buildDashboardSnapshot } = require("../07-dashboard/lib/snapshot");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function itemKey(item) {
  return `${String(item.itemName || item.noticeName || "").normalize("NFC").trim().toLowerCase()}\u001f${item.niceClass || ""}`;
}

function union(values) {
  return [...new Set(values.filter(Boolean))];
}

function mergeMetric(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return { ...base, sourceIds: union([...(base.sourceIds || []), ...(extra.sourceIds || [])]) };
}

function mergeItem(base, extra) {
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

function main() {
  const root = path.resolve(__dirname, "..");
  const basePath = path.join(root, "07-dashboard", "web", "public", "data", "dashboard-snapshot.json");
  const matchPath = path.join(root, "03-match-trademarks", "output", "marine-forest-live-20260825.json");
  const base = readJson(basePath);
  const document = readJson(matchPath);

  for (const result of document.results) {
    if (result.input?.sourceId !== "kofpi_forest_product") continue;
    result.input.sido = "전국";
    result.input.sigungu = "지역 미제공";
    result.query = { ...(result.query || {}), region: "전국 지역 미제공", regionMatch: "not_applicable" };
  }

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
  const regions = mergeRegions(base.regions, extra.regions);
  const generatedAt = new Date().toISOString();
  const merged = {
    ...base,
    snapshotId: `dashboard-${crypto.createHash("sha256").update(`${base.snapshotId}\n${generatedAt}\nmarine-forest-20260825`).digest("hex").slice(0, 20)}`,
    generatedAt,
    asOf: { ...base.asOf, sourceMaxFetchedAt: document.completedAt, analysisGeneratedAt: analysis.generatedAt },
    coverage: {
      ...base.coverage,
      observedRegionCount: regions.filter((region) => region.sido !== "전국").length,
      regionItemCount: regions.reduce((sum, region) => sum + region.items.length, 0),
    },
    sources: [...new Map([...base.sources, ...extra.sources].map((source) => [source.sourceId, source])).values()],
    warnings: union([
      ...base.warnings,
      "NFQS 품질인증수산물 290행과 KOFPI 임산물 90행을 2026-08-25 실 API로 수집하고 KIPRIS 검색 결과를 병합했습니다.",
      "KOFPI 임산물은 원천에 지역 정보가 없어 '전국 / 지역 미제공' 목록으로 표시하며 지역별 출원율 분모에는 사용하지 않습니다.",
      "신규 수산·임산 KIPRIS 검색은 쿼리당 1페이지 상한의 부분 수집이며 지역 귀속·공백 점수는 후속 주소 보강 전까지 차단합니다.",
    ]),
    regions,
  };
  fs.writeFileSync(basePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.error(`[mergeSupplementalDashboardData] regions=${regions.length}, items=${merged.coverage.regionItemCount}, snapshot=${merged.snapshotId}`);
}

main();
