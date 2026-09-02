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

const MATCH_VERSION = "kipris-trademark-applicant-region-v2-aliases";

function applicationNumbers(document) {
  const seen = new Set();
  const result = [];
  const entries = document?.storageMode === "query_facts"
    ? Object.values(document.queryFacts || {})
    : document.results || [];
  for (const entry of entries) {
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
      return {
        address: region.normalizedRegion || null,
        nationality: applicant.nationality || null,
        producerOrg: Boolean(applicant.producerOrg),
        regionNormalizationMethod: region.method || null,
        regionNormalizationReason: region.reason || null,
        hasSourceAddress: Boolean(String(applicant.address || "").trim()),
      };
    })
    .filter((applicant) => applicant.address || applicant.nationality || applicant.hasSourceAddress);
}

async function enrichApplicantRegions(document, client, options = {}) {
  if (!document || !Array.isArray(document.results)) {
    throw new Error("입력은 ③단계 결과 JSON이어야 합니다 (results 배열 필요).");
  }
  const cacheOnly = Boolean(options.cacheOnly);
  const limit = Number(options.limit ?? 10);
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isInteger(limit) || limit < (cacheOnly ? 0 : 1) || limit > 50000) {
    throw new Error(cacheOnly ? "cacheOnly 실행의 limit은 0~50000 정수여야 합니다." : "limit은 1~50000 정수여야 합니다.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error("concurrency는 1~5 정수여야 합니다.");
  }
  const cacheEntries = options.cacheEntries instanceof Map ? options.cacheEntries : new Map();
  const maxConsecutiveErrors = Number(options.maxConsecutiveErrors ?? 20);
  if (!Number.isInteger(maxConsecutiveErrors) || maxConsecutiveErrors < 1 || maxConsecutiveErrors > 1000) {
    throw new Error("maxConsecutiveErrors는 1~1000 정수여야 합니다.");
  }
  const adminList = options.adminList || loadAdminCodes();
  const allNumbers = applicationNumbers(document);
  const cachedNumbers = allNumbers.filter((number) => cacheEntries.get(number)?.status === "complete");
  const selected = cacheOnly
    ? []
    : allNumbers.filter((number) => !cacheEntries.has(number)).slice(0, limit);
  let cursor = 0;
  let rateLimitError = null;
  let haltError = null;
  let consecutiveErrors = 0;
  const fetched = [];
  async function worker() {
    while (cursor < selected.length) {
      const applicationNumber = selected[cursor++];
      if (rateLimitError || haltError) {
        fetched.push({
          applicationNumber,
          status: rateLimitError ? "rate_limited" : "circuit_breaker",
          requested: false,
        });
        continue;
      }
      try {
        const response = await client.getApplicants(applicationNumber);
        const entry = {
          status: "complete",
          fetchedAt: options.fetchedAt || new Date().toISOString(),
          found: response.found,
          resultCode: response.resultCode || null,
          terminalReason: response.retryExhausted ? "empty_after_retries" : null,
          applicants: sanitizeApplicants(response.applicants, adminList),
        };
        cacheEntries.set(applicationNumber, entry);
        fetched.push({ applicationNumber, ...entry, requested: true });
        consecutiveErrors = 0;
        if (typeof options.onCacheUpdate === "function") {
          await options.onCacheUpdate({ applicationNumber, entry, cacheEntries });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isRateLimitError(error)) rateLimitError = message;
        consecutiveErrors++;
        if (!rateLimitError && consecutiveErrors >= maxConsecutiveErrors) haltError = message;
        fetched.push({ applicationNumber, status: "error", error: message, requested: true });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  const available = new Map();
  for (const number of cachedNumbers) available.set(number, cacheEntries.get(number));
  for (const row of fetched) if (row.status === "complete") available.set(row.applicationNumber, row);

  const counts = { inside: 0, outside: 0, unverified: 0, notCollected: 0, noApplicationNumber: 0 };
  const enrichHitForRegion = (hit, queryRegion) => {
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
      const evaluated = evaluateApplicantRegions(
        queryRegion || "",
        cached.applicants,
        adminList
      );
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
  };
  let results;
  let queryFacts = document.queryFacts;
  if (document.storageMode === "query_facts") {
    queryFacts = Object.fromEntries(Object.entries(document.queryFacts || {}).map(([key, fact]) => [
      key,
      {
        ...fact,
        hits: (fact.hits || []).map((hit) => enrichHitForRegion(hit, "")),
      },
    ]));
    counts.inside = 0;
    counts.outside = 0;
    counts.unverified = 0;
    counts.notCollected = 0;
    counts.noApplicationNumber = 0;
    for (const entry of document.results || []) {
      const fact = queryFacts[entry.queryKey];
      for (const hit of fact?.hits || []) {
        const number = normalizeApplicationNumber(hit.applicationNumber);
        if (!number) counts.noApplicationNumber++;
        else if (!available.has(number)) counts.notCollected++;
        else {
          const evaluated = evaluateApplicantRegions(
            entry.query?.region || "",
            available.get(number).applicants,
            adminList
          );
          counts[evaluated.match]++;
        }
      }
    }
    results = document.results;
  } else {
    results = document.results.map((entry) => ({
      ...entry,
      hits: (entry.hits || []).map((hit) => enrichHitForRegion(hit, entry.query?.region || "")),
    }));
  }
  const requested = fetched.filter((row) => row.requested).length;
  const errors = fetched.filter((row) => row.status === "error").length;
  const newlyComplete = fetched.filter((row) => row.status === "complete").length;
  const totalComplete = cachedNumbers.length + newlyComplete;
  const fetchedAt = new Date().toISOString();
  return {
    ...document,
    queryFacts,
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
        storageUnit: document.storageMode === "query_facts" ? "query_fact_hit_with_region_row_evaluation" : "expanded_region_row_hit",
      },
      uniqueApplicationCount: allNumbers.length,
      cachedApplicationCount: cachedNumbers.length,
      selectedApplicationCount: selected.length,
      requestedApplicationCount: requested,
      newlyCompleteApplicationCount: newlyComplete,
      completeApplicationCount: totalComplete,
      errorApplicationCount: errors,
      notCollectedApplicationCount: Math.max(0, allNumbers.length - totalComplete),
      rateLimitDetected: Boolean(rateLimitError),
      circuitBreakerDetected: Boolean(haltError),
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
