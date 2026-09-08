"use strict";
// 서지상세(getBibliographyDetailInfoSearch) 지정상품 조회 영속 캐시. 출원번호 키.
// 786baa0 교훈: writeFileAtomic(EPERM 재시도 포함)로 저장 — Windows 백신이 잠깐
// .tmp를 잠가도 안전.
const fs = require("fs");
const { writeFileAtomic } = require("../../scripts/lib/atomicWrite");

const CACHE_SCHEMA_VERSION = "bibliography-goods-cache-v1";

function loadCache(filePath) {
  const map = new Map();
  if (!filePath || !fs.existsSync(filePath)) return map;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return map;
  for (const [applicationNumber, entry] of Object.entries(parsed.entries || {})) {
    if (entry?.status === "complete") map.set(applicationNumber, entry);
  }
  return map;
}

function saveCache(filePath, entries, updatedAt = new Date().toISOString()) {
  if (!filePath) return;
  const document = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt,
    privacyPolicy: "지정상품 명칭·NICE류·유사군만 보존, 출원인 개인정보 없음",
    entries: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileAtomic(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

module.exports = { CACHE_SCHEMA_VERSION, loadCache, saveCache };
