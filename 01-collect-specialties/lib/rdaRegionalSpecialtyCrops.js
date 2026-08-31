"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "02-normalize-items",
  "data",
  "regional-specialty-crops-2025.json"
);

function loadDocument(dataPath = DEFAULT_DATA_PATH) {
  const document = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));
  if (document.schemaVersion !== "regional-specialty-crops-v1") {
    throw new Error(`지역특화작목 스키마가 다릅니다: ${document.schemaVersion || "없음"}`);
  }
  const entries = Object.entries(document.provinces || {}).flatMap(([sido, crops]) =>
    crops.map((crop) => ({ sido, ...crop }))
  );
  if (entries.length !== 69) {
    throw new Error(`지역특화작목은 69개여야 합니다: ${entries.length}`);
  }
  return { document, entries };
}

function collectRegionalSpecialtyCrops({ limit, dataPath } = {}) {
  const { document, entries } = loadDocument(dataPath);
  const selected = limit === undefined ? entries : entries.slice(0, limit);
  const collectedAt = new Date().toISOString();
  const rows = selected.map((entry) => ({
    sido: entry.sido,
    sigungu: "",
    regionCode: "",
    regionMatchMethod: "official_policy_province",
    sourceRegionName: entry.sido,
    sourceRegionCode: "",
    sourceItemName: entry.itemName,
    sourceRecordUrl: document.sourceUrl,
    sourceScope: "province_policy_specialty",
    rawItemName: entry.itemName,
    source: `농촌진흥청 지역특화작목(${entry.tier})`,
    collectedAt,
  }));
  const rawRecords = selected.map((entry) => ({
    sourceRecordId: `${entry.sido}|${entry.tier}|${entry.itemName}`,
    referenceYear: document.referenceYear,
    sourceFileSha256: document.sourceFileSha256,
    ...entry,
  }));
  return { document, rows, rawRecords };
}

module.exports = { DEFAULT_DATA_PATH, loadDocument, collectRegionalSpecialtyCrops };
