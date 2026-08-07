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

// 잠정 기본값 — 핵심 규칙이 아니라 튜닝 대상이다. NICE류를 모르는 행을 무필터로 두면
// 무관한 상표가 대량 섞인다는 문제(실측: "호박" 51,246건, "포도" 102,643건)를 일단 줄이려고
// 원내 방법론(바탕화면 지역브랜드 PJ, 06.sub3생성쿼리)의 류 집합을 그대로 가져왔다.
// 특산품 대부분이 식품이라 우선 이걸 기본값으로 썼을 뿐, 공예품 등(이천도자기=21류처럼
// 이 목록 밖인 사례 확인됨)에는 안 맞는다 — 데이터가 쌓이면 언제든 바뀔 수 있는 값이다.
const FOOD_RELATED_CLASSES = ["29", "30", "31", "32", "33", "40", "43"];

module.exports = { filterByClassCode, FOOD_RELATED_CLASSES };
