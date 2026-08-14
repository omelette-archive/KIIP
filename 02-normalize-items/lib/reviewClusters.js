"use strict";

const fs = require("fs");
const { parseCsvLine } = require("./noticeDictionary");
const { canonicalName } = require("./ruleNormalizer");

const REVIEW_CLUSTER_SCHEMA_VERSION = "normalization-review-clusters-v1";

function readReviewCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const required = ["inputIndex", "sido", "sigungu", "rawItemName", "itemName", "status", "reviewReason", "reviewCandidates"];
  for (const field of required) {
    if (!header.includes(field)) throw new Error(`검토 CSV에 ${field} 컬럼이 필요합니다.`);
  }
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return Object.fromEntries(header.map((field, index) => [field, fields[index] || ""]));
  });
}

function parseCandidates(value) {
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("reviewCandidates가 JSON 배열이 아닙니다.");
  }
  if (!Array.isArray(parsed)) throw new Error("reviewCandidates가 JSON 배열이 아닙니다.");
  return parsed.map((candidate) => ({
    item: String(candidate?.item || ""),
    niceClass: String(candidate?.niceClass || ""),
    similarGroupCode: String(candidate?.similarGroupCode || ""),
    score: Number(candidate?.score) || 0,
  }));
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedCounts(map) {
  return [...map.entries()]
    .sort(([aKey, aCount], [bKey, bCount]) => bCount - aCount || aKey.localeCompare(bKey, "ko"))
    .map(([name, count]) => ({ name, count }));
}

function sortedItemCounts(map) {
  return [...map.entries()]
    .sort(([aName, aCount], [bName, bCount]) =>
      bCount - aCount ||
      aName.replace(/\s/g, "").length - bName.replace(/\s/g, "").length ||
      (aName.match(/\s/g) || []).length - (bName.match(/\s/g) || []).length ||
      aName.localeCompare(bName, "ko")
    )
    .map(([name, count]) => ({ name, count }));
}

function summarizeReviewRows(rows, { topCandidates = 5, examples = 3 } = {}) {
  if (!Number.isInteger(topCandidates) || topCandidates < 1) throw new Error("topCandidates는 1 이상 정수여야 합니다.");
  if (!Number.isInteger(examples) || examples < 1) throw new Error("examples는 1 이상 정수여야 합니다.");

  const reviewRows = rows.filter((row) => row.status === "review_required");
  const reasonCounts = new Map();
  const normalizationVersionCounts = new Map();
  const dictionaryVersionCounts = new Map();
  const groups = new Map();
  for (const row of reviewRows) {
    const itemName = String(row.itemName || row.rawItemName || "").normalize("NFC").trim();
    const key = canonicalName(itemName) || `input:${row.inputIndex}`;
    increment(reasonCounts, row.reviewReason || "사유 없음");
    increment(normalizationVersionCounts, row.normalizationVersion || "버전 없음");
    increment(dictionaryVersionCounts, row.dictionaryVersion || "버전 없음");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, itemName, parsedCandidates: parseCandidates(row.reviewCandidates) });
  }

  const clusters = [...groups.entries()].map(([groupKey, groupedRows]) => {
    const itemCounts = new Map();
    const rawCounts = new Map();
    const clusterReasonCounts = new Map();
    const regionCounts = new Map();
    const sourceCounts = new Map();
    const candidates = new Map();
    for (const row of groupedRows) {
      increment(itemCounts, row.itemName);
      increment(rawCounts, row.rawItemName || row.itemName);
      increment(clusterReasonCounts, row.reviewReason || "사유 없음");
      increment(regionCounts, [row.sido, row.sigungu].filter(Boolean).join(" ") || "지역 없음");
      increment(sourceCounts, row.sourceId || row.source || "출처 없음");
      const seenInRow = new Set();
      for (const candidate of row.parsedCandidates) {
        const candidateKey = [candidate.item, candidate.niceClass, candidate.similarGroupCode].join("\u0000");
        if (!candidates.has(candidateKey)) {
          candidates.set(candidateKey, { ...candidate, appearances: 0, scoreTotal: 0, scoreSamples: 0 });
        }
        const aggregate = candidates.get(candidateKey);
        if (!seenInRow.has(candidateKey)) {
          aggregate.appearances++;
          seenInRow.add(candidateKey);
        }
        aggregate.scoreTotal += candidate.score;
        aggregate.scoreSamples++;
      }
    }
    const candidateOptions = [...candidates.values()]
      .map((candidate) => ({
        item: candidate.item,
        niceClass: candidate.niceClass,
        similarGroupCode: candidate.similarGroupCode,
        appearances: candidate.appearances,
        coverage: Number((candidate.appearances / groupedRows.length).toFixed(4)),
        averageScore: Number((candidate.scoreTotal / candidate.scoreSamples).toFixed(4)),
      }))
      .sort((a, b) => b.appearances - a.appearances || b.averageScore - a.averageScore || a.item.localeCompare(b.item, "ko"));
    const itemVariants = sortedItemCounts(itemCounts);
    const topCandidate = candidateOptions[0] || null;
    return {
      groupKey,
      representativeItemName: itemVariants[0]?.name || "",
      rowCount: groupedRows.length,
      itemVariants,
      rawItemVariants: sortedItemCounts(rawCounts),
      reasonCounts: sortedCounts(clusterReasonCounts),
      regionCount: regionCounts.size,
      regions: sortedCounts(regionCounts),
      sourceCounts: sortedCounts(sourceCounts),
      candidateState: !topCandidate
        ? "no_candidates"
        : topCandidate.appearances === groupedRows.length
          ? "same_candidate_present_in_all_rows"
          : "mixed_candidates",
      candidateOptions: candidateOptions.slice(0, topCandidates),
      reviewDisposition: "human_review_required",
      examples: groupedRows.slice(0, examples).map((row) => ({
        inputIndex: row.inputIndex,
        sido: row.sido,
        sigungu: row.sigungu,
        rawItemName: row.rawItemName,
      })),
    };
  });
  clusters.sort((a, b) => b.rowCount - a.rowCount || a.representativeItemName.localeCompare(b.representativeItemName, "ko"));

  return {
    schemaVersion: REVIEW_CLUSTER_SCHEMA_VERSION,
    inputRowCount: rows.length,
    reviewRowCount: reviewRows.length,
    uniqueItemClusterCount: clusters.length,
    normalizationVersions: sortedCounts(normalizationVersionCounts),
    dictionaryVersions: sortedCounts(dictionaryVersionCounts),
    reasonCounts: sortedCounts(reasonCounts),
    clusters,
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function summaryCsv(summary) {
  const fields = [
    "groupKey", "representativeItemName", "rowCount", "regionCount", "candidateState",
    "topCandidateItem", "topCandidateNiceClass", "topCandidateSimilarGroupCode",
    "topCandidateCoverage", "reviewReasons", "rawItemVariants", "reviewDisposition",
  ];
  const lines = [fields.join(",")];
  for (const cluster of summary.clusters) {
    const top = cluster.candidateOptions[0] || {};
    const row = {
      groupKey: cluster.groupKey,
      representativeItemName: cluster.representativeItemName,
      rowCount: cluster.rowCount,
      regionCount: cluster.regionCount,
      candidateState: cluster.candidateState,
      topCandidateItem: top.item || "",
      topCandidateNiceClass: top.niceClass || "",
      topCandidateSimilarGroupCode: top.similarGroupCode || "",
      topCandidateCoverage: top.coverage ?? "",
      reviewReasons: cluster.reasonCounts.map((entry) => `${entry.name}:${entry.count}`).join(" | "),
      rawItemVariants: cluster.rawItemVariants.map((entry) => `${entry.name}:${entry.count}`).join(" | "),
      reviewDisposition: cluster.reviewDisposition,
    };
    lines.push(fields.map((field) => csvEscape(row[field])).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

module.exports = {
  REVIEW_CLUSTER_SCHEMA_VERSION,
  readReviewCsv,
  summarizeReviewRows,
  summaryCsv,
};
