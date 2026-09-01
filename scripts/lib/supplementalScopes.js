"use strict";

/**
 * #70(2026-09-01): NFQS·KOFPI 보완 소스의 지역 스코프 정규화를 운영 파이프라인에 접기
 * 위해 mergeSupplementalDashboardData.js에서 그대로 옮긴 함수들이다. 예전엔 별도 병합
 * 스크립트가 라이브 스냅샷을 사후 패치했지만, 이제 ①이 이 소스들을 함께 수집하므로
 * ③→④ 사이(scope 정규화)와 ⑦ 뒤(주산지 근거·특화작목 배지)에 단계로 넣는다.
 *
 * - normalizeNfqsFacilityScopes: NFQS 품질인증 인증사업장 소재지는 특산품 생산지 근거가
 *   아니므로 "전국 지역 미제공"으로 돌린다.
 * - normalizeNfqsGeoReviewScopes: 복수 지역 가능성이 있어 보류된 지리적표시수산물을
 *   "전국 지역 검토대기"로 둔다.
 * - expandForestRegionalResults: KOFPI 임산물DB백과는 지역 필드가 없다. 2024년
 *   임산물생산조사의 공식 주산지 근거가 있으면 그 시군구별 행으로 펼치고, 없으면
 *   전국 카탈로그 행으로만 둔다.
 * - attachForestPrimaryRegionEvidence: ⑦ 스냅샷의 KOFPI 품목에 주산지 근거를 붙인다.
 */

function union(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeNfqsFacilityScopes(document) {
  for (const result of document.results || []) {
    if (result.input?.sourceId !== "nfqs_quality_cert") continue;
    result.input = {
      ...result.input,
      sido: "전국",
      sigungu: "지역 미제공",
      regionCode: "",
      regionMatchMethod: "facility_location_not_specialty_origin",
      sourceRegionName: "전국(인증사업장 소재지는 특산품 생산지 근거가 아님)",
      sourceScope: "nationwide_certified_product_catalog",
    };
    result.provenance = {
      ...(result.provenance || {}),
      sourceRegionName: result.input.sourceRegionName,
      regionMatchMethod: result.input.regionMatchMethod,
    };
    result.query = {
      ...(result.query || {}),
      region: "전국 지역 미제공",
      regionMatch: "not_applicable",
    };
  }
}

function normalizeNfqsGeoReviewScopes(document) {
  for (const result of document.results || []) {
    if (
      result.input?.sourceId !== "nfqs_geographical_indication" ||
      result.input?.sourceScope !== "geographical_indication_region_review"
    ) {
      continue;
    }
    result.input = {
      ...result.input,
      sido: "전국",
      sigungu: "지역 검토대기",
      regionCode: "",
    };
    result.query = {
      ...(result.query || {}),
      region: "전국 지역 검토대기",
      regionMatch: "not_applicable",
    };
  }
}

function expandForestRegionalResults(document, evidenceDocument) {
  const expanded = [];
  for (const result of document.results || []) {
    if (result.input?.sourceId !== "kofpi_forest_product") {
      expanded.push(result);
      continue;
    }
    const primaryRegionEvidence = evidenceDocument.items?.[result.input.itemName] || [];
    if (primaryRegionEvidence.length === 0) {
      const nationwide = structuredClone(result);
      nationwide.input.sido = "전국";
      nationwide.input.sigungu = "지역 미제공";
      nationwide.query = {
        ...(nationwide.query || {}),
        region: "전국 지역 미제공",
        regionMatch: "not_applicable",
      };
      expanded.push(nationwide);
      continue;
    }
    for (const evidence of primaryRegionEvidence) {
      const regional = structuredClone(result);
      regional.inputIndex = `forest-region-${evidence.tableNumber}-${result.inputIndex}`;
      regional.input = {
        ...regional.input,
        inputIndex: regional.inputIndex,
        sido: evidence.sido,
        sigungu: evidence.sigungu,
        regionCode: "",
        regionMatchMethod: evidence.evidenceType,
        sourceRegionName: evidence.region,
        sourceScope: "official_primary_region_evidence",
      };
      regional.provenance = {
        ...(regional.provenance || {}),
        sourceRegionName: evidence.region,
        regionMatchMethod: evidence.evidenceType,
      };
      regional.query = {
        ...(regional.query || {}),
        region: evidence.region,
        regionMatch: "official_primary_region_evidence",
      };
      expanded.push(regional);
    }
  }
  document.results = expanded;
  document.inputCount = expanded.length;
  document.searchableRowCount = expanded.filter((row) => row.status !== "skipped").length;
  document.successCount = expanded.filter((row) => row.status === "ok").length;
  document.partialCount = expanded.filter((row) => row.collectionStatus === "partial").length;
  document.errorCount = expanded.filter((row) => row.status === "error").length;
  document.skippedCount = expanded.filter((row) => row.status === "skipped").length;
}

/**
 * ③→④ 사이에 적용한다. document는 mutate된다.
 */
function applySupplementalScopes(document, { forestRegionEvidence } = {}) {
  normalizeNfqsFacilityScopes(document);
  normalizeNfqsGeoReviewScopes(document);
  if (forestRegionEvidence) expandForestRegionalResults(document, forestRegionEvidence);
  return document;
}

function attachForestPrimaryRegionEvidence(regions, evidenceDocument) {
  const matchedItemNames = new Set();
  let evidenceRows = 0;
  for (const region of regions) {
    for (const item of region.items) {
      if (!(item.sources || []).includes("kofpi_forest_product")) continue;
      const allEvidence = evidenceDocument.items?.[item.itemName] || [];
      const evidence =
        region.sido === "전국"
          ? allEvidence
          : allEvidence.filter((row) => row.region === region.region);
      if (!evidence.length) continue;
      item.regionalEvidence = evidence.map((row) => ({
        ...structuredClone(row),
        regionalMetricEligible:
          region.sido !== "전국" &&
          item.metrics?.uniqueTrademarkCount?.availability === "available",
        regionalMetricValidatedAt: region.sido !== "전국" ? "2026-08-25" : null,
      }));
      item.sources = union([...(item.sources || []), "forest_product_production_survey"]);
      matchedItemNames.add(item.itemName);
      evidenceRows += evidence.length;
    }
  }
  return { matchedItems: matchedItemNames.size, evidenceRows };
}

module.exports = {
  union,
  normalizeNfqsFacilityScopes,
  normalizeNfqsGeoReviewScopes,
  expandForestRegionalResults,
  applySupplementalScopes,
  attachForestPrimaryRegionEvidence,
};
