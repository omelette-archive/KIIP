#!/usr/bin/env node
"use strict";
/**
 * 지역 특산품 원시 목록을 여러 소스에서 수집해 표준 스키마로 합친다.
 * { sido, sigungu, regionCode, regionMatchMethod, sourceRegionName,
 *   sourceRegionCode, sourceItemName, sourceRecordUrl, rawItemName, source,
 *   sourceId, sourceContractVersion, sourceUrl, sourceLastVerifiedAt, collectedAt }[]
 *
 * 사용법:
 *   node 01-collect-specialties/collectSpecialties.js --sources gi,nongsaro,nfqs_geographical_indication --out <path>
 *
 * 소스:
 *   gi        국립농산물품질관리원 지리적표시 등록정보 (GI_API_KEY 필요)
 *   nongsaro  농촌진흥청 지역특산물 (NONGSARO_API_KEY, NONGSARO_API_BASE_URL 필요)
 *   sejong_official_specialties  세종시 공식 특산품 검증 스냅샷
 *   jeju_naqs_gi_specialties     농관원 제주 지리적표시 검증 스냅샷
 *   seogwipo_grandculture_specialties 디지털서귀포문화대전 특산물 검증 스냅샷
 *   nfqs_quality_cert            국립수산물품질관리원 품질인증수산물(NFQS_QUALITY_API_KEY 필요)
 *   nfqs_geographical_indication 국립수산물품질관리원 지리적표시수산물(NFQS_GEO_API_KEY 필요)
 * API 소스는 제공기관 활용신청 승인이 필요하다. 키가 없으면 해당 API 소스만
 * 건너뛰고 경고를 남기며, 공식 검증 스냅샷은 인증 없이 함께 적재한다.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { loadAdminCodes } = require("./lib/adminCodes");
const { createClient: createGiClient, normalizeDate: normalizeGiDate } = require("./lib/giClient");
const { createClient: createNongsaroClient } = require("./lib/nongsaroClient");
const { createClient: createNfqsClient } = require("./lib/nfqsClient");
const { createClient: createNfqsGeoClient } = require("./lib/nfqsGeoClient");
const { createClient: createKofpiClient } = require("./lib/kofpiClient");
const {
  fromGiRegistrations,
  fromNongsaro,
  fromNfqsCertifications,
  fromNfqsGeographicalIndications,
  fromKofpiProducts,
} = require("./lib/normalize");
const { getSourceDefinition, loadSourceRegistry } = require("./lib/sourceRegistry");
const { createCollectionStore, makeStoredRecords } = require("./lib/collectionStore");
const {
  loadOfficialSupplement,
  normalizeOfficialSupplement,
} = require("./lib/officialSupplement");

loadEnv();

function parseArgs(argv) {
  const args = {
    sources: "gi,nongsaro,nfqs_quality_cert,nfqs_geographical_indication,kofpi_forest_product,sejong_official_specialties,jeju_naqs_gi_specialties,seogwipo_grandculture_specialties",
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
      "  node 01-collect-specialties/collectSpecialties.js [옵션]",
      "",
      "옵션:",
      "  --sources <목록>   콤마 구분 (기본 gi,nongsaro,sejong_official_specialties,jeju_naqs_gi_specialties)",
      "  --out <path>       결과 CSV 저장 경로 (기본 01-collect-specialties/output/specialties.csv)",
      "  --db <path>        누적 SQLite 경로 (기본: CSV와 같은 이름의 .sqlite)",
      "  --limit <n>        소스별 최대 수집 건수 (샘플 검증용)",
      "  --gi-date <목록>    GI 등록일 YYYYMMDD 목록 (콤마 구분, 기본: 한국시간 오늘)",
      "  --gi-from <날짜>    GI 누락 복구 시작일 YYYYMMDD (--gi-to와 함께 사용)",
      "  --gi-to <날짜>      GI 누락 복구 종료일 YYYYMMDD (양끝 포함)",
      "  --gi-max-days <n>   GI 범위 조회 보호 상한 (기본 31, 최대 366)",
      "  --allow-empty      모든 소스가 실패해도 빈 CSV를 쓰고 성공 처리",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function currentKstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

function giDateToUtc(date) {
  const normalized = normalizeGiDate(date);
  return new Date(Date.UTC(
    Number(normalized.slice(0, 4)),
    Number(normalized.slice(4, 6)) - 1,
    Number(normalized.slice(6, 8))
  ));
}

function resolveGiRegistrationDates(args) {
  const explicit = args["gi-date"];
  const from = args["gi-from"];
  const to = args["gi-to"];
  if (explicit && (from || to)) {
    throw new Error("--gi-date와 --gi-from/--gi-to는 동시에 사용할 수 없습니다.");
  }
  if ((from && !to) || (!from && to)) {
    throw new Error("--gi-from과 --gi-to는 함께 지정해야 합니다.");
  }
  if (explicit) {
    const dates = String(explicit).split(",").map((date) => normalizeGiDate(date.trim()));
    return [...new Set(dates)];
  }
  if (!from && !to) return [currentKstDate()];

  const maxDays = args["gi-max-days"] === undefined ? 31 : Number(args["gi-max-days"]);
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 366) {
    throw new Error("--gi-max-days는 1~366 정수여야 합니다.");
  }
  const start = giDateToUtc(from);
  const end = giDateToUtc(to);
  if (start > end) throw new Error("--gi-from은 --gi-to보다 늦을 수 없습니다.");
  const dayCount = Math.floor((end - start) / 86400000) + 1;
  if (dayCount > maxDays) {
    throw new Error(`GI 범위 조회는 ${maxDays}일을 초과할 수 없습니다. 범위를 나눠 실행하세요.`);
  }
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
    dates.push(cursor.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return dates;
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeOutputCsv(outPath, rows) {
  const fields = [
    "sido", "sigungu", "rawItemName", "source", "sourceId", "sourceContractVersion",
    "sourceUrl", "sourceLastVerifiedAt", "collectedAt", "regionCode", "regionMatchMethod",
    "sourceRegionName", "sourceRegionCode", "sourceItemName", "sourceRecordUrl", "sourceScope",
  ];
  const lines = [fields.join(",")];
  for (const row of rows) lines.push(fields.map((f) => csvEscape(row[f])).join(","));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, "﻿" + lines.join("\n") + "\n", "utf8");
}

function addSourceMetadata(rows, definition) {
  return rows.map((row) => ({
    ...row,
    sourceId: definition.id,
    sourceContractVersion: definition.dataVersion,
    sourceUrl: definition.catalogUrl,
    sourceLastVerifiedAt: definition.lastVerifiedAt,
  }));
}

async function collectGi(adminList, warnings, options = {}) {
  let requestCount = 0;
  try {
    const client = createGiClient({
      apiKey: process.env.GI_API_KEY,
      baseUrl: process.env.GI_API_BASE_URL,
      onRequest: () => requestCount++,
    });
    const registrations = await client.listRegistrations({
      registrationDates: options.giRegistrationDates,
      limit: options.limit,
    });
    const normalized = fromGiRegistrations(registrations, adminList);
    const rows = addSourceMetadata(normalized.rows, options.sourceDefinition);
    const w = normalized.warnings;
    warnings.push(...w);
    return {
      rows,
      rawRecords: makeStoredRecords("gi", registrations, rows),
      succeeded: true,
      requestCount,
    };
  } catch (err) {
    warnings.push(`gi 소스 건너뜀: ${err.message}`);
    return { rows: [], rawRecords: [], succeeded: false, requestCount, error: err.message };
  }
}

async function collectNongsaro(adminList, warnings, options = {}) {
  let requestCount = 0;
  try {
    const client = createNongsaroClient({
      apiKey: process.env.NONGSARO_API_KEY,
      baseUrl: process.env.NONGSARO_API_BASE_URL,
      onRequest: () => requestCount++,
    });
    const specialties = await client.listSpecialties({ numOfRows: 200, limit: options.limit });
    const normalized = fromNongsaro(specialties, adminList);
    const rows = addSourceMetadata(normalized.rows, options.sourceDefinition);
    const w = normalized.warnings;
    warnings.push(...w);
    return {
      rows,
      rawRecords: makeStoredRecords("nongsaro", specialties, rows),
      succeeded: true,
      requestCount,
    };
  } catch (err) {
    warnings.push(`nongsaro 소스 건너뜀: ${err.message}`);
    return { rows: [], rawRecords: [], succeeded: false, requestCount, error: err.message };
  }
}

async function collectNfqs(adminList, warnings, options = {}) {
  let requestCount = 0;
  try {
    const client = createNfqsClient({
      certKey: process.env.NFQS_QUALITY_API_KEY,
      baseUrl: process.env.NFQS_QUALITY_API_BASE_URL,
      onRequest: () => requestCount++,
    });
    const certifications = await client.listCertifications({ limit: options.limit });
    const normalized = fromNfqsCertifications(certifications, adminList);
    const rows = addSourceMetadata(normalized.rows, options.sourceDefinition);
    warnings.push(...normalized.warnings);
    return {
      rows,
      rawRecords: makeStoredRecords("nfqs_quality_cert", certifications, rows),
      succeeded: true,
      requestCount,
    };
  } catch (err) {
    warnings.push(`nfqs_quality_cert 소스 건너뜀: ${err.message}`);
    return { rows: [], rawRecords: [], succeeded: false, requestCount, error: err.message };
  }
}

async function collectNfqsGeographicalIndications(adminList, warnings, options = {}) {
  let requestCount = 0;
  try {
    const client = createNfqsGeoClient({
      certKey: process.env.NFQS_GEO_API_KEY,
      baseUrl: process.env.NFQS_GEO_API_BASE_URL,
      onRequest: () => requestCount++,
    });
    const registrations = await client.listRegistrations({ limit: options.limit });
    const normalized = fromNfqsGeographicalIndications(registrations, adminList);
    const rows = addSourceMetadata(normalized.rows, options.sourceDefinition);
    warnings.push(...normalized.warnings);
    return {
      rows,
      rawRecords: makeStoredRecords("nfqs_geographical_indication", registrations, rows),
      succeeded: true,
      requestCount,
    };
  } catch (err) {
    warnings.push(`nfqs_geographical_indication 소스 건너뜀: ${err.message}`);
    return { rows: [], rawRecords: [], succeeded: false, requestCount, error: err.message };
  }
}

async function collectKofpi(_adminList, warnings, options = {}) {
  let requestCount = 0;
  try {
    const client = createKofpiClient({ onRequest: () => requestCount++ });
    const products = await client.listProducts({ limit: options.limit });
    const normalized = fromKofpiProducts(products);
    const rows = addSourceMetadata(normalized.rows, options.sourceDefinition);
    warnings.push(...normalized.warnings);
    return {
      rows,
      rawRecords: makeStoredRecords("kofpi_forest_product", products, rows),
      succeeded: true,
      requestCount,
    };
  } catch (err) {
    warnings.push(`kofpi_forest_product 소스 건너뜀: ${err.message}`);
    return { rows: [], rawRecords: [], succeeded: false, requestCount, error: err.message };
  }
}

const OFFICIAL_SUPPLEMENT_PATHS = {
  sejong_official_specialties: path.join(__dirname, "data", "sejong-official-specialties.json"),
  jeju_naqs_gi_specialties: path.join(__dirname, "data", "jeju-naqs-gi-specialties.json"),
  seogwipo_grandculture_specialties: path.join(__dirname, "data", "seogwipo-grandculture-specialties.json"),
};

async function collectOfficialSupplement(adminList, warnings, options = {}) {
  const definition = options.sourceDefinition;
  try {
    const document = loadOfficialSupplement(OFFICIAL_SUPPLEMENT_PATHS[definition.id]);
    const records = options.limit === undefined
      ? document.records
      : document.records.slice(0, options.limit);
    const normalized = normalizeOfficialSupplement({ ...document, records }, adminList, definition.name);
    warnings.push(...normalized.warnings);
    const rows = addSourceMetadata(normalized.rows, definition);
    return {
      rows,
      rawRecords: makeStoredRecords(definition.id, records, rows),
      succeeded: true,
      requestCount: 0,
    };
  } catch (err) {
    warnings.push(`${definition.id} 소스 건너뜀: ${err.message}`);
    return { rows: [], rawRecords: [], succeeded: false, requestCount: 0, error: err.message };
  }
}

const COLLECTORS = {
  gi: collectGi,
  nongsaro: collectNongsaro,
  sejong_official_specialties: collectOfficialSupplement,
  jeju_naqs_gi_specialties: collectOfficialSupplement,
  seogwipo_grandculture_specialties: collectOfficialSupplement,
  nfqs_quality_cert: collectNfqs,
  nfqs_geographical_indication: collectNfqsGeographicalIndications,
  kofpi_forest_product: collectKofpi,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();

  const outPath = path.resolve(args.out || path.join(__dirname, "output", "specialties.csv"));
  const parsedOut = path.parse(outPath);
  const dbPath = path.resolve(args.db || path.join(parsedOut.dir, `${parsedOut.name}.sqlite`));
  const sources = [...new Set(String(args.sources).split(",").map((s) => s.trim()).filter(Boolean))];
  const sourceRegistry = loadSourceRegistry();
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    printUsageAndExit("--limit 는 1 이상의 정수여야 합니다.");
  }
  const giRegistrationDates = sources.includes("gi") ? resolveGiRegistrationDates(args) : [];
  if (giRegistrationDates.length) {
    console.error(
      `[collectSpecialties] GI 등록일 조회 ${giRegistrationDates.length}일 ` +
      `(${giRegistrationDates[0]}~${giRegistrationDates[giRegistrationDates.length - 1]})`
    );
  }

  const warnings = [];
  let rows = [];
  let rawRecords = [];
  let succeededSources = 0;
  let failedSources = 0;
  let requestCount = 0;
  let stored = { inserted: 0, updated: 0, unchanged: 0 };
  const sourceResults = {};
  const store = createCollectionStore(dbPath);
  const runId = store.startRun({
    sources,
    queryScope: { limit: limit ?? null, giRegistrationDates },
  });
  let runFinished = false;

  try {
    const adminList = loadAdminCodes();
    console.error(`[collectSpecialties] 법정동코드 마스터 ${adminList.length.toLocaleString()}건 로드`);

    for (const source of sources) {
      const definition = getSourceDefinition(source, sourceRegistry);
      const collector = COLLECTORS[source];
      if (!definition || definition.role !== "collector" || !collector) {
        const message = `알 수 없는 소스: ${source}`;
        warnings.push(message);
        failedSources++;
        sourceResults[source] = { succeeded: false, requestCount: 0, rowCount: 0, error: message };
        continue;
      }
      const result = await collector(adminList, warnings, {
        limit,
        giRegistrationDates,
        sourceDefinition: definition,
      });
      requestCount += result.requestCount;
      if (result.succeeded) succeededSources++;
      else failedSources++;
      sourceResults[source] = {
        succeeded: result.succeeded,
        requestCount: result.requestCount,
        rowCount: result.rows.length,
        error: result.error || null,
      };
      console.error(`[collectSpecialties] ${source} (${definition.name}) -> ${result.rows.length}행`);
      rows = rows.concat(result.rows);
      rawRecords = rawRecords.concat(result.rawRecords);
    }

    if (succeededSources === 0 && !args["allow-empty"]) {
      const details = warnings.length ? ` 원인: ${warnings.slice(0, 5).join("; ")}` : "";
      throw new Error(
        `선택한 수집 소스가 모두 실패했습니다. 빈 결과를 의도했다면 --allow-empty를 사용하세요.${details}`
      );
    }

    stored = store.persistRecords(runId, rawRecords);
    writeOutputCsv(outPath, rows);
    const status = succeededSources === 0 ? "empty_allowed" : failedSources > 0 ? "partial" : "success";
    store.finishRun(runId, {
      status,
      sourceResults,
      requestCount,
      succeededSourceCount: succeededSources,
      failedSourceCount: failedSources,
      rowCount: rows.length,
      stored,
      warnings,
    });
    runFinished = true;

    console.error(
      `[collectSpecialties] done. total=${rows.length}, requests=${requestCount}, ` +
      `db(inserted=${stored.inserted}, updated=${stored.updated}, unchanged=${stored.unchanged}) -> ${outPath}`
    );
    console.error(`[collectSpecialties] run=${runId} -> ${dbPath}`);
    if (warnings.length) {
      console.error(`[collectSpecialties] 경고 ${warnings.length}건:`);
      for (const w of warnings.slice(0, 20)) console.error(`  - ${w}`);
      if (warnings.length > 20) console.error(`  ... 외 ${warnings.length - 20}건`);
    }
  } catch (error) {
    if (!runFinished) {
      try {
        store.finishRun(runId, {
          status: "failed",
          sourceResults,
          requestCount,
          succeededSourceCount: succeededSources,
          failedSourceCount: Math.max(failedSources, sources.length - succeededSources),
          rowCount: rows.length,
          stored,
          warnings,
          errorMessage: error.message,
        });
      } catch (finishError) {
        error.message += `; 실행 이력 저장 실패: ${finishError.message}`;
      }
    }
    throw error;
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(`[collectSpecialties] 실패: ${err.message}`);
  process.exit(1);
});
