"use strict";

const crypto = require("crypto");
const { selectTrademarkExamples, statusCategory } = require("./analyzer");

const RAW_GOODS_REVIEW_SCHEMA_VERSION = "raw-item-goods-review-v1";
const RAW_GOODS_REVIEW_METHOD_VERSION = "raw-item-goods-match-ai-review-v1";

function clean(value) {
  return value === undefined || value === null
    ? ""
    : String(value).normalize("NFC").trim().replace(/\s+/g, " ");
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function normalizeRegion(sidoValue, sigunguValue) {
  let sido = clean(sidoValue);
  let sigungu = clean(sigunguValue);
  if (sigungu.includes(">")) {
    const parts = sigungu.split(">").map(clean).filter(Boolean);
    if (!sido) sido = parts[0] || "";
    sigungu = parts[parts.length - 1] || "";
  }
  return { sido, sigungu };
}

function rowKey(row) {
  const { sido, sigungu } = normalizeRegion(row.sido, row.sigungu);
  // niceClass까지 키에 넣는다: 같은 지자체·품목명이라도 원물명 미분류 행(niceClass 없음)과
  // 고시명칭 매칭 행(예: "신선한 복분자" NICE 31)은 별개 행이다 — 구분 안 하면 수집에 두
  // 행이 다 생겼을 때 "중복 지역×품목"으로 잘못 걸린다(2026-09-04, 고창군 복분자 등 3건).
  // 검토본 행은 niceClass가 없어 clean() 결과가 원물 행(null→"")과 같아 매칭이 유지된다.
  return [sido, sigungu, clean(row.itemName), clean(row.niceClass)].join("\u001f");
}

function regionLabel(sido, sigungu) {
  return sido === sigungu ? sido : [sido, sigungu].filter(Boolean).join(" ");
}

function contentId(rows) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(rows), "utf8")
    .digest("hex")
    .slice(0, 20);
}

function normalizeApp(app, rowLabel, appIndex) {
  if (!app || typeof app !== "object") {
    throw new Error(`${rowLabel} apps[${appIndex}]가 객체가 아닙니다.`);
  }
  const applicationNumber = clean(app.applicationNumber).replace(/\s/g, "");
  if (!applicationNumber) {
    throw new Error(`${rowLabel} apps[${appIndex}]에 applicationNumber가 없습니다.`);
  }
  const goodsMatchMethod = clean(app.goodsMatchMethod).toLowerCase();
  if (!["normalized_exact", "normalized_contains"].includes(goodsMatchMethod)) {
    throw new Error(
      `${rowLabel} / ${applicationNumber}: 검토 승인 입력은 normalized_exact 또는 normalized_contains만 허용합니다.`
    );
  }
  const designatedProducts = (Array.isArray(app.designatedProducts) ? app.designatedProducts : [])
    .map((product) => ({
      classCode: clean(product?.classCode) || null,
      designatedProductName: clean(product?.designatedProductName) || null,
    }))
    .filter((product) => product.designatedProductName);
  if (designatedProducts.length === 0) {
    throw new Error(`${rowLabel} / ${applicationNumber}: 지정상품 근거가 없습니다.`);
  }
  return {
    title: clean(app.title) || null,
    applicationNumber,
    applicationDate: clean(app.applicationDate) || null,
    applicationStatus: clean(app.applicationStatus) || null,
    registrationNumber: clean(app.registrationNumber) || null,
    goodsMatchMethod,
    designatedProducts,
  };
}

function normalizeReviewDocument(document) {
  const legacyArray = Array.isArray(document);
  const rows = legacyArray ? document : document?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("지정상품 검토 파일은 배열 또는 rows 배열을 가진 객체여야 합니다.");
  }
  if (!legacyArray && document.schemaVersion !== RAW_GOODS_REVIEW_SCHEMA_VERSION) {
    throw new Error(
      `지원하지 않는 지정상품 검토 schemaVersion입니다: ${clean(document?.schemaVersion) || "(없음)"}`
    );
  }
  const seenRows = new Set();
  const normalizedRows = rows.map((sourceRow, rowIndex) => {
    if (!sourceRow || typeof sourceRow !== "object") {
      throw new Error(`rows[${rowIndex}]가 객체가 아닙니다.`);
    }
    const { sido, sigungu } = normalizeRegion(sourceRow.sido, sourceRow.sigungu);
    const itemName = clean(sourceRow.itemName);
    const label = [sido, sigungu, itemName].filter(Boolean).join(" / ") || `rows[${rowIndex}]`;
    if (!sido || !sigungu || !itemName) {
      throw new Error(`${label}: sido, sigungu, itemName이 모두 필요합니다.`);
    }
    const key = rowKey({ sido, sigungu, itemName });
    if (seenRows.has(key)) throw new Error(`${label}: 중복 검토 행입니다.`);
    seenRows.add(key);
    const apps = (Array.isArray(sourceRow.apps) ? sourceRow.apps : []).map((app, appIndex) =>
      normalizeApp(app, label, appIndex)
    );
    if (apps.length === 0) throw new Error(`${label}: 승인된 출원 앱이 없습니다.`);
    const seenApps = new Set();
    for (const app of apps) {
      if (seenApps.has(app.applicationNumber)) {
        throw new Error(`${label}: 출원번호 ${app.applicationNumber}가 중복됩니다.`);
      }
      seenApps.add(app.applicationNumber);
    }
    const registeredCount = apps.filter(
      (app) => statusCategory(app.applicationStatus) === "registered"
    ).length;
    if (
      sourceRow.uniqueTrademarkCount !== undefined &&
      Number(sourceRow.uniqueTrademarkCount) !== apps.length
    ) {
      throw new Error(`${label}: uniqueTrademarkCount와 apps 고유 건수가 다릅니다.`);
    }
    if (
      sourceRow.registeredTrademarkCount !== undefined &&
      Number(sourceRow.registeredTrademarkCount) !== registeredCount
    ) {
      throw new Error(`${label}: registeredTrademarkCount와 apps 등록 건수가 다릅니다.`);
    }
    return { sido, sigungu, itemName, apps };
  });
  return {
    schemaVersion: RAW_GOODS_REVIEW_SCHEMA_VERSION,
    methodVersion: clean(document?.methodVersion) || RAW_GOODS_REVIEW_METHOD_VERSION,
    reviewId: clean(document?.reviewId) || `sha256-${contentId(normalizedRows)}`,
    reviewedAt: clean(document?.reviewedAt) || null,
    source: clean(document?.source) || null,
    rows: normalizedRows,
  };
}

function statusCounts(apps) {
  const counts = { registered: 0, pending: 0, inactive: 0, unknown: 0 };
  for (const app of apps) counts[statusCategory(app.applicationStatus)]++;
  return counts;
}

function goodsCounts(apps) {
  const counts = {
    normalized_exact: 0,
    normalized_contains: 0,
    class_only: 0,
    mismatch: 0,
    unverified: 0,
  };
  for (const app of apps) counts[app.goodsMatchMethod]++;
  return counts;
}

function examples(apps, limit) {
  return selectTrademarkExamples(
    apps.map((app) => ({
      title: app.title,
      applicationNumber: app.applicationNumber,
      applicationDate: app.applicationDate,
      applicant: null,
      applicationStatus: app.applicationStatus,
      statusCategory: statusCategory(app.applicationStatus),
      applicantRegionMatch: "inside",
      goodsMatchMethod: app.goodsMatchMethod,
      goodsReviewRequired: false,
      goodsEvidence: app.designatedProducts.map((product) => ({
        designatedProductName: product.designatedProductName,
        classCode: product.classCode,
      })),
    })),
    limit
  );
}

function sumReviewedRegionalMetrics(rows) {
  const regionalStatusCounts = { registered: 0, pending: 0, inactive: 0, unknown: 0 };
  let regionalUniqueTrademarkCount = 0;
  for (const row of rows) {
    regionalUniqueTrademarkCount += Number(row.regionalUniqueTrademarkCount) || 0;
    for (const category of Object.keys(regionalStatusCounts)) {
      regionalStatusCounts[category] += Number(row.regionalStatusCounts?.[category]) || 0;
    }
  }
  return {
    regionalUniqueTrademarkCount,
    regionalStatusCounts,
    regionalRegistrationRate: safeRate(
      regionalStatusCounts.registered,
      regionalUniqueTrademarkCount
    ),
  };
}

function refreshAggregates(analysis) {
  Object.assign(analysis.summary, sumReviewedRegionalMetrics(analysis.regionItems));
  for (const region of analysis.regions) {
    Object.assign(
      region,
      sumReviewedRegionalMetrics(
        analysis.regionItems.filter((row) => clean(row.region) === clean(region.region))
      )
    );
  }
  for (const item of analysis.items) {
    Object.assign(
      item,
      sumReviewedRegionalMetrics(
        analysis.regionItems.filter(
          (row) =>
            clean(row.noticeName) === clean(item.noticeName) &&
            clean(row.niceClass) === clean(item.niceClass)
        )
      )
    );
  }
}

function normalizeRegionAggregates(analysis) {
  const grouped = new Map();
  const additiveFields = [
    "queryCount",
    "successfulQueryCount",
    "partialQueryCount",
    "erroredQueryCount",
    "skippedQueryCount",
    "sourceTotalCount",
    "returnedHitCount",
    "uniqueTrademarkCount",
    "nationwideSearchTrademarkCount",
  ];
  for (const region of analysis.regions) {
    const normalized = normalizeRegion(region.sido, region.sigungu);
    if (!normalized.sido || !normalized.sigungu) {
      grouped.set(`unresolved\u001f${clean(region.region)}\u001f${grouped.size}`, region);
      continue;
    }
    const key = [normalized.sido, normalized.sigungu].join("\u001f");
    region.sido = normalized.sido;
    region.sigungu = normalized.sigungu;
    region.region = regionLabel(normalized.sido, normalized.sigungu);
    const target = grouped.get(key);
    if (!target) {
      grouped.set(key, region);
      continue;
    }
    for (const field of additiveFields) {
      target[field] = (Number(target[field]) || 0) + (Number(region[field]) || 0);
    }
    target.sources = [...new Set([...(target.sources || []), ...(region.sources || [])])].sort();
    const provenance = new Map();
    for (const source of [...(target.sourceProvenance || []), ...(region.sourceProvenance || [])]) {
      const sourceKey = clean(source?.sourceId) || clean(source?.sourceLabel) || JSON.stringify(source);
      provenance.set(sourceKey, source);
    }
    target.sourceProvenance = [...provenance.values()];
    target.regionalMetricAvailability =
      target.regionalMetricAvailability === "blocked" || region.regionalMetricAvailability === "blocked"
        ? "blocked"
        : "available";
    target.regionalMetricBlockingReasons = [
      ...new Set([
        ...(target.regionalMetricBlockingReasons || []),
        ...(region.regionalMetricBlockingReasons || []),
      ]),
    ];
  }
  analysis.regions = [...grouped.values()];
}

function normalizeRegionItems(regionItems) {
  for (const row of regionItems) {
    const normalized = normalizeRegion(row.sido, row.sigungu);
    if (!normalized.sido || !normalized.sigungu) continue;
    row.sido = normalized.sido;
    row.sigungu = normalized.sigungu;
    row.region = regionLabel(normalized.sido, normalized.sigungu);
  }
}

function applyRawGoodsReview(analysis, reviewDocument, options = {}) {
  if (!analysis || !Array.isArray(analysis.regionItems)) {
    throw new Error("analysis는 ④단계 출력이어야 합니다(regionItems 배열 필요).");
  }
  if (!Array.isArray(analysis.regions) || !Array.isArray(analysis.items) || !analysis.summary) {
    throw new Error("analysis의 summary/regions/items 집계가 없습니다.");
  }
  const review = normalizeReviewDocument(reviewDocument);
  // 농사로 원본의 "시도 > 시군구" 복합 문자열은 검토 대상 외 행에도 섞일 수 있다.
  // overlay를 적용할 때 전체 지역×품목 키를 먼저 정규화해 같은 지자체가 두 그룹으로
  // 갈라지는 것을 막는다.
  normalizeRegionItems(analysis.regionItems);
  const targets = new Map();
  for (const row of analysis.regionItems) {
    const key = rowKey(row);
    if (targets.has(key)) throw new Error(`④ 분석에 중복 지역×품목 행이 있습니다: ${key}`);
    targets.set(key, row);
  }
  const appliedRows = [];
  // 검토본(raw-item-goods-review-v1.json)은 2026-08-20 시점의 사람 판정으로 고정돼 있고,
  // 그 뒤로 특산품 수집이 계속 바뀐다(품목이 고시명칭 매칭으로 승격되거나 이름·지역이
  // 달라짐). 그럴 때 검토 행 하나 안 맞는다고 전체 파이프라인을 멈추면 안 된다 — 기본은
  // 못 맞춘 행을 건너뛰고 나머지를 적용한다. strict=true면 예전처럼 즉시 실패(검토본을 갓
  // 만들어 검증할 때). 2026-09-04: --raw-goods-review 플래그가 애초에 안 먹던 버그를 고치자
  // 이 드리프트가 처음 드러났다(알밤한우/공주시가 고시명칭 매칭으로 승격됨).
  const strict = Boolean(options.strict);
  const skippedRows = [];
  const maxExamples = Number(options.maxRecentBrands ?? analysis.parameters?.maxRecentBrands ?? 10);
  if (!Number.isInteger(maxExamples) || maxExamples < 1 || maxExamples > 100) {
    throw new Error("maxRecentBrands는 1~100 범위의 정수여야 합니다.");
  }
  for (const reviewedRow of review.rows) {
    const key = rowKey(reviewedRow);
    const label = key.replace(/\u001f/g, " / ");
    const target = targets.get(key);
    if (!target) {
      if (strict) throw new Error(`검토 행과 일치하는 ④ 지역×품목이 없습니다: ${label}`);
      skippedRows.push({ key: label, reason: "no_matching_region_item" });
      continue;
    }
    if (!new Set(["raw_item_name_unclassified", "raw_item_goods_matched"]).has(target.matchingBasis)) {
      if (strict) {
        throw new Error(`검토 행의 ④ matchingBasis가 원물명 미분류가 아닙니다: ${label} / ${target.matchingBasis}`);
      }
      skippedRows.push({ key: label, reason: `matching_basis_${target.matchingBasis}` });
      continue;
    }
    const regionalStatusCounts = statusCounts(reviewedRow.apps);
    const matchCounts = goodsCounts(reviewedRow.apps);
    const sourceProvenance = Array.isArray(target.sourceProvenance)
      ? target.sourceProvenance.filter((source) => source?.sourceId !== "raw_item_goods_review")
      : [];
    sourceProvenance.push({
      sourceId: "raw_item_goods_review",
      sourceLabel: "원물명 지정상품 검토 결과",
      sourceContractVersion: review.schemaVersion,
      sourceFetchedAt: review.reviewedAt,
    });
    Object.assign(target, {
      sido: reviewedRow.sido,
      sigungu: reviewedRow.sigungu,
      region: regionLabel(reviewedRow.sido, reviewedRow.sigungu),
      matchingBasis: "raw_item_goods_matched",
      regionalUniqueTrademarkCount: reviewedRow.apps.length,
      regionalStatusCounts,
      regionalRegistrationRate: safeRate(
        regionalStatusCounts.registered,
        reviewedRow.apps.length
      ),
      regionalMetricAvailability: "available",
      regionalMetricBlockingReasons: [],
      trademarkExamples: examples(reviewedRow.apps, maxExamples),
      goodsMatchCounts: matchCounts,
      // 대시보드의 현행 계약을 보존한다: exact는 자동 일치, contains는 검토 후보로 분리한다.
      goodsConfirmedHitCount: matchCounts.normalized_exact,
      goodsReviewRequiredHitCount: matchCounts.normalized_contains,
      goodsMismatchHitCount: 0,
      goodsUnverifiedHitCount: 0,
      goodsVerificationRate: 1,
      ipRegistryStatusCounts: {
        complete: reviewedRow.apps.length,
        not_applicable: 0,
        not_collected: 0,
        not_found: 0,
        error: 0,
        unknown: 0,
      },
      sourceProvenance,
      rawGoodsReview: {
        schemaVersion: review.schemaVersion,
        methodVersion: review.methodVersion,
        reviewId: review.reviewId,
        reviewedAt: review.reviewedAt,
        source: review.source,
        exactCount: matchCounts.normalized_exact,
        containsCount: matchCounts.normalized_contains,
      },
    });
    appliedRows.push(target);
  }
  normalizeRegionAggregates(analysis);
  refreshAggregates(analysis);
  analysis.rawGoodsReview = {
    schemaVersion: review.schemaVersion,
    methodVersion: review.methodVersion,
    reviewId: review.reviewId,
    reviewedAt: review.reviewedAt,
    source: review.source,
    appliedRowCount: appliedRows.length,
    applicationCount: appliedRows.reduce(
      (sum, row) => sum + Number(row.regionalUniqueTrademarkCount || 0),
      0
    ),
    exactCount: appliedRows.reduce(
      (sum, row) => sum + Number(row.goodsConfirmedHitCount || 0),
      0
    ),
    containsCount: appliedRows.reduce(
      (sum, row) => sum + Number(row.goodsReviewRequiredHitCount || 0),
      0
    ),
    skippedRowCount: skippedRows.length,
    skippedRows,
  };
  analysis.provenance = analysis.provenance || {};
  analysis.provenance.rawGoodsReview = analysis.rawGoodsReview;
  analysis.methodology = analysis.methodology || {};
  analysis.methodology.rawItemGoodsReviewPolicy =
    "고시명칭 사전 미분류 원물은 지정상품명 normalized_exact/normalized_contains 및 지역 검토를 통과한 고유 출원만 지역 건수로 승격";
  return analysis;
}

module.exports = {
  RAW_GOODS_REVIEW_METHOD_VERSION,
  RAW_GOODS_REVIEW_SCHEMA_VERSION,
  applyRawGoodsReview,
  normalizeReviewDocument,
  rowKey,
};
