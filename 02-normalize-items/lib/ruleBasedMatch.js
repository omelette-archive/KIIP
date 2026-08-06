"use strict";
/**
 * candidateSearch(bigram Jaccard + substring 후보 검색) 결과를 LLM 호출 없이 결정론적
 * 규칙으로 확정한다. 사람이 매번 검수하지 않아도 되는 명확한 매칭만 자동 확정하고,
 * 애매한 건은 noticeName:null로 남겨 별도 단계(reviewWithAi.js)의 AI 검토 대상으로
 * 넘긴다 — 매 행마다 LLM이 판단을 내리던 이전 방식과 달리, "결정은 코드가 하고 AI는
 * 그 결과를 나중에 검토한다"는 순서로 바꾼 것이 이 모듈의 핵심이다.
 */

const { bigrams } = require("./noticeDictionary");
const { findCandidates, stripRegionNames, jaccard } = require("./candidateSearch");

// 재배용 파생 형태(묘목/나무 등)는 실제 특산품이 아니므로 규칙으로 바로 제외한다.
// 기획 문서 규칙: "사과나무, 사과묘목 등은 자동 제외".
const EXCLUDE_KEYWORD_RE = /묘목|묘삼|모종|종자|종묘|유묘|접목|대목|나무/;

// substring 방향은 반드시 "사전 표제어가 정제된 원문 안에 포함"이어야 신뢰한다
// (예: "하회탈" ⊃ "탈"). 반대 방향("사과" ⊂ "사과주")은 접미사 하나로 품목류가 완전히
// 달라질 수 있어(사과→사과주/사과묘목/사과나무 등 NICE류가 제각각) 자동 확정하면
// 위험하다 — 실제 고시명칭 사전에 파생 표기가 많아 검증 중 발견된 케이스. 이런 반대
// 방향 후보는 AI 검토(reviewWithAi.js)로 넘긴다.
//
// substring이 전혀 없는 순수 bigram 유사도(오타/띄어쓰기 차이 정도)는 더 높은 임계값을
// 요구한다.
const JACCARD_ONLY_THRESHOLD = 0.8;

function normalize(text) {
  return (text || "").normalize("NFC");
}

/**
 * @param {string} rawItemName
 * @param {ReturnType<typeof import("./noticeDictionary").loadDictionary>} dictionary
 * @param {{sido?:string, sigungu?:string}} [region]
 * @param {{topK?:number}} [options]
 * @returns {{itemName:string, noticeName:string|null, niceClass:string|null,
 *   similarGroupCode:string|null, excluded:boolean, matchScore:number|null}}
 */
function matchItem(rawItemName, dictionary, region = {}, options = {}) {
  const { topK = 5 } = options;
  const normalized = normalize(rawItemName);
  // 콤마 뒤 품종/부가정보(예: "부사")는 사전 표제어와 거의 겹치지 않아 후보 검색과
  // substring 판정을 모두 방해하므로, 매칭용 원문에서는 먼저 잘라낸다.
  const coreRawName = normalized.split(",")[0].trim() || normalized;

  // findCandidates가 내부적으로 쓰는 지역명 제거 로직과 동일하게 재현해, substring
  // 판정 기준(cleaned)을 candidateSearch가 실제로 스코어링에 쓴 텍스트와 일치시킨다.
  let cleaned = stripRegionNames(coreRawName, [region.sido, region.sigungu]).trim();
  if (!cleaned) cleaned = coreRawName;

  const candidates = findCandidates(coreRawName, dictionary, region, { topK });

  // 안전한 방향의 substring 매칭 후보 중, 가장 구체적인(문자열이 긴) 것을 우선한다.
  const safeMatches = candidates
    .filter((c) => cleaned.includes(c.item))
    .sort((a, b) => b.item.length - a.item.length || b.score - a.score);

  let matched = safeMatches[0] || null;
  if (!matched && candidates[0]) {
    const top = candidates[0];
    const pureJaccard = jaccard(bigrams(cleaned), bigrams(top.item));
    if (pureJaccard >= JACCARD_ONLY_THRESHOLD) matched = top;
  }

  const noticeName = matched ? matched.item : null;
  const niceClass = matched ? matched.niceClass : null;
  const similarGroupCode = matched ? matched.similarGroupCode : null;
  const matchScore = matched ? matched.score : null;

  const itemName = noticeName || cleaned;
  const excluded = EXCLUDE_KEYWORD_RE.test(normalized);

  return { itemName, noticeName, niceClass, similarGroupCode, excluded, matchScore };
}

module.exports = { matchItem, EXCLUDE_KEYWORD_RE, JACCARD_ONLY_THRESHOLD };
