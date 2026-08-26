#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  analyzeEntries,
  applicationYear,
  regionCategory,
  selectTrademarkExamples,
  statusCategory,
  trademarkKey,
} = require("./lib/analyzer");
const { applyRawGoodsReview } = require("./lib/rawGoodsReview");

function hit(number, title, date, status, regionMatch) {
  return {
    title,
    applicant: `${title} 영농조합`,
    applicationNumber: number,
    applicationDate: date,
    applicationStatus: status,
    classificationCode: "31",
    regionMatch,
  };
}

function ok(label) {
  console.log(`  ok - ${label}`);
}

const input = [
  {
    sido: "경상북도",
    sigungu: "안동시",
    itemName: "사과",
    noticeName: "신선한 사과",
    niceClass: "31",
    query: { region: "경상북도 안동시", searchString: "신선한 사과", regionMatch: "unverified" },
    totalCount: 20,
    returnedCount: 5,
    hits: [
      hit("40-2025-1", "안동햇사과", "20250102", "등록", "inside"),
      hit("40-2024-2", "아침사과", "2024-03-04", "출원중", "outside"),
      hit("40-2023-3", "푸른사과", "20230102", "거절", "unverified"),
      hit("40-2025-1", "안동햇사과", "20250102", "등록", "inside"),
      hit("40-X", "날짜미상", "", "", "unverified"),
    ],
  },
  {
    sido: "경상북도",
    sigungu: "안동시",
    itemName: "사과",
    noticeName: "신선한 사과",
    niceClass: "31",
    query: { region: "경상북도 안동시", searchString: "신선한 사과" },
    error: "테스트 오류",
  },
  {
    sido: "경상북도",
    sigungu: "안동시",
    itemName: "탈",
    niceClass: "28",
    query: { region: "경상북도 안동시", searchString: "탈" },
    totalCount: 0,
    returnedCount: 0,
    hits: [],
  },
  {
    sido: "경기도",
    sigungu: "포천시",
    itemName: "사과",
    niceClass: "31",
    query: { region: "경기도 포천시", searchString: "사과" },
    totalCount: 1,
    returnedCount: 1,
    hits: [hit("40-2025-1", "안동햇사과", "20250102", "등록", false)],
  },
];

console.log("1) 필드 정규화");
assert.strictEqual(applicationYear("2024-01-02"), 2024);
assert.strictEqual(applicationYear("날짜없음"), null);
assert.strictEqual(statusCategory("등록결정"), "registered");
assert.strictEqual(statusCategory("출원공고"), "pending");
assert.strictEqual(statusCategory("거절"), "inactive");
assert.strictEqual(statusCategory("등록취소"), "inactive");
assert.strictEqual(regionCategory({ applicantRegionMatch: true }), "inside");
assert.strictEqual(regionCategory({ regionMatch: "out-of-region" }), "outside");
assert.strictEqual(trademarkKey({ applicationNumber: "40-1" }), "app:40-1");
ok("날짜·상태·지역·중복 키 정규화");

console.log("2) 전체/지역×품목 집계");
const result = analyzeEntries(input, { asOfYear: 2026, recentYears: 2, maxRecentBrands: 2 });
assert.strictEqual(result.summary.queryCount, 4);
assert.strictEqual(result.summary.erroredQueryCount, 1);
assert.strictEqual(result.summary.returnedHitCount, 6);
assert.strictEqual(result.summary.uniqueTrademarkCount, 4, "지역 간 동일 출원번호도 전체에서는 한 번만 집계");
assert.strictEqual(result.regionItems.length, 3, "결과 0건인 지역×품목도 유지");
const andongApple = result.regionItems.find(
  (row) => row.region === "경상북도 안동시" && row.itemName === "사과"
);
assert.ok(andongApple);
assert.strictEqual(andongApple.queryCount, 2);
assert.strictEqual(andongApple.uniqueTrademarkCount, 4);
assert.strictEqual(andongApple.duplicateHitCount, 1);
assert.strictEqual(andongApple.statusCounts.registered, 1);
assert.strictEqual(andongApple.statusCounts.pending, 1);
assert.strictEqual(andongApple.statusCounts.inactive, 1);
assert.strictEqual(andongApple.nationwideSearchTrademarkCount, 4);
assert.strictEqual(andongApple.regionalUniqueTrademarkCount, 1);
assert.strictEqual(andongApple.regionalStatusCounts.registered, 1);
assert.strictEqual(andongApple.regionalRegistrationRate, 1);
assert.strictEqual(andongApple.regionalMetricAvailability, "blocked");
assert.deepStrictEqual(andongApple.regionalMetricBlockingReasons, [
  "collection_incomplete",
]);
assert.strictEqual(andongApple.invalidApplicationDateCount, 1);
ok("오류·0건 포함, 출원번호 중복 제거, 상태별 집계");

console.log("2-1) 원물류(29·30·31류) 전국 후보 지역 주소 일치 비율(#110, 지역 통계와 분리된 참고 지표)");
assert.deepStrictEqual(andongApple.rawGoodsRegionalShare, {
  nationwideCandidateCount: 4,
  regionalAddressMatchCount: 1,
  rate: 0.25,
});
const pocheonApple = result.regionItems.find(
  (row) => row.region === "경기도 포천시" && row.itemName === "사과"
);
assert.ok(pocheonApple);
assert.strictEqual(pocheonApple.rawGoodsRegionalShare.nationwideCandidateCount, 1);
assert.strictEqual(pocheonApple.rawGoodsRegionalShare.regionalAddressMatchCount, 0);
const tal = result.regionItems.find((row) => row.itemName === "탈");
assert.deepStrictEqual(tal.rawGoodsRegionalShare, {
  nationwideCandidateCount: 0,
  regionalAddressMatchCount: 0,
  rate: null,
}, "hits가 0건이면 후보도 0건(널 아님) — 지역 버킷 자체는 유지");
ok("가공품·서비스류를 뺀 29·30·31류 전국 후보 중 이 지역 주소 일치 건수·비율을 지역 통계와 별개로 계산");

console.log("3) 시계열과 지역 검증 지표");
assert.deepStrictEqual(andongApple.recentPeriod, { startYear: 2024, endYear: 2025, count: 2 });
assert.deepStrictEqual(andongApple.previousPeriod, { startYear: 2022, endYear: 2023, count: 1 });
assert.strictEqual(andongApple.recentTrend, "increase");
assert.strictEqual(andongApple.recentChangeRate, 1);
assert.strictEqual(andongApple.regionVerifiedHitCount, 2);
assert.strictEqual(andongApple.regionVerificationRate, 0.5);
assert.strictEqual(andongApple.localApplicantShare, 0.5);
assert.strictEqual(andongApple.recentBrands.length, 2);
ok("현재 연도 제외 최근/직전 기간 비교와 검증된 지역 비중");

console.log("4) 03단계 신 배치 계약(status/keywordTotalCount/skipped.input) 호환");
{
  // PR #1의 실제 matchTrademarks.js 배치 출력 형태를 그대로 재현한다:
  // ok는 query.region(문자열)+keywordTotalCount, skipped는 query 없이 input에 ②단계
  // 원본 행이 그대로 들어있다.
  const newFormatInput = [
    {
      status: "ok",
      collectionStatus: "partial",
      stopReason: "max_pages",
      inputIndex: 0,
      query: { region: "전라남도 나주시", regionMatch: "unverified", item: "신선한 배", classCode: "31" },
      keywordTotalCount: 12345,
      page: { number: 1, size: 5, unfilteredCount: 1, filteredCount: 1, hasMore: true },
      hits: [hit("40-2025-9", "나주햇배", "20250501", "등록", "unverified")],
    },
    {
      status: "error",
      inputIndex: 1,
      query: { region: "전라남도 나주시", item: "신선한 배", classCode: "31" },
      error: "API 오류",
    },
    {
      status: "skipped",
      inputIndex: 2,
      reason: "② 단계 status=review_required",
      input: {
        sido: "경상북도",
        sigungu: "안동시",
        rawItemName: "안동하회탈",
        itemName: "하회탈",
        noticeName: "",
        niceClass: "",
        excluded: "false",
        status: "review_required",
      },
    },
  ];
  const r = analyzeEntries(newFormatInput, { asOfYear: 2026 });
  assert.strictEqual(r.summary.queryCount, 3);
  assert.strictEqual(r.summary.successfulQueryCount, 1);
  assert.strictEqual(r.summary.partialQueryCount, 1);
  assert.strictEqual(r.summary.erroredQueryCount, 1);
  assert.strictEqual(r.summary.skippedQueryCount, 1, "skipped는 성공/오류와 분리된 별도 카운트여야 함");
  assert.strictEqual(r.summary.sourceTotalCount, 12345, "keywordTotalCount를 읽어야 함(구 totalCount 아님)");

  const unassigned = r.regionItems.find((row) => row.region === "미지정 지역");
  assert.strictEqual(unassigned, undefined, "skipped 행이 가짜 '미지정 지역' 버킷을 만들면 안 됨");

  const skippedRow = r.regionItems.find(
    (row) => row.region === "경상북도 안동시" && row.itemName === "하회탈"
  );
  assert.strictEqual(skippedRow, undefined, "고시명칭 미확정 행은 지역×특산품 집계에 노출하면 안 됨");
  assert.strictEqual(r.exclusions.unresolvedNoticeNameCount, 1);

  assert.ok(
    r.warnings.some((w) => w.includes("검토대기·제외")),
    "skipped 건수에 대한 경고 문구가 있어야 함"
  );
  assert.ok(
    r.warnings.some((w) => w.includes("부분 수집")),
    "partial 검색이 집계에 포함됐다는 경고 문구가 있어야 함"
  );
  const batchDocument = {
    schemaVersion: "1.2",
    mode: "batch",
    inputCount: 3,
    searchableRowCount: 2,
    successCount: 1,
    partialCount: 1,
    errorCount: 1,
    skippedCount: 1,
    uniqueQueryCount: 2,
    uniqueQueryStatusCounts: { complete: 0, partial: 1, error: 1 },
    results: newFormatInput,
  };
  const batchResult = analyzeEntries(batchDocument, { asOfYear: 2026 });
  assert.strictEqual(batchResult.summary.inputRowCount, 3);
  assert.strictEqual(batchResult.summary.searchableRowCount, 2);
  assert.strictEqual(batchResult.summary.uniqueQueryCount, 2);
  assert.strictEqual(batchResult.summary.partialUniqueQueryCount, 1);
  assert.strictEqual(batchResult.summary.erroredUniqueQueryCount, 1);
  const compactDocument = {
    ...batchDocument,
    schemaVersion: "1.3",
    storageMode: "query_facts",
    queryFacts: {
      "사과\u001f31": {
        ...newFormatInput[0],
        query: { ...newFormatInput[0].query, region: null },
      },
    },
    results: [
      {
        inputIndex: 0,
        queryKey: "사과\u001f31",
        query: { ...newFormatInput[0].query },
        input: newFormatInput[0].input,
        status: "ok",
        collectionStatus: "partial",
      },
    ],
    inputCount: 1,
    searchableRowCount: 1,
    successCount: 1,
    partialCount: 1,
    errorCount: 0,
    skippedCount: 0,
    uniqueQueryCount: 1,
  };
  const compactResult = analyzeEntries(compactDocument, { asOfYear: 2026 });
  assert.strictEqual(compactResult.regionItems.length, 1);
  assert.strictEqual(compactResult.regionItems[0].uniqueTrademarkCount, 1);
  assert.strictEqual(compactResult.summary.partialRowCount, 1);
  ok("skipped 행은 성공 집계·미지정 버킷에서 빠지고, ok 행은 keywordTotalCount로 정확히 집계됨");
}

console.log("5) ①단계 source(지리적표시/농사로/샘플) 집계 전파 — ⑤단계 대표성 판정용");
{
  const withSource = [
    {
      status: "ok",
      inputIndex: 0,
      source: "지리적표시",
      provenance: {
        sourceLabel: "지리적표시",
        sourceId: "gi",
        sourceContractVersion: "provider-live-api",
        sourceFetchedAt: "2026-08-10T01:00:00Z",
      },
      query: { region: "경기도 안성시", item: "안성배" },
      keywordTotalCount: 2,
      hits: [hit("40-2025-9", "안성햇배", "20250501", "등록", "unverified")],
    },
    {
      status: "ok",
      inputIndex: 1,
      source: "지리적표시",
      query: { region: "경기도 안성시", item: "안성배" },
      keywordTotalCount: 2,
      hits: [hit("40-2025-9", "안성햇배", "20250501", "등록", "unverified")],
    },
    {
      status: "error",
      inputIndex: 2,
      source: "농사로",
      query: { region: "전라남도 보성군", item: "보성녹차" },
      error: "테스트 오류",
    },
    {
      status: "skipped",
      inputIndex: 3,
      reason: "② 단계에서 분석 제외된 품목",
      input: { sido: "경상북도", sigungu: "안동시", rawItemName: "안동사과나무", itemName: "사과나무", source: "샘플" },
    },
  ];
  const r = analyzeEntries(withSource, { asOfYear: 2026 });
  const anseongPear = r.regionItems.find((row) => row.region === "경기도 안성시");
  assert.deepStrictEqual(anseongPear.sources, ["지리적표시"], "같은 지역×품목에 중복 등장해도 출처는 한 번만 담김");
  assert.strictEqual(anseongPear.sourceProvenance[0].sourceId, "gi");
  assert.strictEqual(anseongPear.sourceProvenance[0].sourceContractVersion, "provider-live-api");
  const boseongTea = r.regionItems.find((row) => row.region === "전라남도 보성군");
  assert.deepStrictEqual(boseongTea.sources, ["농사로"], "검색 자체가 오류난 행도 출처는 유실되지 않음");
  const andongTree = r.regionItems.find((row) => row.itemName === "사과나무");
  assert.strictEqual(andongTree, undefined, "분석 제외 품목을 집계 차원에 만들면 안 됨");
  assert.ok(r.summary.skippedQueryCount > 0, "제외 행은 운영 요약에는 남아야 함");
  assert.strictEqual(r.schemaVersion, "1.4");
  ok("regionItems/regions/items 각 버킷에 distinct 수집출처 목록이 담김");
}

console.log("6) 농사로 지역브랜드 조인 신호 — 출원인 주소 지표와 분리");
{
  const referenced = (number, regionStatus, level, sido, sigungu) => ({
    ...hit(number, `상표-${number}`, "20250101", "등록", "unverified"),
    regionalBrandMatchSource: "nongsaro_area_brand_application_number",
    regionalBrandMatchVersion: "area-brand-application-region-join-v1",
    regionalBrandEvidence: [{
      contentId: number,
      regionStatus,
      regionLevel: level,
      sido,
      sigungu,
      normalizedRegion: [sido, sigungu].filter(Boolean).join(" ") || null,
    }],
  });
  const r = analyzeEntries([{
    status: "ok",
    query: { region: "경상북도 구미시", item: "쌀", classCode: "30" },
    hits: [
      referenced("40-1", "matched", "sigungu", "경상북도", "구미시"),
      referenced("40-2", "matched", "sigungu", "경상북도", "안동시"),
      referenced("40-3", "ambiguous", null, null, null),
      hit("40-4", "미참조상표", "20250101", "등록", "unverified"),
    ],
  }], { asOfYear: 2026 });
  const row = r.regionItems[0];
  assert.deepStrictEqual(row.regionalBrandCounts, {
    inside: 1,
    outside: 1,
    unverified: 1,
    notReferenced: 1,
  });
  assert.strictEqual(row.regionalBrandReferenceHitCount, 3);
  assert.strictEqual(row.regionalBrandVerifiedHitCount, 2);
  assert.strictEqual(row.regionalBrandReferenceRate, 0.75);
  assert.strictEqual(row.regionalBrandInsideShare, 0.5);
  assert.strictEqual(row.localApplicantShare, null, "지역브랜드 연관성을 출원인 주소로 간주하면 안 됨");
  assert.ok(r.warnings.some((warning) => warning.includes("출원인 주소 근거가 아닙니다")));
  ok("출원번호 지역브랜드 연관성은 별도 지표로 집계되고 localApplicantShare를 오염시키지 않음");
}

console.log("6-1) 지역브랜드명은 특산품 집계 차원에서 제외");
{
  const r = analyzeEntries([{
    status: "ok",
    input: {
      sido: "전라남도",
      sigungu: "나주시",
      rawItemName: "배",
      itemName: "상큼愛",
      matchPurpose: "regional_brand_application_join_validation",
    },
    provenance: { matchPurpose: "regional_brand_application_join_validation" },
    query: { region: "전라남도 나주시", item: "상큼愛" },
    hits: [hit("40-9", "상큼愛", "20250101", "등록", "unverified")],
  }], { asOfYear: 2026 });
  assert.strictEqual(r.regionItems.length, 0);
  assert.strictEqual(r.exclusions.validationOnlyExcludedCount, 1);
  assert.ok(r.warnings.some((warning) => warning.includes("출원번호 대조 전용")));
  ok("상표·브랜드명은 개별 검증 근거일 뿐 특산품명이나 집계 키가 아님");
}

console.log("7) 등록원부 출원인 주소·지정상품 근거 집계");
{
  const enrichedHit = (number, applicantRegionMatch, goodsMatchMethod) => ({
    ...hit(number, `등록원부-${number}`, "20250101", "등록", "unverified"),
    ipRegistryStatus: "complete",
    applicantRegionMatch,
    applicantRegionMatchSource: "ip_registry_applicant_address",
    goodsMatchMethod,
    goodsReviewRequired: goodsMatchMethod !== "normalized_exact",
    goodsEvidence: goodsMatchMethod === "normalized_exact"
      ? [{ classCode: "31", designatedProductName: "신선한 사과" }]
      : [],
  });
  const r = analyzeEntries({
    schemaVersion: "1.1",
    ipRegistryEnrichment: {
      enabled: true,
      status: "partial",
      completeRegistrationCount: 2,
      errorRegistrationCount: 0,
      notCollectedRegistrationCount: 1,
      sourceMetadata: { sourceId: "ip_registry", contractVersion: "ip-registry-mark-history-v1" },
      policy: {
        applicantRegionMatchVersion: "ip-registry-applicant-region-v1",
        goodsMatchVersion: "ip-registry-designated-goods-v0-review",
      },
    },
    applicationApplicantEnrichment: {
      enabled: true,
      status: "partial",
      completeApplicationCount: 1,
      errorApplicationCount: 0,
      notCollectedApplicationCount: 2,
      sourceMetadata: {
        sourceId: "kipris_trademark_applicant",
        contractVersion: "kipris-trademark-applicant-address-v1",
      },
      policy: { applicantRegionMatchVersion: "kipris-trademark-applicant-region-v1" },
    },
    results: [{
      status: "ok",
      query: { region: "경상북도 안동시", item: "신선한 사과", classCode: "31" },
      hits: [
        enrichedHit("40-1", "inside", "normalized_exact"),
        enrichedHit("40-2", "outside", "class_only"),
        { ...hit("40-3", "미수집", "20250101", "등록", "unverified"), ipRegistryStatus: "not_collected" },
      ],
    }],
  }, { asOfYear: 2026 });
  const row = r.regionItems[0];
  assert.deepStrictEqual(row.regionCounts, { inside: 1, outside: 1, unverified: 1 });
  assert.strictEqual(row.localApplicantShare, 0.5);
  assert.strictEqual(row.regionVerificationRate, 0.6667);
  assert.strictEqual(row.goodsMatchCounts.normalized_exact, 1);
  assert.strictEqual(row.goodsMatchCounts.class_only, 1);
  assert.strictEqual(row.goodsMatchCounts.unverified, 1);
  assert.strictEqual(row.goodsConfirmedHitCount, 1);
  assert.strictEqual(row.goodsReviewRequiredHitCount, 1);
  assert.strictEqual(row.goodsVerificationRate, 0.6667);
  assert.strictEqual(row.ipRegistryStatusCounts.complete, 2);
  assert.strictEqual(row.ipRegistryStatusCounts.not_collected, 1);
  assert.strictEqual(row.trademarkExamples[0].title, "등록원부-40-1");
  assert.strictEqual(row.trademarkExamples[0].goodsMatchMethod, "normalized_exact");
  assert.strictEqual(row.trademarkExamples[0].goodsEvidence[0].designatedProductName, "신선한 사과");
  assert.ok(r.provenance.sources.some((source) => source.sourceId === "ip_registry"));
  assert.ok(r.provenance.sources.some((source) => source.sourceId === "kipris_trademark_applicant"));
  assert.ok(r.warnings.some((warning) => warning.includes("등록원부 보강이 partial")));
  assert.ok(r.warnings.some((warning) => warning.includes("출원번호 기반 출원인 주소 보강이 partial")));
  assert.strictEqual(
    r.methodology.applicantRegionMetricVersion,
    "kipris-trademark-applicant-region-v1"
  );
  assert.ok(r.warnings.some((warning) => warning.includes("class_only")));
  ok("진짜 출원인 주소와 지정상품 후보를 분리 집계하고 부분 보강 경고를 전파");
}

console.log("7-1) 등록원부 일별 예산 소진·429 재개 시점을 경고로 노출(#52)");
{
  const r = analyzeEntries({
    schemaVersion: "1.1",
    ipRegistryEnrichment: {
      enabled: true,
      status: "partial",
      completeRegistrationCount: 44,
      errorRegistrationCount: 0,
      notCollectedRegistrationCount: 11564,
      rateLimitSkippedRegistrationCount: 56,
      sourceMetadata: { sourceId: "ip_registry", contractVersion: "ip-registry-mark-history-v1" },
      policy: {
        applicantRegionMatchVersion: "ip-registry-applicant-region-v1",
        goodsMatchVersion: "ip-registry-designated-goods-v0-review",
      },
      dailyBudget: {
        limit: 300,
        usedToday: 300,
        remainingToday: 0,
        resumeNotBefore: "2026-08-12T15:00:00.000Z",
        blockedReason: "daily_budget_exhausted",
      },
    },
    results: [],
  }, { asOfYear: 2026 });
  assert.ok(r.warnings.some((warning) => warning.includes("429로 건너뜀 56")));
  assert.ok(
    r.warnings.some(
      (warning) =>
        warning.includes("일일 호출 예산을 모두 사용") && warning.includes("2026-08-12T15:00:00.000Z")
    )
  );
  ok("일별 예산 소진 사유와 재개 가능 시점을 경고 메시지로 노출");
}

console.log("7-2) 등록번호 없는 출원(미등록·심사중)은 지정상품 미평가로 별도 경고(#12)");
{
  const r = analyzeEntries({
    schemaVersion: "1.1",
    ipRegistryEnrichment: {
      enabled: true,
      status: "partial",
      completeRegistrationCount: 1,
      errorRegistrationCount: 0,
      notCollectedRegistrationCount: 0,
      counts: { noRegistrationHitCount: 42 },
      sourceMetadata: { sourceId: "ip_registry", contractVersion: "ip-registry-mark-history-v1" },
      policy: {
        applicantRegionMatchVersion: "ip-registry-applicant-region-v1",
        goodsMatchVersion: "ip-registry-designated-goods-v0-review",
      },
    },
    results: [],
  }, { asOfYear: 2026 });
  assert.ok(
    r.warnings.some(
      (warning) => warning.includes("42개 상표") && warning.includes("등록원부 지정상품 조회 대상이 아닙니다")
    ),
    "등록번호 없는 출원 건수를 지정상품 미평가 경고로 명시해야 함"
  );
  ok("등록번호 없는 출원(미등록·심사중)이 지정상품 근거 없이 매칭됐다는 사실을 명시적으로 경고");
}

console.log("8) 지역브랜드 조인 검증용 자료는 고시명칭 유무와 무관하게 집계 제외");
{
  const brandOnlyEntry = {
    status: "ok",
    query: { region: "경상북도", item: "데일리", classCode: null },
    itemName: "데일리",
    noticeName: null,
    provenance: { matchPurpose: "regional_brand_application_join_validation" },
    hits: [hit("50-1", "데일리", "20250101", "등록", "inside")],
  };
  const normalEntry = {
    status: "ok",
    query: { region: "경상북도 영양군", item: "신선한 사과", classCode: "31" },
    noticeName: "신선한 사과",
    provenance: { matchPurpose: null },
    hits: [hit("50-2", "영양사과", "20250101", "등록", "inside")],
  };

  const withBrandOnly = analyzeEntries([brandOnlyEntry], { asOfYear: 2026 });
  assert.strictEqual(withBrandOnly.regionItems.length, 0);
  assert.strictEqual(withBrandOnly.exclusions.validationOnlyExcludedCount, 1);
  assert.ok(withBrandOnly.warnings.some((warning) => warning.includes("출원번호 대조 전용")));

  const withNormalOnly = analyzeEntries([normalEntry], { asOfYear: 2026 });
  assert.strictEqual(withNormalOnly.regionItems.length, 1);

  const brandOnlyWithNotice = {
    ...brandOnlyEntry,
    noticeName: "신선한 사과",
  };
  const withNoticeFilled = analyzeEntries([brandOnlyWithNotice], { asOfYear: 2026 });
  assert.strictEqual(withNoticeFilled.regionItems.length, 0);
  assert.strictEqual(withNoticeFilled.exclusions.validationOnlyExcludedCount, 1);
  ok("validation_only 자료는 출원번호 evidence에만 쓰고 특산품 통계를 오염시키지 않음");
}

console.log("5-1) 지역 상표 지표는 수집 완료를 기준으로 공개하고 주소 확보율은 참고 지표로 보존");
{
  const r = analyzeEntries([{
    status: "ok",
    collectionStatus: "complete",
    query: { region: "경상북도 안동시", item: "신선한 사과", classCode: "31" },
    hits: [
      hit("R-1", "안동사과", "20250101", "등록", "inside"),
      hit("R-2", "서울사과", "20250102", "등록", "outside"),
    ],
  }], { asOfYear: 2026 });
  const row = r.regionItems[0];
  assert.strictEqual(row.nationwideSearchTrademarkCount, 2);
  assert.strictEqual(row.regionalUniqueTrademarkCount, 1);
  assert.strictEqual(row.regionalMetricAvailability, "available");
  assert.deepStrictEqual(row.regionalMetricBlockingReasons, []);
  assert.strictEqual(row.regionalRegistrationRate, 1);
  ok("전국 검색 후보 2건과 지역 inside 확정 1건을 분리하고 완전 검증 여부를 명시");
}

console.log("9) ②단계 품목 판정 근거(verdictSource)를 지역×품목 행까지 전파(#51)");
{
  const r = analyzeEntries([
    {
      status: "ok",
      query: { region: "경상북도 안동시", item: "신선한 배", classCode: "31" },
      input: {
        sido: "경상북도",
        sigungu: "안동시",
        itemName: "배",
        noticeName: "신선한 배",
        niceClass: "31",
        matchMethod: "rule_fresh",
        confidence: "0.9500",
        verdictSource: "algorithm",
      },
      hits: [],
    },
  ], { asOfYear: 2026 });
  const row = r.regionItems[0];
  assert.strictEqual(row.itemVerdictSource, "algorithm");
  assert.strictEqual(row.itemMatchMethod, "rule_fresh");
  assert.strictEqual(row.itemMatchConfidence, 0.95);
  ok("사람이 개별 승인하지 않은 algorithm 판정을 지역×품목 행 단위까지 보존해 대시보드가 구분 표시 가능");
}

console.log("0) 상표 사례는 최신순을 유지하면서 지정상품 근거를 보존");
{
  const recent = Array.from({ length: 12 }, (_, index) => ({
    title: `최근-${index}`,
    applicationNumber: `R-${index}`,
    applicationDate: `2026${String(12 - index).padStart(2, "0")}01`,
    goodsMatchMethod: "unverified",
    goodsEvidence: [],
  }));
  const exact = {
    title: "과거 지정상품 확정",
    applicationNumber: "E-1",
    applicationDate: "20100101",
    goodsMatchMethod: "normalized_exact",
    goodsEvidence: [{ classCode: "31", designatedProductName: "신선한 사과" }],
  };
  const selected = selectTrademarkExamples([...recent, exact], 10);
  assert.strictEqual(selected.length, 10);
  assert.ok(selected.some((row) => row.applicationNumber === "E-1"));
  ok("최근 사례가 10건을 넘더라도 지정상품 확정 근거 최소 1건은 사례 목록에 포함");
}

console.log("9-1) 과거 지역 등록 사례를 최신 출원보다 우선 보존");
{
  const recent = Array.from({ length: 12 }, (_, index) => ({
    title: `최신-출원-${index}`,
    applicationNumber: `P-${index}`,
    applicationDate: `2026${String(12 - index).padStart(2, "0")}01`,
    applicationStatus: "출원",
    statusCategory: "pending",
    applicantRegionMatch: "inside",
    goodsMatchMethod: "unverified",
    goodsEvidence: [],
  }));
  const oldRegistered = {
    title: "과거-지역-등록",
    applicationNumber: "REG-OLD-1",
    applicationDate: "20150101",
    applicationStatus: "등록",
    statusCategory: "registered",
    applicantRegionMatch: "inside",
    goodsMatchMethod: "unverified",
    goodsEvidence: [],
  };
  const selected = selectTrademarkExamples([...recent, oldRegistered], 10);
  assert.strictEqual(selected.length, 10);
  assert.ok(selected.some((row) => row.applicationNumber === "REG-OLD-1"));
  ok("최신 출원 10건이 있어도 과거 지역 등록 사례를 보존");
}

console.log("10) 원물명 지정상품 검토 결과를 ④ 분석에 결정론적으로 재적용");
{
  const analysis = analyzeEntries([
    {
      status: "ok",
      collectionStatus: "complete",
      query: { region: "경기도 남양주시", item: "깻잎", classCode: "" },
      input: { sido: "경기도", sigungu: "남양주시", itemName: "깻잎" },
      hits: [],
    },
    {
      status: "ok",
      collectionStatus: "complete",
      query: { region: "경기도 > 남양주시", item: "딸기", classCode: "" },
      input: { sido: "경기도", sigungu: "경기도 > 남양주시", itemName: "딸기" },
      hits: [],
    },
  ], { asOfYear: 2026, maxRecentBrands: 10 });
  const review = [{
    sido: "",
    sigungu: "경기도 > 남양주시",
    itemName: "깻잎",
    uniqueTrademarkCount: 2,
    registeredTrademarkCount: 1,
    apps: [
      {
        title: "남양주 깻잎",
        applicationNumber: "40-2025-1",
        applicationDate: "20250101",
        applicationStatus: "출원",
        goodsMatchMethod: "normalized_exact",
        designatedProducts: [{ classCode: "31", designatedProductName: "깻잎" }],
      },
      {
        title: "남양주 채소",
        applicationNumber: "40-2024-2",
        applicationDate: "20240101",
        applicationStatus: "등록",
        goodsMatchMethod: "normalized_contains",
        designatedProducts: [{ classCode: "31", designatedProductName: "신선한 깻잎" }],
      },
    ],
  }];
  applyRawGoodsReview(analysis, review);
  const row = analysis.regionItems.find((candidate) => candidate.itemName === "깻잎");
  assert.strictEqual(row.matchingBasis, "raw_item_goods_matched");
  assert.strictEqual(row.regionalUniqueTrademarkCount, 2);
  assert.strictEqual(row.regionalStatusCounts.registered, 1);
  assert.strictEqual(row.regionalRegistrationRate, 0.5);
  assert.strictEqual(row.goodsConfirmedHitCount, 1, "exact는 자동 일치로 유지");
  assert.strictEqual(row.goodsReviewRequiredHitCount, 1, "contains는 검토 후보로 유지");
  assert.strictEqual(row.trademarkExamples[0].goodsEvidence.length, 1);
  assert.strictEqual(analysis.regions[0].regionalUniqueTrademarkCount, 2);
  assert.strictEqual(analysis.summary.regionalUniqueTrademarkCount, 2);
  assert.strictEqual(
    analysis.regionItems.find((candidate) => candidate.itemName === "딸기").region,
    "경기도 남양주시",
    "검토 대상이 아닌 같은 지역 행도 복합 지역명을 정규화"
  );
  assert.strictEqual(analysis.rawGoodsReview.appliedRowCount, 1);
  applyRawGoodsReview(analysis, review);
  assert.strictEqual(
    analysis.regionItems.find((candidate) => candidate.itemName === "깻잎").sourceProvenance.filter(
      (source) => source.sourceId === "raw_item_goods_review"
    ).length,
    1,
    "같은 검토본 재적용은 provenance를 중복시키지 않음"
  );
  assert.throws(
    () => applyRawGoodsReview(analysis, [{ ...review[0], itemName: "없는 품목" }]),
    /일치하는 ④ 지역×품목이 없습니다/
  );
  ok("복합 지역명 보정, 건수·등록률·exact/contains·근거·상위 집계를 함께 재현");
}

console.log("\n모든 자체 테스트 통과");
