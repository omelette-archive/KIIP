"use strict";

/**
 * #73 — 출원인 주소 미확인 건 선별 재조회.
 *
 * trademark-applicant-region-cache.json(경로 A)은 상세주소를 저장하지 않고
 * 정규화한 시도·시군구와 조회 종료 상태만 보존한다. 그래서 시도·시군구 별칭 규칙이
 * 개선돼도(PR #72) 과거에 정규화를 실패한 건은 캐시만으로는 재분석할 수 없다 —
 * 원문 주소가 없어서 새 규칙을 다시 적용해볼 수가 없기 때문이다. 유일한 복구 경로는
 * 같은 API를 다시 호출해 원문 주소를 다시 받아, 그 자리에서 새 정규화 규칙을
 * 적용하는 것이다.
 *
 * 이 모듈은 새 API 호출 없이, 기존 캐시만 보고 "다시 불러봐야 의미가 있는 건"과
 * "다시 불러도 똑같을 게 뻔한 건"을 구분한다.
 *
 * 범위: 경로 A(출원번호 기반)만 다룬다. 경로 B(ip-registry-cache.json, 등록번호
 * 기반)는 주소·국적이 둘 다 없는 출원인을 캐시 저장 단계에서 아예 걸러내
 * (`sanitizeRegistryRecordForCache`), 이 모듈과 같은 방식의 사후 분류에 필요한
 * 최소 정보(hasSourceAddress)가 없다. 경로 B까지 다루려면 그 캐시 스키마 확장이
 * 먼저 필요하다 — 이번 범위에서는 하지 않는다.
 */

const REFRESH_MANIFEST_SCHEMA_VERSION = "applicant-region-refresh-manifest-v1";

// 국적 코드가 한국이 아니면 해외 주소로 본다(법정동 마스터로는 애초에 매칭 불가 —
// 재조회해도 결과가 달라지지 않는다). 코드가 없거나 알 수 없으면 국내 여부가
// 불명하다는 뜻이므로, 재조회 후보에서 섣불리 빼지 않는다 — 예산을 조금 더 쓰더라도
// 실제 국내 건을 놓치는 쪽보다 안전하다.
function isForeignNationality(nationality) {
  const value = String(nationality || "").trim();
  return value !== "" && value !== "KR" && value !== "대한민국";
}

function classifyApplicant(applicant) {
  if (!applicant?.hasSourceAddress) return "no_address";
  if (isForeignNationality(applicant.nationality)) return "foreign_address";
  if (applicant.address) return "matched";
  if (applicant.regionNormalizationReason === "ambiguous_sigungu") return "ambiguous";
  return "unmatched";
}

/**
 * 출원번호 하나의 캐시 항목(복수 출원인 가능)을 재조회 우선순위 카테고리 하나로
 * 판정한다. refreshCandidate=true인 것만 재조회 대상이다.
 */
function classifyCacheEntry(applicationNumber, entry) {
  if (!entry || entry.status !== "complete") {
    return { applicationNumber, category: "not_collected", refreshCandidate: false };
  }
  if (entry.terminalReason === "empty_after_retries") {
    return { applicationNumber, category: "empty_after_retries", refreshCandidate: false };
  }
  if (entry.found === false || entry.resultCode === "20") {
    return { applicationNumber, category: "no_result", refreshCandidate: false };
  }
  const applicants = Array.isArray(entry.applicants) ? entry.applicants : [];
  if (applicants.length === 0) {
    return { applicationNumber, category: "no_address", refreshCandidate: false };
  }
  const categories = applicants.map(classifyApplicant);
  const matchedAddresses = new Set(applicants.filter((a) => a.address).map((a) => a.address));
  if (matchedAddresses.size > 1) {
    return { applicationNumber, category: "conflicting", refreshCandidate: false };
  }
  if (categories.includes("matched")) {
    return { applicationNumber, category: "matched", refreshCandidate: false };
  }
  if (categories.every((category) => category === "no_address")) {
    return { applicationNumber, category: "no_address", refreshCandidate: false };
  }
  if (categories.every((category) => category === "foreign_address")) {
    return { applicationNumber, category: "foreign_address", refreshCandidate: false };
  }
  if (categories.includes("ambiguous")) {
    return { applicationNumber, category: "ambiguous", refreshCandidate: true };
  }
  return { applicationNumber, category: "unmatched", refreshCandidate: true };
}

/**
 * @param {Map<string, object>} cacheEntries 기준 캐시(읽기 전용으로만 사용)
 * @param {{applicationNumbers?: string[], generatedAt?: string}} [options]
 *   applicationNumbers를 주면(예: ③ 검색 결과에서 뽑은 전체 모집단) 캐시에 아예 없는
 *   출원번호도 not_collected로 함께 집계한다. 생략하면 캐시에 실제로 있는 항목만 본다.
 */
function buildRefreshManifest(cacheEntries, options = {}) {
  const universe = Array.isArray(options.applicationNumbers)
    ? [...new Set(options.applicationNumbers)]
    : [...cacheEntries.keys()];
  const rows = universe
    .sort((a, b) => a.localeCompare(b))
    .map((applicationNumber) => classifyCacheEntry(applicationNumber, cacheEntries.get(applicationNumber)));
  const byCategory = {};
  for (const row of rows) byCategory[row.category] = (byCategory[row.category] || 0) + 1;
  const candidates = rows.filter((row) => row.refreshCandidate);
  return {
    schemaVersion: REFRESH_MANIFEST_SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    totalRowCount: rows.length,
    byCategory,
    refreshCandidateCount: candidates.length,
    candidates,
  };
}

module.exports = {
  REFRESH_MANIFEST_SCHEMA_VERSION,
  isForeignNationality,
  classifyApplicant,
  classifyCacheEntry,
  buildRefreshManifest,
};
