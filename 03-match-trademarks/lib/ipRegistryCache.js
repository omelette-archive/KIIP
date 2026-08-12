"use strict";

const fs = require("fs");
const path = require("path");
const { IP_REGISTRY_SOURCE_METADATA } = require("./ipRegistryClient");

const CACHE_SCHEMA_VERSION = "ip-registry-cache-v1";

function emptyCache() {
  return new Map();
}

function loadCache(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyCache();
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
    throw new Error(`등록원부 캐시 스키마가 다릅니다: ${parsed.schemaVersion || "없음"}`);
  }
  if (parsed.contractVersion !== IP_REGISTRY_SOURCE_METADATA.contractVersion) {
    throw new Error(
      `등록원부 캐시 계약 버전이 다릅니다: ${parsed.contractVersion || "없음"}`
    );
  }
  const entries = new Map();
  for (const [registrationNumber, entry] of Object.entries(parsed.entries || {})) {
    if (entry?.status === "complete" && entry.record?.found) {
      entries.set(registrationNumber, entry);
    }
  }
  return entries;
}

function saveCache(filePath, entries, updatedAt = new Date().toISOString()) {
  if (!filePath) return;
  const sortedEntries = Object.fromEntries(
    [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
  const document = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    contractVersion: IP_REGISTRY_SOURCE_METADATA.contractVersion,
    updatedAt,
    privacyPolicy:
      "전체 도로명·상세주소는 저장하지 않고 행정구역 시도·시군구와 지정상품만 보존",
    entries: sortedEntries,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  loadCache,
  saveCache,
};
