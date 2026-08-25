"use strict";

const { findCandidates, stripRegionNames } = require("./candidateSearch");
const { isServiceClass } = require("./filters");
const approvedAliases = require("../data/approved-aliases.json");
const kofpiForestProducts = require("../data/kofpi-forest-products-v1.json");

const EXCLUDED_SUFFIX_RE = /(나무|묘목|모종|종묘|종자|씨앗)$/;
// 이슈 #74(2026-08-18 결정): 원물(매실)의 사전 후보가 가공품/파생품(매실주) 형태로만
// 존재하는 경우를 별도로 표시한다. A안(가공품 상표를 원물 브랜드 근거로 인정 안 함)은
// 그대로 유지하되, 이 패턴만 review_required 중에서 골라내려면 매번 후보 문자열을
// 다시 스캔해야 하는 문제를 해결한다. 접미어 목록은 #74에서 실측 확인된 상위 패턴만
// 반영했다(주/차/김치/젓/기름) — B안 채택 시의 자동 인정 규칙이 아니라 사람이 재검토할
// 대상을 표시하는 용도이므로, 목록을 넓히려면 별도 실측·이슈 갱신을 거친다.
const PROCESSED_DERIVATIVE_SUFFIXES = ["주", "차", "김치", "젓", "기름"];

/**
 * 후보 중 "원물명 + 가공품 접미어" 형태만 있고 원물명 그대로인 후보는 없는 경우를 찾는다.
 * 정확 어간 일치(매실주→매실)를 우선하고, 없으면 부분 포함 관계(옥수수차→찰옥수수)까지 본다.
 */
function findProcessedDerivativeCandidate(itemName, candidates) {
  let partial = null;
  for (const candidate of candidates) {
    const base = String(candidate.item || "").replace(/^(신선한|미가공)\s*/, "");
    for (const suffix of PROCESSED_DERIVATIVE_SUFFIXES) {
      if (!base.endsWith(suffix) || base === suffix) continue;
      const stem = base.slice(0, -suffix.length);
      if (stem === itemName) return { candidate, suffix, stem };
      // 접두 수식어 차이(찰옥수수→옥수수차)만 허용한다 — stem이 itemName의 접미(어간)이거나
      // 그 반대여야 한다. 둘 다 접두 방향(전통장류/전통차처럼 우연히 앞부분만 같은 경우)은
      // 원물-가공품 관계가 아니라 무관한 공통 접두어일 뿐이라 제외한다.
      if (!partial && (stem.endsWith(itemName) || itemName.endsWith(stem))) {
        partial = { candidate, suffix, stem };
      }
    }
  }
  return partial;
}
// 원본이 "기타(그 외/미분류)"처럼 실제 품목이 아닌 범용 표기인데, 고시상품명칭에 우연히 같은
// 글자의 다른 품목(예: "기타" = 악기 15류)이 있어 그대로 두면 무관한 품목으로 확정돼버린다.
// 알파테스트 실행에서 "기타" raw 이름이 15류 악기로 오매칭되는 걸 실측으로 확인해 추가함.
const EXCLUDED_EXACT_NAMES = new Set(["기타"]);
const SEGMENT_SEPARATOR_RE = /[,，;；]/;

function canonicalName(value) {
  return String(value || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s'"`()[\]{}._-]+/g, "");
}

// 이슈 #114: 한국임업진흥원 임산물DB백과는 지역 정보가 없는 순수 품목 사전이라
// 지역×품목 행을 새로 만들 수 없다(#114 확인 결과) — 대신 고시명칭 사전에 없는
// review_required 원물명이 실제로는 알려진 임산물(예: "지리산능이버섯"→"능이")일 때
// 검토 사유에 학명·영문명·과명을 덧붙여 재검토를 도와준다. 사전 자체를 확정하는 게
// 아니라 참고 근거만 추가하므로 status/matchMethod의 review_required는 그대로 유지한다.
const kofpiIndex = new Map();
for (const [name, info] of Object.entries(kofpiForestProducts.items)) {
  kofpiIndex.set(canonicalName(name), { name, ...info });
}
function findKofpiForestProductReference(itemName) {
  const key = canonicalName(itemName);
  const exact = kofpiIndex.get(key);
  if (exact) return { ...exact, matchType: "exact" };
  // 접미(어간) 관계만 허용한다(findProcessedDerivativeCandidate와 같은 원칙) — 2글자
  // 미만 품목명은 우연한 부분일치가 너무 흔해 제외한다(예: "삼"이 무관한 단어에도 낌).
  let best = null;
  for (const [kofpiKey, info] of kofpiIndex) {
    if (kofpiKey.length < 2 || !key.endsWith(kofpiKey)) continue;
    if (!best || kofpiKey.length > canonicalName(best.name).length) best = { ...info, matchType: "suffix" };
  }
  return best;
}

function cleanItemName(rawItemName, region = {}) {
  const raw = String(rawItemName || "").normalize("NFC").trim();
  if (!raw) return "";

  let cleaned = stripRegionNames(raw, [region.sido, region.sigungu]).trim();
  if (!cleaned) cleaned = raw;

  // 품종·부연 설명은 검토용 원문에 남기고, 1차 규칙 매칭에는 첫 품목 구간만 사용한다.
  cleaned = cleaned.split(SEGMENT_SEPARATOR_RE)[0];
  cleaned = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || raw;
}

function serializeCandidates(candidates) {
  return JSON.stringify(
    candidates.map((candidate) => ({
      item: candidate.item,
      niceClass: candidate.niceClass,
      similarGroupCode: candidate.similarGroupCode,
      score: Number(Number(candidate.score || 0).toFixed(4)),
    }))
  );
}

function uniqueCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    const key = [candidate.item, candidate.niceClass, candidate.similarGroupCode].join("\u0000");
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

const officialNameIndexCache = new WeakMap();
const approvedAliasIndex = new Map();

for (const rule of approvedAliases.rules) {
  for (const alias of rule.aliases) {
    const key = canonicalName(alias);
    if (approvedAliasIndex.has(key)) {
      throw new Error(`승인 별칭이 중복되었습니다: ${alias}`);
    }
    approvedAliasIndex.set(key, rule);
  }
}

function getOfficialNameIndex(dictionary) {
  let cached = officialNameIndexCache.get(dictionary);
  if (cached) return cached;

  cached = new Map();
  for (const candidate of dictionary) {
    if (isServiceClass(candidate.niceClass)) continue;
    const key = canonicalName(candidate.item);
    const matches = cached.get(key) || [];
    matches.push(candidate);
    cached.set(key, matches);
  }
  officialNameIndexCache.set(dictionary, cached);
  return cached;
}

function reviewResult(base, itemName, candidates, reviewReason, matchMethod = "rule_unresolved") {
  return {
    ...base,
    itemName,
    noticeName: "",
    niceClass: "",
    similarGroupCode: "",
    excluded: false,
    status: "review_required",
    matchMethod,
    confidence: "",
    verdictSource: "unresolved",
    reviewReason,
    reviewCandidates: serializeCandidates(candidates),
    error: "",
  };
}

/**
 * 외부 API 없이 보수적으로 확정한다. 정제명이 사전 항목과 정확히 일치하는 경우만
 * 자동 매핑하고, 나머지는 후보와 함께 별도 검토 대상으로 남긴다.
 */
function normalizeByRules(row, dictionary, { topK = 5 } = {}) {
  const base = {
    sido: row.sido || "",
    sigungu: row.sigungu || "",
    rawItemName: row.rawItemName || "",
    source: row.source || "",
  };
  const itemName = cleanItemName(row.rawItemName, row);
  if (!itemName) return reviewResult(base, "", [], "정제할 품목명이 없음");

  const candidates = findCandidates(itemName, dictionary, {}, { topK });
  const officialNameIndex = getOfficialNameIndex(dictionary);

  if (EXCLUDED_SUFFIX_RE.test(itemName) || EXCLUDED_EXACT_NAMES.has(itemName)) {
    return {
      ...base,
      itemName,
      noticeName: "",
      niceClass: "",
      similarGroupCode: "",
      excluded: true,
      status: "ok",
      matchMethod: "rule_excluded",
      confidence: "1.0000",
      verdictSource: "excluded",
      reviewReason: "",
      reviewCandidates: serializeCandidates(candidates),
      error: "",
    };
  }

  const approvedAlias = approvedAliasIndex.get(canonicalName(itemName));
  if (approvedAlias) {
    const matches = uniqueCandidates(
      (officialNameIndex.get(canonicalName(approvedAlias.noticeName)) || []).filter(
        (candidate) =>
          candidate.niceClass === approvedAlias.niceClass &&
          candidate.similarGroupCode === approvedAlias.similarGroupCode
      )
    );
    if (matches.length !== 1) {
      return reviewResult(
        base,
        itemName,
        [...matches, ...candidates].slice(0, topK),
        `승인 별칭의 고시명칭 계약 불일치(${approvedAliases.version})`
      );
    }
    const matched = matches[0];
    return {
      ...base,
      itemName,
      noticeName: matched.item,
      niceClass: matched.niceClass,
      similarGroupCode: matched.similarGroupCode,
      excluded: false,
      status: "ok",
      matchMethod: "rule_approved_alias",
      confidence: "1.0000",
      verdictSource: "human_approved_alias",
      reviewReason: "",
      reviewCandidates: serializeCandidates(
        uniqueCandidates([{ ...matched, score: 1.45 }, ...candidates]).slice(0, topK)
      ),
      error: "",
    };
  }

  // exact는 원물명 자체가 사전과 완전히 같으므로 판단의 여지가 없다(사람 재가 불필요).
  // fresh/unprocessed는 정해진 접두어 사전(신선한/미가공)만 허용하는 결정론적 규칙으로
  // "고시명칭을 임의로 확정"하는 게 아니라 코드로 버전 관리되는 화이트리스트다. 임의
  // 접두어를 추가하지 않고, 새 접두어가 필요하면 실측 검토 후 이 배열에 명시적으로
  // 추가하고 자체 테스트로 고정한다(ADR 0001의 "반복 검토 사례는 코드/사전 변경과
  // 테스트를 통해서만 자동화 범위에 포함된다" 원칙).
  const preferredNames = [
    { name: itemName, matchMethod: "rule_exact", confidence: "1.0000", score: 1.5, verdictSource: "exact" },
    { name: `신선한 ${itemName}`, matchMethod: "rule_fresh", confidence: "0.9500", score: 1.4, verdictSource: "algorithm" },
    { name: `미가공 ${itemName}`, matchMethod: "rule_unprocessed", confidence: "0.9000", score: 1.3, verdictSource: "algorithm" },
  ];

  for (const preferred of preferredNames) {
    const preferredKey = canonicalName(preferred.name);
    const matches = uniqueCandidates(
      (officialNameIndex.get(preferredKey) || [])
        .map((candidate) => ({ ...candidate, score: preferred.score }))
    );
    if (matches.length > 1) {
      return reviewResult(base, itemName, [...matches, ...candidates].slice(0, topK), "동일 명칭이 여러 분류에 존재함");
    }
    if (matches.length !== 1) continue;

    const matched = matches[0];
    return {
      ...base,
      itemName,
      noticeName: matched.item,
      niceClass: matched.niceClass,
      similarGroupCode: matched.similarGroupCode,
      excluded: false,
      status: "ok",
      matchMethod: preferred.matchMethod,
      confidence: preferred.confidence,
      verdictSource: preferred.verdictSource,
      reviewReason: "",
      reviewCandidates: serializeCandidates(
        uniqueCandidates([matched, ...candidates]).slice(0, topK)
      ),
      error: "",
    };
  }
  const derivative = candidates.length ? findProcessedDerivativeCandidate(itemName, candidates) : null;
  if (derivative) {
    return reviewResult(
      base,
      itemName,
      candidates,
      `원물의 사전 후보가 가공품/파생품 형태("${derivative.suffix}")로만 존재함 — ${derivative.candidate.item}(#74, A안 유지: 가공품 상표를 원물 브랜드 근거로 인정하지 않음)`,
      "rule_unresolved_processed_derivative"
    );
  }
  const kofpiMatch = findKofpiForestProductReference(itemName);
  if (kofpiMatch) {
    const detail = [kofpiMatch.scientificName, kofpiMatch.family].filter(Boolean).join(", ");
    return reviewResult(
      base,
      itemName,
      candidates,
      `고시명칭 후보는 없지만 임산물DB백과(한국임업진흥원)에 "${kofpiMatch.name}"(${kofpiMatch.majorCategory}${detail ? `, ${detail}` : ""})로 등재됨 — 원물 확인 참고용, 고시명칭 자동 확정 아님(#114)`,
      "rule_unresolved_kofpi_forest_product_reference"
    );
  }
  return reviewResult(
    base,
    itemName,
    candidates,
    candidates.length ? "정확히 일치하는 고시명칭이 없음" : "고시명칭 후보가 없음"
  );
}

module.exports = {
  canonicalName,
  cleanItemName,
  normalizeByRules,
  serializeCandidates,
  approvedAliases,
};
