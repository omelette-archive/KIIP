"use strict";

const INACTIVE_STATUS_WORDS = ["거절", "취하", "포기", "소멸", "무효", "취소"];
const PENDING_STATUS_WORDS = ["출원", "심사", "공고"];
const ANALYSIS_VERSION = "brand-analysis-v4-regional-metric-gate";

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function applicationYear(value) {
  const match = clean(value).match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1800 && year <= 2200 ? year : null;
}

function statusCategory(value) {
  const status = clean(value);
  if (INACTIVE_STATUS_WORDS.some((word) => status.includes(word))) return "inactive";
  if (status.includes("등록")) return "registered";
  if (PENDING_STATUS_WORDS.some((word) => status.includes(word))) return "pending";
  return "unknown";
}

function regionCategory(hit) {
  const raw = hit.applicantRegionMatch ?? hit.regionMatch;
  if (raw === true) return "inside";
  if (raw === false) return "outside";
  const value = clean(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (["inside", "in_region", "matched", "local"].includes(value)) return "inside";
  if (["outside", "out_of_region", "not_matched", "nonlocal"].includes(value)) return "outside";
  return "unverified";
}

function regionalBrandCategory(hit, bucket) {
  if (!bucket.sido || !hit.regionalBrandMatchSource) return null;
  const evidence = Array.isArray(hit.regionalBrandEvidence) ? hit.regionalBrandEvidence : [];
  if (evidence.length === 0) return "unverified";
  const values = evidence.map((row) => {
    if (clean(row.regionStatus) !== "matched" || !clean(row.sido)) return "unverified";
    if (clean(row.sido) !== clean(bucket.sido)) return "outside";
    if (clean(row.regionLevel) === "sigungu" && clean(bucket.sigungu)) {
      return clean(row.sigungu) === clean(bucket.sigungu) ? "inside" : "outside";
    }
    return "inside";
  });
  return new Set(values).size === 1 ? values[0] : "unverified";
}

function goodsMatchCategory(hit) {
  const value = clean(hit.goodsMatchMethod).toLowerCase();
  return ["normalized_exact", "normalized_contains", "class_only", "mismatch", "unverified"].includes(value)
    ? value
    : "unverified";
}

function ipRegistryStatusCategory(hit) {
  const value = clean(hit.ipRegistryStatus).toLowerCase();
  return ["complete", "not_applicable", "not_collected", "not_found", "error"].includes(value)
    ? value
    : "unknown";
}

function trademarkKey(hit) {
  const applicationNumber = clean(hit.applicationNumber);
  if (applicationNumber) return `app:${applicationNumber.replace(/\s/g, "")}`;
  const registrationNumber = clean(hit.registrationNumber);
  if (registrationNumber) return `reg:${registrationNumber.replace(/\s/g, "")}`;
  return `fallback:${[
    clean(hit.title),
    clean(hit.applicant),
    clean(hit.applicationDate),
    clean(hit.classificationCode),
  ].join("|")}`;
}

function selectTrademarkExamples(examples, limit) {
  const max = Math.max(0, Number(limit) || 0);
  if (max === 0) return [];
  const recent = [...examples].sort(
    (a, b) =>
      clean(b.applicationDate).localeCompare(clean(a.applicationDate)) ||
      clean(a.title).localeCompare(clean(b.title), "ko")
  );
  const evidenceRank = {
    normalized_exact: 0,
    normalized_contains: 1,
    class_only: 2,
    mismatch: 3,
  };
  const evidence = recent
    .filter(
      (row) =>
        evidenceRank[row.goodsMatchMethod] !== undefined ||
        (Array.isArray(row.goodsEvidence) && row.goodsEvidence.length > 0)
    )
    .sort(
      (a, b) =>
        (evidenceRank[a.goodsMatchMethod] ?? 9) - (evidenceRank[b.goodsMatchMethod] ?? 9) ||
        clean(b.applicationDate).localeCompare(clean(a.applicationDate))
    );
  const selected = [];
  const seen = new Set();
  const add = (row) => {
    const key = clean(row.applicationNumber) || `${clean(row.title)}\u001f${clean(row.applicationDate)}`;
    if (!seen.has(key) && selected.length < max) {
      seen.add(key);
      selected.push(row);
    }
  };
  for (const row of evidence.slice(0, Math.min(3, max))) add(row);
  for (const row of recent) add(row);
  return selected.sort(
    (a, b) =>
      clean(b.applicationDate).localeCompare(clean(a.applicationDate)) ||
      clean(a.title).localeCompare(clean(b.title), "ko")
  );
}

function normalizeInput(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && typeof parsed === "object") return [parsed];
  throw new Error("입력 JSON은 03단계 결과 객체, 결과 배열, 또는 { results: [] } 형태여야 합니다.");
}

// ③단계 배치 출력의 status=skipped 행은 query가 없고, ②단계 원본 행이 input에 그대로
// 담겨 있다(sido/sigungu/itemName/noticeName/niceClass 등). 여기서 안 읽으면 지역·품목
// 정보가 있는데도 "미지정 지역 × 미지정 품목"이라는 가짜 버킷이 생긴다.
function entryDimensions(entry) {
  const query = entry.query || {};
  const input = entry.input || {};
  const queryRegion = clean(query.region);
  const regionParts = queryRegion.split(/\s+/).filter(Boolean);
  const sido = clean(entry.sido) || clean(input.sido) || regionParts[0] || "";
  const sigungu = clean(entry.sigungu) || clean(input.sigungu) || regionParts.slice(1).join(" ");
  const region =
    queryRegion || [sido, sigungu].filter(Boolean).join(" ") || "미지정 지역";
  const noticeName =
    clean(entry.noticeName) ||
    clean(input.noticeName) ||
    clean(query.item) ||
    clean(query.searchString) ||
    null;
  const itemName =
    clean(input.itemName) ||
    clean(entry.itemName) ||
    noticeName ||
    clean(input.rawItemName) ||
    "미지정 품목";
  return {
    sido,
    sigungu,
    region,
    itemName,
    noticeName,
    niceClass: clean(entry.niceClass) || clean(query.classCode) || clean(input.niceClass) || null,
  };
}

function matchPurpose(entry) {
  return clean(entry.provenance?.matchPurpose) || clean(entry.input?.matchPurpose);
}

// ③단계 신 계약은 전체 건수를 keywordTotalCount로 준다(구 계약/다른 소스 대비 totalCount·
// returnedCount도 대비용으로 허용).
function entryTotalCount(entry) {
  const raw = entry.keywordTotalCount ?? entry.totalCount ?? entry.returnedCount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// ①단계 수집 출처(지리적표시/농사로/샘플 등). ok/error 행은 entry.source, skipped 행은
// entry.input.source에 들어있다 — ⑤단계가 "대표 특산품"(예: 지리적표시 등록 여부) 신호로
// 쓴다.
function entrySource(entry) {
  const input = entry.input || {};
  return clean(entry.source) || clean(input.source);
}

function entryProvenance(entry) {
  if (entry.provenance && typeof entry.provenance === "object") return entry.provenance;
  const input = entry.input || {};
  const sourceLabel = entrySource(entry);
  return sourceLabel ? { sourceLabel, sourceId: input.sourceId || null } : null;
}

function createBucket(dimensions) {
  return {
    ...dimensions,
    queryCount: 0,
    successfulQueryCount: 0,
    partialQueryCount: 0,
    erroredQueryCount: 0,
    skippedQueryCount: 0,
    sourceTotalCount: 0,
    returnedHitCount: 0,
    hits: new Map(),
    sources: new Set(),
    sourceProvenance: new Map(),
  };
}

// status가 없는 입력(구 형식/다른 소스 대비)은 error 필드 유무로 추정한다.
function entryStatus(entry) {
  return clean(entry.status) || (entry.error ? "error" : "ok");
}

function addEntry(bucket, entry) {
  bucket.queryCount++;
  const source = entrySource(entry);
  if (source) bucket.sources.add(source);
  const provenance = entryProvenance(entry);
  if (provenance) {
    const provenanceKey = JSON.stringify([
      provenance.sourceId || null,
      provenance.sourceLabel || null,
      provenance.sourceContractVersion || null,
      provenance.sourceFetchedAt || null,
      provenance.sourceContentId || null,
    ]);
    bucket.sourceProvenance.set(provenanceKey, provenance);
  }
  const status = entryStatus(entry);
  // ②단계에서 검토대기·제외로 걸러진 행(status=skipped, dry-run의 planned)은 상표 검색
  // 자체가 안 일어난 것이라, 성공/오류 어느 쪽에도 넣지 않고 별도로만 센다.
  if (status === "skipped" || status === "planned") {
    bucket.skippedQueryCount++;
    return;
  }
  if (status === "error") {
    bucket.erroredQueryCount++;
    return;
  }
  bucket.successfulQueryCount++;
  if (clean(entry.collectionStatus) === "partial") bucket.partialQueryCount++;
  bucket.sourceTotalCount += entryTotalCount(entry);
  const hits = Array.isArray(entry.hits) ? entry.hits : [];
  bucket.returnedHitCount += hits.length;
  for (const hit of hits) {
    const key = trademarkKey(hit);
    if (!bucket.hits.has(key)) bucket.hits.set(key, hit);
  }
}

function mergeBucket(target, source) {
  target.queryCount += source.queryCount;
  target.successfulQueryCount += source.successfulQueryCount;
  target.partialQueryCount += source.partialQueryCount;
  target.erroredQueryCount += source.erroredQueryCount;
  target.skippedQueryCount += source.skippedQueryCount;
  target.sourceTotalCount += source.sourceTotalCount;
  target.returnedHitCount += source.returnedHitCount;
  for (const [key, hit] of source.hits) {
    if (!target.hits.has(key)) target.hits.set(key, hit);
  }
  for (const s of source.sources) target.sources.add(s);
  for (const [key, provenance] of source.sourceProvenance) {
    if (!target.sourceProvenance.has(key)) target.sourceProvenance.set(key, provenance);
  }
}

function trendOf(recent, previous) {
  if (recent === 0 && previous === 0) return "no_activity";
  if (recent > 0 && previous === 0) return "new";
  if (recent > previous) return "increase";
  if (recent < previous) return "decrease";
  return "flat";
}

function finalizeBucket(bucket, options) {
  const statusCounts = { registered: 0, pending: 0, inactive: 0, unknown: 0 };
  const regionalStatusCounts = { registered: 0, pending: 0, inactive: 0, unknown: 0 };
  const regionCounts = { inside: 0, outside: 0, unverified: 0 };
  const regionalBrandCounts = bucket.sido
    ? { inside: 0, outside: 0, unverified: 0, notReferenced: 0 }
    : null;
  const goodsMatchCounts = {
    normalized_exact: 0,
    normalized_contains: 0,
    class_only: 0,
    mismatch: 0,
    unverified: 0,
  };
  const ipRegistryStatusCounts = {
    complete: 0,
    not_applicable: 0,
    not_collected: 0,
    not_found: 0,
    error: 0,
    unknown: 0,
  };
  const yearCounts = new Map();
  let invalidApplicationDateCount = 0;
  const recentBrands = [];
  const trademarkExamples = [];

  const recentEnd = options.asOfYear - 1;
  const recentStart = recentEnd - options.recentYears + 1;
  const previousEnd = recentStart - 1;
  const previousStart = previousEnd - options.recentYears + 1;

  for (const hit of bucket.hits.values()) {
    const status = statusCategory(hit.applicationStatus);
    const applicantRegion = regionCategory(hit);
    statusCounts[status]++;
    regionCounts[applicantRegion]++;
    if (applicantRegion === "inside") regionalStatusCounts[status]++;
    if (regionalBrandCounts) {
      const category = regionalBrandCategory(hit, bucket);
      if (category === null) regionalBrandCounts.notReferenced++;
      else regionalBrandCounts[category]++;
    }
    goodsMatchCounts[goodsMatchCategory(hit)]++;
    ipRegistryStatusCounts[ipRegistryStatusCategory(hit)]++;
    trademarkExamples.push({
      title: clean(hit.title) || null,
      applicationNumber: clean(hit.applicationNumber) || null,
      applicationDate: clean(hit.applicationDate) || null,
      applicant: clean(hit.applicant) || null,
      applicationStatus: clean(hit.applicationStatus) || null,
      goodsMatchMethod: clean(hit.goodsMatchMethod) || "unverified",
      goodsReviewRequired: Boolean(hit.goodsReviewRequired),
      goodsEvidence: Array.isArray(hit.goodsEvidence) ? hit.goodsEvidence.slice(0, 3) : [],
    });
    const year = applicationYear(hit.applicationDate);
    if (year === null) {
      invalidApplicationDateCount++;
    } else {
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      if (year >= recentStart && year <= recentEnd) {
        recentBrands.push({
          title: clean(hit.title) || null,
          applicationNumber: clean(hit.applicationNumber) || null,
          applicationDate: clean(hit.applicationDate) || null,
          applicant: clean(hit.applicant) || null,
          applicationStatus: clean(hit.applicationStatus) || null,
        });
      }
    }
  }

  const countRange = (start, end) => {
    let total = 0;
    for (let year = start; year <= end; year++) total += yearCounts.get(year) || 0;
    return total;
  };
  const recentApplicationCount = countRange(recentStart, recentEnd);
  const previousApplicationCount = countRange(previousStart, previousEnd);
  const regionVerifiedHitCount = regionCounts.inside + regionCounts.outside;
  const regionalBrandReferenceHitCount = regionalBrandCounts
    ? regionalBrandCounts.inside + regionalBrandCounts.outside + regionalBrandCounts.unverified
    : 0;
  const regionalBrandVerifiedHitCount = regionalBrandCounts
    ? regionalBrandCounts.inside + regionalBrandCounts.outside
    : 0;
  const uniqueTrademarkCount = bucket.hits.size;
  const isRegionalBucket = Boolean(clean(bucket.region));
  const regionalUniqueTrademarkCount = isRegionalBucket ? regionCounts.inside : null;
  // threshold=1(기본)은 기존 all-or-nothing 게이트와 동일하다. 1 미만은 명시적으로 요청한
  // 알파/미리보기 실행에서만 쓰고, 그 결과에는 항상 completenessThreshold를 남겨 완화된
  // 기준으로 나왔다는 걸 구분할 수 있게 한다.
  const regionalCollectionRate =
    bucket.queryCount > 0
      ? (bucket.successfulQueryCount - bucket.partialQueryCount) / bucket.queryCount
      : 0;
  const regionalCollectionComplete =
    isRegionalBucket &&
    bucket.successfulQueryCount > 0 &&
    bucket.erroredQueryCount === 0 &&
    bucket.skippedQueryCount === 0 &&
    regionalCollectionRate >= options.regionalCoverageThreshold;
  const regionalAddressVerificationComplete =
    isRegionalBucket &&
    (uniqueTrademarkCount === 0 ||
      regionVerifiedHitCount / uniqueTrademarkCount >= options.regionalCoverageThreshold);
  const regionalMetricBlockingReasons = [];
  if (isRegionalBucket && !regionalCollectionComplete) {
    regionalMetricBlockingReasons.push("collection_incomplete");
  }
  if (isRegionalBucket && !regionalAddressVerificationComplete) {
    regionalMetricBlockingReasons.push("applicant_address_unverified");
  }
  const regionalMetricAvailability = !isRegionalBucket
    ? null
    : regionalMetricBlockingReasons.length === 0
      ? "available"
      : "blocked";
  const goodsConfirmedHitCount = goodsMatchCounts.normalized_exact;
  const goodsReviewRequiredHitCount =
    goodsMatchCounts.normalized_contains + goodsMatchCounts.class_only;
  const goodsEvaluatedHitCount =
    goodsConfirmedHitCount + goodsReviewRequiredHitCount + goodsMatchCounts.mismatch;
  const applicationYearCounts = {};
  for (const year of [...yearCounts.keys()].sort((a, b) => a - b)) {
    applicationYearCounts[String(year)] = yearCounts.get(year);
  }
  recentBrands.sort((a, b) => clean(b.applicationDate).localeCompare(clean(a.applicationDate)));

  const result = {};
  for (const [key, value] of Object.entries(bucket)) {
    if (key !== "hits" && key !== "sources" && key !== "sourceProvenance") result[key] = value;
  }
  return {
    ...result,
    sources: [...bucket.sources].sort(),
    sourceProvenance: [...bucket.sourceProvenance.values()],
    uniqueTrademarkCount,
    nationwideSearchTrademarkCount: uniqueTrademarkCount,
    duplicateHitCount: Math.max(0, bucket.returnedHitCount - uniqueTrademarkCount),
    statusCounts,
    registrationRate: safeRate(statusCounts.registered, uniqueTrademarkCount),
    regionalUniqueTrademarkCount,
    regionalStatusCounts: isRegionalBucket ? regionalStatusCounts : null,
    regionalRegistrationRate: isRegionalBucket
      ? safeRate(regionalStatusCounts.registered, regionalUniqueTrademarkCount)
      : null,
    regionalMetricAvailability,
    regionalMetricBlockingReasons,
    applicationYearCounts,
    recentPeriod: { startYear: recentStart, endYear: recentEnd, count: recentApplicationCount },
    previousPeriod: { startYear: previousStart, endYear: previousEnd, count: previousApplicationCount },
    recentChange: recentApplicationCount - previousApplicationCount,
    recentChangeRate:
      previousApplicationCount > 0
        ? Number(((recentApplicationCount - previousApplicationCount) / previousApplicationCount).toFixed(4))
        : null,
    recentTrend: trendOf(recentApplicationCount, previousApplicationCount),
    recentBrands: recentBrands.slice(0, options.maxRecentBrands),
    trademarkExamples: selectTrademarkExamples(trademarkExamples, options.maxRecentBrands),
    regionCounts,
    regionVerifiedHitCount,
    regionVerificationRate: safeRate(regionVerifiedHitCount, uniqueTrademarkCount),
    localApplicantShare: safeRate(regionCounts.inside, regionVerifiedHitCount),
    regionalBrandCounts,
    regionalBrandReferenceHitCount: regionalBrandCounts ? regionalBrandReferenceHitCount : null,
    regionalBrandVerifiedHitCount: regionalBrandCounts ? regionalBrandVerifiedHitCount : null,
    regionalBrandReferenceRate: regionalBrandCounts
      ? safeRate(regionalBrandReferenceHitCount, uniqueTrademarkCount)
      : null,
    regionalBrandInsideShare: regionalBrandCounts
      ? safeRate(regionalBrandCounts.inside, regionalBrandVerifiedHitCount)
      : null,
    goodsMatchCounts,
    goodsConfirmedHitCount,
    goodsReviewRequiredHitCount,
    goodsMismatchHitCount: goodsMatchCounts.mismatch,
    goodsVerificationRate: safeRate(goodsEvaluatedHitCount, uniqueTrademarkCount),
    ipRegistryStatusCounts,
    invalidApplicationDateCount,
  };
}

function sortAggregates(rows) {
  return rows.sort(
    (a, b) =>
      b.uniqueTrademarkCount - a.uniqueTrademarkCount ||
      clean(a.region).localeCompare(clean(b.region), "ko") ||
      clean(a.itemName).localeCompare(clean(b.itemName), "ko")
  );
}

function analyzeEntries(parsed, providedOptions = {}) {
  const asOfYear = Number(providedOptions.asOfYear ?? new Date().getUTCFullYear());
  const recentYears = Number(providedOptions.recentYears ?? 3);
  const maxRecentBrands = Number(providedOptions.maxRecentBrands ?? 10);
  const regionalCoverageThreshold = Number(providedOptions.regionalCoverageThreshold ?? 1);
  if (!Number.isInteger(asOfYear) || asOfYear < 1801 || asOfYear > 2200) {
    throw new Error("asOfYear는 1801~2200 범위의 정수여야 합니다.");
  }
  if (!Number.isInteger(recentYears) || recentYears < 1 || recentYears > 20) {
    throw new Error("recentYears는 1~20 범위의 정수여야 합니다.");
  }
  if (!Number.isInteger(maxRecentBrands) || maxRecentBrands < 1 || maxRecentBrands > 100) {
    throw new Error("maxRecentBrands는 1~100 범위의 정수여야 합니다.");
  }
  if (
    !Number.isFinite(regionalCoverageThreshold) ||
    regionalCoverageThreshold < 0 ||
    regionalCoverageThreshold > 1
  ) {
    throw new Error("regionalCoverageThreshold는 0~1 범위의 숫자여야 합니다.");
  }
  const options = { asOfYear, recentYears, maxRecentBrands, regionalCoverageThreshold };
  const inputDocument = parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : null;
  const entries = normalizeInput(parsed);
  const regionItemBuckets = new Map();
  const unresolvedBucket = createBucket({});
  let validationOnlyExcludedCount = 0;
  let unresolvedNoticeNameCount = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (matchPurpose(entry) === "regional_brand_application_join_validation") {
      validationOnlyExcludedCount++;
      continue;
    }
    const dimensions = entryDimensions(entry);
    if (!dimensions.noticeName) {
      unresolvedNoticeNameCount++;
      addEntry(unresolvedBucket, entry);
      continue;
    }
    const key = [dimensions.region, dimensions.noticeName, dimensions.niceClass || ""].join("\u001f");
    if (!regionItemBuckets.has(key)) regionItemBuckets.set(key, createBucket(dimensions));
    addEntry(regionItemBuckets.get(key), entry);
  }

  const combinedBucket = (key, dimensions, source) => {
    if (!key.has(dimensions.groupKey)) key.set(dimensions.groupKey, createBucket(dimensions.value));
    mergeBucket(key.get(dimensions.groupKey), source);
  };
  const regionBuckets = new Map();
  const itemBuckets = new Map();
  const summaryBucket = createBucket({});
  for (const bucket of regionItemBuckets.values()) {
    combinedBucket(regionBuckets, {
      groupKey: bucket.region,
      value: { sido: bucket.sido, sigungu: bucket.sigungu, region: bucket.region },
    }, bucket);
    combinedBucket(itemBuckets, {
      groupKey: `${bucket.noticeName}\u001f${bucket.niceClass || ""}`,
      value: { itemName: bucket.itemName, noticeName: bucket.noticeName, niceClass: bucket.niceClass },
    }, bucket);
    mergeBucket(summaryBucket, bucket);
  }
  mergeBucket(summaryBucket, unresolvedBucket);

  const finalizeAll = (buckets) => sortAggregates([...buckets.values()].map((b) => finalizeBucket(b, options)));
  const summary = finalizeBucket(summaryBucket, options);
  const regionItems = finalizeAll(regionItemBuckets);
  const regions = finalizeAll(regionBuckets);
  const items = finalizeAll(itemBuckets);
  const warnings = [];
  if (validationOnlyExcludedCount > 0) {
    warnings.push(
      `${validationOnlyExcludedCount}개 농사로 지역브랜드 검증 행은 출원번호 대조 전용이므로 특산품 집계에서 제외했습니다.`
    );
  }
  if (unresolvedNoticeNameCount > 0) {
    warnings.push(
      `${unresolvedNoticeNameCount}개 행은 ② 고시명칭이 확정되지 않아 지역×특산품 집계에서 제외했습니다.`
    );
  }
  if (summary.erroredQueryCount > 0) {
    warnings.push(`${summary.erroredQueryCount}개 검색이 오류여서 집계에서 제외되었습니다.`);
  }
  if (summary.partialQueryCount > 0) {
    warnings.push(
      `${summary.partialQueryCount}개 검색은 03단계 페이지·hit·요청 상한에 도달한 부분 수집입니다. 저장된 hits는 집계에 포함했지만 완전한 모집단으로 해석하면 안 됩니다.`
    );
  }
  if (summary.skippedQueryCount > 0) {
    warnings.push(
      `${summary.skippedQueryCount}개 행이 ②단계에서 검토대기·제외 처리되어 상표 검색 자체가 건너뛰어졌습니다(집계에서 제외).`
    );
  }
  if (summary.regionVerificationRate !== 1 && summary.uniqueTrademarkCount > 0) {
    warnings.push(
      "출원인 주소 기반 지역 매칭이 끝나지 않은 상표가 있어 지역별 상표 건수·등록률·공백 점수를 차단했습니다. uniqueTrademarkCount는 전국 검색 참고값이며 지역 지표에는 사용하지 않습니다."
    );
  }
  if (regionItems.some((row) => row.regionalBrandReferenceHitCount > 0)) {
    warnings.push(
      "농사로 지역브랜드 출원번호 조인은 등록된 지역브랜드 연관성 검증 신호이며 출원인 주소 근거가 아닙니다. localApplicantShare에는 포함하지 않았습니다."
    );
  }
  if (inputDocument?.ipRegistryEnrichment?.enabled) {
    const registry = inputDocument.ipRegistryEnrichment;
    if (registry.status !== "complete") {
      warnings.push(
        `등록원부 보강이 ${registry.status} 상태입니다(완료 ${registry.completeRegistrationCount || 0}, ` +
          `오류 ${registry.errorRegistrationCount || 0}, 미수집 ${registry.notCollectedRegistrationCount || 0}).`
      );
    }
    if (summary.goodsReviewRequiredHitCount > 0) {
      warnings.push(
        `${summary.goodsReviewRequiredHitCount}개 상표는 지정상품 normalized_contains/class_only 검토 후보이며 #12 기준 확정 전 확정 매칭으로 해석하면 안 됩니다.`
      );
    }
  }
  if (inputDocument?.applicationApplicantEnrichment?.enabled) {
    const applicants = inputDocument.applicationApplicantEnrichment;
    if (applicants.status !== "complete") {
      warnings.push(
        `출원번호 기반 출원인 주소 보강이 ${applicants.status} 상태입니다(완료 ${applicants.completeApplicationCount || 0}, ` +
          `오류 ${applicants.errorApplicationCount || 0}, 미수집 ${applicants.notCollectedApplicationCount || 0}).`
      );
    }
  }
  warnings.push("건수는 03단계가 저장한 hits 기준입니다. KIPRIS 전체 검색 건수(totalCount)와 같지 않을 수 있습니다.");
  if (regionalCoverageThreshold < 1) {
    warnings.push(
      `regionalCoverageThreshold=${regionalCoverageThreshold}로 완화된 알파 실행입니다 — 수집·주소 검증이 ` +
        `100% 미만이어도 지역 지표를 노출합니다. 배포용 공식 수치가 아니라 알파 미리보기로만 사용하세요.`
    );
  }

  return {
    schemaVersion: "1.4",
    analysisVersion: ANALYSIS_VERSION,
    generatedAt: new Date().toISOString(),
    provenance: {
      inputSchemaVersion: inputDocument?.schemaVersion || null,
      inputCompletedAt: inputDocument?.completedAt || null,
      sources: [
        inputDocument?.trademarkSourceMetadata,
        inputDocument?.regionalBrandValidation?.enabled
          ? inputDocument.regionalBrandValidation.sourceMetadata
          : null,
        inputDocument?.ipRegistryEnrichment?.enabled
          ? inputDocument.ipRegistryEnrichment.sourceMetadata
          : null,
        inputDocument?.applicationApplicantEnrichment?.enabled
          ? inputDocument.applicationApplicantEnrichment.sourceMetadata
          : null,
      ].filter(Boolean),
    },
    methodology: {
      analysisUnit: "지역 × ② 표준 특산품명(표시) × 고시상품명칭·NICE류(집계 키)",
      trademarkTitlePolicy: "상표명은 개별 hit 근거로만 보존하며 품목명·집계 키로 사용하지 않음",
      regionalBrandValidationPolicy: "농사로 areaBrandLst는 출원번호 검증 전용이며 특산품 마스터·집계 입력에서 제외",
      trademarkCountBasis:
        "uniqueTrademarkCount는 03단계 전국 검색 hit 참고값; 지역 지표는 출원인 주소 inside로 검증된 regionalUniqueTrademarkCount만 사용",
      partialCollectionPolicy: "partial hit도 포함하되 경고와 partialQueryCount를 함께 제공",
      applicantRegionMetric:
        "출원인 주소 근거만 지역 건수·등록률·localApplicantShare에 사용하며, 수집 또는 주소 검증이 불완전하면 regionalMetricAvailability=blocked",
      regionalBrandMetric: "농사로 지역브랜드 출원번호 연관성은 별도 regionalBrand* 지표로 집계",
      applicantRegionMetricVersion:
        inputDocument?.applicationApplicantEnrichment?.policy?.applicantRegionMatchVersion ||
        inputDocument?.ipRegistryEnrichment?.policy?.applicantRegionMatchVersion ||
        null,
      applicantRegionMetricVersions: [
        inputDocument?.ipRegistryEnrichment?.policy?.applicantRegionMatchVersion,
        inputDocument?.applicationApplicantEnrichment?.policy?.applicantRegionMatchVersion,
      ].filter(Boolean),
      designatedGoodsPolicy:
        "normalized_exact만 확정 근거, normalized_contains/class_only는 검토 후보; #12 기준 확정 전 고유 상표 합계에서 자동 제외하지 않음",
      designatedGoodsMatchVersion:
        inputDocument?.ipRegistryEnrichment?.policy?.goodsMatchVersion || null,
      currentYearPolicy: "진행 중인 현재 연도는 최근/직전 기간 비교에서 제외",
      lastUpdatedAt: "2026-08-11",
    },
    parameters: {
      asOfYear,
      recentYears,
      recentPeriodExcludesCurrentYear: true,
      maxRecentBrands,
      regionalCoverageThreshold,
    },
    exclusions: {
      validationOnlyExcludedCount,
      unresolvedNoticeNameCount,
    },
    warnings,
    summary,
    regionItems,
    regions,
    items,
  };
}

module.exports = {
  ANALYSIS_VERSION,
  analyzeEntries,
  applicationYear,
  goodsMatchCategory,
  ipRegistryStatusCategory,
  normalizeInput,
  regionalBrandCategory,
  regionCategory,
  selectTrademarkExamples,
  statusCategory,
  trademarkKey,
};
