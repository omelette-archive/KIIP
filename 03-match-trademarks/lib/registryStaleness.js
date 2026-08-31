"use strict";

/**
 * #81 — 등록원부 캐시 변경 감지(TTL이 아니라 공식 만료예정일 기반).
 *
 * getMarkHistory 원본 응답에는 `right[]`(설정등록·존속기간갱신등록·소멸등록·이전등록 등
 * 공식 처분 이력, 사유·일자만 있고 개인정보 없음)와 `cndrtExptnDate`(권리존속기간만료
 * 예정일)가 있다 — 2026-08-31 실키로 확인(기존 파서는 두 필드를 버리고 있었다).
 * 이 신호 덕분에 "얼마나 지나면 다시 봐야 하는지"를 통계적으로 추정(TTL)할 필요 없이,
 * "공식 만료예정일이 이미 지났는데 캐시에는 아직 그 이후 처분 이력이 없는" 건만
 * 정확히 골라 재검증하면 된다 — 실측 사례: 만료예정일 20241020인 건이 실제로
 * 20250429에 소멸등록됐다(예정일과 실제 처분일은 다를 수 있지만, 예정일이 지났다는
 * 사실 자체는 "다시 볼 가치가 있다"는 신뢰할 수 있는 신호다).
 *
 * 알려진 한계(완료 조건 아님, 설계상 트레이드오프): 만료 전 이전등록(양도)처럼 예정일과
 * 무관하게 발생하는 변경은 이 정책으로는 못 잡는다 — 사용자 결정(2026-08-31): 불필요한
 * 호출을 최소화하는 쪽을 우선한다.
 */

const STALENESS_MANIFEST_SCHEMA_VERSION = "registry-staleness-manifest-v1";

function parseYmd(value) {
  const clean = String(value || "").trim();
  if (!/^\d{8}$/.test(clean)) return null;
  const year = Number(clean.slice(0, 4));
  const month = Number(clean.slice(4, 6));
  const day = Number(clean.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 캐시 항목 하나가 재검증이 필요한지 판정한다.
 * @param {object} entry {status, fetchedAt, record}
 * @param {Date} asOf 판정 기준 시점(기본 지금)
 */
function classifyStalenessCacheEntry(registrationNumber, entry, asOf = new Date()) {
  if (!entry || entry.status !== "complete" || entry.record?.found === false) {
    return { registrationNumber, category: "not_collected", refreshCandidate: false };
  }
  const record = entry.record || {};
  const expiry = parseYmd(record.expectedRightExpiryDate);
  if (!expiry) {
    // 사용자 결정(2026-08-31): 만료예정일이 없는 오래된/예외적 레코드는 이번 정책의
    // 재검증 대상에 넣지 않는다(불필요한 호출 최소화 우선) — 정보용 카테고리로만 남긴다.
    return { registrationNumber, category: "no_expiry_date", refreshCandidate: false };
  }
  if (expiry.getTime() > asOf.getTime()) {
    return { registrationNumber, category: "not_yet_due", refreshCandidate: false };
  }
  const history = Array.isArray(record.rightHistory) ? record.rightHistory : [];
  const hasPostExpiryEvent = history.some((row) => {
    const eventDate = parseYmd(row.date);
    return eventDate && eventDate.getTime() >= expiry.getTime();
  });
  if (hasPostExpiryEvent) {
    return { registrationNumber, category: "due_confirmed", refreshCandidate: false };
  }
  return { registrationNumber, category: "due_unconfirmed", refreshCandidate: true };
}

/**
 * @param {Map<string, object>} cacheEntries 기준 캐시(읽기 전용으로만 사용)
 * @param {{registrationNumbers?: string[], asOf?: Date, generatedAt?: string}} [options]
 */
function buildStalenessManifest(cacheEntries, options = {}) {
  const asOf = options.asOf || new Date();
  const universe = Array.isArray(options.registrationNumbers)
    ? [...new Set(options.registrationNumbers)]
    : [...cacheEntries.keys()];
  const rows = universe
    .sort((a, b) => a.localeCompare(b))
    .map((registrationNumber) =>
      classifyStalenessCacheEntry(registrationNumber, cacheEntries.get(registrationNumber), asOf)
    );
  const byCategory = {};
  for (const row of rows) byCategory[row.category] = (byCategory[row.category] || 0) + 1;
  const candidates = rows.filter((row) => row.refreshCandidate);
  return {
    schemaVersion: STALENESS_MANIFEST_SCHEMA_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    asOf: asOf.toISOString(),
    policy: "expiry_only", // cndrtExptnDate < asOf AND 캐시에 그 이후 right[] 이벤트 없음
    totalRowCount: rows.length,
    byCategory,
    refreshCandidateCount: candidates.length,
    candidates,
  };
}

function normalizedAddressSet(applicants) {
  return new Set((applicants || []).map((a) => a.address).filter(Boolean));
}

function normalizedGoodsSet(products) {
  return new Set(
    (products || []).map((p) => `${p.classCode || ""}::${p.designatedProductName || ""}`)
  );
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * 재조회 전(before) 캐시 레코드와 후(after) 신규 레코드를 비교해 변경 종류를 구분한다
 * (완료 조건: 변경 없음/주소 변경/지정상품 변경/조회 실패 구분).
 */
function diffRegistryRecords(beforeRecord, afterEntry) {
  if (!afterEntry || afterEntry.status !== "complete" || afterEntry.record?.found === false) {
    return { category: "fetch_failed", addressChanged: false, goodsChanged: false, statusChanged: false };
  }
  const afterRecord = afterEntry.record;
  const before = beforeRecord || {};
  const addressChanged = !setsEqual(
    normalizedAddressSet(before.applicants),
    normalizedAddressSet(afterRecord.applicants)
  );
  const goodsChanged = !setsEqual(
    normalizedGoodsSet(before.products),
    normalizedGoodsSet(afterRecord.products)
  );
  const beforeHistoryLength = Array.isArray(before.rightHistory) ? before.rightHistory.length : 0;
  const afterHistoryLength = Array.isArray(afterRecord.rightHistory) ? afterRecord.rightHistory.length : 0;
  const statusChanged = afterHistoryLength !== beforeHistoryLength;
  const changeCount = [addressChanged, goodsChanged, statusChanged].filter(Boolean).length;
  let category = "no_change";
  if (changeCount > 1) category = "multiple_changed";
  else if (statusChanged) category = "status_changed";
  else if (addressChanged) category = "address_changed";
  else if (goodsChanged) category = "goods_changed";
  return { category, addressChanged, goodsChanged, statusChanged };
}

module.exports = {
  STALENESS_MANIFEST_SCHEMA_VERSION,
  parseYmd,
  classifyStalenessCacheEntry,
  buildStalenessManifest,
  diffRegistryRecords,
};
