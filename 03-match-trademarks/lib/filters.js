"use strict";

/**
 * classificationCode 하나를 비교 가능한 형태로 정규화한다.
 * 실제 KIPRIS 응답은 자릿수가 일관되지 않아 "8"과 "008"이 같은 류를 가리킨다.
 */
function normalizeClassCode(code) {
  const n = parseInt(code, 10);
  return Number.isNaN(n) ? String(code).trim() : String(n);
}

/**
 * 품목(NICE 상품류 코드) 기준으로 상표 검색 결과를 필터링한다. 단일 코드 또는 코드
 * 배열(허용 목록)을 받는다. classificationCode는 상표 하나가 여러 류에 걸치면
 * "09|35|42"처럼 파이프로 묶여 오므로 정확 일치가 아니라 분리 후 포함 여부로 비교해야 한다.
 */
function filterByClassCode(hits, classCode) {
  const codes = Array.isArray(classCode) ? classCode : classCode ? [classCode] : [];
  if (codes.length === 0) return hits;
  const wanted = new Set(codes.map(normalizeClassCode));
  return hits.filter((h) => {
    if (!h.classificationCode) return false;
    return h.classificationCode
      .split("|")
      .some((code) => wanted.has(normalizeClassCode(code)));
  });
}

// 지역 특산품은 거의 전부 식품·음료·숙박음식업 관련 류다. NICE류를 모르는 행을 무필터로
// 두면 무관한 상표가 대량 섞인다 — 실측 사례(docs/kipris-api-notes.md): "호박" 51,246건,
// "포도" 102,643건, "참외" 10,095건. 원내 실제 매칭 방법론(바탕화면 지역브랜드 PJ,
// 06.sub3생성쿼리)도 관련_류 미상일 때 동일한 류 집합으로 제한한다.
const FOOD_RELATED_CLASSES = ["29", "30", "31", "32", "33", "40", "43"];

module.exports = { filterByClassCode, FOOD_RELATED_CLASSES };
