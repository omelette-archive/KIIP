#!/usr/bin/env node
"use strict";
/**
 * 단일 {지역, 품목} 또는 ② 단계의 정규화 CSV를 받아 KIPRIS 상표 검색
 * (getWordSearch)을 호출하고 품목(NICE 상품류 코드)으로 현재 페이지 결과를 필터링한다.
 *
 * 지역 매칭은 아직 구현되어 있지 않다. getWordSearch 응답에 출원인 주소/지역 필드가 없기
 * 때문에 요청 지역을 unverified 태그로만 보존한다.
 */

const path = require("path");
const fs = require("fs");
const { loadEnv } = require("./lib/loadEnv");

// kiprisClient는 모듈 로드 시 프로토콜을 결정하므로 .env를 먼저 읽어야 한다.
loadEnv();

const { createClient } = require("./lib/kiprisClient");
const { filterByClassCode, FOOD_RELATED_CLASSES } = require("./lib/filters");

function parseArgs(argv) {
  const args = { numOfRows: 20, pageNo: 1, concurrency: 2, "max-requests": 100 };
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
      "  --dry-run            배치 입력·요청 계획만 검증하고 API는 호출하지 않음",
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

function makeBatchQuery(row) {
  if (row.status && row.status !== "ok") {
    return { skipReason: `상위 단계 status=${row.status}` };
  }
  if (isCsvTrue(row.excluded)) {
    return { skipReason: "② 단계에서 분석 제외된 품목" };
  }

  const region = [row.sido, row.sigungu].filter(Boolean).join(" ").trim();
  const item = (row.noticeName || row.itemName || row.rawItemName || "").trim();
  if (!region) return { skipReason: "지역 정보 없음" };
  if (!item) return { skipReason: "검색 품목 없음" };
  return { region, item, classCode: row.niceClass || null };
}

function countSearchableRows(rows) {
  return rows.reduce((count, row) => count + (makeBatchQuery(row).skipReason ? 0 : 1), 0);
}

function buildBatchPlan(rows) {
  return rows.map((row, inputIndex) => {
    const query = makeBatchQuery(row);
    if (query.skipReason) {
      return { status: "skipped", inputIndex, reason: query.skipReason, input: row };
    }
    return { status: "planned", inputIndex, query, source: row.source || null };
  });
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
  const result = await client.trademarkSearch({
    searchString: String(query.item),
    numOfRows: Number(options.numOfRows),
    pageNo: Number(options.pageNo),
  });
  // NICE류를 모르면 무필터 대신 식품·음료 관련 기본 류 집합으로 좁힌다(FOOD_RELATED_CLASSES
  // 참고 — 무필터 시 노이즈가 수만 건까지 나오는 게 실측으로 확인됨).
  const classCodeFallbackApplied = !query.classCode;
  const hits = filterByClassCode(result.hits, query.classCode || FOOD_RELATED_CLASSES);
  return buildSearchOutput(query, result, hits, { ...options, classCodeFallbackApplied });
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
  return runWithConcurrency(rows, options.concurrency, async (row, inputIndex) => {
    const query = makeBatchQuery(row);
    const source = row.source || null;
    if (query.skipReason) {
      return { status: "skipped", inputIndex, reason: query.skipReason, input: row };
    }
    try {
      const output = await searchOne(client, query, options);
      return { inputIndex, source, ...output };
    } catch (err) {
      return {
        status: "error",
        inputIndex,
        query,
        source,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
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

function validateNumericArgs(args) {
  const numOfRows = Number(args.numOfRows);
  const pageNo = Number(args.pageNo);
  const concurrency = Number(args.concurrency);
  const maxRequests = Number(args["max-requests"]);
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
  return { numOfRows, pageNo, concurrency, maxRequests };
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

  if (args.input) {
    const inputPath = path.resolve(args.input);
    const rows = readNormalizedCsv(inputPath);
    const plannedRequests = countSearchableRows(rows);
    if (plannedRequests > numeric.maxRequests) {
      throw new Error(
        `배치 검색 예정 ${plannedRequests}건이 요청 상한 ${numeric.maxRequests}건을 초과합니다. ` +
        "무료 KIPRISPlus 월간 호출량을 확인한 뒤 --max-requests를 명시적으로 조정하세요."
      );
    }
    if (args["dry-run"]) {
      const results = buildBatchPlan(rows);
      const output = {
        mode: "batch-dry-run",
        inputFile: inputPath,
        inputCount: rows.length,
        plannedRequestCount: plannedRequests,
        skippedCount: results.filter((row) => row.status === "skipped").length,
        completedAt: new Date().toISOString(),
        results,
      };
      const outPath = writeJson(output, args.out);
      console.error(
        `[matchTrademarks] dry-run. requests=${plannedRequests}, skipped=${output.skippedCount}${outPath ? ` -> ${outPath}` : ""}`
      );
      return;
    }
    const client = createClient({ apiKey });
    console.error(`[matchTrademarks] batch input=${rows.length}행, requests=${plannedRequests}/${numeric.maxRequests}`);
    const results = await runBatch(rows, client, numeric);
    const output = {
      mode: "batch",
      inputFile: inputPath,
      inputCount: rows.length,
      successCount: results.filter((row) => row.status === "ok").length,
      errorCount: results.filter((row) => row.status === "error").length,
      skippedCount: results.filter((row) => row.status === "skipped").length,
      completedAt: new Date().toISOString(),
      results,
    };
    const outPath = writeJson(output, args.out);
    console.error(
      `[matchTrademarks] batch done. success=${output.successCount}, error=${output.errorCount}, skipped=${output.skippedCount}${outPath ? ` -> ${outPath}` : ""}`
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
    `[matchTrademarks] item="${query.item}" region="${query.region}" (지역은 아직 미검증 태그만 부여)`
  );
  const client = createClient({ apiKey });
  const output = await searchOne(client, query, numeric);
  const outPath = writeJson(output, args.out);
  console.error(
    `[matchTrademarks] pageFiltered=${output.page.filteredCount}, keywordTotal=${output.keywordTotalCount}${outPath ? ` -> ${outPath}` : ""}`
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
  buildBatchPlan,
  buildSearchOutput,
  searchOne,
  runBatch,
  runWithConcurrency,
};
