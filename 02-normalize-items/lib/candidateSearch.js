"use strict";
/**
 * 원시 품목명(rawItemName)과 고시상품명칭 사전 사이의 후보를 문자 bigram Jaccard
 * 유사도로 뽑는다. 임베딩/외부 API 없이 순수 로컬 계산이라 API 키 없이도 동작·
 * 테스트 가능 — LLM은 이 후보 목록 중에서만 고르게 해서 환각을 막는 데 쓴다.
 */

const { bigrams } = require("./noticeDictionary");
const { isServiceClass } = require("./filters");

function normalize(text) {
  return (text || "").normalize("NFC");
}

// 시군구 접미사. "안동시"가 넘어와도 원시 품목명에는 "안동하회탈"처럼 접미사 없이
// 두 글자 어근만 들어있는 경우가 많아, 어근도 함께 제거 대상에 넣는다.
const REGION_SUFFIX_RE = /(특별자치시|특별자치도|광역시|특별시|자치시|자치군|시|군|구|읍|면|동|리)$/;

/**
 * rawItemName에서 시도/시군구 문자열(및 시/군/구 등 접미사를 뗀 어근)을 제거한다.
 * "안동사과"에서 "안동"을 지우지 않으면 "안동" 자체가 우연히 겹치는 무관한 사전
 * 항목이 상위 후보로 끼어든다.
 */
function stripRegionNames(text, regionNames) {
  let result = text;
  for (const name of regionNames) {
    const normalized = normalize(name);
    if (!normalized) continue;
    const root = normalized.replace(REGION_SUFFIX_RE, "");
    for (const variant of [normalized, root]) {
      if (variant) result = result.split(variant).join("");
    }
  }
  return result;
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * @param {string} rawItemName
 * @param {ReturnType<typeof import("./noticeDictionary").loadDictionary>} dictionary
 * @param {{sido?:string, sigungu?:string}} [region]
 * @param {{topK?:number, includeServiceClass?:boolean}} [options]
 * @returns {{item:string, niceClass:string, similarGroupCode:string, itemEn:string, score:number}[]}
 */
function findCandidates(rawItemName, dictionary, region = {}, options = {}) {
  const { topK = 20, includeServiceClass = false } = options;

  let cleaned = stripRegionNames(normalize(rawItemName), [region.sido, region.sigungu]).trim();
  if (!cleaned) cleaned = normalize(rawItemName);

  const queryBigrams = bigrams(cleaned);

  const scored = [];
  for (const entry of dictionary) {
    if (!includeServiceClass && isServiceClass(entry.niceClass)) continue;
    // substring 포함 관계(예: "하회탈" ⊃ "탈")는 bigram이 하나도 안 겹쳐도(1글자
    // 사전 항목 등) 유효한 신호이므로, bigram 점수가 0이어도 먼저 확인해서 살려둔다.
    const hasSubstringMatch = cleaned.length > 0 && (cleaned.includes(entry.item) || entry.item.includes(cleaned));
    const jaccardScore = jaccard(queryBigrams, entry.bigrams);
    if (jaccardScore === 0 && !hasSubstringMatch) continue;
    const score = jaccardScore + (hasSubstringMatch ? 0.5 : 0);
    scored.push({ item: entry.item, niceClass: entry.niceClass, similarGroupCode: entry.similarGroupCode, itemEn: entry.itemEn, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { findCandidates, jaccard, stripRegionNames };
