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
 * 경로 A(출원번호 기반, trademark-applicant-region-cache.json)와 경로 B(등록번호
 * 기반, ip-registry-cache.json) 둘 다 다룬다. 두 캐시의 applicant 항목 스키마는
 * 이미 동일하다(address/nationality/hasSourceAddress/regionNormalizationReason —
 * `03-match-trademarks/lib/ipRegistryEnricher.js`의 `sanitizeRegistryRecordForCache`
 * 참고, 2026-08 중 추가됨). 다른 점은 경로 B 캐시가 항목을 한 단계 더 감싼다는
 * 것뿐이다: `{ status, fetchedAt, record: { found, resultCode, applicants, ... } }`.
 * (과거 이 주석은 "경로 B는 스키마 확장이 먼저 필요하다"고 적혀 있었으나, 확인해보니
 * 그 확장은 이미 되어 있었다 — #73.)
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

/**
 * 경로 B(등록번호, ip-registry-cache.json) 캐시 항목 하나를 재조회 우선순위
 * 카테고리로 판정한다. entry는 `{status, fetchedAt, record}` 형태이고, applicant
 * 판정 로직 자체는 classifyApplicant()를 그대로 재사용한다 — 두 캐시의 applicant
 * 스키마가 이미 같기 때문이다.
 */
function classifyRegistryCacheEntry(registrationNumber, entry) {
  if (!entry || entry.status !== "complete") {
    return { registrationNumber, category: "not_collected", refreshCandidate: false };
  }
  const record = entry.record || {};
  if (record.found === false || record.resultCode === "20") {
    return { registrationNumber, category: "no_result", refreshCandidate: false };
  }
  const applicants = Array.isArray(record.applicants) ? record.applicants : [];
  if (applicants.length === 0) {
    return { registrationNumber, category: "no_address", refreshCandidate: false };
  }
  const categories = applicants.map(classifyApplicant);
  const matchedAddresses = new Set(applicants.filter((a) => a.address).map((a) => a.address));
  if (matchedAddresses.size > 1) {
    return { registrationNumber, category: "conflicting", refreshCandidate: false };
  }
  if (categories.includes("matched")) {
    return { registrationNumber, category: "matched", refreshCandidate: false };
  }
  if (categories.every((category) => category === "no_address")) {
    return { registrationNumber, category: "no_address", refreshCandidate: false };
  }
  if (categories.every((category) => category === "foreign_address")) {
    return { registrationNumber, category: "foreign_address", refreshCandidate: false };
  }
  if (categories.includes("ambiguous")) {
    return { registrationNumber, category: "ambiguous", refreshCandidate: true };
  }
  return { registrationNumber, category: "unmatched", refreshCandidate: true };
}

/**
 * @param {Map<string, object>} cacheEntries 경로 B 기준 캐시(읽기 전용으로만 사용)
 * @param {{registrationNumbers?: string[], generatedAt?: string}} [options]
 */
function buildRegistryRefreshManifest(cacheEntries, options = {}) {
  const universe = Array.isArray(options.registrationNumbers)
    ? [...new Set(options.registrationNumbers)]
    : [...cacheEntries.keys()];
  const rows = universe
    .sort((a, b) => a.localeCompare(b))
    .map((registrationNumber) => classifyRegistryCacheEntry(registrationNumber, cacheEntries.get(registrationNumber)));
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
  classifyRegistryCacheEntry,
  buildRegistryRefreshManifest,
};
