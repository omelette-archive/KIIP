"use strict";
/**
 * 품목별 "원물 → 가공품 → 서비스/확장" 전국 상표 흐름 분석(이슈 #116/#74/#110).
 *
 * ③단계(03-match-trademarks)는 각 품목에 매핑된 NICE류만 검색해 지역 통계에 쓴다(의도적
 * 노이즈 절감). 이 모듈은 그와 별개로, 품목 원물명을 NICE류 제한 없이 전국 검색해 원물·
 * 가공품·서비스 단계별 활동을 참고용으로 파악한다. 지역 출원 통계·분모/분자에는 절대
 * 섞지 않는다.
 *
 * 지정상품(designated goods) 텍스트는 상표 단어검색 API에 없고, 등록원부 대조(경로 B)는
 * 아직 전체의 2%만 처리돼 있어(2026-08-26 기준) 원물/가공품 세부 구분에 쓸 수 없다.
 * 그래서 NICE류 29~31류(원물류) 안에서는 상표명 텍스트의 가공 지표 단어로 판정한다.
 * 이 판정은 등록원부로 검증된 값이 아니라 근사치이므로, 산출물 소비 측(대시보드 등)에서
 * "확정된 분류"처럼 보이지 않게 다뤄야 한다.
 */

const SERVICE_CLASSES = new Set(["35", "39", "40", "41", "42", "43", "44", "45"]);
const GOODS_CLASSES = new Set(["29", "30", "31", "32", "33"]);

// 단일 음절 키워드는 무관한 단어와 충돌하므로(청정/정선/주식회사 등) "품목명+음절"이
// 하나의 합성어를 이룰 때만 인정한다. 2글자 이상 키워드는 상표명 전체에서 부분일치를 허용한다.
const PROCESSED_SUFFIXES = ["주", "차", "즙", "청", "환", "정", "면", "빵", "떡", "엿", "장"];
const PROCESSED_WORDS = [
  "막걸리", "소주", "와인", "리큐르", "브랜디", "주스", "음료", "에이드",
  "잼", "정과", "당절임", "장아찌", "절임", "피클", "식혜", "식초",
  "국수", "과자", "스낵", "쿠키", "파이",
  "가루", "분말", "캡슐", "엑기스", "농축액", "추출물", "진액",
  "젓갈", "통조림", "소스", "드레싱", "조청",
  "로션", "크림", "에센스", "화장품", "비누", "팩",
  "가공", "구이", "훈제", "육포", "볶음", "건강기능식품",
];

function normalizeClassCode(code) {
  const n = parseInt(code, 10);
  return Number.isNaN(n) ? String(code).trim() : String(n);
}

function hitClasses(hit) {
  return String(hit.classificationCode || "")
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean)
    .map(normalizeClassCode);
}

// "미가공"·"무가공"은 "가공하지 않음"이라는 부정 표현인데 "가공"을 부분 문자열로
// 담고 있어 그대로 두면 원물을 가공품으로 오판정한다(#74 실측 발견 — "미가공 감자"
// 등 7건). 판정 전에 부정형을 먼저 제거한다.
const NEGATED_PROCESSED_RE = /(미|무)가공/g;
function classifyGoodsTitle(title, coreTerm) {
  const t = (title || "").replace(NEGATED_PROCESSED_RE, "");
  if (PROCESSED_WORDS.some((kw) => t.includes(kw))) return "processed";
  for (const suf of PROCESSED_SUFFIXES) {
    if (t.includes(coreTerm + suf)) return "processed";
  }
  return "raw";
}

/**
 * 히트 하나를 원물/가공품/서비스/제외 단계로 분류한다.
 * mode: "agri"(농수임산물 - 원물/가공품 구분 적용) | "craft"(공예품 등 - 구분 없이 제품/서비스만)
 */
function classifyHitStage(hit, coreTerm, mode = "agri") {
  const cs = hitClasses(hit);
  const isService = cs.some((c) => SERVICE_CLASSES.has(c));
  const isGoods = cs.some((c) => GOODS_CLASSES.has(c));
  if (mode === "craft") return isService ? "service" : isGoods || cs.length ? "product" : "excluded";
  if (isGoods) return classifyGoodsTitle(hit.title, coreTerm) === "processed" ? "processed" : "raw";
  if (isService) return "service";
  return "excluded";
}

function aggregateHits(hits, coreTerm, mode = "agri") {
  const stages = { raw: [], processed: [], service: [], product: [], excluded: [] };
  for (const hit of hits) stages[classifyHitStage(hit, coreTerm, mode)].push(hit);
  return stages;
}

// 파일럿 176개 품목 실측(2026-08-27) 결과, "원물 단계 상위 출원인 = 그 지역이 산지"라는
// 해석이 23%(41/176)에서만 신뢰할 만했다. 이 휴리스틱은 상위 출원인이 지자체·생산자단체·
// 영농조합법인·협동조합처럼 실제 생산 주체로 보이는지만 걸러낸다. 판정 로직은
// 03-match-trademarks/lib/producerApplicant.js로 옮겨 지역 통계 경로와 공유한다(#118).
const { isProducerLikeApplicant } = require("../../03-match-trademarks/lib/producerApplicant");

/**
 * 품목 하나의 stages(raw/processed/service)를 보고 클러스터 서술을 노출해도 될지 판단한다.
 * 원물 단계 상위 출원인이 생산자형이면 "producer_confirmed", 아니면 "uncertain".
 */
function rawSignalConfidence(rawTopApplicants) {
  const top = rawTopApplicants?.[0];
  return top && isProducerLikeApplicant(top.applicant) ? "producer_confirmed" : "uncertain";
}

// 이슈 #116(2026-09-01): "단계별 대표·특이 지정상품 예시"를 보여달라는 요청. 상표
// 단어검색 API 응답에는 지정상품 텍스트가 없어(경로 B 등록원부 대조는 전체의 2%뿐)
// 대신 그 단계에서 실제로 출원된 "상표명" 예시를 보여준다 — 대표(coreTerm 옆에 짧게
// 붙은 전형적 브랜딩)와 이색(coreTerm에서 멀어진 확장형)으로 나눈다. 상표명은
// 지역 귀속과 무관하므로 rawSignalConfidence와 상관없이 항상 노출해도 안전하다.
// 2026-09-04(#116): 실데이터 검증에서 "짧은 순 = 대표"가 한 글자 상표("A","j")를,
// "긴 순 = 이색"이 100자짜리 마케팅 문구를 뽑는 문제 확인. 한 글자·기호만 있는 상표와
// 슬로건형 장문을 먼저 걸러내고, 대표는 coreTerm을 포함한 전형적 브랜딩에서 고른다.
const EXAMPLE_MIN_LEN = 2;
const EXAMPLE_MAX_LEN = 40;
const EXAMPLE_REP_MAX_LEN = 14;
function stageExamples(stageHits, coreTerm, limit = 3) {
  const core = String(coreTerm || "").trim();
  const seen = new Set();
  const titles = [];
  for (const hit of stageHits) {
    const title = (hit.title || "").replace(/\s+/g, " ").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  // 한 글자·기호뿐인 상표, 슬로건형 장문은 예시로서 의미가 없다.
  const compactLen = (title) => title.replace(/\s+/g, "").length;
  const pool = titles.filter((title) => {
    const len = compactLen(title);
    return len >= EXAMPLE_MIN_LEN && len <= EXAMPLE_MAX_LEN && /[가-힣A-Za-z0-9]{2,}/.test(title.replace(/\s+/g, ""));
  });
  if (pool.length === 0) return { representative: [], unusual: [] };
  const byLength = [...pool].sort((a, b) => compactLen(a) - compactLen(b) || a.localeCompare(b, "ko-KR"));
  // 대표: coreTerm을 담은 짧은 브랜딩 우선, 모자라면 그냥 짧은 순으로 채운다.
  const withCore = core ? byLength.filter((title) => title.includes(core) && compactLen(title) <= EXAMPLE_REP_MAX_LEN) : [];
  const representative = [...new Set([...withCore, ...byLength])].slice(0, limit);
  const repSet = new Set(representative);
  // 이색: coreTerm에서 멀어진 확장형 — coreTerm 미포함을 먼저, 그다음 긴 순.
  const unusual = [...pool]
    .filter((title) => !repSet.has(title))
    .sort((a, b) => {
      const aCore = core && a.includes(core) ? 1 : 0;
      const bCore = core && b.includes(core) ? 1 : 0;
      return aCore - bCore || compactLen(b) - compactLen(a) || a.localeCompare(b, "ko-KR");
    })
    .slice(0, limit);
  return { representative, unusual };
}

// 이슈 #119(2026-09-02): 단계별 "주요 지정상품(류)" — 지정상품 텍스트는 없지만 NICE
// 상품류 코드는 모든 hit에 있으므로, 그 단계에서 많이 쓰인 상품류를 상위 N개 보여준다.
function stageClassDistribution(stageHits, limit = 5) {
  const byClass = new Map();
  for (const hit of stageHits) {
    for (const code of hitClasses(hit)) byClass.set(code, (byClass.get(code) || 0) + 1);
  }
  const total = [...byClass.values()].reduce((sum, count) => sum + count, 0);
  return [...byClass.entries()]
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .slice(0, limit)
    .map(([classCode, count]) => ({ classCode, count, share: total ? count / total : 0 }));
}

// 이슈 #119: 단계별 상표 출원 상위 지역과 점유율(특산품 관리 지역 고려 X). 전체 hit의
// 주소를 조회할 예산은 없으므로 상위 출원인(withRegion)이 이미 주소가 붙은 것을 지역별로
// 합산한다 — 상위 출원인 기준 근사치다.
function stageTopRegions(topApplicantsWithRegion, limit = 5) {
  const byRegion = new Map();
  for (const applicant of topApplicantsWithRegion || []) {
    if (!applicant.region) continue;
    byRegion.set(applicant.region, (byRegion.get(applicant.region) || 0) + (applicant.count || 0));
  }
  const total = [...byRegion.values()].reduce((sum, count) => sum + count, 0);
  return [...byRegion.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko-KR"))
    .slice(0, limit)
    .map(([region, count]) => ({ region, count, share: total ? count / total : 0 }));
}

function topApplicantsByStage(stageHits, limit = 5) {
  const byApplicant = new Map();
  for (const hit of stageHits) {
    if (!hit.applicant) continue;
    const entry = byApplicant.get(hit.applicant) || { applicant: hit.applicant, count: 0, sampleApplicationNumber: null };
    entry.count += 1;
    // 여러 히트 중 실제로 출원번호가 있는 첫 건만 대표값으로 남긴다(빈 값으로 API 호출 오류 방지).
    if (!entry.sampleApplicationNumber && hit.applicationNumber) entry.sampleApplicationNumber = hit.applicationNumber;
    byApplicant.set(hit.applicant, entry);
  }
  return [...byApplicant.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

async function collectNationwideHits(kiprisClient, term, { maxPages = 30, numOfRows = 100, maxHits = 3000 } = {}) {
  const hits = [];
  let page = 1;
  let totalCount = 0;
  let stopReason = "source_exhausted";
  while (page <= maxPages && hits.length < maxHits) {
    const result = await kiprisClient.trademarkSearch({ searchString: term, numOfRows, pageNo: page });
    totalCount = Number(result.totalCount) || 0;
    hits.push(...result.hits);
    if (page * numOfRows >= totalCount || result.hits.length === 0) { stopReason = "source_exhausted"; break; }
    page += 1;
  }
  if (page > maxPages) stopReason = "max_pages";
  if (hits.length >= maxHits) stopReason = "max_hits";
  const collectionStatus = stopReason === "source_exhausted" ? "complete" : "bounded";
  return { term, totalCount, fetchedCount: hits.length, pagesFetched: Math.min(page, maxPages), stopReason, collectionStatus, hits: hits.slice(0, maxHits) };
}

/**
 * 상위 출원인의 대표 출원번호로 주소를 조회해 시도/시군구로 정규화한다.
 * applicantCache는 03-match-trademarks/lib/trademarkApplicantCache.js의 Map 포맷을 그대로 쓴다
 * (키: 정규화된 출원번호, 값: { status:"complete", found, applicants:[...] }).
 */
async function resolveApplicantRegion(applicantClient, applicationNumber, adminList, normalizeApplicantAddress, cache) {
  if (!applicationNumber) return { status: "unmatched" };
  const cached = cache.get(applicationNumber);
  let applicants;
  if (cached?.status === "complete") {
    applicants = cached.applicants || [];
  } else {
    const res = await applicantClient.getApplicants(applicationNumber);
    applicants = res.applicants || [];
    cache.set(applicationNumber, { status: "complete", found: res.found, resultCode: res.resultCode, applicants });
  }
  const first = applicants[0];
  if (!first?.address) return { status: "unmatched" };
  return normalizeApplicantAddress(first.address, adminList);
}

const AGRI_CATEGORIES = new Set(["과일", "채소", "곡물", "축산물", "수산물", "임산물", "특용작물"]);
const DISPLAY_PREFIXES = ["신선한 ", "미가공 "];
const OFFICIAL_MATCHING_BASES = new Set(["notice_name_and_nice_class", "raw_item_goods_matched"]);

/**
 * 대시보드 스냅샷에서 농수임산물 원물 품목명을 뽑아 브랜드 수식어가 붙은 이름(예: "마춤 쌀",
 * "치악산 배")을 같은 원물의 변형으로 묶는다. "A / B" 형태의 복합 표시명은 개별 품목으로
 * 분리한다. 완전한 명칭 정규화(②단계 별칭 사전)는 아니고, 이 분석의 검색어 중복만 줄이는
 * 가벼운 휴리스틱이다 — 붙지 않은 이름(예: "가와지쌀")은 그대로 별도 검색어로 남는다.
 */
function deriveAgriCoreItems(snapshot) {
  const rawNames = new Set();
  for (const region of snapshot.regions || []) {
    for (const item of region.items || []) {
      if (!item.matchingBasis || !OFFICIAL_MATCHING_BASES.has(item.matchingBasis)) continue;
      if (!item.category || !AGRI_CATEGORIES.has(item.category.label)) continue;
      let name = item.noticeName || "";
      for (const prefix of DISPLAY_PREFIXES) if (name.startsWith(prefix)) name = name.slice(prefix.length);
      if (name) rawNames.add(name);
    }
  }
  const names = [...rawNames];
  const nameSet = new Set(names);
  const cores = new Set();
  for (const name of names) {
    if (name.includes("/")) { name.split("/").map((s) => s.trim()).filter(Boolean).forEach((c) => cores.add(c)); continue; }
    if (name.includes(" ")) {
      const parts = name.split(" ");
      const last = parts[parts.length - 1];
      if (nameSet.has(last) && last !== name) { cores.add(last); continue; }
    }
    cores.add(name);
  }
  return [...cores].sort((a, b) => a.localeCompare(b, "ko-KR"));
}

module.exports = {
  SERVICE_CLASSES,
  GOODS_CLASSES,
  PROCESSED_WORDS,
  PROCESSED_SUFFIXES,
  AGRI_CATEGORIES,
  classifyGoodsTitle,
  classifyHitStage,
  aggregateHits,
  isProducerLikeApplicant,
  rawSignalConfidence,
  stageExamples,
  stageClassDistribution,
  stageTopRegions,
  topApplicantsByStage,
  collectNationwideHits,
  resolveApplicantRegion,
  deriveAgriCoreItems,
};
