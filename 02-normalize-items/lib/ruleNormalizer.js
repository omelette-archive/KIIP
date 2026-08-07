"use strict";

const { findCandidates, stripRegionNames } = require("./candidateSearch");
const { isServiceClass } = require("./filters");

const EXCLUDED_SUFFIX_RE = /(나무|묘목|모종|종묘|종자|씨앗)$/;
const SEGMENT_SEPARATOR_RE = /[,，;；]/;

function canonicalName(value) {
  return String(value || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s'"`()[\]{}._-]+/g, "");
}

function cleanItemName(rawItemName, region = {}) {
  const raw = String(rawItemName || "").normalize("NFC").trim();
  if (!raw) return "";

  let cleaned = stripRegionNames(raw, [region.sido, region.sigungu]).trim();
  if (!cleaned) cleaned = raw;

  // 품종·부연 설명은 검토용 원문에 남기고, 1차 규칙 매칭에는 첫 품목 구간만 사용한다.
  cleaned = cleaned.split(SEGMENT_SEPARATOR_RE)[0];
  cleaned = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || raw;
}

function serializeCandidates(candidates) {
  return JSON.stringify(
    candidates.map((candidate) => ({
      item: candidate.item,
      niceClass: candidate.niceClass,
      similarGroupCode: candidate.similarGroupCode,
      score: Number(Number(candidate.score || 0).toFixed(4)),
    }))
  );
}

function uniqueCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    const key = [candidate.item, candidate.niceClass, candidate.similarGroupCode].join("\u0000");
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

const officialNameIndexCache = new WeakMap();

function getOfficialNameIndex(dictionary) {
  let cached = officialNameIndexCache.get(dictionary);
  if (cached) return cached;

  cached = new Map();
  for (const candidate of dictionary) {
    if (isServiceClass(candidate.niceClass)) continue;
    const key = canonicalName(candidate.item);
    const matches = cached.get(key) || [];
    matches.push(candidate);
    cached.set(key, matches);
  }
  officialNameIndexCache.set(dictionary, cached);
  return cached;
}

function reviewResult(base, itemName, candidates, reviewReason) {
  return {
    ...base,
    itemName,
    noticeName: "",
    niceClass: "",
    similarGroupCode: "",
    excluded: false,
    status: "review_required",
    matchMethod: "rule_unresolved",
    confidence: "",
    reviewReason,
    reviewCandidates: serializeCandidates(candidates),
    error: "",
  };
}

/**
 * 외부 API 없이 보수적으로 확정한다. 정제명이 사전 항목과 정확히 일치하는 경우만
 * 자동 매핑하고, 나머지는 후보와 함께 별도 검토 대상으로 남긴다.
 */
function normalizeByRules(row, dictionary, { topK = 5 } = {}) {
  const base = {
    sido: row.sido || "",
    sigungu: row.sigungu || "",
    rawItemName: row.rawItemName || "",
    source: row.source || "",
  };
  const itemName = cleanItemName(row.rawItemName, row);
  if (!itemName) return reviewResult(base, "", [], "정제할 품목명이 없음");

  const candidates = findCandidates(itemName, dictionary, {}, { topK });
  const officialNameIndex = getOfficialNameIndex(dictionary);

  if (EXCLUDED_SUFFIX_RE.test(itemName)) {
    return {
      ...base,
      itemName,
      noticeName: "",
      niceClass: "",
      similarGroupCode: "",
      excluded: true,
      status: "ok",
      matchMethod: "rule_excluded",
      confidence: "1.0000",
      reviewReason: "",
      reviewCandidates: serializeCandidates(candidates),
      error: "",
    };
  }

  const preferredNames = [
    { name: itemName, matchMethod: "rule_exact", confidence: "1.0000", score: 1.5 },
    { name: `신선한 ${itemName}`, matchMethod: "rule_fresh", confidence: "0.9500", score: 1.4 },
    { name: `미가공 ${itemName}`, matchMethod: "rule_unprocessed", confidence: "0.9000", score: 1.3 },
  ];

  for (const preferred of preferredNames) {
    const preferredKey = canonicalName(preferred.name);
    const matches = uniqueCandidates(
      (officialNameIndex.get(preferredKey) || [])
        .map((candidate) => ({ ...candidate, score: preferred.score }))
    );
    if (matches.length > 1) {
      return reviewResult(base, itemName, [...matches, ...candidates].slice(0, topK), "동일 명칭이 여러 분류에 존재함");
    }
    if (matches.length !== 1) continue;

    const matched = matches[0];
    return {
      ...base,
      itemName,
      noticeName: matched.item,
      niceClass: matched.niceClass,
      similarGroupCode: matched.similarGroupCode,
      excluded: false,
      status: "ok",
      matchMethod: preferred.matchMethod,
      confidence: preferred.confidence,
      reviewReason: "",
      reviewCandidates: serializeCandidates(
        uniqueCandidates([matched, ...candidates]).slice(0, topK)
      ),
      error: "",
    };
  }
  return reviewResult(
    base,
    itemName,
    candidates,
    candidates.length ? "정확히 일치하는 고시명칭이 없음" : "고시명칭 후보가 없음"
  );
}

module.exports = {
  canonicalName,
  cleanItemName,
  normalizeByRules,
  serializeCandidates,
};
