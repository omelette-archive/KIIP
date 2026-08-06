"use strict";
/**
 * 여러 소스(지리적표시, 농사로 등)의 결과를 표준 출력 스키마
 * { sido, sigungu, rawItemName, source, collectedAt }로 정규화한다.
 * adminCodes.js가 만든 시군구 마스터 목록과 지역 문자열을 대조해서 sido/sigungu를
 * 분리한다 — 못 찾아도 하드 실패는 아니고 경고만 남긴다(소스마다 지역 표기 형식이
 * "경상북도 안동시" / "안동시" / "안동" 등으로 제각각이라 완벽한 매칭은 기대하기 어려움).
 *
 * ⚠️ 시군구명은 시도 경계 없이 중복되는 경우가 실제로 있다 — 중구(서울/부산/대구/대전/
 * 울산), 동구·서구·남구·북구(광역시 여러 곳), 고성군(강원/경남) 등. 시군구명만으로
 * 매칭하면 배열 순서상 우연히 먼저 걸리는 시도로 잘못 태깅된다(실제로 "대전광역시 중구"가
 * "서울특별시 중구"로, "강원도 고성군"이 "경상남도 고성군"으로 잘못 매칭되는 걸 확인함).
 * 그래서 시군구명이 여러 시도에 중복되면, 지역 문자열에 시도명(핵심어)이 함께 있는지로
 * 한 번 더 좁히고, 그래도 못 좁히면 틀린 시도를 단정하지 않고 matched:false + ambiguous:true로
 * 남긴다.
 */

const SIDO_SUFFIX_RE = /(특별자치시|특별자치도|광역시|특별시|도)$/;

function sidoCoreName(sido) {
  return (sido || "").replace(SIDO_SUFFIX_RE, "");
}

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
  if (candidates.length === 1) {
    return { sido: candidates[0].sido, sigungu: candidates[0].sigungu, matched: true };
  }

  // 동명 시군구 — 지역 문자열에 시도명(핵심어)이 같이 있으면 그걸로 좁힌다.
  const narrowed = candidates.filter((admin) => normalized.includes(sidoCoreName(admin.sido)));
  if (narrowed.length === 1) {
    return { sido: narrowed[0].sido, sigungu: narrowed[0].sigungu, matched: true };
  }

  // 그래도 못 좁히면 틀린 시도를 단정짓지 않는다.
  return {
    sido: "",
    sigungu: normalized,
    matched: false,
    ambiguous: true,
    candidateSidos: candidates.map((c) => c.sido),
  };
}

function toRows(entries, { adminList, source, itemNameOf, regionOf, now = new Date().toISOString() }) {
  const warnings = [];
  const rows = entries.map((entry) => {
    const region = regionOf(entry);
    const split = splitRegion(region, adminList);
    if (split.ambiguous) {
      warnings.push(
        `${source}: 시군구명이 여러 시도에 중복돼 확정 못함 - "${region}" (후보: ${split.candidateSidos.join(", ")}) (품목: ${itemNameOf(entry)})`
      );
    } else if (!split.matched) {
      warnings.push(`${source}: 지역명 매칭 실패 - "${region}" (품목: ${itemNameOf(entry)})`);
    }
    return { sido: split.sido, sigungu: split.sigungu, rawItemName: itemNameOf(entry), source, collectedAt: now };
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
