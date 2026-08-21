"use strict";

const fs = require("fs");
const { toRows } = require("./normalize");

function loadOfficialSupplement(filePath) {
  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (document.schemaVersion !== 1 || !Array.isArray(document.records)) {
    throw new Error(`공식 보완자료 스키마가 올바르지 않습니다: ${filePath}`);
  }
  for (const [index, record] of document.records.entries()) {
    for (const field of ["sourceRecordId", "region", "rawItemName", "sourceRecordUrl"]) {
      if (!String(record[field] || "").trim()) {
        throw new Error(`공식 보완자료 ${index + 1}번 행에 ${field} 값이 없습니다: ${filePath}`);
      }
    }
  }
  return document;
}

function normalizeOfficialSupplement(document, adminList, sourceLabel) {
  return toRows(document.records, {
    adminList,
    source: sourceLabel,
    itemNameOf: (record) => record.rawItemName,
    sourceItemNameOf: (record) => record.sourceItemName || record.rawItemName,
    regionOf: (record) => record.region,
    regionCodeOf: (record) => record.sourceRegionCode || "",
    sourceRecordUrlOf: (record) => record.sourceRecordUrl,
    now: `${document.lastVerifiedAt}T00:00:00.000Z`,
  });
}

module.exports = { loadOfficialSupplement, normalizeOfficialSupplement };
