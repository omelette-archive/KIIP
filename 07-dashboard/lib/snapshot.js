"use strict";

const crypto = require("crypto");
const { loadAdminRegionCodes } = require("../../01-collect-specialties/lib/adminCodes");
const { loadSourceCoverageGaps } = require("../../01-collect-specialties/lib/sourceCoverageGaps");
const { getSourceDefinition, loadSourceRegistry } = require("../../01-collect-specialties/lib/sourceRegistry");
const ITEM_CATEGORIES = require("../../02-normalize-items/data/item-categories-v1.json");

const DASHBOARD_SCHEMA_VERSION = "dashboard-snapshot-v1";
const DASHBOARD_CONTRACT_VERSION = "dashboard-data-contract-v0-draft";
const REGION_CODE_VERSION = "molit-legal-dong-20260703";
const SPECIALTY_ID_VERSION = "specialty-id-v1-notice-class-sha256";

function clean(value) {
  return value === undefined || value === null
    ? ""
    : String(value).normalize("NFC").trim().replace(/\s+/g, " ");
}

function hash(value, length = 16) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
}

// 이슈 #109(품목 카테고리화). 고시명칭이 확정된 항목(notice_name_and_nice_class /
// raw_item_goods_matched)만 02-normalize-items/data/item-categories-v1.json과 대조한다.
// "신선한 "/"미가공 " 접두어는 매칭 규칙이 붙인 수식어라 대조 전에 떼어낸다 — Dashboard.tsx의
// officialItemLabel()과 동일 규칙. 매핑에 없는 명칭(아직 미분류)은 category: null로 둔다.
const CATEGORY_OFFICIAL_MATCHING_BASES = new Set(["notice_name_and_nice_class", "raw_item_goods_matched"]);
const CATEGORY_DISPLAY_PREFIXES = ["신선한 ", "미가공 "];
function itemCategory(row) {
  const basis = clean(row.matchingBasis) || "notice_name_and_nice_class";
  if (!CATEGORY_OFFICIAL_MATCHING_BASES.has(basis)) return null;
  let name = clean(row.noticeName);
  if (!name) return null;
  const prefix = CATEGORY_DISPLAY_PREFIXES.find((candidate) => name.startsWith(candidate));
  if (prefix) name = name.slice(prefix.length);
  const code = ITEM_CATEGORIES.items[name];
  return code ? { code, label: ITEM_CATEGORIES.categories[code] || code } : null;
}

function canonicalItem(row) {
  const name = clean(row.noticeName) || clean(row.itemName);
  const niceClass = clean(row.niceClass).replace(/^0+(?=\d)/, "");
  return { name, niceClass, basis: `${name.toLowerCase()}\u001f${niceClass}` };
}

function specialtyIdentity(row) {
  const canonical = canonicalItem(row);
  if (!canonical.name) {
    return { specialtyId: null, specialtyIdStatus: "unresolved", canonical };
  }
  return {
    specialtyId: `sp-v1-${hash(canonical.basis)}`,
    specialtyIdStatus: "resolved",
    canonical,
  };
}

function createRegionIndex(adminCodes = loadAdminRegionCodes()) {
  const grouped = new Map();
  for (const row of adminCodes) {
    const key = `${clean(row.sido)}\u001f${clean(row.sigungu)}`;
    if (!grouped.has(key)) grouped.set(key, new Map());
    grouped.get(key).set(clean(row.code), row);
  }
  return grouped;
}

// 2026-08-21: 농사로 areaNm이 "경기도 > 남양주시"처럼 시도>시군구를 한 필드에
// 합쳐 주는 경우가 있다(대부분의 다른 지역은 시군구만 옴, 예: "대전광역시"). 이
// 원본 값을 그대로 sigungu로 쓰면 법정동코드 완전일치 매칭이 항상 실패한다(">"가
// 낀 문자열은 마스터에 없으니까) — ">" 구분자를 분리해서 진짜 시군구만 남긴다.
function splitCompoundRegionText(value) {
  const raw = clean(value);
  if (!raw.includes(">")) return { prefix: "", tail: raw };
  const parts = raw.split(">").map((part) => clean(part)).filter(Boolean);
  return { prefix: parts.slice(0, -1).join(" "), tail: parts[parts.length - 1] || "" };
}

function resolveRegion(row, regionIndex) {
  const regionParts = clean(row.region).split(" ").filter(Boolean);
  const splitSigungu = splitCompoundRegionText(row.sigungu);
  const sido = clean(row.sido) || splitSigungu.prefix || regionParts[0] || "";
  const sigungu = splitSigungu.tail || regionParts.slice(1).join(" ");
  const candidates = regionIndex.get(`${sido}${sigungu}`);
  if (!sido || !candidates || candidates.size === 0) {
    return { regionCode: null, regionCodeStatus: "unresolved", sido, sigungu };
  }
  if (candidates.size > 1) {
    return { regionCode: null, regionCodeStatus: "ambiguous", sido, sigungu };
  }
  return { regionCode: [...candidates.keys()][0], regionCodeStatus: "resolved", sido, sigungu };
}

function rowKey(row) {
  const canonical = canonicalItem(row);
  const region = clean(row.region) || [clean(row.sido), clean(row.sigungu)].filter(Boolean).join(" ");
  return `${region}\u001f${canonical.basis}`;
}

function count(row, field) {
  const value = Number(row?.[field]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function optionalCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function dataState(row) {
  const queryCount = count(row, "queryCount");
  const successful = count(row, "successfulQueryCount");
  const partial = count(row, "partialQueryCount");
  const errors = count(row, "erroredQueryCount");
  const skipped = count(row, "skippedQueryCount");
  if (queryCount === 0) return "not_collected";
  if (errors === queryCount) return "error";
  if (skipped === queryCount) return "skipped";
  if (partial > 0 || errors > 0 || skipped > 0 || successful < queryCount) return "partial";
  return count(row, "uniqueTrademarkCount") === 0 ? "complete_zero" : "complete_nonzero";
}

function metricStatus(state) {
  if (state === "complete_zero" || state === "complete_nonzero") return "complete";
  if (state === "error") return "error";
  if (state === "not_collected" || state === "skipped") return "not_collected";
  return "partial";
}

function sourceRef(provenance) {
  const sourceId = clean(provenance?.sourceId);
  if (sourceId) return sourceId;
  const label = clean(provenance?.sourceLabel);
  return label ? `label-${hash(label, 12)}` : null;
}

function rowSourceIds(row) {
  const ids = new Set();
  for (const provenance of Array.isArray(row?.sourceProvenance) ? row.sourceProvenance : []) {
    const id = sourceRef(provenance);
    if (id) ids.add(id);
  }
  for (const label of Array.isArray(row?.sources) ? row.sources : []) {
    if (clean(label)) ids.add(`label-${hash(clean(label), 12)}`);
  }
  return [...ids].sort();
}

function makeMetric(value, row, options) {
  const state = options.state || dataState(row);
  return {
    value,
    availability: options.availability || "available",
    status: options.status || metricStatus(state),
    sourceIds: options.sourceIds || rowSourceIds(row),
    calculatedAt: options.calculatedAt || null,
    methodVersion: options.methodVersion || null,
    rationale: options.rationale || null,
    blockingIssue: options.blockingIssue || null,
  };
}

function collectSources(analysis) {
  const sources = new Map();
  const add = (provenance) => {
    if (!provenance || typeof provenance !== "object") return;
    const id = sourceRef(provenance);
    if (!id) return;
    const existing = sources.get(id) || {};
    sources.set(id, {
      sourceId: id,
      sourceLabel:
        clean(provenance.sourceLabel) ||
        clean(provenance.dataset) ||
        clean(provenance.provider) ||
        existing.sourceLabel ||
        null,
      sourceContractVersion:
        clean(provenance.sourceContractVersion) ||
        clean(provenance.contractVersion) ||
        existing.sourceContractVersion ||
        null,
      sourceFetchedAt:
        clean(provenance.sourceFetchedAt) ||
        clean(provenance.fetchedAt) ||
        existing.sourceFetchedAt ||
        null,
      sourceUrl:
        clean(provenance.sourceUrl) ||
        clean(provenance.catalogUrl) ||
        clean(provenance.endpoint) ||
        existing.sourceUrl ||
        null,
      sourceLastVerifiedAt:
        clean(provenance.sourceLastVerifiedAt) ||
        clean(provenance.lastContractVerifiedAt) ||
        existing.sourceLastVerifiedAt ||
        null,
      idOrigin: clean(provenance.sourceId) ? "upstream" : "derived_from_label",
    });
  };
  for (const source of Array.isArray(analysis?.provenance?.sources)
    ? analysis.provenance.sources
    : []) add(source);
  for (const row of Array.isArray(analysis?.regionItems) ? analysis.regionItems : []) {
    for (const source of Array.isArray(row.sourceProvenance) ? row.sourceProvenance : []) add(source);
    for (const label of Array.isArray(row.sources) ? row.sources : []) add({ sourceLabel: label });
  }
  sources.set("admin_codes", {
    sourceId: "admin_codes",
    sourceLabel: "국토교통부 전국 법정동 코드",
    sourceContractVersion: REGION_CODE_VERSION,
    sourceFetchedAt: "2026-08-06",
    sourceUrl: "https://www.data.go.kr/data/15063424/fileData.do",
    sourceLastVerifiedAt: "2026-08-06",
    idOrigin: "source_registry",
  });
  return [...sources.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function assertInputs(analysis, gap, strategy) {
  if (!analysis || !Array.isArray(analysis.regionItems) || !Array.isArray(analysis.regions)) {
    throw new Error("analysis는 ④단계 출력이어야 합니다 (regionItems/regions 배열 필요).");
  }
  if (!gap || !Array.isArray(gap.rows) || !Array.isArray(gap.ranking)) {
    throw new Error("gap은 ⑤단계 출력이어야 합니다 (rows/ranking 배열 필요).");
  }
  if (!strategy || !Array.isArray(strategy.briefings)) {
    throw new Error("strategy는 ⑥단계 출력이어야 합니다 (briefings 배열 필요).");
  }
  if (
    strategy.sourceScoreVersion &&
    gap.scoreVersion &&
    strategy.sourceScoreVersion !== gap.scoreVersion
  ) {
    throw new Error("⑥ sourceScoreVersion과 ⑤ scoreVersion이 일치하지 않습니다.");
  }
  if (
    gap.provenance?.inputAnalysisVersion &&
    analysis.analysisVersion &&
    gap.provenance.inputAnalysisVersion !== analysis.analysisVersion
  ) {
    throw new Error("⑤ inputAnalysisVersion과 ④ analysisVersion이 일치하지 않습니다.");
  }
}

function buildDashboardSnapshot({ analysis, gap, strategy }, options = {}) {
  assertInputs(analysis, gap, strategy);
  const mode = options.mode || "sample";
  if (!new Set(["sample", "full"]).has(mode)) {
    throw new Error("mode는 sample 또는 full이어야 합니다.");
  }
  const generatedAt = options.generatedAt || new Date().toISOString();
  const regionIndex = createRegionIndex(options.adminCodes);
  const analysisSourceIds = (Array.isArray(analysis?.provenance?.sources)
    ? analysis.provenance.sources
    : [])
    .map(sourceRef)
    .filter((sourceId) => sourceId && sourceId !== "ip_registry");
  const analysisRows = new Map(analysis.regionItems.map((row) => [rowKey(row), row]));
  const gapRows = new Map(gap.rows.map((row) => [rowKey(row), row]));
  const briefingRows = new Map(strategy.briefings.map((row) => [rowKey(row), row]));
  const seenSpecialties = new Map();
  const warnings = new Set([
    ...(Array.isArray(analysis.warnings) ? analysis.warnings : []),
    ...(Array.isArray(gap.warnings) ? gap.warnings : []),
    ...(Array.isArray(strategy.warnings) ? strategy.warnings : []),
  ]);
  if (mode === "sample") {
    warnings.add("샘플 실행 결과이며 전국 모집단 통계나 정책 결론으로 해석하면 안 됩니다.");
  }
  warnings.add("현재 행정구역 경계 GeoJSON 버전은 연결되지 않아 지도 렌더링은 차단 상태입니다.");
  warnings.add(
    "법정동코드 원본에 폐지·변경 이력이 섞여 있어 현재 유효한 전국 목표 지역 수는 아직 확정하지 않았습니다."
  );

  for (const row of gap.rows) {
    if (!analysisRows.has(rowKey(row))) {
      throw new Error(`⑤ 행을 ④ 지역×품목에 연결할 수 없습니다: ${rowKey(row)}`);
    }
  }
  for (const row of strategy.briefings) {
    if (!analysisRows.has(rowKey(row))) {
      throw new Error(`⑥ 브리핑을 ④ 지역×품목에 연결할 수 없습니다: ${rowKey(row)}`);
    }
  }

  const regionGroups = new Map();
  for (const row of analysis.regionItems) {
    // 검토대기(고시명칭 미확정) 행을 원물명으로 검색한 결과(matchingBasis=
    // raw_item_name_unclassified)는 niceClass가 없는 게 정상이다 — 식품 기본류
    // fallback으로 검색했을 뿐 공식 분류가 아니기 때문. 이 경우만 niceClass 미확정을
    // 허용하고, noticeName은 여전히 필수(원물명이라도 표시할 이름은 있어야 함).
    const hasRawItemBasis = new Set([
      "raw_item_name_unclassified",
      "raw_item_goods_matched",
    ]).has(clean(row.matchingBasis));
    if (!clean(row.noticeName) || (!hasRawItemBasis && !clean(row.niceClass))) {
      throw new Error(
        `대시보드 품목은 ② 고시명칭 확정 또는 원물명 미분류 검색 행만 허용합니다: ${clean(row.region)} / ${clean(row.itemName)}`
      );
    }
    const regionIdentity = resolveRegion(row, regionIndex);
    const specialty = specialtyIdentity(row);
    if (specialty.specialtyId) {
      const previous = seenSpecialties.get(specialty.specialtyId);
      if (previous && previous !== specialty.canonical.basis) {
        throw new Error(`specialtyId 충돌: ${specialty.specialtyId}`);
      }
      seenSpecialties.set(specialty.specialtyId, specialty.canonical.basis);
    }
    const state = dataState(row);
    const baseMetricSourceIds = [
      ...new Set([...rowSourceIds(row), ...analysisSourceIds]),
    ].sort();
    const registryMetricSourceIds =
      count(row.ipRegistryStatusCounts, "complete") > 0
        ? [...new Set([...baseMetricSourceIds, "ip_registry"])].sort()
        : baseMetricSourceIds;
    const gapRow = gapRows.get(rowKey(row));
    const briefing = briefingRows.get(rowKey(row));
    const calculatedAt = analysis.generatedAt || generatedAt;
    const rawGoodsMatched = clean(row.matchingBasis) === "raw_item_goods_matched";
    const reviewedAt = clean(row.rawGoodsReview?.reviewedAt) || calculatedAt;
    const regionalMethodVersion = rawGoodsMatched
      ? clean(row.rawGoodsReview?.methodVersion) || "raw-item-goods-match-ai-review-v1"
      : analysis.analysisVersion || null;
    const regionalMetricAvailable =
      row.regionalMetricAvailability === "available" ||
      (!row.regionalMetricAvailability && row.regionVerificationRate === 1);
    const regionalTrademarkCount = regionalMetricAvailable
      ? count(row, "regionalUniqueTrademarkCount") || count(row.regionCounts, "inside")
      : null;
    const regionalRegisteredCount = regionalMetricAvailable
      ? count(row.regionalStatusCounts, "registered")
      : null;
    const scoreAvailability =
      typeof gapRow?.gapScore === "number" ? "preview" : "blocked";
    const scoreBlockingIssue =
      gapRow?.scoreAvailability === "blocked" || !regionalMetricAvailable ? "#50" : "#29";
    const item = {
      specialtyId: specialty.specialtyId,
      specialtyIdStatus: specialty.specialtyIdStatus,
      itemName: clean(row.itemName) || null,
      noticeName: clean(row.noticeName) || null,
      niceClass: clean(row.niceClass) || null,
      matchingBasis: clean(row.matchingBasis) || "notice_name_and_nice_class",
      category: itemCategory(row),
      applicationYearCounts: row.applicationYearCounts && Object.keys(row.applicationYearCounts).length
        ? row.applicationYearCounts
        : null,
      registrationYearCounts:
        row.registrationYearCounts && Object.keys(row.registrationYearCounts).length
          ? row.registrationYearCounts
          : null,
      // #110: 지역 출원 지표(uniqueTrademarkCount 등)와 완전히 분리된 참고 지표 —
      // 가공품·서비스류를 뺀 원물류(29·30·31류) 전국 후보 중 이 지역 주소와 일치하는
      // 비율. 기존 분자·분모에는 절대 섞지 않는다.
      rawGoodsRegionalShare: row.rawGoodsRegionalShare
        ? {
            nationwideCandidateCount: count(row.rawGoodsRegionalShare, "nationwideCandidateCount"),
            regionalAddressMatchCount: count(row.rawGoodsRegionalShare, "regionalAddressMatchCount"),
            rate: optionalCount(row.rawGoodsRegionalShare.rate),
          }
        : null,
      itemVerdict: {
        source: clean(row.itemVerdictSource) || "unresolved",
        method: clean(row.itemMatchMethod) || null,
        confidence: typeof row.itemMatchConfidence === "number" ? row.itemMatchConfidence : null,
      },
      dataState: state,
      sources: rowSourceIds(row),
      trademarkExamples: Array.isArray(row.trademarkExamples)
        ? row.trademarkExamples.map((example) => ({
            title: clean(example.title) || null,
            applicationNumber: clean(example.applicationNumber) || null,
            applicationDate: clean(example.applicationDate) || null,
            applicationStatus: clean(example.applicationStatus) || null,
            statusCategory: clean(example.statusCategory) || null,
            applicantRegionMatch: clean(example.applicantRegionMatch) || null,
            goodsMatchMethod: clean(example.goodsMatchMethod) || "unverified",
            goodsReviewRequired: Boolean(example.goodsReviewRequired),
            goodsEvidence: Array.isArray(example.goodsEvidence) ? example.goodsEvidence : [],
          }))
        : [],
      metrics: {
        uniqueTrademarkCount: makeMetric(regionalTrademarkCount, row, {
          state,
          sourceIds: baseMetricSourceIds,
          availability: regionalMetricAvailable ? "available" : "blocked",
          calculatedAt: reviewedAt,
          methodVersion: regionalMethodVersion,
          rationale: rawGoodsMatched
            ? "검토 승인된 지정상품 exact/contains 및 지역 일치 고유 출원만 집계"
            : "출원인 주소가 해당 지역 inside로 검증된 고유 출원만 집계",
          blockingIssue: regionalMetricAvailable ? null : "#50",
        }),
        nationwideSearchTrademarkCount: makeMetric(
          count(row, "nationwideSearchTrademarkCount") || count(row, "uniqueTrademarkCount"),
          row,
          {
            state,
            sourceIds: baseMetricSourceIds,
            availability: "preview",
            calculatedAt,
            methodVersion: analysis.analysisVersion || null,
            rationale: "KIPRIS 전국 단어검색 후보; 지역 상표 건수로 사용하지 않음",
            blockingIssue: "#50",
          }
        ),
        registeredTrademarkCount: makeMetric(regionalRegisteredCount, row, {
          state,
          sourceIds: registryMetricSourceIds,
          availability: regionalMetricAvailable ? "available" : "blocked",
          calculatedAt: reviewedAt,
          methodVersion: regionalMethodVersion,
          rationale: rawGoodsMatched
            ? "검토 승인된 지정상품·지역 일치 출원 중 등록 상태"
            : "지역 inside 검증 출원 중 등록 상태",
          blockingIssue: regionalMetricAvailable ? null : "#50",
        }),
        registrationRate: makeMetric(
          regionalMetricAvailable ? row.regionalRegistrationRate ?? null : null,
          row,
          {
            state,
            sourceIds: registryMetricSourceIds,
            availability: regionalMetricAvailable ? "available" : "blocked",
            calculatedAt: reviewedAt,
            methodVersion: regionalMethodVersion,
            rationale: rawGoodsMatched
              ? "등록 출원 / 검토 승인된 지정상품·지역 일치 고유 출원"
              : "지역 inside 등록 출원 / 지역 inside 고유 출원",
            blockingIssue: regionalMetricAvailable ? null : "#50",
          }
        ),
        localApplicantShare: makeMetric(
          regionalMetricAvailable ? row.localApplicantShare ?? null : null,
          row,
          {
            state,
            sourceIds: registryMetricSourceIds,
            availability: regionalMetricAvailable ? "available" : "blocked",
            calculatedAt,
            methodVersion: analysis.analysisVersion || null,
            rationale: "출원인 주소가 검증된 hit만 사용",
            blockingIssue: regionalMetricAvailable ? null : "#50",
          }
        ),
        regionalBrandInsideShare: makeMetric(row.regionalBrandInsideShare ?? null, row, {
          state,
          sourceIds: baseMetricSourceIds,
          availability:
            count(row, "regionalBrandReferenceHitCount") > 0 ? "available" : "blocked",
          calculatedAt,
          methodVersion: analysis.analysisVersion || null,
          rationale: "농사로 지역브랜드 출원번호 연관성; 출원인 주소와 별도",
        }),
        confirmedGoodsMatchCount: makeMetric(row.goodsConfirmedHitCount ?? 0, row, {
          state,
          sourceIds: registryMetricSourceIds,
          availability: rawGoodsMatched
            ? "available"
            : count(row.ipRegistryStatusCounts, "complete") > 0 ? "preview" : "blocked",
          calculatedAt: rawGoodsMatched ? reviewedAt : calculatedAt,
          methodVersion: rawGoodsMatched
            ? regionalMethodVersion
            : "ip-registry-designated-goods-v0-review",
          rationale: rawGoodsMatched
            ? "지정상품명이 원물명과 정규화 완전일치(normalized_exact)한 출원 수"
            : "등록원부 지정상품과 정규화 완전일치한 상표만 집계",
          blockingIssue: rawGoodsMatched ? null : "#12",
        }),
        goodsReviewCandidateCount: makeMetric(row.goodsReviewRequiredHitCount ?? 0, row, {
          state,
          sourceIds: registryMetricSourceIds,
          availability: rawGoodsMatched
            ? "available"
            : count(row.ipRegistryStatusCounts, "complete") > 0 ? "preview" : "blocked",
          calculatedAt: rawGoodsMatched ? reviewedAt : calculatedAt,
          methodVersion: rawGoodsMatched
            ? regionalMethodVersion
            : "ip-registry-designated-goods-v0-review",
          rationale: rawGoodsMatched
            ? "지정상품명에 원물명이 포함(normalized_contains)된 출원 수"
            : "normalized_contains 또는 class_only 후보",
          blockingIssue: rawGoodsMatched ? null : "#12",
        }),
        gapScore: makeMetric(gapRow?.gapScore ?? null, row, {
          state,
          availability: scoreAvailability,
          calculatedAt: gap.generatedAt || generatedAt,
          methodVersion: gap.scoreVersion || null,
          rationale: gapRow?.gapReason || "⑤ 예시 점수 기준",
          blockingIssue: scoreBlockingIssue,
        }),
      },
      briefing: briefing
        ? {
            templateVersion: strategy.templateVersion || null,
            isGapAlert: Boolean(briefing.isGapAlert),
            sentences: Array.isArray(briefing.sentences) ? briefing.sentences : [],
            evidence: briefing.evidence || null,
            aiReviewApplied: false,
          }
        : null,
    };
    const groupKey = clean(row.region) || [clean(row.sido), clean(row.sigungu)].join(" ");
    if (!regionGroups.has(groupKey)) {
      regionGroups.set(groupKey, {
        ...regionIdentity,
        sido: regionIdentity.sido || clean(row.sido) || null,
        sigungu: regionIdentity.sigungu || clean(row.sigungu) || null,
        region: clean(row.region).includes(">")
          ? [regionIdentity.sido, regionIdentity.sigungu].filter(Boolean).join(" ")
          : clean(row.region) || groupKey,
        items: [],
      });
    }
    regionGroups.get(groupKey).items.push(item);
  }

  const regionAggregates = new Map(analysis.regions.map((row) => [clean(row.region), row]));
  const regions = [...regionGroups.values()].map((region) => {
    const aggregate = regionAggregates.get(clean(region.region));
    const state = aggregate ? dataState(aggregate) : "not_collected";
    if (region.regionCodeStatus !== "resolved") {
      warnings.add(`${region.region}의 공식 regionCode를 확정하지 못했습니다.`);
    }
    region.items.sort(
      (a, b) =>
        (b.metrics.uniqueTrademarkCount.value ?? -1) -
          (a.metrics.uniqueTrademarkCount.value ?? -1) ||
        clean(a.noticeName || a.itemName).localeCompare(clean(b.noticeName || b.itemName), "ko")
    );
    return {
      ...region,
      dataState: state,
      metrics: aggregate
        ? {
            uniqueTrademarkCount: makeMetric(
              aggregate.regionalMetricAvailability === "available"
                ? count(aggregate, "regionalUniqueTrademarkCount")
                : null,
              aggregate,
              {
                state,
                availability:
                  aggregate.regionalMetricAvailability === "available" ? "available" : "blocked",
                calculatedAt: analysis.generatedAt || generatedAt,
                methodVersion: analysis.analysisVersion || null,
                blockingIssue:
                  aggregate.regionalMetricAvailability === "available" ? null : "#50",
              }
            ),
            registeredTrademarkCount: makeMetric(
              aggregate.regionalMetricAvailability === "available"
                ? count(aggregate.regionalStatusCounts, "registered")
                : null,
              aggregate,
              {
                state,
                availability:
                  aggregate.regionalMetricAvailability === "available" ? "available" : "blocked",
                calculatedAt: analysis.generatedAt || generatedAt,
                methodVersion: analysis.analysisVersion || null,
                blockingIssue:
                  aggregate.regionalMetricAvailability === "available" ? null : "#50",
              }
            ),
            registrationRate: makeMetric(
              aggregate.regionalMetricAvailability === "available"
                ? aggregate.regionalRegistrationRate ?? null
                : null,
              aggregate,
              {
                state,
                availability:
                  aggregate.regionalMetricAvailability === "available" ? "available" : "blocked",
                calculatedAt: analysis.generatedAt || generatedAt,
                methodVersion: analysis.analysisVersion || null,
                blockingIssue:
                  aggregate.regionalMetricAvailability === "available" ? null : "#50",
              }
            ),
          }
        : {},
    };
  });
  regions.sort((a, b) => clean(a.region).localeCompare(clean(b.region), "ko"));

  const presentSido = new Set(regions.map((region) => region.sido).filter(Boolean));
  const sourceCoverageGaps = options.sourceCoverageGaps || loadSourceCoverageGaps();
  const sourceRegistry = options.sourceRegistry || (() => {
    try {
      return loadSourceRegistry();
    } catch {
      return null;
    }
  })();
  for (const gap of sourceCoverageGaps) {
    if (presentSido.has(gap.sido)) continue; // 실제 데이터가 생기면 자동으로 더 이상 경고하지 않음
    const sourceLabel = sourceRegistry
      ? getSourceDefinition(gap.sourceId, sourceRegistry)?.name || gap.sourceId
      : gap.sourceId;
    warnings.add(
      `${gap.sido}은(는) 현재 ${sourceLabel} 소스에서 특산물이 한 건도 수집되지 않아 지역 목록에 나타나지 않습니다` +
        `(확인 ${gap.verifiedAt}, ${gap.verificationMethod}). 0건으로 확정된 것이 아니라 출처 미확보 상태입니다 — ` +
        `${gap.note}(${gap.issue}).`
    );
  }

  const summary = analysis.summary || {};
  const coverage = {
    targetRegionCount: null,
    observedRegionCount: regions.length,
    regionItemCount: analysis.regionItems.length,
    completeQueryCount: optionalCount(summary.completeRowCount) ?? Math.max(
      0,
      count(summary, "successfulQueryCount") - count(summary, "partialQueryCount")
    ),
    partialQueryCount: optionalCount(summary.partialRowCount) ?? count(summary, "partialQueryCount"),
    errorQueryCount: optionalCount(summary.erroredRowCount) ?? count(summary, "erroredQueryCount"),
    skippedQueryCount: optionalCount(summary.skippedRowCount) ?? count(summary, "skippedQueryCount"),
    unit: "region_item_input_rows",
  };

  const availableRegionItemCount = analysis.regionItems.filter(
    (row) => row.regionalMetricAvailability === "available"
  ).length;
  const regionalAttributionCounts = analysis.regionItems.reduce(
    (counts, row) => {
      counts.inside += count(row.regionCounts || {}, "inside");
      counts.outside += count(row.regionCounts || {}, "outside");
      counts.unverified += count(row.regionCounts || {}, "unverified");
      return counts;
    },
    { inside: 0, outside: 0, unverified: 0 }
  );
  const addressEvidenceCount =
    optionalCount(summary.applicantAddressEvidenceCount) ?? count(summary, "regionVerifiedHitCount");
  const nationwideTrademarkCount = count(summary, "uniqueTrademarkCount");
  const regionalCoverageThreshold = Number(analysis.parameters?.regionalCoverageThreshold ?? 1);
  const pipelineStatus = {
    stage: clean(options.stage) || (mode === "full" ? "alpha" : "sample"),
    inputScope: mode,
    units: {
      row: "region_item_input_rows",
      uniqueQuery: "notice_name_and_nice_class",
      trademark: "application_number",
    },
    rowCounts: {
      total: optionalCount(summary.inputRowCount) ?? count(summary, "queryCount"),
      searchable: optionalCount(summary.searchableRowCount) ?? count(summary, "successfulQueryCount"),
      complete: coverage.completeQueryCount,
      partial: coverage.partialQueryCount,
      error: coverage.errorQueryCount,
      skipped: coverage.skippedQueryCount,
    },
    uniqueQueryCounts: {
      total: optionalCount(options.uniqueQueryCount ?? summary.uniqueQueryCount),
      complete: optionalCount(options.completeUniqueQueryCount ?? summary.completeUniqueQueryCount),
      partial: optionalCount(options.partialUniqueQueryCount ?? summary.partialUniqueQueryCount),
    },
    nationwideCandidates: {
      uniqueTrademarkCount: nationwideTrademarkCount,
      returnedHitCount: count(summary, "returnedHitCount"),
      duplicateHitCount: count(summary, "duplicateHitCount"),
    },
    applicantRegionVerification: {
      inside: regionalAttributionCounts.inside,
      outside: regionalAttributionCounts.outside,
      unverified: Math.max(0, nationwideTrademarkCount - addressEvidenceCount),
      verifiedCount: addressEvidenceCount,
      rate:
        typeof summary.applicantAddressEvidenceRate === "number"
          ? summary.applicantAddressEvidenceRate
          : typeof summary.regionVerificationRate === "number"
            ? summary.regionVerificationRate
          : null,
      regionalAttributionCounts,
      unit: "unique_trademark_address_evidence",
    },
    regionalMetricGate: {
      availableRegionItemCount,
      blockedRegionItemCount: Math.max(0, analysis.regionItems.length - availableRegionItemCount),
      coverageThreshold: Number.isFinite(regionalCoverageThreshold)
        ? regionalCoverageThreshold
        : 1,
      policy:
        regionalCoverageThreshold < 1
          ? "alpha_collection_coverage_preview_address_rate_is_advisory"
          : "collection_complete_address_rate_is_advisory",
    },
    collectionExperiment: {
      queryHitCap: optionalCount(options.queryHitCap),
      serializationFailureObservedAtOrAbove: optionalCount(
        options.serializationFailureObservedAtOrAbove
      ),
      outputShape:
        analysis.provenance?.inputStorageMode === "query_facts"
          ? "query_facts_with_region_row_references"
          : "expanded_region_item_hits",
    },
  };

  const identityFor = (row) => {
    const region = resolveRegion(row, regionIndex);
    const specialty = specialtyIdentity(row);
    return { regionCode: region.regionCode, specialtyId: specialty.specialtyId };
  };
  const rankings = gap.ranking.map((row, index) => {
    const analysisRow = analysisRows.get(rowKey(row));
    const state = dataState(analysisRow);
    return {
      rank: index + 1,
      ...identityFor(row),
      region: clean(row.region) || null,
      itemName: clean(row.itemName) || null,
      noticeName: clean(row.noticeName) || null,
      gapScore: makeMetric(row.gapScore ?? null, row, {
        availability: "preview",
        status: metricStatus(state),
        calculatedAt: gap.generatedAt || generatedAt,
        methodVersion: gap.scoreVersion || null,
        rationale: "⑤ 예시 점수 기준",
        blockingIssue: "#29",
      }),
    };
  });
  const briefings = strategy.briefings.map((row) => ({
    ...identityFor(row),
    region: clean(row.region) || null,
    itemName: clean(row.itemName) || null,
    templateVersion: strategy.templateVersion || null,
    isGapAlert: Boolean(row.isGapAlert),
    sentences: Array.isArray(row.sentences) ? row.sentences : [],
    evidence: row.evidence || null,
    aiReviewApplied: false,
  }));
  const alerts = briefings.filter((row) => row.isGapAlert);
  const snapshotBasis = JSON.stringify({ mode, analysis, gap, strategy, pipelineStatus });
  const sources = collectSources(analysis);
  const sourceFetchedAt = sources
    .map((source) => clean(source.sourceFetchedAt))
    .filter(Boolean)
    .sort();

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    snapshotId: `dashboard-${hash(snapshotBasis, 20)}`,
    generatedAt,
    mode,
    asOf: {
      sourceMinFetchedAt: sourceFetchedAt[0] || null,
      sourceMaxFetchedAt: sourceFetchedAt[sourceFetchedAt.length - 1] || null,
      analysisGeneratedAt: analysis.generatedAt || null,
    },
    versions: {
      analysisVersion: analysis.analysisVersion || null,
      scoreVersion: gap.scoreVersion || null,
      templateVersion: strategy.templateVersion || null,
      dashboardContractVersion: DASHBOARD_CONTRACT_VERSION,
      regionCodeVersion: REGION_CODE_VERSION,
      specialtyIdVersion: SPECIALTY_ID_VERSION,
      geographyVersion: null,
    },
    coverage,
    pipelineStatus,
    map: {
      defaultMetric: "data_coverage",
      availability: "blocked",
      blockingReason: "현재 기준 행정구역 경계 GeoJSON 미연결",
    },
    sources,
    warnings: [...warnings],
    regions,
    rankings,
    briefings,
    alerts,
  };
}

module.exports = {
  DASHBOARD_SCHEMA_VERSION,
  DASHBOARD_CONTRACT_VERSION,
  REGION_CODE_VERSION,
  SPECIALTY_ID_VERSION,
  buildDashboardSnapshot,
  canonicalItem,
  createRegionIndex,
  dataState,
  resolveRegion,
  rowKey,
  specialtyIdentity,
};
