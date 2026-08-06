"use strict";
/**
 * 원시 품목명(rawItemName)과 고시상품명칭 사전 사이의 후보를 문자 bigram Jaccard
 * 유사도로 뽑는다. 임베딩/외부 API 없이 순수 로컬 계산이라 API 키 없이도 동작·
 * 테스트 가능 — LLM은 이 후보 목록 중에서만 고르게 해서 환각을 막는 데 쓴다.
 *
 * 성능: 사전이 57,000건이 넘어서 매 쿼리마다 전체를 선형 스캔하면 01→02 파이프라인이
 * 실제로 수백~수천 행을 처리할 때 느려진다. bigram 역색인(bigram -> 해당 bigram을 가진
 * 사전 항목 인덱스 목록)을 만들어서, 쿼리와 최소 하나의 bigram이라도 겹치는 항목만
 * 스코어링 대상으로 좁힌다. 이 색인은 dictionary 배열마다 한 번만 만들고 WeakMap에
 * 캐싱해서 재사용한다(같은 dictionary로 여러 번 findCandidates를 부르는 배치 처리에서
 * 특히 효과적 — normalizeItems.js가 정확히 이 패턴).
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

const indexCache = new WeakMap();

/**
 * dictionary에 대한 bigram 역색인을 만들고(또는 캐시에서 꺼내고) 반환한다.
 * - invertedIndex: bigram -> 그 bigram을 가진 entries 인덱스 배열
 * - shortEntryIndices: item 길이가 1인 항목의 인덱스 목록. 1글자 항목(예: "탈", "밀")은
 *   자기 자신이 곧 bigram 토큰이라, 그보다 긴 쿼리의 실제 2글자 bigram과는 절대 안
 *   겹친다("하회탈"의 bigram은 {"하회","회탈"}뿐 — "탈"이라는 토큰 자체가 없음). 그래서
 *   substring 매칭을 위해 항상 별도로 후보에 넣어야 한다. 2글자 이상 항목은 자신이
 *   쿼리의 연속 부분문자열이면 그 bigram이 쿼리의 bigram이기도 해서 역색인만으로
 *   자동으로 걸린다.
 */
function getIndex(dictionary) {
  let cached = indexCache.get(dictionary);
  if (cached) return cached;

  const invertedIndex = new Map();
  const shortEntryIndices = [];
  dictionary.forEach((entry, i) => {
    if (entry.item.length === 1) shortEntryIndices.push(i);
    for (const bg of entry.bigrams) {
      let bucket = invertedIndex.get(bg);
      if (!bucket) {
        bucket = [];
        invertedIndex.set(bg, bucket);
      }
      bucket.push(i);
    }
  });

  cached = { invertedIndex, shortEntryIndices };
  indexCache.set(dictionary, cached);
  return cached;
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
  const { invertedIndex, shortEntryIndices } = getIndex(dictionary);

  // 후보를 "쿼리와 bigram이 하나라도 겹치는 항목" + "1글자 사전 항목 전체"로 좁힌다.
  // 쿼리 자체가 1글자면(드문 케이스) bigram이 없어 색인으로 못 좁히므로 전체 스캔으로
  // 안전하게 물러난다.
  let indicesToScore;
  if (cleaned.length <= 1) {
    indicesToScore = dictionary.keys();
  } else {
    const candidateIndices = new Set(shortEntryIndices);
    for (const bg of queryBigrams) {
      const bucket = invertedIndex.get(bg);
      if (bucket) for (const i of bucket) candidateIndices.add(i);
    }
    indicesToScore = candidateIndices;
  }

  const scored = [];
  for (const i of indicesToScore) {
    const entry = dictionary[i];
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
