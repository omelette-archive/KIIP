"use strict";

const fs = require("fs");
const path = require("path");
const { CONTRACT_VERSION } = require("./trademarkApplicantClient");

const CACHE_SCHEMA_VERSION = "trademark-applicant-region-cache-v1";

function loadCache(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || parsed.contractVersion !== CONTRACT_VERSION) {
    throw new Error("상표 출원인 주소 캐시의 스키마 또는 계약 버전이 다릅니다.");
  }
  return new Map(
    Object.entries(parsed.entries || {}).filter(
      ([, entry]) =>
        entry?.status === "complete" &&
        (entry.found === true ||
          entry.resultCode === "20" ||
          entry.terminalReason === "empty_after_retries")
    )
  );
}

function saveCache(filePath, entries, updatedAt = new Date().toISOString()) {
  if (!filePath) return;
  const document = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    updatedAt,
    privacyPolicy:
      "출원인 이름·특허고객번호·전체 상세주소는 저장하지 않고 시도·시군구와 조회 종료 상태만 보존",
    entries: Object.fromEntries([...entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, filePath);
}

module.exports = { CACHE_SCHEMA_VERSION, loadCache, saveCache };
