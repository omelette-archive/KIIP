"use strict";

const { loadAdminCodes } = require("../../01-collect-specialties/lib/adminCodes");
const {
  evaluateApplicantRegions,
  isRateLimitError,
  normalizeApplicantAddress,
} = require("./ipRegistryEnricher");
const {
  SOURCE_METADATA,
  normalizeApplicationNumber,
} = require("./trademarkApplicantClient");

const MATCH_VERSION = "kipris-trademark-applicant-region-v1";

function applicationNumbers(document) {
  const seen = new Set();
  const result = [];
  for (const entry of document.results || []) {
    for (const hit of entry.hits || []) {
      const number = normalizeApplicationNumber(hit.applicationNumber);
      if (number && !seen.has(number)) {
        seen.add(number);
        result.push(number);
      }
    }
  }
  return result;
}

function sanitizeApplicants(applicants, adminList) {
  return (applicants || [])
    .map((applicant) => {
      const region = normalizeApplicantAddress(applicant.address, adminList);
      return { address: region.normalizedRegion || null, nationality: applicant.nationality || null };
    })
    .filter((applicant) => applicant.address || applicant.nationality);
}

async function enrichApplicantRegions(document, client, options = {}) {
  if (!document || !Array.isArray(document.results)) {
    throw new Error("입력은 ③단계 결과 JSON이어야 합니다 (results 배열 필요).");
  }
  const limit = Number(options.limit ?? 10);
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("limit은 1~1000 정수여야 합니다.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error("concurrency는 1~5 정수여야 합니다.");
  }
  const cacheEntries = options.cacheEntries instanceof Map ? options.cacheEntries : new Map();
  const adminList = options.adminList || loadAdminCodes();
  const allNumbers = applicationNumbers(document);
  const cachedNumbers = allNumbers.filter((number) => cacheEntries.get(number)?.status === "complete");
  const selected = allNumbers.filter((number) => !cacheEntries.has(number)).slice(0, limit);
  let cursor = 0;
  let rateLimitError = null;
  const fetched = [];
  async function worker() {
    while (cursor < selected.length) {
      const applicationNumber = selected[cursor++];
      if (rateLimitError) {
        fetched.push({ applicationNumber, status: "rate_limited", requested: false });
        continue;
      }
      try {
        const response = await client.getApplicants(applicationNumber);
        const entry = {
          status: "complete",
          fetchedAt: options.fetchedAt || new Date().toISOString(),
          found: response.found,
          applicants: sanitizeApplicants(response.applicants, adminList),
        };
        cacheEntries.set(applicationNumber, entry);
        fetched.push({ applicationNumber, ...entry, requested: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isRateLimitError(error)) rateLimitError = message;
        fetched.push({ applicationNumber, status: "error", error: message, requested: true });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  const available = new Map();
  for (const number of cachedNumbers) available.set(number, cacheEntries.get(number));
  for (const row of fetched) if (row.status === "complete") available.set(row.applicationNumber, row);

  const counts = { inside: 0, outside: 0, unverified: 0, notCollected: 0, noApplicationNumber: 0 };
  const results = document.results.map((entry) => ({
    ...entry,
    hits: (entry.hits || []).map((hit) => {
      const number = normalizeApplicationNumber(hit.applicationNumber);
      if (!number) {
        counts.noApplicationNumber++;
        return { ...hit, applicationApplicantLookup: { status: "no_application_number" } };
      }
      const cached = available.get(number);
      if (!cached) {
        counts.notCollected++;
        return { ...hit, applicationApplicantLookup: { status: "not_collected" } };
      }
      const evaluated = evaluateApplicantRegions(entry.query?.region || "", cached.applicants);
      counts[evaluated.match]++;
      return {
        ...hit,
        applicantRegionMatch: evaluated.match,
        applicantRegionMatchSource: SOURCE_METADATA.sourceId,
        applicantRegionMatchVersion: MATCH_VERSION,
        applicantRegionMatchConfidence: evaluated.confidence,
        applicantRegionEvidence: evaluated.evidence,
        applicationApplicantLookup: {
          status: "ok",
          fetchedAt: cached.fetchedAt || null,
          found: Boolean(cached.found),
        },
      };
    }),
  }));
  const requested = fetched.filter((row) => row.requested).length;
  const errors = fetched.filter((row) => row.status === "error").length;
  const newlyComplete = fetched.filter((row) => row.status === "complete").length;
  const totalComplete = cachedNumbers.length + newlyComplete;
  const fetchedAt = new Date().toISOString();
  return {
    ...document,
    results,
    applicationApplicantEnrichment: {
      enabled: true,
      status: totalComplete === allNumbers.length ? "complete" : errors === requested && requested > 0 ? "error" : "partial",
      fetchedAt,
      sourceMetadata: { ...SOURCE_METADATA, fetchedAt },
      policy: {
        lookupKey: "applicationNumber",
        addressStorage: "normalized_sido_sigungu_only",
        applicantRegionMatchVersion: MATCH_VERSION,
      },
      uniqueApplicationCount: allNumbers.length,
      cachedApplicationCount: cachedNumbers.length,
      selectedApplicationCount: selected.length,
      requestedApplicationCount: requested,
      newlyCompleteApplicationCount: newlyComplete,
      completeApplicationCount: totalComplete,
      errorApplicationCount: errors,
      notCollectedApplicationCount: Math.max(0, allNumbers.length - totalComplete - errors),
      rateLimitDetected: Boolean(rateLimitError),
      applicantRegionCounts: counts,
    },
  };
}

module.exports = {
  MATCH_VERSION,
  applicationNumbers,
  enrichApplicantRegions,
  sanitizeApplicants,
};
