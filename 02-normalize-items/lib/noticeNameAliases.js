"use strict";

/**
 * 품목 1개에 붙는 "관련 고시명칭 여러 개"(별칭 세트)를 읽는다.
 *
 * 2026-09-09(사용자): "품목별로 고시명칭 연계해서 상표 추출할 때 고시명칭 1개만 하지 말고
 * 해당 류에 있는 고시명칭 여러개로 검색해주면 좋겠어. 품목 1개에 n개의 관련 고시명칭이 있는
 * 거고, 그 중 하나가 출원되어도 해당 품목은 출원된 것으로."
 *
 * 왜 필요한가: ②는 품목 하나에 고시명칭 하나만 확정한다(「인삼」→「신선한 인삼」). ③의
 * 지정상품 대조(evaluateGoods)는 그 하나와만 비교하므로, 실제로는 인삼을 쓴 출원인
 * 「인삼차」(30류)·「인삼주」(33류)가 특산품 활용으로 안 잡힌다. 류 필터도 31류만 남겨
 * 애초에 수집 단계에서 걸러진다. 별칭 세트는 이 두 곳을 함께 넓힌다.
 *
 * 범위(2026-09-10, 사용자 선택 "가"): 상위 30개 다출원 품목부터. 990개 전체로 넓히려면
 * 같은 방식으로 데이터 파일에 항목을 추가하면 되고 코드는 그대로다.
 *
 * 이름을 지어내지 않는다: 데이터 파일의 모든 별칭은 고시상품명칭 사전에 실재하는 표제어이며,
 * 생성 스크립트가 사전 대조에 실패하면 빌드가 멈춘다(ADR 0001 / 원칙 #16 — 생성형 AI가
 * 특산품 데이터를 직접 판정하지 않는다). 사람이 고른 근거는 데이터 파일 주석 대신 이
 * 파일과 런북에 적는다.
 */

const ALIASES = require("../data/notice-name-aliases-v1.json");

function compact(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
}

const INDEX = new Map();
for (const item of ALIASES.items || []) {
  const key = compact(item.noticeName);
  if (!key) continue;
  INDEX.set(key, item);
}

/**
 * 고시명칭에 붙은 별칭 세트를 돌려준다(자기 자신 포함). 없으면 빈 배열.
 * @param {string} noticeName
 * @returns {{noticeName:string, niceClass:string, similarGroupCode:string, stage:"raw"|"processed"|"service"}[]}
 */
function aliasesFor(noticeName) {
  const item = INDEX.get(compact(noticeName));
  return item ? item.aliases : [];
}

/**
 * 별칭 세트가 걸쳐 있는 NICE류 전부. 수집 단계 류 필터를 넓히는 데 쓴다 —
 * 31류만 남기면 「인삼차」(30류)·「인삼주」(33류) 출원이 수집 단계에서 사라진다.
 * @param {string} noticeName
 * @returns {string[]} 오름차순 류 코드. 별칭이 없으면 빈 배열.
 */
function aliasClassesFor(noticeName) {
  const classes = new Set();
  for (const alias of aliasesFor(noticeName)) {
    const code = String(alias.niceClass || "").trim();
    if (code) classes.add(code);
  }
  return [...classes].sort((a, b) => Number(a) - Number(b));
}

module.exports = {
  ALIAS_VERSION: ALIASES.version,
  aliasesFor,
  aliasClassesFor,
};
