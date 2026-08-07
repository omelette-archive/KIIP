#!/usr/bin/env node
"use strict";

/**
 * normalizeItems.js가 만든 검토 대기 CSV의 사람 결정을 전체 정규화 결과에 반영한다.
 * 외부 API나 모델을 호출하지 않으며, 자동 생성된 후보 중 하나를 승인하거나 제외/보류만
 * 허용한다. 임의 매핑이 필요하면 이 스크립트가 아니라 명시적 규칙/사전을 변경해야 한다.
 */

const fs = require("fs");
const path = require("path");
const { parseCsvLine } = require("./lib/noticeDictionary");
const { OUTPUT_FIELDS, writeOutputCsv } = require("./normalizeItems");

const ALLOWED_DECISIONS = new Set(["", "keep_pending", "approve_candidate", "exclude"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    args[key] = hasValue ? next : true;
    if (hasValue) i++;
  }
  return args;
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function parseCandidates(value, inputIndex) {
  let candidates;
  try {
    candidates = JSON.parse(value || "[]");
  } catch (error) {
    throw new Error(`inputIndex=${inputIndex}: reviewCandidates JSON이 올바르지 않습니다.`);
  }
  if (!Array.isArray(candidates)) {
    throw new Error(`inputIndex=${inputIndex}: reviewCandidates는 배열이어야 합니다.`);
  }
  return candidates;
}

function requireAudit(review, inputIndex) {
  if (!String(review.reviewedBy || "").trim()) {
    throw new Error(`inputIndex=${inputIndex}: reviewedBy가 필요합니다.`);
  }
  const reviewedAt = String(review.reviewedAt || "").trim();
  if (!reviewedAt || Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error(`inputIndex=${inputIndex}: reviewedAt에 ISO-8601 시각이 필요합니다.`);
  }
}

function applyDecision(row, review) {
  const inputIndex = String(row.inputIndex);
  const decision = String(review.reviewDecision || "").trim();
  if (!ALLOWED_DECISIONS.has(decision)) {
    throw new Error(`inputIndex=${inputIndex}: 허용되지 않은 reviewDecision=${decision}`);
  }

  if (!decision || decision === "keep_pending") {
    return {
      ...row,
      reviewDecision: decision,
      selectedCandidateIndex: "",
      reviewNote: review.reviewNote || "",
      reviewedBy: review.reviewedBy || "",
      reviewedAt: review.reviewedAt || "",
    };
  }

  requireAudit(review, inputIndex);
  const audit = {
    reviewDecision: decision,
    selectedCandidateIndex: "",
    reviewNote: review.reviewNote || "",
    reviewedBy: String(review.reviewedBy).trim(),
    reviewedAt: String(review.reviewedAt).trim(),
  };

  if (decision === "exclude") {
    return {
      ...row,
      noticeName: "",
      niceClass: "",
      similarGroupCode: "",
      excluded: true,
      status: "ok",
      matchMethod: "manual_excluded",
      confidence: "",
      reviewReason: "",
      ...audit,
    };
  }

  const indexText = String(review.selectedCandidateIndex || "").trim();
  if (!/^\d+$/.test(indexText)) {
    throw new Error(`inputIndex=${inputIndex}: selectedCandidateIndex는 0부터 시작하는 정수여야 합니다.`);
  }
  const candidateIndex = Number(indexText);
  const candidates = parseCandidates(row.reviewCandidates, inputIndex);
  const candidate = candidates[candidateIndex];
  if (!candidate || !candidate.item || !candidate.niceClass) {
    throw new Error(`inputIndex=${inputIndex}: 후보 ${candidateIndex}가 존재하지 않습니다.`);
  }

  return {
    ...row,
    noticeName: candidate.item,
    niceClass: candidate.niceClass,
    similarGroupCode: candidate.similarGroupCode || "",
    excluded: false,
    status: "ok",
    matchMethod: "manual_candidate",
    confidence: "",
    reviewReason: "",
    ...audit,
    selectedCandidateIndex: String(candidateIndex),
  };
}

function applyManualReviews(rows, reviews) {
  const rowsByIndex = new Map(rows.map((row) => [String(row.inputIndex), row]));
  const reviewsByIndex = new Map();

  for (const review of reviews) {
    const inputIndex = String(review.inputIndex || "").trim();
    if (!inputIndex) throw new Error("검토 CSV의 모든 행에 inputIndex가 필요합니다.");
    if (reviewsByIndex.has(inputIndex)) throw new Error(`중복 inputIndex=${inputIndex}`);
    const original = rowsByIndex.get(inputIndex);
    if (!original) throw new Error(`inputIndex=${inputIndex}: 원본 정규화 행이 없습니다.`);
    if (original.status !== "review_required") {
      throw new Error(`inputIndex=${inputIndex}: review_required 행만 검토할 수 있습니다.`);
    }
    reviewsByIndex.set(inputIndex, review);
  }

  return rows.map((row) => {
    const review = reviewsByIndex.get(String(row.inputIndex));
    return review ? applyDecision(row, review) : row;
  });
}

function usage(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error([
    "사용법:",
    "  node 02-normalize-items/applyManualReviews.js --input <normalized.csv> --reviews <review-required.csv> --out <reviewed.csv>",
    "",
    "reviewDecision: approve_candidate | exclude | keep_pending",
    "approve_candidate는 selectedCandidateIndex(0부터 시작), reviewedBy, reviewedAt이 필요합니다.",
    "exclude는 reviewedBy, reviewedAt이 필요합니다.",
  ].join("\n"));
  process.exit(message ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input || !args.reviews || !args.out) usage("--input, --reviews, --out은 필수입니다.");

  const rows = readCsv(path.resolve(args.input));
  const reviews = readCsv(path.resolve(args.reviews));
  const results = applyManualReviews(rows, reviews);
  writeOutputCsv(path.resolve(args.out), results);

  const approved = results.filter((row) => row.matchMethod === "manual_candidate").length;
  const excluded = results.filter((row) => row.matchMethod === "manual_excluded").length;
  const pending = results.filter((row) => row.status === "review_required").length;
  console.error(`[applyManualReviews] approved=${approved}, excluded=${excluded}, pending=${pending}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[applyManualReviews] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  ALLOWED_DECISIONS,
  applyDecision,
  applyManualReviews,
  readCsv,
};
