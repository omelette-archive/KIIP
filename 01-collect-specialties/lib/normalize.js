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

  const candidates = adminList.filter((admin) => normalized.includes(admin.sigungu));
  if (candidates.length === 0) {
    return { sido: "", sigungu: normalized, matched: false };
  }

  // "중구", "강서구", "고성군"처럼 여러 시도에 같은 시군구명이 존재한다. 입력에
  // 시도가 함께 있으면 반드시 시도까지 일치하는 후보를 우선해야 한다.
  const exactRegion = candidates.find((admin) => normalized.includes(admin.sido));
  if (exactRegion) {
    return { sido: exactRegion.sido, sigungu: exactRegion.sigungu, matched: true };
  }

  // 시도가 생략된 입력은 시군구명이 전국에서 유일할 때만 확정한다. 여러 후보 중 첫
  // 항목을 고르면 서울 중구/부산 중구 같은 지역이 조용히 오분류된다.
  const uniqueRegions = new Map(
    candidates.map((admin) => [`${admin.sido}\u0000${admin.sigungu}`, admin])
  );
  if (uniqueRegions.size === 1) {
    const [only] = uniqueRegions.values();
    return { sido: only.sido, sigungu: only.sigungu, matched: true };
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
