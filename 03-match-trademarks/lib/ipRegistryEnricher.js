"use strict";
/**
 * ③ 배치 결과의 hit 중 registrationNumber가 있는 것만 골라 등록원부 API(getMarkHistory)로
 * 보강한다 — 출원인 주소(#11)와 지정상품(#12)을 함께 얻는다.
 *
 * 농사로 지역브랜드(areaBrandEnricher.js)와의 차이: 그쪽은 사전에 받아둔 정적 파일을
 * 출원번호로 조인하는 동기 처리지만, 여기는 등록번호 단위로 실시간 API를 호출하는 비동기
 * 처리다. 그래서 호출 예산(budget)과 동시성 제어가 필요하고, 실패한 개별 조회가 배치 전체를
 * 죽이지 않도록 개별 hit 단위로 에러를 흡수한다.
 *
 * 지역 판정 로직은 areaBrandEnricher.js의 normalizeAreaBrandRegion/classifyRegionalBrandMatch를
 * 그대로 재사용한다(지역 텍스트 정규화 규칙은 출처와 무관하게 동일해야 함). 다만 여기서 얻는
 * 주소는 지역브랜드처럼 "브랜드 연관 지역"이 아니라 진짜 출원인 주소이므로, 결과를
 * regionalBrand*가 아니라 04-analyze-brand가 이미 읽는 applicantRegionMatch 본류에 직접
 * 반영한다(docs/data-source-provenance.md 참고).
 */

const { loadAdminCodes } = require("../../01-collect-specialties/lib/adminCodes");
const {
  classifyRegionalBrandMatch,
  normalizeAreaBrandRegion,
} = require("./areaBrandEnricher");
const {
  IP_REGISTRY_CONTRACT_VERSION,
  IP_REGISTRY_SOURCE_METADATA,
  normalizeRegistrationNumber,
} = require("./ipRegistryClient");

const APPLICANT_REGION_MATCH_VERSION = "ip-registry-applicant-region-v1";

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

// 실키 검증(2026-08-11) 중 hits 46건을 무제한 동시 호출로 보강했더니 25건 전부 HTTP 429가
// 났다 — fetchWithRetry의 지수 백오프로도 회복이 안 될 만큼 이 서비스의 초당 허용량이
// 낮다. runWithConcurrency로 동시 호출 수를 좁혀 재시도가 실제로 회복할 시간을 준다.
async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}

function createIpRegistryContext({
  client,
  adminList = loadAdminCodes(),
  maxRequests = 50,
  concurrency = 3,
} = {}) {
  if (!client) throw new Error("createIpRegistryContext: client가 필요합니다.");
  return {
    client,
    adminList,
    concurrency,
    budget: createRequestBudget(maxRequests),
    cache: new Map(), // registrationNumber -> Promise<{status, enrichment?, error?}>
    stats: { requested: 0, cacheHits: 0, skippedBudget: 0, errors: 0 },
  };
}

async function lookupMarkHistory(context, registrationNumber) {
  if (context.cache.has(registrationNumber)) {
    context.stats.cacheHits++;
    return context.cache.get(registrationNumber);
  }
  if (!context.budget.reserve()) {
    context.stats.skippedBudget++;
    const skipped = Promise.resolve({ status: "skipped_budget" });
    context.cache.set(registrationNumber, skipped);
    return skipped;
  }
  context.stats.requested++;
  const promise = context.client
    .getMarkHistory(registrationNumber)
    .then((enrichment) => ({ status: "ok", enrichment }))
    .catch((error) => {
      context.stats.errors++;
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    });
  context.cache.set(registrationNumber, promise);
  return promise;
}

function designatedGoodsEvidence(enrichment) {
  return {
    registrationNumber: enrichment.registrationNumber,
    productList: enrichment.productList,
    source: IP_REGISTRY_SOURCE_METADATA.sourceId,
    contractVersion: IP_REGISTRY_CONTRACT_VERSION,
  };
}

/**
 * @param {object[]} hits ③ 배치의 한 쿼리(entry) 안의 hits
 * @param {string} queryRegionText entry.query.region ("경상북도 안동시" 형태)
 * @param {ReturnType<typeof createIpRegistryContext>} context
 */
async function enrichHitsWithIpRegistry(hits, queryRegionText, context) {
  if (!context || !Array.isArray(hits) || hits.length === 0) return hits;
  const queryRegion = normalizeAreaBrandRegion(queryRegionText, context.adminList);

  return runWithConcurrency(hits, context.concurrency, async (hit) => {
    const rgstNo = normalizeRegistrationNumber(hit.registrationNumber);
    if (!rgstNo) return { ...hit, ipRegistryLookup: { status: "no_registration_number" } };

    const result = await lookupMarkHistory(context, rgstNo);
    if (result.status !== "ok") {
      return { ...hit, ipRegistryLookup: { status: result.status, error: result.error || null } };
    }

    const { enrichment } = result;
    const enriched = { ...hit, ipRegistryLookup: { status: "ok" } };

    if (enrichment.applicantAddr) {
      const applicantRegion = normalizeAreaBrandRegion(enrichment.applicantAddr, context.adminList);
      const classified = classifyRegionalBrandMatch(queryRegion, applicantRegion);
      enriched.applicantRegion = {
        raw: enrichment.applicantAddr,
        sido: applicantRegion.sido || null,
        sigungu: applicantRegion.sigungu || null,
        status: applicantRegion.status,
        level: applicantRegion.level,
      };
      enriched.applicantRegionMatchSource = IP_REGISTRY_SOURCE_METADATA.sourceId;
      enriched.applicantRegionMatchVersion = APPLICANT_REGION_MATCH_VERSION;
      // classifyRegionalBrandMatch는 'inside'/'outside'/'unverified' 문자열을 준다.
      // 04-analyze-brand의 regionCategory()는 applicantRegionMatch가 boolean이면 바로
      // inside/outside로 읽으므로, 확신하지 못하는 unverified는 필드를 아예 비워 과신하지
      // 않는다(지역브랜드 조인 때와 같은 원칙).
      if (classified.match === "inside") enriched.applicantRegionMatch = true;
      else if (classified.match === "outside") enriched.applicantRegionMatch = false;
    }

    if (enrichment.productList.length > 0) {
      enriched.designatedGoodsEvidence = designatedGoodsEvidence(enrichment);
    }

    return enriched;
  });
}

function summarizeIpRegistryMatches(results) {
  const counts = { inside: 0, outside: 0, unverified: 0, referenced: 0, goodsReferenced: 0 };
  for (const entry of results || []) {
    for (const hit of entry.hits || []) {
      if (hit.applicantRegionMatchSource) {
        counts.referenced++;
        if (hit.applicantRegionMatch === true) counts.inside++;
        else if (hit.applicantRegionMatch === false) counts.outside++;
        else counts.unverified++;
      }
      if (hit.designatedGoodsEvidence) counts.goodsReferenced++;
    }
  }
  return counts;
}

function ipRegistryValidationMetadata(context, results) {
  if (!context) return { enabled: false };
  const metadata = {
    enabled: true,
    sourceMetadata: IP_REGISTRY_SOURCE_METADATA,
    contractVersion: IP_REGISTRY_CONTRACT_VERSION,
    requestStats: context.stats,
    criteria: {
      lookupKey: "registrationNumber(등록번호) — applicationNumber 아님, 미등록 상표는 대상 아님",
      regionNormalization: "국토교통부 법정동코드 시도·시군구명 완전일치, 고유한 시/군/구 접미사 복원",
      ambiguousRegionPolicy: "복수 후보 또는 미매칭 지역은 추정하지 않고 unverified(applicantRegionMatch 미설정)",
      statisticalMeaning: "실제 출원인 주소이며 04-analyze-brand의 applicantRegionMatch 본류에 직접 반영",
    },
  };
  if (results) metadata.matchCounts = summarizeIpRegistryMatches(results);
  return metadata;
}

module.exports = {
  createIpRegistryContext,
  enrichHitsWithIpRegistry,
  summarizeIpRegistryMatches,
  ipRegistryValidationMetadata,
};
