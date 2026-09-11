"use strict";
/**
 * #12 확장 — 지정상품 대조를 등록원부(경로 B, 등록상표만)뿐 아니라 서지상세
 * (getBibliographyDetailInfoSearch, 경로 C)로도 한다. 서지상세는 출원중·포기·등록
 * 전부에서 지정상품을 주고(2026-09-08 실측, #12 코멘트), 등록번호가 아니라 출원번호가
 * 키라 등록원부로 영구 도달 불가한 미등록 출원(전체의 상당 비중)까지 대조할 수 있다.
 *
 * 층위 정책(kiip-59 스펙, #12): 등록상표는 등록원부가 계속 authoritative — 이미
 * normalized_exact로 확정된 hit는 절대 건드리지 않는다. 서지상세는 (a) 등록원부가 원천
 * 도달 못 하는 미등록 출원 우선 (b) 등록됐지만 등록원부 미수집분의 임시 대체로만 쓴다.
 * evaluateGoods 정규화 로직은 등록원부·서지상세가 텍스트·classCode 체계 동일함을
 * 확인했으므로(#12) 그대로 재사용한다.
 */

const { evaluateGoods } = require("./ipRegistryEnricher");

const GOODS_MATCH_VERSION = "bibliography-designated-goods-v1";

function normalizeApplicationNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

// 등록원부로 이미 normalized_exact 확정된 hit는 손대지 않는다(등록원부 authoritative).
function isAlreadyConfirmedByRegistry(hit) {
  return hit?.goodsMatchMethod === "normalized_exact" && hit?.goodsSource !== "bibliography";
}

// 등록번호가 없으면(출원중·심사대기 등) 등록원부로 영구 도달 불가 — 최우선 대상.
function isRegistryUnreachable(hit) {
  return !String(hit?.registrationNumber || "").trim();
}

// SERVICE_ACCESS_DENIED(일일 한도 등, xmlLite.isResultCode20AccessError → KiprisApiError)를
// 03c와 같은 방식으로 회로차단 신호로 본다 — "0건 완료"로 삼키지 않는다(7dd502d 교훈).
function isAccessDeniedError(error) {
  return Boolean(error) && (error.code === "SERVICE_ACCESS_DENIED" || error.resultCode === "20");
}

function mapDesignatedGoodsToProducts(designatedGoods) {
  return (designatedGoods || []).map((g) => ({ classCode: g.classCode, designatedProductName: g.name }));
}

// query_facts 구조에서 검색어는 hit이 아니라 fact 레벨(fact.query)에 있다(ipRegistryEnricher와
// 동일한 형태) — hit.query를 읽으면 항상 비어 unverified로 오분류된다.
function applyBibliographyGoods(hit, query, designatedGoods, fetchedAt) {
  const products = mapDesignatedGoodsToProducts(designatedGoods);
  const goods = evaluateGoods(query || {}, products);
  return {
    ...hit,
    goodsMatchMethod: goods.method,
    goodsMatchConfidence: goods.confidence,
    goodsMatchVersion: GOODS_MATCH_VERSION,
    goodsReviewRequired: goods.reviewRequired,
    goodsEvidence: goods.evidence,
    goodsMatchNoticeName: goods.matchedNoticeName,
    goodsMatchNoticeStage: goods.matchedNoticeStage,
    goodsSource: "bibliography",
    bibliographyGoodsFetchedAt: fetchedAt,
  };
}

/**
 * document.queryFacts 전체에서 후보 hit를 모은다(팩트·인덱스 참조 포함). 우선순위:
 * 등록번호 없음(등록원부 도달 불가) 먼저, 그다음 등록됐지만 아직 미확정.
 */
function collectCandidates(document) {
  if (document?.storageMode !== "query_facts" || !document.queryFacts) {
    throw new Error("bibliographyGoodsEnricher: storageMode=query_facts 문서만 지원합니다.");
  }
  const candidates = [];
  for (const [factKey, fact] of Object.entries(document.queryFacts)) {
    const hits = fact.hits || [];
    for (let index = 0; index < hits.length; index++) {
      const hit = hits[index];
      if (!hit.applicationNumber) continue;
      if (isAlreadyConfirmedByRegistry(hit)) continue;
      candidates.push({ factKey, index, hit, query: fact.query, pending: isRegistryUnreachable(hit) });
    }
  }
  // stable sort: pending 먼저, 그 안에서는 원래 순서 유지.
  return candidates
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => (a.pending === b.pending ? a.order - b.order : a.pending ? -1 : 1));
}

/**
 * @param {object} document ③단계 결과(query_facts 저장 방식, 파괴적으로 수정됨)
 * @param {object} kiprisClient createClient()의 반환값(designatedGoods 메서드 필요)
 * @param {{limit?:number, concurrency?:number, goodsCache?:Map, onRequest?:Function,
 *   onCacheUpdate?:Function, onAccessDenied?:Function}} [options]
 */
async function enrichDocument(document, kiprisClient, options = {}) {
  const limit = Number(options.limit ?? 0);
  const concurrency = Math.max(1, Math.min(5, Number(options.concurrency ?? 2)));
  const goodsCache = options.goodsCache instanceof Map ? options.goodsCache : new Map();

  const candidates = collectCandidates(document);
  const selected = limit > 0 ? candidates.slice(0, limit) : candidates;

  const byAppNo = new Map();
  for (const candidate of selected) {
    const no = normalizeApplicationNumber(candidate.hit.applicationNumber);
    if (!no) continue;
    if (!byAppNo.has(no)) byAppNo.set(no, []);
    byAppNo.get(no).push(candidate);
  }
  const appNos = [...byAppNo.keys()];

  let requestedCount = 0;
  let newlyCompleteCount = 0;
  let errorCount = 0;
  let accessDeniedError = null;
  let cursor = 0;

  async function worker() {
    while (cursor < appNos.length) {
      if (accessDeniedError) return;
      const no = appNos[cursor++];
      let entry = goodsCache.get(no);
      if (!entry || entry.status === "error") {
        if (typeof options.onRequest === "function") options.onRequest(no);
        requestedCount++;
        try {
          const res = await kiprisClient.designatedGoods(no);
          entry = { status: "complete", designatedGoods: res.designatedGoods, fetchedAt: new Date().toISOString() };
          newlyCompleteCount++;
        } catch (error) {
          if (isAccessDeniedError(error)) {
            accessDeniedError = error.message || "SERVICE_ACCESS_DENIED";
            if (typeof options.onAccessDenied === "function") options.onAccessDenied(error);
            return;
          }
          entry = { status: "error", designatedGoods: [], error: error.message, fetchedAt: new Date().toISOString() };
          errorCount++;
        }
        goodsCache.set(no, entry);
        if (typeof options.onCacheUpdate === "function") options.onCacheUpdate(no, entry);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, appNos.length) }, worker));

  let appliedExactCount = 0;
  let appliedOtherCount = 0;
  for (const [no, refs] of byAppNo) {
    const entry = goodsCache.get(no);
    if (!entry || entry.status !== "complete") continue;
    for (const ref of refs) {
      const fact = document.queryFacts[ref.factKey];
      const enriched = applyBibliographyGoods(ref.hit, ref.query, entry.designatedGoods, entry.fetchedAt);
      fact.hits[ref.index] = enriched;
      if (enriched.goodsMatchMethod === "normalized_exact") appliedExactCount++;
      else appliedOtherCount++;
    }
  }

  return {
    document,
    summary: {
      contractVersion: GOODS_MATCH_VERSION,
      candidateCount: candidates.length,
      selectedCount: selected.length,
      uniqueApplicationCount: appNos.length,
      requestedCount,
      newlyCompleteCount,
      errorCount,
      appliedExactCount,
      appliedOtherCount,
      accessDeniedDetected: Boolean(accessDeniedError),
      accessDeniedMessage: accessDeniedError,
    },
  };
}

module.exports = {
  GOODS_MATCH_VERSION,
  isAlreadyConfirmedByRegistry,
  isRegistryUnreachable,
  isAccessDeniedError,
  mapDesignatedGoodsToProducts,
  applyBibliographyGoods,
  collectCandidates,
  enrichDocument,
  normalizeApplicationNumber,
};
