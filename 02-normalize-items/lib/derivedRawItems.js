"use strict";

/**
 * 가공품 형태로 수집된 품목명에서 "원물" 품목 행을 파생한다(2026-09-08 사용자 결정).
 *
 * 배경: ①이 수집한 품목명에는 "블루베리잼", "감말랭이", "유자차"처럼 원물명에 가공 형태가
 * 붙은 것과 "막걸리", "한과", "찐빵"처럼 가공품 자체가 특산품인 것이 섞여 있다. 상표 분석
 * 단위로는 원물("블루베리")이 필요하지만, 그 지역이 실제로 등록한 명칭("블루베리잼")도
 * 특산품이므로 어느 쪽도 버리지 않는다.
 *
 * 결정: **치환이 아니라 추가**한다. "감말랭이"는 그대로 두고 "감" 행을 하나 더 만든다.
 * 파생 행은 rawItemName만 원물로 바꾸고 sourceItemName에 원문을 남겨 역추적을 보장한다.
 *
 * 원물 인정 기준은 둘 중 하나다.
 *   (1) 고시상품명칭 사전에 "신선한/미가공/살아있는 ○○" 또는 31류 표제어로 존재
 *   (2) 다른 지역에서 이미 특산품 품목으로 수집된 이름
 * (2)를 두는 이유: 고시명칭에 표제어가 아예 없는 품목이 많다(유자·멸치·송이 등). 특산품
 * 카탈로그 자체가 "무엇이 원물 품목인가"에 대한 1차 근거다.
 *
 * 어느 기준에도 맞지 않으면 파생하지 않는다 — "왕곡한과"의 "왕곡"(지역명), "더담막걸리"의
 * "더담"(브랜드명), "싱싱단감농장"의 "싱싱단감농"(업체명 오수집)처럼 원물이 아닌 앞부분을
 * 품목으로 만들어 버리면 공백률 분모가 오염된다.
 */

// 원물명 뒤에 붙는 가공 형태. 긴 것부터 매칭해야 "생강조청"이 "생강조"+"청"으로 잘리지 않는다.
const PROCESSED_SUFFIXES = [
  "말랭이", "농축액", "엑기스", "진액", "원액", "통조림", "장아찌", "액젓", "조청", "한과",
  "막걸리", "주스", "식초", "와인", "소주", "청주", "김치", "절임", "과자", "찐빵",
  "잼", "즙", "차", "청", "환", "빵", "떡", "면", "칩", "주", "젓", "장", "가루", "기름",
].sort((a, b) => b.length - a.length);

// 그 자체가 하나의 완성 품목으로 통용되는 이름. 앞부분이 우연히 원물명과 겹쳐도
// 파생하지 않는다 — "조청"의 "조"(곡물 조), "엿기름"의 "엿"이 사전에 있다고 해서
// 조·엿을 그 지역 특산품으로 만들면 공백률 분모가 오염된다.
// 1글자 원물(감·배·밀·꽃)은 실재하므로 길이로 자르지 않고 이 목록으로만 막는다.
const WHOLE_ITEM_NAMES = new Set([
  "조청", "엿기름", "참기름", "들기름", "녹차", "황차", "홍차", "말차",
  "메주", "된장", "간장", "고추장", "쌈장", "청국장",
  "소주", "청주", "탁주", "약주", "막걸리", "동동주",
  "찐빵", "한과", "유과", "약과", "식혜", "수정과", "김치",
]);

const FRESH_PREFIX_RE = /^(신선한|미가공|무가공|살아있는)\s*/;

function compact(value) {
  return String(value || "").replace(/\s+/g, "");
}

/**
 * 고시명칭 사전에서 원물로 볼 수 있는 표제어 집합을 만든다.
 * @param {{item:string, niceClass:string}[]} dictionary
 * @returns {Set<string>}
 */
function dictionaryRawNames(dictionary) {
  const names = new Set();
  for (const entry of dictionary || []) {
    const item = String(entry.item || "").trim();
    if (!item) continue;
    if (FRESH_PREFIX_RE.test(item)) names.add(compact(item.replace(FRESH_PREFIX_RE, "")));
    // 31류는 신선 농림수산물·살아있는 동물 류다. 접두어가 없는 표제어도 원물로 인정한다.
    if (String(entry.niceClass || "").trim() === "31") names.add(compact(item));
  }
  names.delete("");
  return names;
}

/**
 * 품목명에서 가공 접미사를 떼어 원물 후보를 낸다. 원물로 인정되지 않으면 null.
 * @returns {{ base: string, suffix: string, basis: "dictionary"|"catalog" } | null}
 */
function deriveRawItemName(itemName, { dictionaryNames, catalogNames }) {
  const name = compact(itemName);
  if (!name) return null;
  if (WHOLE_ITEM_NAMES.has(name)) return null;
  const suffix = PROCESSED_SUFFIXES.find(
    (candidate) => name.endsWith(candidate) && name.length > candidate.length
  );
  if (!suffix) return null;
  const base = name.slice(0, -suffix.length);
  if (base === name) return null;
  if (dictionaryNames.has(base)) return { base, suffix, basis: "dictionary" };
  if (catalogNames.has(base)) return { base, suffix, basis: "catalog" };
  return null;
}

function regionKeyOf(row) {
  return `${String(row.sido || "").trim()}|${String(row.sigungu || "").trim()}`;
}

/**
 * ① 수집 행 전체를 보고 파생 원물 행을 만든다. 원본 행은 건드리지 않는다.
 * 같은 지역에 이미 그 원물 행이 있으면 만들지 않는다(중복 방지).
 *
 * @param {object[]} rows ①단계 CSV 행
 * @param {{item:string, niceClass:string}[]} dictionary 고시상품명칭 사전
 * @returns {{ rows: object[], notes: string[] }}
 */
function deriveRawItemRows(rows, dictionary) {
  const dictNames = dictionaryRawNames(dictionary);
  const catalogNames = new Set();
  const perRegion = new Map();
  for (const row of rows || []) {
    const name = compact(row.rawItemName);
    if (!name) continue;
    catalogNames.add(name);
    const key = regionKeyOf(row);
    if (!perRegion.has(key)) perRegion.set(key, new Set());
    perRegion.get(key).add(name);
  }

  const derived = [];
  const notes = [];
  const seen = new Set();
  for (const row of rows || []) {
    const found = deriveRawItemName(row.rawItemName, { dictionaryNames: dictNames, catalogNames });
    if (!found) continue;
    const key = regionKeyOf(row);
    if (perRegion.get(key)?.has(found.base)) continue;
    const dedupeKey = `${key}|${found.base}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    derived.push({
      ...row,
      rawItemName: found.base,
      // 원문을 남겨 어느 가공품에서 파생됐는지 추적할 수 있게 한다.
      sourceItemName: row.sourceItemName || row.rawItemName,
      derivedFromItemName: row.rawItemName,
      derivedSuffix: found.suffix,
      derivedBasis: found.basis,
    });
    notes.push(`${row.sido} ${row.sigungu || ""} ${row.rawItemName} → ${found.base}(+${found.suffix}, ${found.basis})`.replace(/\s+/g, " "));
  }
  return { rows: derived, notes };
}

// 2026-09-09(사용자): "협동조합은 원물일 경우에만 공동출원인 인정해주고, 가공품인
// 특산품의 경우 일반 기업 등 모두 가능해." 원물의 산지 귀속은 생산 주체가 그 지역에
// 있어야 뜻이 있고, 가공품은 기업이 가공·판매 주체라 기업 소재지도 정당한 귀속처다.
// ③단계 공동출원인 판정이 이 구분을 쓰도록 여기 있는 목록을 그대로 공용화한다.
//
// 판정할 수 없으면 null이다 — 「쌀」·「소고기」·「굴」처럼 수식어도 가공 접미어도 없는
// 이름이 여기 해당한다(대시보드 goodsStageOf도 같은 한계를 가진다). 호출부는 null을
// 원물로 단정하지 말고 완화 쪽(모든 공동출원인 인정)으로 처리한다 — 판정 못 한 것을
// 근거로 건수를 깎지 않는다.
function specialtyStageOf(noticeName) {
  const name = compact(noticeName);
  if (!name) return null;
  if (WHOLE_ITEM_NAMES.has(name)) return "processed";
  if (FRESH_PREFIX_RE.test(String(noticeName || "").trim())) return "raw";
  if (PROCESSED_SUFFIXES.some((suffix) => name.endsWith(suffix) && name.length > suffix.length)) {
    return "processed";
  }
  return null;
}

module.exports = {
  specialtyStageOf,
  PROCESSED_SUFFIXES,
  WHOLE_ITEM_NAMES,
  dictionaryRawNames,
  deriveRawItemName,
  deriveRawItemRows,
};
