"use strict";

const { loadAdminCodes } = require("../../01-collect-specialties/lib/adminCodes");
const { splitRegion } = require("../../01-collect-specialties/lib/normalize");
const { normalizeAreaBrandRegion } = require("./areaBrandEnricher");
const { normalizeClassCode } = require("./filters");
const {
  IP_REGISTRY_SOURCE_METADATA,
  normalizeRegistrationNumber,
} = require("./ipRegistryClient");

const APPLICANT_REGION_MATCH_VERSION = "ip-registry-applicant-region-v1";
const GOODS_MATCH_VERSION = "ip-registry-designated-goods-v0-review";

function isRateLimitError(error) {
  return /(?:\b429\b|rate[ _-]?limit|요청\s*(?:횟수|건수).*초과|일일.*초과)/i.test(
    error instanceof Error ? error.message : String(error || "")
  );
}

function clean(value) {
  return value === undefined || value === null
    ? ""
    : String(value).normalize("NFC").trim().replace(/\s+/g, " ");
}

function normalizeGoodsText(value) {
  return clean(value).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function normalizeApplicantAddress(address, adminList = loadAdminCodes()) {
  const raw = clean(address);
  if (!raw) return { status: "unmatched", level: null, reason: "empty_address" };
  const split = splitRegion(raw, adminList);
  if (!split.matched) {
    return {
      status: split.ambiguous ? "ambiguous" : "unmatched",
      level: null,
      reason: split.ambiguous ? "ambiguous_sigungu" : "address_not_in_admin_master",
      candidateSidos: split.candidateSidos || [],
    };
  }
  return {
    status: "matched",
    level: split.sigungu ? "sigungu" : "sido",
    sido: split.sido,
    sigungu: split.sigungu,
    normalizedRegion: [split.sido, split.sigungu].filter(Boolean).join(" "),
    method: split.sigungu ? "admin_sigungu_in_masked_address" : "admin_sido_in_masked_address",
  };
}

function classifyApplicantRegionMatch(queryRegion, applicantRegion) {
  if (queryRegion.status !== "matched" || applicantRegion.status !== "matched") {
    return { match: "unverified", confidence: "unverified_registry_address" };
  }
  if (queryRegion.sido !== applicantRegion.sido) {
    return { match: "outside", confidence: "exact_registry_address_sido" };
  }
  if (queryRegion.level === "sigungu" && applicantRegion.level === "sigungu") {
    return {
      match: queryRegion.sigungu === applicantRegion.sigungu ? "inside" : "outside",
      confidence: "exact_registry_address_sigungu",
    };
  }
  return { match: "inside", confidence: "exact_registry_address_sido" };
}

function evaluateApplicantRegions(queryRegionText, applicants, adminList = loadAdminCodes()) {
  const queryRegion = normalizeAreaBrandRegion(queryRegionText, adminList);
  const evidence = (applicants || []).map((applicant) => {
    const region = normalizeApplicantAddress(applicant.address, adminList);
    const result = classifyApplicantRegionMatch(queryRegion, region);
    return {
      normalizedRegion: region.normalizedRegion || null,
      regionStatus: region.status,
      regionLevel: region.level,
      sido: region.sido || null,
      sigungu: region.sigungu || null,
      nationality: applicant.nationality || null,
      representative: applicant.representative || null,
      match: result.match,
      confidence: result.confidence,
    };
  });
  if (evidence.length === 0) {
    return { match: "unverified", confidence: "no_applicant_address", evidence: [] };
  }
  const matches = [...new Set(evidence.map((row) => row.match))];
  const confidences = [...new Set(evidence.map((row) => row.confidence))];
  if (matches.length !== 1 || confidences.length !== 1) {
    return {
      match: "unverified",
      confidence: "multiple_conflicting_applicant_addresses",
      evidence,
    };
  }
  return { match: matches[0], confidence: confidences[0], evidence };
}

function queryClassCodes(value) {
  return new Set(
    clean(value)
      .split(/[|,;\s]+/)
      .filter(Boolean)
      .map(normalizeClassCode)
  );
}

function evaluateGoods(query, products) {
  const target = normalizeGoodsText(query?.item);
  const wantedClasses = queryClassCodes(query?.classCode);
  const normalizedProducts = (products || []).map((product) => ({
    classCode: product.classCode ? normalizeClassCode(product.classCode) : null,
    designatedProductName: clean(product.designatedProductName) || null,
    normalizedName: normalizeGoodsText(product.designatedProductName),
  }));
  const classMatched = normalizedProducts.filter(
    (product) => wantedClasses.size === 0 || (product.classCode && wantedClasses.has(product.classCode))
  );
  const exact = target
    ? classMatched.filter((product) => product.normalizedName === target)
    : [];
  const contains = target
    ? classMatched.filter(
        (product) =>
          product.normalizedName &&
          product.normalizedName !== target &&
          (product.normalizedName.includes(target) || target.includes(product.normalizedName))
      )
    : [];
  let method = "unverified";
  let confidence = "unverified";
  let reviewRequired = true;
  if (exact.length > 0) {
    method = "normalized_exact";
    confidence = "high";
    reviewRequired = false;
  } else if (contains.length > 0) {
    method = "normalized_contains";
    confidence = "high_contains";
    // 지정상품명에 고시상품명칭이 포함되면 특산품 활용 출원으로 인정한다.
    reviewRequired = false;
  } else if (classMatched.length > 0) {
    method = "class_only";
    confidence = "candidate_only";
  } else if (normalizedProducts.length > 0) {
    method = "mismatch";
    confidence = "high";
  }
  return {
    method,
    confidence,
    reviewRequired,
    targetNormalized: target || null,
    productCount: normalizedProducts.length,
    classMatchedProductCount: classMatched.length,
    evidence: [...exact, ...contains]
      .filter(
        (row, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.classCode === row.classCode &&
              candidate.designatedProductName === row.designatedProductName
          ) === index
      )
      .slice(0, 50)
      .map(({ classCode, designatedProductName }) => ({ classCode, designatedProductName })),
  };
}

function enrichHit(hit, query, record, fetchedAt) {
  const applicant = evaluateApplicantRegions(query?.region, record.applicants);
  const goods = evaluateGoods(query, record.products);
  return {
    ...hit,
    ipRegistryStatus: "complete",
    ipRegistrySource: IP_REGISTRY_SOURCE_METADATA.sourceId,
    ipRegistryContractVersion: IP_REGISTRY_SOURCE_METADATA.contractVersion,
    ipRegistryFetchedAt: fetchedAt,
    applicantRegionMatch: applicant.match,
    applicantRegionMatchSource: "ip_registry_applicant_address",
    applicantRegionMatchVersion: APPLICANT_REGION_MATCH_VERSION,
    applicantRegionMatchConfidence: applicant.confidence,
    applicantRegionEvidence: applicant.evidence,
    goodsMatchMethod: goods.method,
    goodsMatchConfidence: goods.confidence,
    goodsMatchVersion: GOODS_MATCH_VERSION,
    goodsReviewRequired: goods.reviewRequired,
    goodsEvidence: goods.evidence,
    registryEvidence: {
      registrationNumber: record.registrationNumber || hit.registrationNumber || null,
      applicationNumber: record.applicationNumber || hit.applicationNumber || null,
      productCount: goods.productCount,
      classMatchedProductCount: goods.classMatchedProductCount,
    },
  };
}

function sanitizeRegistryRecordForCache(record, adminList = loadAdminCodes()) {
  const applicants = (record?.applicants || [])
    .map((applicant) => {
      const region = normalizeApplicantAddress(applicant.address, adminList);
      return {
        address: region.normalizedRegion || null,
        nationality: applicant.nationality || null,
        representative: applicant.representative || null,
      };
    })
    .filter((applicant) => applicant.address || applicant.nationality);
  return {
    found: Boolean(record?.found),
    resultCode: record?.resultCode || null,
    resultMsg: record?.resultMsg || null,
    totalCount: Number(record?.totalCount) || 0,
    applicationNumber: record?.applicationNumber || null,
    registrationNumber: record?.registrationNumber || null,
    registrationDate: record?.registrationDate || null,
    applicants,
    products: (record?.products || []).map((product) => ({
      classCode: product.classCode || null,
      designatedProductName: product.designatedProductName || null,
    })),
  };
}

// storageMode=query_facts(③ 기본 저장 방식)에서는 hit가 entry가 아니라
// document.queryFacts[queryKey]에 한 번만 저장된다. 여기서 안 읽으면 등록번호를 하나도
// 못 찾는다(2026-08-12 발견 — 지정상품 매칭 기준 완화가 실데이터에 전혀 반영되지 않던 원인).
function factHitSources(document) {
  if (document?.storageMode === "query_facts" && document.queryFacts) {
    return Object.values(document.queryFacts);
  }
  return document.results || [];
}

function registryNumbers(document) {
  const result = [];
  const seen = new Set();
  for (const entry of factHitSources(document)) {
    for (const hit of entry.hits || []) {
      const number = normalizeRegistrationNumber(hit.registrationNumber);
      if (number && !seen.has(number)) {
        seen.add(number);
        result.push(number);
      }
    }
  }
  return result;
}

async function mapConcurrent(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker));
  return output;
}

function createRequestBudget(maxRequests) {
  let used = 0;
  return {
    reserve() {
      if (used >= maxRequests) return false;
      used++;
      return true;
    },
    get used() {
      return used;
    },
  };
}

function createIpRegistryContext({
  client,
  adminList = loadAdminCodes(),
  maxRequests = 3,
  concurrency = 3,
} = {}) {
  if (!client) throw new Error("createIpRegistryContext: client가 필요합니다.");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100) {
    throw new Error("maxRequests는 1~100 정수여야 합니다.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error("concurrency는 1~5 정수여야 합니다.");
  }
  return {
    client,
    adminList,
    concurrency,
    budget: createRequestBudget(maxRequests),
    cache: new Map(),
    rateLimitError: null,
    stats: {
      requested: 0,
      completed: 0,
      notFound: 0,
      cacheHits: 0,
      skippedBudget: 0,
      skippedRateLimit: 0,
      errors: 0,
    },
  };
}

async function lookupMarkHistory(context, registrationNumber) {
  if (context.cache.has(registrationNumber)) {
    context.stats.cacheHits++;
    return context.cache.get(registrationNumber);
  }
  if (context.rateLimitError) {
    context.stats.skippedRateLimit++;
    const skipped = Promise.resolve({
      status: "not_collected",
      reason: "rate_limit",
      error: context.rateLimitError,
    });
    context.cache.set(registrationNumber, skipped);
    return skipped;
  }
  if (!context.budget.reserve()) {
    context.stats.skippedBudget++;
    const skipped = Promise.resolve({ status: "not_collected" });
    context.cache.set(registrationNumber, skipped);
    return skipped;
  }
  context.stats.requested++;
  const promise = context.client
    .getMarkHistory(registrationNumber)
    .then((record) => {
      if (!record?.found) {
        context.stats.notFound++;
        return { status: "not_found", record };
      }
      context.stats.completed++;
      return { status: "complete", record };
    })
    .catch((error) => {
      context.stats.errors++;
      const message = error instanceof Error ? error.message : String(error);
      if (isRateLimitError(error)) context.rateLimitError = message;
      return {
        status: "error",
        error: message,
      };
    });
  context.cache.set(registrationNumber, promise);
  return promise;
}

async function enrichHitsWithIpRegistry(hits, queryInput, context) {
  if (!context || !Array.isArray(hits) || hits.length === 0) return hits;
  const query =
    queryInput && typeof queryInput === "object"
      ? queryInput
      : { region: queryInput || "" };
  const fetchedAt = new Date().toISOString();
  return mapConcurrent(hits, context.concurrency, async (hit) => {
    const registrationNumber = normalizeRegistrationNumber(hit.registrationNumber);
    if (!registrationNumber) {
      return {
        ...hit,
        ipRegistryStatus: "not_applicable",
        ipRegistryLookup: { status: "no_registration_number" },
      };
    }
    const result = await lookupMarkHistory(context, registrationNumber);
    if (result.status !== "complete") {
      return {
        ...hit,
        ipRegistryStatus: result.status,
        ipRegistryError: result.error || undefined,
        ipRegistryLookup: {
          status:
            result.status === "not_collected"
              ? result.reason === "rate_limit" ? "skipped_rate_limit" : "skipped_budget"
              : result.status,
          error: result.error || null,
        },
      };
    }
    const enriched = enrichHit(hit, query, result.record, fetchedAt);
    const firstRegion = enriched.applicantRegionEvidence[0];
    return {
      ...enriched,
      ipRegistryLookup: { status: "ok" },
      applicantRegion: firstRegion
        ? {
            sido: firstRegion.sido,
            sigungu: firstRegion.sigungu,
            status: firstRegion.regionStatus,
            level: firstRegion.regionLevel,
          }
        : undefined,
      designatedGoodsEvidence:
        result.record.products.length > 0
          ? {
              registrationNumber: result.record.registrationNumber,
              productList: result.record.products.map((row) => ({
                productClsCd: row.classCode,
                desProduct: row.designatedProductName,
              })),
              source: IP_REGISTRY_SOURCE_METADATA.sourceId,
              contractVersion: IP_REGISTRY_SOURCE_METADATA.contractVersion,
            }
          : undefined,
    };
  });
}

function summarizeIpRegistryMatches(results) {
  const counts = { inside: 0, outside: 0, unverified: 0, referenced: 0, goodsReferenced: 0 };
  for (const entry of results || []) {
    for (const hit of entry.hits || []) {
      if (hit.ipRegistryStatus === "complete") {
        counts.referenced++;
        const match = hit.applicantRegionMatch;
        if (match === "inside" || match === true) counts.inside++;
        else if (match === "outside" || match === false) counts.outside++;
        else counts.unverified++;
      }
      if (hit.designatedGoodsEvidence) counts.goodsReferenced++;
    }
  }
  return counts;
}

function ipRegistryValidationMetadata(context, results) {
  if (!context) return { enabled: false };
  const matchCounts = summarizeIpRegistryMatches(results);
  const goodsMatchCounts = {
    normalized_exact: 0,
    normalized_contains: 0,
    class_only: 0,
    mismatch: 0,
    unverified: 0,
  };
  for (const entry of results || []) {
    for (const hit of entry.hits || []) {
      if (goodsMatchCounts[hit.goodsMatchMethod] !== undefined) {
        goodsMatchCounts[hit.goodsMatchMethod]++;
      }
    }
  }
  const fetchedAt = new Date().toISOString();
  const status =
    context.stats.errors === context.stats.requested && context.stats.requested > 0
      ? "error"
      : context.stats.errors > 0 || context.stats.skippedBudget > 0 || context.stats.skippedRateLimit > 0
        ? "partial"
        : "complete";
  return {
    enabled: true,
    status,
    fetchedAt,
    sourceMetadata: { ...IP_REGISTRY_SOURCE_METADATA, fetchedAt },
    policy: {
      registrationNumberOnly: true,
      unregisteredHits: "not_applicable",
      classOnlyStatistics: "candidate_only_until_issue_12_policy",
      goodsMatchVersion: GOODS_MATCH_VERSION,
      applicantRegionMatchVersion: APPLICANT_REGION_MATCH_VERSION,
    },
    requestStats: { ...context.stats },
    requestedRegistrationCount: context.stats.requested,
    completeRegistrationCount: context.stats.completed,
    notFoundRegistrationCount: context.stats.notFound,
    errorRegistrationCount: context.stats.errors,
    notCollectedRegistrationCount: context.stats.skippedBudget + context.stats.skippedRateLimit,
    rateLimitDetected: Boolean(context.rateLimitError),
    applicantRegionCounts: {
      inside: matchCounts.inside,
      outside: matchCounts.outside,
      unverified: matchCounts.unverified,
    },
    goodsMatchCounts,
    matchCounts,
  };
}

async function enrichDocument(document, client, options = {}) {
  if (!document || !Array.isArray(document.results)) {
    throw new Error("입력은 ③단계 결과 JSON이어야 합니다 (results 배열 필요).");
  }
  const allNumbers = registryNumbers(document);
  const limit = Number(options.limit ?? 3);
  const concurrency = Number(options.concurrency ?? 1);
  const cacheEntries = options.cacheEntries instanceof Map ? options.cacheEntries : new Map();
  const adminList = options.adminList || loadAdminCodes();
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
    throw new Error("limit은 0~100 정수여야 합니다.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new Error("concurrency는 1~5 정수여야 합니다.");
  }
  const cachedByNumber = new Map(
    allNumbers
      .filter((number) => cacheEntries.get(number)?.status === "complete")
      .map((number) => [number, cacheEntries.get(number)])
  );
  const uncachedNumbers = allNumbers.filter((number) => !cachedByNumber.has(number));
  const selected = uncachedNumbers.slice(0, limit);
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  let rateLimitError = null;
  const fetched = await mapConcurrent(selected, concurrency, async (registrationNumber) => {
    if (rateLimitError) {
      return {
        registrationNumber,
        status: "rate_limited",
        error: rateLimitError,
        requested: false,
      };
    }
    try {
      const record = await client.getMarkHistory({ registrationNumber });
      if (record.found) {
        cacheEntries.set(registrationNumber, {
          status: "complete",
          fetchedAt,
          record: sanitizeRegistryRecordForCache(record, adminList),
        });
        if (typeof options.onCacheUpdate === "function") options.onCacheUpdate(registrationNumber);
      }
      return {
        registrationNumber,
        status: record.found ? "complete" : "not_found",
        record,
        requested: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRateLimitError(error)) rateLimitError = message;
      return {
        registrationNumber,
        status: "error",
        error: message,
        requested: true,
      };
    }
  });
  const fetchedByNumber = new Map(
    [...cachedByNumber.entries()].map(([registrationNumber, entry]) => [
      registrationNumber,
      { registrationNumber, status: "complete", record: entry.record, requested: false, cached: true },
    ])
  );
  for (const row of fetched) fetchedByNumber.set(row.registrationNumber, row);
  const counts = {
    registeredHitCount: 0,
    noRegistrationHitCount: 0,
    completeHitCount: 0,
    notFoundHitCount: 0,
    errorHitCount: 0,
    notCollectedHitCount: 0,
  };
  const applicantRegionCounts = { inside: 0, outside: 0, unverified: 0 };
  const goodsMatchCounts = {
    normalized_exact: 0,
    normalized_contains: 0,
    class_only: 0,
    mismatch: 0,
    unverified: 0,
  };
  function enrichHits(hits, query) {
    return (hits || []).map((hit) => {
      const number = normalizeRegistrationNumber(hit.registrationNumber);
      if (!number) {
        counts.noRegistrationHitCount++;
        return { ...hit, ipRegistryStatus: "not_applicable" };
      }
      counts.registeredHitCount++;
      const fetchedRow = fetchedByNumber.get(number);
      if (!fetchedRow) {
        counts.notCollectedHitCount++;
        return { ...hit, ipRegistryStatus: "not_collected" };
      }
      if (fetchedRow?.status === "rate_limited") {
        counts.notCollectedHitCount++;
        return {
          ...hit,
          ipRegistryStatus: "not_collected",
          ipRegistryLookup: { status: "skipped_rate_limit" },
        };
      }
      if (!fetchedRow || fetchedRow.status === "error") {
        counts.errorHitCount++;
        return {
          ...hit,
          ipRegistryStatus: "error",
          ipRegistryError: fetchedRow?.error || "등록원부 조회 결과 없음",
        };
      }
      if (fetchedRow.status === "not_found") {
        counts.notFoundHitCount++;
        return { ...hit, ipRegistryStatus: "not_found" };
      }
      counts.completeHitCount++;
      const enriched = enrichHit(hit, query || {}, fetchedRow.record, fetchedAt);
      applicantRegionCounts[enriched.applicantRegionMatch]++;
      goodsMatchCounts[enriched.goodsMatchMethod]++;
      return enriched;
    });
  }

  // query_facts 저장 방식은 각 고유 쿼리의 hits를 한 번만(지역행마다 복제하지 않고) 보강한다
  // — results는 그대로 두고 queryFacts만 갱신해 압축 저장 구조를 유지한다.
  const isQueryFacts = document.storageMode === "query_facts" && document.queryFacts;
  const queryFacts = isQueryFacts
    ? Object.fromEntries(
        Object.entries(document.queryFacts).map(([key, fact]) => [
          key,
          { ...fact, hits: enrichHits(fact.hits, fact.query) },
        ])
      )
    : undefined;
  const results = isQueryFacts
    ? document.results
    : document.results.map((entry) => ({ ...entry, hits: enrichHits(entry.hits, entry.query) }));
  const errorRegistrationCount = fetched.filter((row) => row.status === "error").length;
  const notFoundRegistrationCount = fetched.filter((row) => row.status === "not_found").length;
  const completeRegistrationCount = fetched.filter((row) => row.status === "complete").length;
  const cachedRegistrationCount = cachedByNumber.size;
  const totalCompleteRegistrationCount = cachedRegistrationCount + completeRegistrationCount;
  const requestedRegistrationCount = fetched.filter((row) => row.requested).length;
  const rateLimitSkippedRegistrationCount = fetched.filter(
    (row) => row.status === "rate_limited"
  ).length;
  const notCollectedRegistrationCount = Math.max(
    0,
    allNumbers.length - totalCompleteRegistrationCount - notFoundRegistrationCount - errorRegistrationCount
  );
  const status =
    errorRegistrationCount === selected.length && selected.length > 0
      ? "error"
      : errorRegistrationCount > 0 || notCollectedRegistrationCount > 0
        ? "partial"
        : "complete";
  return {
    ...document,
    results,
    ...(queryFacts ? { queryFacts } : {}),
    ipRegistryEnrichment: {
      enabled: true,
      status,
      fetchedAt,
      sourceMetadata: { ...IP_REGISTRY_SOURCE_METADATA, fetchedAt },
      policy: {
        registrationNumberOnly: true,
        unregisteredHits: "not_applicable",
        classOnlyStatistics: "candidate_only_until_issue_12_policy",
        goodsMatchVersion: GOODS_MATCH_VERSION,
        applicantRegionMatchVersion: APPLICANT_REGION_MATCH_VERSION,
      },
      uniqueRegistrationCount: allNumbers.length,
      selectedRegistrationCount: selected.length,
      requestedRegistrationCount,
      cachedRegistrationCount,
      newlyCompleteRegistrationCount: completeRegistrationCount,
      completeRegistrationCount: totalCompleteRegistrationCount,
      notFoundRegistrationCount,
      errorRegistrationCount,
      notCollectedRegistrationCount,
      rateLimitDetected: Boolean(rateLimitError),
      rateLimitSkippedRegistrationCount,
      counts,
      applicantRegionCounts,
      goodsMatchCounts,
    },
  };
}

module.exports = {
  APPLICANT_REGION_MATCH_VERSION,
  GOODS_MATCH_VERSION,
  classifyApplicantRegionMatch,
  createIpRegistryContext,
  enrichDocument,
  enrichHit,
  enrichHitsWithIpRegistry,
  evaluateApplicantRegions,
  evaluateGoods,
  normalizeApplicantAddress,
  normalizeGoodsText,
  isRateLimitError,
  ipRegistryValidationMetadata,
  registryNumbers,
  sanitizeRegistryRecordForCache,
  summarizeIpRegistryMatches,
};
