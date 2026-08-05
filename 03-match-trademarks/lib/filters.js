"use strict";

/** 품목(NICE 상품류 코드) 기준으로 상표 검색 결과를 필터링한다. */
function filterByClassCode(hits, classCode) {
  if (!classCode) return hits;
  const wanted = String(classCode);
  return hits.filter((h) => h.classificationCode === wanted);
}

module.exports = { filterByClassCode };
