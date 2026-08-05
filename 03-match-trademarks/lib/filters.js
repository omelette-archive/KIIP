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
 * 품목(NICE 상품류 코드) 기준으로 상표 검색 결과를 필터링한다.
 * classificationCode는 상표 하나가 여러 류에 걸치면 "09|35|42"처럼 파이프로 묶여 오므로
 * 정확 일치가 아니라 분리 후 포함 여부로 비교해야 한다.
 */
function filterByClassCode(hits, classCode) {
  if (!classCode) return hits;
  const wanted = normalizeClassCode(classCode);
  return hits.filter((h) => {
    if (!h.classificationCode) return false;
    return h.classificationCode
      .split("|")
      .some((code) => normalizeClassCode(code) === wanted);
  });
}

module.exports = { filterByClassCode };
