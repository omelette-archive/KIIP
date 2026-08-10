"use strict";
/**
 * 농사로 지역 브랜드(areaBrandLst)의 signguNm은 표기가 일정하지 않다 — "구미"처럼 시/군/구
 * 접미사가 빠진 기초지역, "경상북도"처럼 광역명만 있는 행이 섞여 나온다. 법정동코드 마스터와
 * 대조해서 sido/sigungu로 정규화하고, 확정 못하면 추정하지 않고 unverified로 남긴다.
 *
 * KIPRIS hit의 applicationNumber와 조인해 지역 판정 근거를 만들되, 원본 hit는 바꾸지 않고
 * areaBrandMatch라는 별도 필드에 담는다.
 *
 * 근거·출처
 * - signguNm 표기 혼재 실측: 2026-08-10, `areaBrandLst` 실키 호출 샘플(안성/구미 등) —
 *   이슈 #24 코멘트, docs/open-api-validation-runbook.md §6 "농사로 지역 브랜드"
 * - "모호하면 unverified 유지" 원칙: 이슈 #11(출원인 주소 조인)과 동일 정책 — 지역 매칭은
 *   추정보다 미검증 표시를 우선한다는 프로젝트 공통 결정(두 이슈 본문에 명시)
 * - "원본과 조인 결과를 분리해 감사 가능하게 남긴다": 이슈 #24 완료 조건 원문
 * - 법정동코드 마스터 데이터: `01-collect-specialties/data/법정동코드_전국_20260703.csv`
 *   (국토교통부, data.go.kr, 2026-07-03 다운로드본) — 이 파일이 갱신되면 매칭 결과도 함께 바뀜
 */

const { indexByApplicationNumber, normalizeApplicationNumber } = require("./areaBrandClient");

// 02-normalize-items/lib/candidateSearch.js의 REGION_SUFFIX_RE와 동일 패턴(포팅, 2026-08-06
// "농사로 지역특산물 원문·실행 이력" 작업에서 검증된 접미사 목록을 그대로 재사용).
const SIGUNGU_SUFFIX_RE = /(특별자치시|특별자치도|광역시|특별시|자치시|자치군|시|군|구)$/;

function sigunguCoreName(sigungu) {
  return (sigungu || "").replace(SIGUNGU_SUFFIX_RE, "");
}

/**
 * @param {string} signguNm 농사로 areaBrandLst의 지역 표기 원문
 * @param {{sido:string, sigungu:string}[]} adminList
 * @returns {{sido:string, sigungu:string, matchLevel:"sigungu"|"sido"|"unverified", ambiguous?:boolean, candidateSidos?:string[]}}
 */
function normalizeAreaBrandRegion(signguNm, adminList) {
  const text = (signguNm || "").trim();
  if (!text) return { sido: "", sigungu: "", matchLevel: "unverified" };

  // 1) 광역명 전체 일치 — 시도는 확정되지만 시군구는 모른다.
  if (adminList.some((a) => a.sido === text)) {
    return { sido: text, sigungu: "", matchLevel: "sido" };
  }

  // 2) 시군구 전체 일치(접미사 포함, 예: "구미시").
  const exact = adminList.filter((a) => a.sigungu === text);
  if (exact.length === 1) {
    return { sido: exact[0].sido, sigungu: exact[0].sigungu, matchLevel: "sigungu" };
  }
  if (exact.length > 1) {
    return {
      sido: "", sigungu: text, matchLevel: "unverified",
      ambiguous: true, candidateSidos: exact.map((a) => a.sido),
    };
  }

  // 3) 접미사 없는 축약형(예: "구미" -> "구미시").
  const short = adminList.filter((a) => sigunguCoreName(a.sigungu) === text);
  if (short.length === 1) {
    return { sido: short[0].sido, sigungu: short[0].sigungu, matchLevel: "sigungu" };
  }
  if (short.length > 1) {
    return {
      sido: "", sigungu: text, matchLevel: "unverified",
      ambiguous: true, candidateSidos: short.map((a) => a.sido),
    };
  }

  return { sido: "", sigungu: text, matchLevel: "unverified" };
}

// matchTrademarks.js의 makeBatchQuery가 [sido, sigungu].join(" ")로 만든 문자열을 그대로
// 되돌린다. sido에는 공백이 없으므로 첫 공백 기준으로 나누면 된다.
function parseQueryRegion(regionText) {
  const text = (regionText || "").trim();
  const spaceIndex = text.indexOf(" ");
  if (spaceIndex === -1) return { sido: text, sigungu: "" };
  return { sido: text.slice(0, spaceIndex), sigungu: text.slice(spaceIndex + 1).trim() };
}

/**
 * 시군구까지 확정된 경우만 inside/outside를 판정한다. 시도만 아는 경우 시도 자체가
 * 다르면 outside로 확신할 수 있지만, 같으면 시군구를 모르므로 unverified로 남긴다
 * (이슈 #24: "모호하면 추정하지 않고 unverified 유지").
 */
function computeRegionMatch(brandRegion, queryRegion) {
  if (brandRegion.matchLevel === "sigungu") {
    return brandRegion.sido === queryRegion.sido && brandRegion.sigungu === queryRegion.sigungu
      ? "inside"
      : "outside";
  }
  if (brandRegion.matchLevel === "sido") {
    return brandRegion.sido === queryRegion.sido ? "unverified" : "outside";
  }
  return "unverified";
}

/**
 * ③ 배치 결과의 hit를 농사로 지역브랜드 목록과 출원번호로 조인해 지역 판정 근거를 붙인다.
 * 원본 entries/hits는 변경하지 않고 새 배열을 반환한다(매칭된 hit만 areaBrandMatch 추가).
 *
 * @param {{entries:object[], areaBrands:object[], adminList:{sido:string,sigungu:string}[]}} p
 */
function joinAreaBrandEvidence({ entries, areaBrands, adminList }) {
  const brandIndex = indexByApplicationNumber(areaBrands);
  let matchedHitCount = 0;

  const joined = entries.map((entry) => {
    if (entry.status !== "ok" || !Array.isArray(entry.hits)) return entry;
    const queryRegion = parseQueryRegion(entry.query && entry.query.region);
    const hits = entry.hits.map((hit) => {
      const key = normalizeApplicationNumber(hit.applicationNumber);
      const brandMatches = key ? brandIndex.get(key) : undefined;
      if (!brandMatches || brandMatches.length === 0) return hit;

      const brand = brandMatches[0];
      const brandRegion = normalizeAreaBrandRegion(brand.regionName, adminList);
      matchedHitCount++;
      return {
        ...hit,
        areaBrandMatch: {
          applicationNumber: brand.applicationNumber,
          brandName: brand.brandName,
          region: brandRegion,
          regionMatch: computeRegionMatch(brandRegion, queryRegion),
        },
      };
    });
    return { ...entry, hits };
  });

  return { entries: joined, matchedHitCount };
}

module.exports = {
  normalizeAreaBrandRegion,
  parseQueryRegion,
  computeRegionMatch,
  joinAreaBrandEvidence,
};
