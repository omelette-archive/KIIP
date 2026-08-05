"use strict";
/**
 * 여러 소스(지리적표시, 농사로 등)의 결과를 표준 출력 스키마
 * { sido, sigungu, rawItemName, source, collectedAt }로 정규화한다.
 * adminCodes.js가 만든 시군구 마스터 목록과 지역 문자열을 대조해서 sido/sigungu를
 * 분리한다 — 못 찾아도 하드 실패는 아니고 경고만 남긴다(소스마다 지역 표기 형식이
 * "경상북도 안동시" / "안동시" / "안동" 등으로 제각각이라 완벽한 매칭은 기대하기 어려움).
 */

/**
 * @param {string} regionText
 * @param {{sido:string, sigungu:string}[]} adminList
 */
function splitRegion(regionText, adminList) {
  const normalized = (regionText || "").trim();
  if (!normalized) return { sido: "", sigungu: "", matched: false };
  for (const admin of adminList) {
    if (normalized.includes(admin.sigungu)) {
      return { sido: admin.sido, sigungu: admin.sigungu, matched: true };
    }
  }
  return { sido: "", sigungu: normalized, matched: false };
}

function toRows(entries, { adminList, source, itemNameOf, regionOf, now = new Date().toISOString() }) {
  const warnings = [];
  const rows = entries.map((entry) => {
    const region = regionOf(entry);
    const { sido, sigungu, matched } = splitRegion(region, adminList);
    if (!matched) {
      warnings.push(`${source}: 지역명 매칭 실패 - "${region}" (품목: ${itemNameOf(entry)})`);
    }
    return { sido, sigungu, rawItemName: itemNameOf(entry), source, collectedAt: now };
  });
  return { rows, warnings };
}

function fromGiRegistrations(registrations, adminList) {
  return toRows(registrations, {
    adminList,
    source: "지리적표시",
    itemNameOf: (r) => r.registeredName,
    regionOf: (r) => r.region,
  });
}

function fromNongsaro(specialties, adminList) {
  return toRows(specialties, {
    adminList,
    source: "농사로",
    itemNameOf: (s) => s.title,
    regionOf: (s) => s.region,
  });
}

module.exports = { splitRegion, fromGiRegistrations, fromNongsaro };
