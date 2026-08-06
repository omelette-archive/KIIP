"use strict";

const INACTIVE_STATUS_WORDS = ["거절", "취하", "포기", "소멸", "무효", "취소"];
const PENDING_STATUS_WORDS = ["출원", "심사", "공고"];

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
  const sido = clean(entry.sido) || clean(input.sido);
  const sigungu = clean(entry.sigungu) || clean(input.sigungu);
  const region =
    clean(query.region) || [sido, sigungu].filter(Boolean).join(" ") || "미지정 지역";
  const itemName =
    clean(entry.itemName) ||
    clean(query.item) ||
    clean(query.searchString) ||
    clean(input.noticeName) ||
    clean(input.itemName) ||
    clean(input.rawItemName) ||
    "미지정 품목";
  return {
    sido,
    sigungu,
    region,
    itemName,
    noticeName: clean(entry.noticeName) || clean(input.noticeName) || null,
    niceClass: clean(entry.niceClass) || clean(query.classCode) || clean(input.niceClass) || null,
  };
}

// ③단계 신 계약은 전체 건수를 keywordTotalCount로 준다(구 계약/다른 소스 대비 totalCount·
// returnedCount도 대비용으로 허용).
function entryTotalCount(entry) {
  const raw = entry.keywordTotalCount ?? entry.totalCount ?? entry.returnedCount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function createBucket(dimensions) {
  return {
    ...dimensions,
    queryCount: 0,
    successfulQueryCount: 0,
    erroredQueryCount: 0,
    skippedQueryCount: 0,
    sourceTotalCount: 0,
    returnedHitCount: 0,
    hits: new Map(),
  };
}

// status가 없는 입력(구 형식/다른 소스 대비)은 error 필드 유무로 추정한다.
function entryStatus(entry) {
  return clean(entry.status) || (entry.error ? "error" : "ok");
}

function addEntry(bucket, entry) {
  bucket.queryCount++;
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
  target.erroredQueryCount += source.erroredQueryCount;
  target.skippedQueryCount += source.skippedQueryCount;
  target.sourceTotalCount += source.sourceTotalCount;
  target.returnedHitCount += source.returnedHitCount;
  for (const [key, hit] of source.hits) {
    if (!target.hits.has(key)) target.hits.set(key, hit);
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
  const regionCounts = { inside: 0, outside: 0, unverified: 0 };
  const yearCounts = new Map();
  let invalidApplicationDateCount = 0;
  const recentBrands = [];

  const recentEnd = options.asOfYear - 1;
  const recentStart = recentEnd - options.recentYears + 1;
  const previousEnd = recentStart - 1;
  const previousStart = previousEnd - options.recentYears + 1;

  for (const hit of bucket.hits.values()) {
    statusCounts[statusCategory(hit.applicationStatus)]++;
    regionCounts[regionCategory(hit)]++;
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
  const uniqueTrademarkCount = bucket.hits.size;
  const applicationYearCounts = {};
  for (const year of [...yearCounts.keys()].sort((a, b) => a - b)) {
    applicationYearCounts[String(year)] = yearCounts.get(year);
  }
  recentBrands.sort((a, b) => clean(b.applicationDate).localeCompare(clean(a.applicationDate)));

  const result = {};
  for (const [key, value] of Object.entries(bucket)) {
    if (key !== "hits") result[key] = value;
  }
  return {
    ...result,
    uniqueTrademarkCount,
    duplicateHitCount: Math.max(0, bucket.returnedHitCount - uniqueTrademarkCount),
    statusCounts,
    registrationRate: safeRate(statusCounts.registered, uniqueTrademarkCount),
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
    regionCounts,
    regionVerifiedHitCount,
    regionVerificationRate: safeRate(regionVerifiedHitCount, uniqueTrademarkCount),
    localApplicantShare: safeRate(regionCounts.inside, regionVerifiedHitCount),
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
  if (!Number.isInteger(asOfYear) || asOfYear < 1801 || asOfYear > 2200) {
    throw new Error("asOfYear는 1801~2200 범위의 정수여야 합니다.");
  }
  if (!Number.isInteger(recentYears) || recentYears < 1 || recentYears > 20) {
    throw new Error("recentYears는 1~20 범위의 정수여야 합니다.");
  }
  if (!Number.isInteger(maxRecentBrands) || maxRecentBrands < 1 || maxRecentBrands > 100) {
    throw new Error("maxRecentBrands는 1~100 범위의 정수여야 합니다.");
  }
  const options = { asOfYear, recentYears, maxRecentBrands };
  const entries = normalizeInput(parsed);
  const regionItemBuckets = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const dimensions = entryDimensions(entry);
    const key = [dimensions.region, dimensions.itemName, dimensions.niceClass || ""].join("\u001f");
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
      groupKey: `${bucket.itemName}\u001f${bucket.niceClass || ""}`,
      value: { itemName: bucket.itemName, noticeName: bucket.noticeName, niceClass: bucket.niceClass },
    }, bucket);
    mergeBucket(summaryBucket, bucket);
  }

  const finalizeAll = (buckets) => sortAggregates([...buckets.values()].map((b) => finalizeBucket(b, options)));
  const summary = finalizeBucket(summaryBucket, options);
  const warnings = [];
  if (summary.erroredQueryCount > 0) {
    warnings.push(`${summary.erroredQueryCount}개 검색이 오류여서 집계에서 제외되었습니다.`);
  }
  if (summary.skippedQueryCount > 0) {
    warnings.push(
      `${summary.skippedQueryCount}개 행이 ②단계에서 검토대기·제외 처리되어 상표 검색 자체가 건너뛰어졌습니다(집계에서 제외).`
    );
  }
  if (summary.regionVerificationRate !== 1 && summary.uniqueTrademarkCount > 0) {
    warnings.push("출원인 주소 기반 지역 매칭이 끝나지 않은 상표가 있어 지역 내·외 비중은 검증된 건만 기준으로 계산했습니다.");
  }
  warnings.push("건수는 03단계가 저장한 hits 기준입니다. KIPRIS 전체 검색 건수(totalCount)와 같지 않을 수 있습니다.");

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    parameters: {
      asOfYear,
      recentYears,
      recentPeriodExcludesCurrentYear: true,
      maxRecentBrands,
    },
    warnings,
    summary,
    regionItems: finalizeAll(regionItemBuckets),
    regions: finalizeAll(regionBuckets),
    items: finalizeAll(itemBuckets),
  };
}

module.exports = {
  analyzeEntries,
  applicationYear,
  normalizeInput,
  regionCategory,
  statusCategory,
  trademarkKey,
};
