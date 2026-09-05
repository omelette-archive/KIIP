#!/usr/bin/env node
"use strict";
/**
 * 단일 {지역, 품목} 또는 ② 단계의 정규화 CSV를 받아 KIPRIS 상표 검색
 * (getWordSearch)을 호출하고 품목(NICE 상품류 코드)으로 결과를 필터링한다.
 *
 * 농사로 지역브랜드 검증자료는 출원번호로, 등록원부 주소·지정상품은 등록번호로 선택 보강한다.
 * 두 지역 근거는 서로 다른 필드와 규칙 버전으로 보존한다.
 */

const path = require("path");
const fs = require("fs");
const { loadEnv } = require("./lib/loadEnv");

// kiprisClient는 모듈 로드 시 프로토콜을 결정하므로 .env를 먼저 읽어야 한다.
loadEnv();

const { createClient, KIPRIS_SOURCE_METADATA } = require("./lib/kiprisClient");
const {
  filterByClassCode,
  normalizeClassCode,
  FOOD_RELATED_CLASSES,
} = require("./lib/filters");
const {
  createAreaBrandContext,
  enrichHitsWithAreaBrands,
  loadAreaBrandDocument,
  summarizeRegionalBrandMatches,
} = require("./lib/areaBrandEnricher");
const { createClient: createIpRegistryClient } = require("./lib/ipRegistryClient");
const {
  createIpRegistryContext,
  enrichHitsWithIpRegistry,
  ipRegistryValidationMetadata,
} = require("./lib/ipRegistryEnricher");

function parseArgs(argv) {
  const args = {
    numOfRows: 20,
    pageNo: 1,
    concurrency: 2,
    "max-requests": 100,
    "max-pages": 5,
    "max-hits-per-query": 100,
    "max-registry-requests": 3,
    "registry-concurrency": 3,
    "storage-mode": "query-facts",
    "refresh-complete-after-days": 14,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    const isFlagValue = next !== undefined && !next.startsWith("--");
    args[key] = isFlagValue ? next : true;
    if (isFlagValue) i++;
  }
  return args;
}

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  단일: node 03-match-trademarks/matchTrademarks.js --region <지역명> --item <품목> [옵션]",
      "  배치: node 03-match-trademarks/matchTrademarks.js --input <normalized.csv> [옵션]",
      "",
      "옵션:",
      "  --classCode <1-45>   단일 모드 NICE 상품류 코드",
      "  --numOfRows <n>      페이지당 결과 수 (기본 20, 최대 100)",
      "  --pageNo <n>         페이지 번호 (기본 1)",
      "  --concurrency <n>    배치 모드 동시 요청 수 (기본 2)",
      "  --max-requests <n>   배치 1회 검색 요청 상한 (기본 100)",
      "  --max-pages <n>      쿼리당 페이지 상한 (기본 5)",
      "  --max-hits-per-query <n> 쿼리당 필터 통과 hit 수집 상한 (기본 100, 체크포인트에 저장)",
      "  --out-max-hits <n>   query_facts 출력 파일에만 적용하는 쿼리당 hit 상한(수집분은 보존)",
      "  --checkpoint <path>  배치 고유 쿼리 체크포인트 경로 (기본: <out>.checkpoint.json)",
      "  --resume             체크포인트의 완료 쿼리를 재사용하고 부분 쿼리부터 재개",
      "  --overwrite-checkpoint --resume 없이 기존 체크포인트를 덮어쓰기 허용(기본은 거부)",
      "  --refresh-complete-after-days <n> 완료 쿼리도 이 일수가 지나면 처음부터 다시 수집해",
      "                       신규 출원을 반영(기본 14, 0=끔·예전처럼 완료 쿼리 영구 재사용)",
      "  --storage-mode <mode> 배치 저장 구조: query-facts(기본, hit 1회 저장) | expanded(호환용)",
      "  --include-review-required 고시명칭 미확정 행을 원물명으로 탐색(별도 실험용, 기본 꺼짐)",
      "  --dry-run            배치 입력·요청 계획만 검증하고 API는 호출하지 않음",
      "  --area-brands <path> 농사로 areaBrandLst JSON을 출원번호로 조인(선택)",
      "  --enrich-registry    등록번호가 있는 hit를 등록원부 API로 보강(출원인 주소·지정상품, 선택)",
      "  --max-registry-requests <n> 등록원부 API 호출 상한 (기본 3, 최대 100)",
      "  --registry-concurrency <n> 등록원부 API 동시 호출 수 (기본 3, 429 방지)",
      "  --registryApiKey <key> IP_REGISTRY_API_KEY 대신 직접 인증키 전달",
      "  --out <path>         결과를 JSON 파일로 저장",
      "  --apiKey <key>       KIPRIS_API_KEY 대신 직접 인증키 전달",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function readNormalizedCsv(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]);
  const required = [
    "sido",
    "sigungu",
    "rawItemName",
    "itemName",
    "noticeName",
    "niceClass",
    "excluded",
    "status",
  ];
  for (const field of required) {
    if (!header.includes(field)) {
      throw new Error(`정규화 CSV에 ${required.join("/")} 컬럼이 필요합니다: ${header.join(",")}`);
    }
  }

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((field, index) => [field, values[index] || ""]));
  });
}

function isCsvTrue(value) {
  return ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function makeBatchQuery(row, options = {}) {
  if (row.status === "error") {
    return { skipReason: `상위 단계 status=${row.status}` };
  }
  if (isCsvTrue(row.excluded)) {
    return { skipReason: "② 단계에서 분석 제외된 품목" };
  }

  const region = [row.sido, row.sigungu].filter(Boolean).join(" ").trim();
  // 지역 없이도 전국 검색해야 하는 카탈로그 스코프. NFQS 품질인증수산물은 인증사업장
  // 소재지가 산지가 아니라 지역 없이 수집되고(01-collect normalize.js), 03d에서
  // "전국 지역 미제공"으로 정규화된다 — 03에서 스킵하면 안 된다(2026-09-04, #70).
  const nationwideCatalog = [
    "nationwide_catalog",
    "nationwide_certified_product_catalog",
    "geographical_indication_region_review",
  ].includes(row.sourceScope);
  if (!region && !nationwideCatalog) return { skipReason: "지역 정보 없음" };

  if (row.status === "ok" && [
    "nfqs_quality_cert",
    "nfqs_geographical_indication",
    "kofpi_forest_product",
    "rda_regional_specialty_crops",
  ].includes(row.sourceId)) {
    const item = String(row.itemName || row.rawItemName || "").trim();
    if (!item) return { skipReason: "공식 수집원 품목명 없음" };
    return {
      region: region || null,
      item,
      classCode: null,
      sourceScope: row.sourceScope || "regional",
    };
  }

  const notice = String(row.noticeName || "").trim();
  if (row.status === "ok") {
    if (!notice) return { skipReason: "② 단계 고시명칭 미확정" };
    if (!String(row.niceClass || "").trim()) return { skipReason: "② 단계 NICE류 미확정" };
    return { region, item: notice, classCode: row.niceClass };
  }

  // 고시명칭이 아직 확정되지 않은(검토대기) 원물명도, 실제로 그 이름으로 출원된 상표가
  // 있는지는 확인할 수 있다. 공식 분류가 없으니 NICE류는 식품 관련 기본류 fallback을
  // 쓰고, classCodeFallbackApplied=true(및 noticeName 비어있음)로 미분류 검색임을 남긴다.
  if (row.status === "review_required" && options.includeReviewRequired) {
    const item = String(row.itemName || "").trim();
    if (!item) return { skipReason: "② 단계 품목명 미확정" };
    return { region, item, classCode: null };
  }

  return { skipReason: `상위 단계 status=${row.status}` };
}

function countSearchableRows(rows, options = {}) {
  return rows.reduce((count, row) => count + (makeBatchQuery(row, options).skipReason ? 0 : 1), 0);
}

function normalizeQueryClasses(classCode) {
  if (!classCode) return `fallback:${FOOD_RELATED_CLASSES.map(normalizeClassCode).join("|")}`;
  return String(classCode)
    .split(/[|,;\s]+/)
    .filter(Boolean)
    .map(normalizeClassCode)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .join("|");
}

function makeSearchKey(query) {
  const item = String(query.item || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return `${item}\u001f${normalizeQueryClasses(query.classCode)}`;
}

function sourceProvenance(row) {
  return {
    sourceLabel: row.source || null,
    sourceId: row.sourceId || null,
    sourceContractVersion: row.sourceContractVersion || null,
    sourceFetchedAt: row.sourceFetchedAt || null,
    sourceUrl: row.sourceUrl || null,
    sourceLastVerifiedAt: row.sourceLastVerifiedAt || null,
    sourceContentId: row.sourceContentId || null,
    sourceApplicationNumber: row.sourceApplicationNumber || null,
    sourceRegionName: row.sourceRegionName || null,
    sourceRegionCode: row.sourceRegionCode || null,
    sourceItemName: row.sourceItemName || null,
    sourceRecordUrl: row.sourceRecordUrl || null,
    regionCode: row.regionCode || null,
    regionMatchMethod: row.regionMatchMethod || null,
    normalizationVersion: row.normalizationVersion || null,
    dictionaryVersion: row.dictionaryVersion || null,
    dictionarySourceUrl: row.dictionarySourceUrl || null,
    dictionaryDownloadedAt: row.dictionaryDownloadedAt || null,
    matchPurpose: row.matchPurpose || null,
  };
}

function buildBatchPlan(rows, options = {}) {
  return rows.map((row, inputIndex) => {
    const query = makeBatchQuery(row, options);
    if (query.skipReason) {
      return {
        status: "skipped",
        inputIndex,
        reason: query.skipReason,
        input: row,
        source: row.source || null,
        provenance: sourceProvenance(row),
      };
    }
    return {
      status: "planned",
      inputIndex,
      queryKey: makeSearchKey(query),
      query,
      input: row,
      source: row.source || null,
      provenance: sourceProvenance(row),
    };
  });
}

function groupPlannedQueries(plan) {
  const groups = new Map();
  for (const entry of plan) {
    if (entry.status !== "planned") continue;
    if (!groups.has(entry.queryKey)) {
      groups.set(entry.queryKey, {
        queryKey: entry.queryKey,
        query: { item: entry.query.item, classCode: entry.query.classCode },
        inputIndexes: [],
      });
    }
    groups.get(entry.queryKey).inputIndexes.push(entry.inputIndex);
  }
  return [...groups.values()];
}

function buildSearchOutput(query, result, hits, { pageNo, numOfRows, classCodeFallbackApplied }) {
  const pageNumber = Number(pageNo);
  const pageSize = Number(numOfRows);
  return {
    status: "ok",
    query: {
      region: query.region,
      regionMatch: "unverified",
      item: query.item,
      // 요청 시점에 실제로 알고 있던 류만 기록한다(메타데이터 정확성). 미상일 때 적용한
      // 기본 류 집합은 classCodeFallbackApplied로 따로 표시한다 — 필터는 됐지만 이
      // 특정 류를 "지정해서" 검색한 게 아님을 구분하기 위함.
      classCode: query.classCode || null,
      classCodeFallbackApplied,
    },
    // KIPRIS가 반환한 키워드 전체 건수이며 classCode 필터 전 값이다.
    keywordTotalCount: result.totalCount,
    page: {
      number: pageNumber,
      size: pageSize,
      unfilteredCount: result.hits.length,
      filteredCount: hits.length,
      hasMore: pageNumber * pageSize < result.totalCount,
    },
    fetchedAt: new Date().toISOString(),
    hits,
  };
}

async function searchOne(client, query, options) {
  const effectiveOptions = {
    numOfRows: 20,
    pageNo: 1,
    maxPages: 1,
    maxHitsPerQuery: 100,
    maxRequests: 1,
    ...options,
  };
  const budget = createRequestBudget(effectiveOptions.maxRequests);
  const collected = await collectSearchPages(client, query, effectiveOptions, budget);
  return mapCollectedQuery(query, collected);
}

function createRequestBudget(maxRequests) {
  let used = 0;
  return {
    reserve() {
      if (used >= maxRequests) return false;
      used++;
      return true;
    },
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, maxRequests - used);
    },
  };
}

function hitKey(hit) {
  return (
    String(hit?.applicationNumber || "").replace(/\D/g, "") ||
    `${String(hit?.registrationNumber || "").replace(/\D/g, "")}|${hit?.title || ""}`
  );
}

// 이슈 #137 코멘트(2026-09-04) "근본 누적 구조": collectionStatus가 "complete"인 쿼리를
// --resume으로 영구 재사용하면, 그 검색어로 KIPRIS에 새로 출원되는 상표를 다시는 못 본다
// (완료 판정은 "그 시점 기준 결과가 다 모였다"는 뜻이지 "앞으로도 안 바뀐다"는 뜻이 아니다).
// refreshCompleteAfterDays가 지나면 완료 쿼리도 처음부터 다시 수집해 신선도를 되찾는다.
function isStaleCompleteQuery(saved, refreshAfterDays) {
  const days = Number(refreshAfterDays);
  if (!Number.isFinite(days) || days <= 0) return false;
  const fetchedAtMs = saved?.fetchedAt ? Date.parse(saved.fetchedAt) : NaN;
  if (!Number.isFinite(fetchedAtMs)) return false;
  return (Date.now() - fetchedAtMs) / 86400000 >= days;
}

// 새로고침 수집 결과를 예전 결과와 합친다. KIPRIS 응답 정렬 순서가 무엇인지 문서로 확인되지
// 않아(docs/kipris-api-notes.md 참고) "신규 출원은 앞쪽 페이지에 있다"고 가정하지 않는다 —
// 대신 완료 쿼리를 페이지 1부터 다시 끝까지 수집해서(collectSearchPages, initial 없이) 예전
// hit와 출원번호 기준으로 합집합을 만든다. 정렬이 바뀌어 예전에 봤던 hit가 새 수집 창에서
// 빠지더라도 잃지 않는다. 새로고침 자체가 실패(네트워크 오류 등)하면 예전 complete 결과를
// 그대로 유지해, 일시적 오류로 이미 확인된 데이터를 잃지 않는다.
function mergeRefreshedCollection(saved, refreshed, maxHitsPerQuery) {
  if (refreshed.collectionStatus === "error") return saved;
  const seen = new Set(saved.hits.map(hitKey));
  const merged = [...saved.hits];
  for (const hit of refreshed.hits) {
    const key = hitKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  const capped = Number.isFinite(maxHitsPerQuery) && merged.length > maxHitsPerQuery
    ? merged.slice(0, maxHitsPerQuery)
    : merged;
  return {
    ...refreshed,
    hits: capped,
    keywordTotalCount: Math.max(Number(refreshed.keywordTotalCount) || 0, Number(saved.keywordTotalCount) || 0),
  };
}

function checkpointSeed(query, initial, startPage = 1) {
  if (!initial || !["partial", "error"].includes(initial.collectionStatus)) {
    return {
      keywordTotalCount: 0,
      hits: [],
      pagesFetched: 0,
      nextPage: startPage,
      unfilteredCount: 0,
      filteredCount: 0,
    };
  }
  const fetched = Number(initial.pages?.fetchedCount) || 0;
  let nextPage = Number(initial.pages?.nextPage) || 1;
  // hit 상한(max_hits_per_query)에 걸려 멈춘 쿼리는 마지막 페이지에서 상한 초과분이
  // 잘려나갔고 nextPage는 이미 그 다음을 가리킨다. 더 깊은 상한으로 재개할 때 그 잘린
  // hit를 잃지 않도록 마지막 페이지를 다시 받는다(아래 dedup이 중복을 제거).
  if (["max_hits_per_query", "max_hits"].includes(initial.stopReason) && nextPage > 1) {
    nextPage -= 1;
  }
  return {
    keywordTotalCount: Number(initial.keywordTotalCount) || 0,
    hits: Array.isArray(initial.hits) ? [...initial.hits] : [],
    pagesFetched: fetched,
    nextPage,
    unfilteredCount: Number(initial.pages?.unfilteredCount) || 0,
    filteredCount: Number(initial.pages?.filteredCount) || 0,
  };
}

async function collectSearchPages(client, query, options, budget, initial) {
  const numOfRows = Number(options.numOfRows);
  const maxPages = Number(options.maxPages);
  const maxHitsPerQuery = Number(options.maxHitsPerQuery);
  const state = checkpointSeed(query, initial, Number(options.pageNo) || 1);
  const classCodeFallbackApplied = !query.classCode;
  const allowedClasses = query.classCode || FOOD_RELATED_CLASSES;
  const startedAt = initial?.startedAt || new Date().toISOString();
  // 재개 시 마지막 페이지를 다시 받을 수 있으므로(위 checkpointSeed 참고) 출원번호 기준
  // 중복을 제거한다.
  const seenHitKeys = new Set(state.hits.map(hitKey));
  let collectionStatus = "partial";
  let stopReason = "max_pages";
  let error = null;

  while (state.pagesFetched < maxPages) {
    if (state.hits.length >= maxHitsPerQuery) {
      stopReason = "max_hits_per_query";
      break;
    }
    if (!budget.reserve()) {
      stopReason = "request_budget";
      break;
    }

    const pageNo = state.nextPage;
    let result;
    try {
      result = await client.trademarkSearch({
        searchString: String(query.item),
        numOfRows,
        pageNo,
      });
    } catch (err) {
      collectionStatus = "error";
      stopReason = "api_error";
      error = err instanceof Error ? err.message : String(err);
      break;
    }

    const pageHits = filterByClassCode(result.hits, allowedClasses).filter((hit) => {
      const key = hitKey(hit);
      if (seenHitKeys.has(key)) return false;
      seenHitKeys.add(key);
      return true;
    });
    const remaining = maxHitsPerQuery - state.hits.length;
    state.hits.push(...pageHits.slice(0, remaining));
    state.keywordTotalCount = Number(result.totalCount) || 0;
    state.pagesFetched++;
    state.nextPage = pageNo + 1;
    state.unfilteredCount += result.hits.length;
    state.filteredCount += pageHits.length;

    const hasMore = pageNo * numOfRows < state.keywordTotalCount && result.hits.length > 0;
    if (!hasMore) {
      collectionStatus = "complete";
      stopReason = "source_exhausted";
      break;
    }
    if (state.hits.length >= maxHitsPerQuery) {
      stopReason = "max_hits_per_query";
      break;
    }
  }

  return {
    collectionStatus,
    stopReason,
    error,
    search: {
      item: query.item,
      classCode: query.classCode || null,
      classCodeFallbackApplied,
    },
    keywordTotalCount: state.keywordTotalCount,
    pages: {
      size: numOfRows,
      fetchedCount: state.pagesFetched,
      nextPage: state.nextPage,
      unfilteredCount: state.unfilteredCount,
      filteredCount: state.filteredCount,
      hasMore: collectionStatus !== "complete",
    },
    startedAt,
    fetchedAt: new Date().toISOString(),
    hits: state.hits,
  };
}

function mapCollectedQuery(query, collected, extra = {}) {
  const output = {
    status: collected.collectionStatus === "error" ? "error" : "ok",
    collectionStatus: collected.collectionStatus,
    stopReason: collected.stopReason,
    query: {
      region: query.region,
      regionMatch: "unverified",
      item: query.item,
      classCode: query.classCode || null,
      classCodeFallbackApplied: !query.classCode,
    },
    keywordTotalCount: collected.keywordTotalCount,
    pages: collected.pages,
    fetchedAt: collected.fetchedAt,
    hits: collected.hits,
    ...extra,
  };
  if (collected.error) output.error = collected.error;
  return output;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runOne()
  );
  await Promise.all(workers);
  return results;
}

// ⑤단계가 "대표 특산품"을 판정하려면 어느 수집 출처(지리적표시/농사로 등)에서 온
// 행인지가 필요하다. skipped 행은 이미 input 전체를 보존해 source가 딸려오지만,
// 검색이 실제로 일어난 ok/error 행은 query/hits만 담아 source가 빠져 있었다 — 여기서
// 함께 실어보내 ④가 지역×품목 버킷에 집계할 수 있게 한다.
async function runBatch(rows, client, options) {
  options = {
    numOfRows: 20,
    pageNo: 1,
    maxPages: 1,
    maxHitsPerQuery: 100,
    maxRequests: 100,
    concurrency: 2,
    ...options,
  };
  const plan = buildBatchPlan(rows, options);
  const groups = groupPlannedQueries(plan);
  const budget = options.requestBudget || createRequestBudget(options.maxRequests);
  const checkpointQueries = options.checkpointQueries || {};
  let resumedQueryCount = 0;
  let refreshedQueryCount = 0;

  const collectedGroups = await runWithConcurrency(groups, options.concurrency, async (group) => {
    const saved = checkpointQueries[group.queryKey];
    const isCompleteCheckpoint = options.resume && saved?.collectionStatus === "complete";
    let collected;
    if (isCompleteCheckpoint && !isStaleCompleteQuery(saved, options.refreshCompleteAfterDays)) {
      collected = saved;
      resumedQueryCount++;
    } else if (isCompleteCheckpoint) {
      // 완료 쿼리가 신선도 기한을 넘겼다 — 이어받기가 아니라 처음부터 다시 수집해서(신규
      // 출원을 놓치지 않도록) 예전 hit와 합집합으로 합친다.
      const refreshed = await collectSearchPages(client, group.query, options, budget, null);
      collected = mergeRefreshedCollection(saved, refreshed, Number(options.maxHitsPerQuery));
      checkpointQueries[group.queryKey] = collected;
      refreshedQueryCount++;
      if (options.saveCheckpoint) options.saveCheckpoint(checkpointQueries, budget.used);
    } else {
      collected = await collectSearchPages(
        client,
        group.query,
        options,
        budget,
        options.resume ? saved : null
      );
      checkpointQueries[group.queryKey] = collected;
      const checkpointChanged =
        !saved ||
        Number(collected.pages?.nextPage) !== Number(saved.pages?.nextPage) ||
        collected.collectionStatus !== saved.collectionStatus ||
        collected.stopReason !== saved.stopReason ||
        (collected.hits?.length || 0) !== (saved.hits?.length || 0);
      if (options.saveCheckpoint && checkpointChanged) {
        options.saveCheckpoint(checkpointQueries, budget.used);
      }
    }
    return { ...group, collected, reusedFromCheckpoint: collected === saved };
  });

  const byKey = new Map(collectedGroups.map((group) => [group.queryKey, group]));
  const results = plan.map((entry) => {
    if (entry.status === "skipped") return entry;
    const group = byKey.get(entry.queryKey);
    const mapped = {
      inputIndex: entry.inputIndex,
      input: entry.input,
      source: entry.source,
      provenance: entry.provenance,
      queryKey: entry.queryKey,
      sharedQueryInputCount: group.inputIndexes.length,
      reusedFromCheckpoint: group.reusedFromCheckpoint,
      ...mapCollectedQuery(entry.query, group.collected),
    };
    mapped.hits = enrichHitsWithAreaBrands(
      mapped.hits,
      entry.query.region,
      options.areaBrandContext
    );
    return mapped;
  });
  const uniqueQueryStatusCounts = { complete: 0, partial: 0, error: 0 };
  for (const group of collectedGroups) {
    const status = group.collected?.collectionStatus;
    if (Object.hasOwn(uniqueQueryStatusCounts, status)) uniqueQueryStatusCounts[status]++;
  }
  return {
    results,
    uniqueQueryCount: groups.length,
    uniqueQueryStatusCounts,
    requestCount: (options.priorRequestCount || 0) + budget.used,
    requestCountThisRun: budget.used,
    resumedQueryCount,
    refreshedQueryCount,
  };
}

function writeJson(output, outArg) {
  const json = JSON.stringify(output, null, 2);
  if (!outArg) {
    console.log(json);
    return null;
  }
  const outPath = path.resolve(outArg);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, json, "utf8");
  return outPath;
}

function writeJsonAtomic(filePath, output) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(output, null, 2), "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      const retryable = ["EPERM", "EBUSY", "EACCES"].includes(error?.code);
      if (!retryable || attempt >= 19) {
        try { fs.rmSync(tempPath, { force: true }); } catch {}
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

function areaBrandValidationMetadata(context, sourceFile, results) {
  if (!context) return { enabled: false };
  const metadata = {
    enabled: true,
    sourceFile,
    referenceCount: context.brands.length,
    sourceMetadata: context.metadata,
    criteria: {
      applicationJoin: "출원번호에서 숫자 외 문자를 제거한 뒤 완전일치",
      regionNormalization: "국토교통부 법정동코드 시도·시군구명 완전일치, 고유한 시/군/구 접미사 복원",
      ambiguousRegionPolicy: "복수 후보 또는 미매칭 지역은 추정하지 않고 unverified",
      statisticalMeaning: "지역브랜드 연관성 검증이며 출원인 주소 근거가 아님",
    },
  };
  if (results) metadata.matchCounts = summarizeRegionalBrandMatches(results);
  return metadata;
}

function loadCheckpoint(filePath, options) {
  if (!fs.existsSync(filePath)) throw new Error(`재개할 체크포인트가 없습니다: ${filePath}`);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  // numOfRows(페이지 크기)는 재개 중 바뀌면 저장된 pages.nextPage 커서 의미가 어긋나므로
  // 완전일치를 요구한다.
  if (Number(parsed.options?.numOfRows) !== Number(options.numOfRows)) {
    throw new Error(`체크포인트 numOfRows=${parsed.options?.numOfRows}가 현재 값 ${options.numOfRows}와 다릅니다.`);
  }
  // maxHitsPerQuery·maxPages는 "더 깊게"만 허용한다(낮추면 이미 수집한 걸 잘라내는 셈이라
  // 금지). 2026-09-04: 운영 파이프라인이 얕은 상한(150건)으로 만든 체크포인트를,
  // partial 쿼리만 골라 문서화된 깊은 상한(3,000건 = 150페이지)으로 이어서 보수하려면
  // 이 상향 재개가 필요하다(03-match-trademarks/README.md "범위가 명시된 제한적 완료").
  for (const key of ["maxHitsPerQuery", "maxPages"]) {
    const saved = Number(parsed.options?.[key]);
    const current = Number(options[key]);
    if (!Number.isInteger(saved) || current < saved) {
      throw new Error(`체크포인트 ${key}=${parsed.options?.[key]}보다 현재 값 ${options[key]}가 작습니다(더 깊게만 재개 가능).`);
    }
  }
  return parsed;
}

// ④ analyzer·대시보드 어디서도 안 쓰는 hit 필드(drawing=이미지 URL이 가장 큼, agent,
// publicationNumber/Date, rightHolder)를 저장 단계에서 제거한다. hit 수십만 건이면 이 필드
// 때문에 파이프라인 중간파일이 enrichIpRegistry·analyzeBrands의 통짜 JSON.parse/stringify
// 512MB 문자열 한계를 넘겨 쿼리당 상한을 못 올린다(2026-09-04, #70). 실측 ~64% 절감.
const HIT_DROP_FIELDS = ["drawing", "agent", "publicationNumber", "publicationDate", "rightHolder", "bigDrawing", "viennaCode", "fullText"];
function leanHit(hit) {
  if (!hit || typeof hit !== "object") return hit;
  const lean = {};
  for (const key of Object.keys(hit)) {
    if (!HIT_DROP_FIELDS.includes(key)) lean[key] = hit[key];
  }
  return lean;
}

function compactBatchOutput(output, { outMaxHits } = {}) {
  // 수집(체크포인트)은 문서 상한(3,000)까지 깊게 하되, 통합 파이프라인의 중간파일이
  // enrichIpRegistry·analyzeBrands의 통짜 JSON 512MB 한계를 넘지 않도록 출력에서만
  // hit 수를 자를 수 있게 한다(--out-max-hits). 전체 수집분은 체크포인트에 보존된다.
  const cap = Number.isInteger(outMaxHits) && outMaxHits > 0 ? outMaxHits : Infinity;
  const queryFacts = {};
  const results = (output.results || []).map((entry) => {
    if (!entry.queryKey || !Array.isArray(entry.hits)) return entry;
    if (!queryFacts[entry.queryKey]) {
      const {
        inputIndex,
        input,
        source,
        provenance,
        reusedFromCheckpoint,
        ...fact
      } = entry;
      const capped = Array.isArray(fact.hits) ? fact.hits.slice(0, cap).map(leanHit) : fact.hits;
      queryFacts[entry.queryKey] = {
        ...fact,
        hits: capped,
        ...(Array.isArray(fact.hits) && fact.hits.length > cap
          ? { outputHitCap: { cap, collectedCount: fact.hits.length } }
          : {}),
        query: {
          ...(fact.query || {}),
          region: null,
          regionMatch: "not_applicable",
        },
      };
    }
    const {
      hits,
      keywordTotalCount,
      pages,
      fetchedAt,
      stopReason,
      error,
      ...reference
    } = entry;
    return reference;
  });
  return {
    ...output,
    schemaVersion: "1.3",
    storageMode: "query_facts",
    queryFactCount: Object.keys(queryFacts).length,
    queryFacts,
    results,
  };
}

function validateNumericArgs(args) {
  const numOfRows = Number(args.numOfRows);
  const pageNo = Number(args.pageNo);
  const concurrency = Number(args.concurrency);
  const maxRequests = Number(args["max-requests"]);
  const maxPages = Number(args["max-pages"]);
  const maxHitsPerQuery = Number(args["max-hits-per-query"]);
  if (!["query-facts", "expanded"].includes(String(args["storage-mode"]))) {
    printUsageAndExit("--storage-mode 은 query-facts 또는 expanded 여야 합니다.");
  }
  if (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > 100) {
    printUsageAndExit("--numOfRows 는 1~100 사이의 정수여야 합니다.");
  }
  if (!Number.isInteger(pageNo) || pageNo < 1) {
    printUsageAndExit("--pageNo 는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    printUsageAndExit("--concurrency 는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    printUsageAndExit("--max-requests 는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    printUsageAndExit("--max-pages 는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isInteger(maxHitsPerQuery) || maxHitsPerQuery < 1) {
    printUsageAndExit("--max-hits-per-query 는 1 이상의 정수여야 합니다.");
  }
  const maxRegistryRequests = Number(args["max-registry-requests"]);
  if (!Number.isInteger(maxRegistryRequests) || maxRegistryRequests < 1 || maxRegistryRequests > 100) {
    printUsageAndExit("--max-registry-requests 는 1~100 정수여야 합니다.");
  }
  const registryConcurrency = Number(args["registry-concurrency"]);
  if (!Number.isInteger(registryConcurrency) || registryConcurrency < 1 || registryConcurrency > 5) {
    printUsageAndExit("--registry-concurrency 는 1~5 정수여야 합니다.");
  }
  const refreshCompleteAfterDays = Number(args["refresh-complete-after-days"]);
  if (!Number.isInteger(refreshCompleteAfterDays) || refreshCompleteAfterDays < 0) {
    printUsageAndExit("--refresh-complete-after-days 는 0 이상의 정수여야 합니다(0=끔).");
  }
  return {
    numOfRows,
    pageNo,
    concurrency,
    maxRequests,
    maxPages,
    maxHitsPerQuery,
    maxRegistryRequests,
    registryConcurrency,
    refreshCompleteAfterDays,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input && (!args.region || !args.item)) {
    printUsageAndExit("단일 모드는 --region/--item, 배치 모드는 --input 이 필요합니다.");
  }
  if (args.input && (args.region || args.item)) {
    printUsageAndExit("--input 과 --region/--item 은 함께 사용할 수 없습니다.");
  }
  if (args["dry-run"] && !args.input) {
    printUsageAndExit("--dry-run 은 --input 배치 모드에서만 사용할 수 있습니다.");
  }

  const numeric = validateNumericArgs(args);
  const apiKey = args.apiKey || process.env.KIPRIS_API_KEY;
  const areaBrandsPath = args["area-brands"] ? path.resolve(args["area-brands"]) : null;
  const areaBrandDocument = areaBrandsPath ? loadAreaBrandDocument(areaBrandsPath) : null;
  const areaBrands = areaBrandDocument?.brands || null;
  const areaBrandContext = areaBrandDocument
    ? createAreaBrandContext(areaBrands, undefined, areaBrandDocument.metadata)
    : null;
  const registryApiKey = args.registryApiKey || process.env.IP_REGISTRY_API_KEY;
  const ipRegistryContext = args["enrich-registry"]
    ? createIpRegistryContext({
        client: createIpRegistryClient({ apiKey: registryApiKey }),
        maxRequests: numeric.maxRegistryRequests,
        concurrency: numeric.registryConcurrency,
      })
    : null;

  if (args.input) {
    const inputPath = path.resolve(args.input);
    const rows = readNormalizedCsv(inputPath);
    const batchPlanOptions = { includeReviewRequired: Boolean(args["include-review-required"]) };
    const plan = buildBatchPlan(rows, batchPlanOptions);
    const uniqueQueries = groupPlannedQueries(plan);
    const searchableRows = countSearchableRows(rows, batchPlanOptions);
    const estimatedMinRequests = Math.min(uniqueQueries.length, numeric.maxRequests);
    const estimatedMaxRequests = Math.min(
      uniqueQueries.length * numeric.maxPages,
      numeric.maxRequests
    );
    if (args["dry-run"]) {
      const output = {
        mode: "batch-dry-run",
        trademarkSourceMetadata: KIPRIS_SOURCE_METADATA,
        inputFile: inputPath,
        inputCount: rows.length,
        searchableRowCount: searchableRows,
        uniqueQueryCount: uniqueQueries.length,
        duplicateQueryRowCount: searchableRows - uniqueQueries.length,
        estimatedMinRequestCount: estimatedMinRequests,
        estimatedMaxRequestCount: estimatedMaxRequests,
        maxRequestCount: numeric.maxRequests,
        reviewRequiredSearchEnabled: batchPlanOptions.includeReviewRequired,
        regionalBrandValidation: areaBrandValidationMetadata(areaBrandContext, areaBrandsPath),
        skippedCount: plan.filter((row) => row.status === "skipped").length,
        completedAt: new Date().toISOString(),
        results: plan,
      };
      const outPath = writeJson(output, args.out);
      console.error(
        `[matchTrademarks] dry-run. rows=${searchableRows}, uniqueQueries=${uniqueQueries.length}, requests=${estimatedMinRequests}~${estimatedMaxRequests}, skipped=${output.skippedCount}${outPath ? ` -> ${outPath}` : ""}`
      );
      return;
    }
    const client = createClient({ apiKey });
    const outPathArg = args.out ? path.resolve(args.out) : null;
    const checkpointPath = path.resolve(
      args.checkpoint ||
        (outPathArg ? `${outPathArg}.checkpoint.json` : path.join(__dirname, "output", "batch-checkpoint.json"))
    );
    // 이슈 #137 코멘트(2026-09-04) "원자료 archive 삭제 금지": 체크포인트는 수십만 hit를
    // 담은 원자료 archive다(운영 실행에서 수백MB) — --resume 없이 같은 경로로 실행하면 이번
    // 실행 예산만큼만 모은 새 체크포인트로 통째로 덮어써 그동안 쌓은 수집분을 조용히
    // 날린다. runOperationalPipeline.js는 파일이 있으면 자동으로 --resume을 붙이지만, 이
    // 스크립트를 직접 호출할 때는 이 안전장치가 없었다.
    if (!args.resume && fs.existsSync(checkpointPath) && !args["overwrite-checkpoint"]) {
      printUsageAndExit(
        `체크포인트가 이미 있습니다: ${checkpointPath}\n` +
        `이어서 모으려면 --resume, 기존 수집분을 버리고 새로 시작하려면 --overwrite-checkpoint를 쓰세요.`
      );
    }
    const checkpoint = args.resume
      ? loadCheckpoint(checkpointPath, numeric)
      : { schemaVersion: "1.0", options: numeric, requestCount: 0, queries: {} };
    const priorRequestCount = Number(checkpoint.requestCount) || 0;
    const saveCheckpoint = (queries, requestCountThisRun = 0) =>
      writeJsonAtomic(checkpointPath, {
        schemaVersion: "1.0",
        options: {
          numOfRows: numeric.numOfRows,
          maxPages: numeric.maxPages,
          maxHitsPerQuery: numeric.maxHitsPerQuery,
        },
        requestCount: priorRequestCount + requestCountThisRun,
        updatedAt: new Date().toISOString(),
        queries,
      });
    console.error(
      `[matchTrademarks] batch input=${rows.length}행, searchable=${searchableRows}, uniqueQueries=${uniqueQueries.length}, requestBudget=${numeric.maxRequests}`
    );
    const batch = await runBatch(rows, client, {
      ...numeric,
      ...batchPlanOptions,
      resume: Boolean(args.resume),
      checkpointQueries: checkpoint.queries || {},
      priorRequestCount,
      saveCheckpoint,
      areaBrandContext,
    });
    const results = batch.results;
    if (ipRegistryContext) {
      for (const entry of results) {
        if (entry.status === "ok" && Array.isArray(entry.hits)) {
          entry.hits = await enrichHitsWithIpRegistry(entry.hits, entry.query, ipRegistryContext);
        }
      }
    }
    let output = {
      schemaVersion: "1.2",
      mode: "batch",
      trademarkSourceMetadata: {
        ...KIPRIS_SOURCE_METADATA,
        fetchedAt: new Date().toISOString(),
      },
      inputFile: inputPath,
      inputCount: rows.length,
      searchableRowCount: searchableRows,
      uniqueQueryCount: batch.uniqueQueryCount,
      completeUniqueQueryCount: batch.uniqueQueryStatusCounts.complete,
      partialUniqueQueryCount: batch.uniqueQueryStatusCounts.partial,
      erroredUniqueQueryCount: batch.uniqueQueryStatusCounts.error,
      uniqueQueryStatusCounts: batch.uniqueQueryStatusCounts,
      duplicateQueryRowCount: searchableRows - batch.uniqueQueryCount,
      reviewRequiredSearchEnabled: batchPlanOptions.includeReviewRequired,
      requestCount: batch.requestCount,
      requestCountThisRun: batch.requestCountThisRun,
      resumedQueryCount: batch.resumedQueryCount,
      refreshedQueryCount: batch.refreshedQueryCount,
      successCount: results.filter((row) => row.status === "ok").length,
      partialCount: results.filter((row) => row.collectionStatus === "partial").length,
      errorCount: results.filter((row) => row.status === "error").length,
      skippedCount: results.filter((row) => row.status === "skipped").length,
      checkpointFile: checkpointPath,
      regionalBrandValidation: areaBrandValidationMetadata(
        areaBrandContext,
        areaBrandsPath,
        results
      ),
      ipRegistryEnrichment: ipRegistryValidationMetadata(ipRegistryContext, results),
      completedAt: new Date().toISOString(),
      results,
    };
    if (args["storage-mode"] === "query-facts") {
      output = compactBatchOutput(output, { outMaxHits: args["out-max-hits"] ? Number(args["out-max-hits"]) : undefined });
    }
    const outPath = writeJson(output, args.out);
    console.error(
      `[matchTrademarks] batch done. requests=${output.requestCount}, success=${output.successCount}, partial=${output.partialCount}, error=${output.errorCount}, skipped=${output.skippedCount}${outPath ? ` -> ${outPath}` : ""}`
    );
    if (output.errorCount > 0) process.exitCode = 2;
    return;
  }

  const query = {
    region: String(args.region),
    item: String(args.item),
    classCode: args.classCode || null,
  };
  console.error(
    `[matchTrademarks] item="${query.item}" region="${query.region}" (등록원부 보강은 --enrich-registry 선택)`
  );
  const client = createClient({ apiKey });
  const output = await searchOne(client, query, numeric);
  output.trademarkSourceMetadata = {
    ...KIPRIS_SOURCE_METADATA,
    fetchedAt: output.fetchedAt,
  };
  output.hits = enrichHitsWithAreaBrands(output.hits, query.region, areaBrandContext);
  output.regionalBrandValidation = areaBrandValidationMetadata(
    areaBrandContext,
    areaBrandsPath,
    [output]
  );
  if (ipRegistryContext) {
    output.hits = await enrichHitsWithIpRegistry(output.hits, query, ipRegistryContext);
  }
  output.ipRegistryEnrichment = ipRegistryValidationMetadata(ipRegistryContext, [output]);
  const outPath = writeJson(output, args.out);
  console.error(
    `[matchTrademarks] pages=${output.pages.fetchedCount}, filtered=${output.hits.length}, collection=${output.collectionStatus}, keywordTotal=${output.keywordTotalCount}${outPath ? ` -> ${outPath}` : ""}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[matchTrademarks] 실패: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  parseCsvLine,
  readNormalizedCsv,
  makeBatchQuery,
  countSearchableRows,
  makeSearchKey,
  sourceProvenance,
  buildBatchPlan,
  groupPlannedQueries,
  buildSearchOutput,
  searchOne,
  collectSearchPages,
  createRequestBudget,
  mapCollectedQuery,
  runBatch,
  runWithConcurrency,
  loadCheckpoint,
  areaBrandValidationMetadata,
  compactBatchOutput,
};
