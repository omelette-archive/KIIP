#!/usr/bin/env node
"use strict";
/**
 * 02단계 출력(sido,sigungu,itemName,noticeName,niceClass,...)을 받아 행마다 KIPRIS
 * 상표 검색을 호출하는 배치 러너. matchTrademarks.js는 {지역,품목} 한 쌍만 처리해서
 * 02의 출력(수십~수백 행)을 실제로 흘려보내려면 매번 수동 반복이 필요했던 공백을 메운다.
 *
 * 사용법:
 *   node 03-match-trademarks/matchTrademarksBatch.js --input <02단계 출력 csv> --out <path>
 *
 * 입력 CSV 컬럼(02-normalize-items/normalizeItems.js 출력과 동일):
 *   sido, sigungu, rawItemName, itemName, noticeName, niceClass, similarGroupCode, excluded
 * - 검색어는 noticeName(고시명칭)이 있으면 그걸 우선 쓰고, 없으면 itemName을 쓴다.
 * - niceClass가 있으면 그 값으로 결과를 필터링한다.
 * - excluded가 true인 행(묘목/나무 등 분석 대상 아님으로 판단된 품목)은 건너뛴다.
 *
 * KIPRIS는 실제 정부 API라 동시 요청 수를 보수적으로 잡는다(기본 3).
 *
 * 인증키: .env 의 KIPRIS_API_KEY, 또는 --apiKey 로 직접 전달.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { createClient } = require("./lib/kiprisClient");
const { filterByClassCode } = require("./lib/filters");

loadEnv();

function parseArgs(argv) {
  const args = { concurrency: 3, numOfRows: 10 };
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
      "  node 03-match-trademarks/matchTrademarksBatch.js --input <csv> [옵션]",
      "",
      "입력 CSV 컬럼(02단계 출력과 동일): sido, sigungu, rawItemName, itemName, noticeName,",
      "  niceClass, similarGroupCode, excluded",
      "",
      "옵션:",
      "  --out <path>          결과 JSON 저장 경로 (기본: 03-match-trademarks/output/batch-result.json)",
      "  --concurrency <n>     동시 요청 수 (기본 3 — KIPRIS는 실제 정부 API라 보수적으로)",
      "  --numOfRows <n>       행마다 가져올 결과 수 (기본 10)",
      "  --apiKey <key>        KIPRIS_API_KEY 대신 직접 인증키 전달",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

// 02-normalize-items/lib/noticeDictionary.js 와 동일한 quote-aware 파서 (phase 간 독립 유지).
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function readInputCsv(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const idx = {
    sido: header.indexOf("sido"),
    sigungu: header.indexOf("sigungu"),
    itemName: header.indexOf("itemName"),
    noticeName: header.indexOf("noticeName"),
    niceClass: header.indexOf("niceClass"),
    excluded: header.indexOf("excluded"),
  };
  if (idx.sido === -1 || idx.sigungu === -1 || idx.itemName === -1) {
    throw new Error(`입력 CSV에 sido/sigungu/itemName 컬럼이 필요합니다: ${header.join(",")}`);
  }
  const get = (fields, i) => (i === -1 ? "" : fields[i] || "");
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return {
      sido: get(fields, idx.sido),
      sigungu: get(fields, idx.sigungu),
      itemName: get(fields, idx.itemName),
      noticeName: get(fields, idx.noticeName),
      niceClass: get(fields, idx.niceClass),
      excluded: get(fields, idx.excluded).toLowerCase() === "true",
    };
  });
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
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "batch-result.json"));
  const concurrency = Number(args.concurrency);
  const numOfRows = Number(args.numOfRows);

  const apiKey = args.apiKey || process.env.KIPRIS_API_KEY;
  const client = createClient({ apiKey });

  const rows = readInputCsv(inputPath);
  const targetRows = rows.filter((r) => !r.excluded && (r.noticeName || r.itemName));
  console.error(
    `[matchTrademarksBatch] input=${rows.length}행, excluded 제외 후 대상=${targetRows.length}행`
  );

  let processed = 0;
  const results = await runWithConcurrency(targetRows, concurrency, async (row) => {
    const region = `${row.sido} ${row.sigungu}`.trim();
    const searchString = row.noticeName || row.itemName;
    let entry;
    try {
      const result = await client.trademarkSearch({ searchString, numOfRows });
      const hits = filterByClassCode(result.hits, row.niceClass);
      entry = {
        sido: row.sido,
        sigungu: row.sigungu,
        itemName: row.itemName,
        noticeName: row.noticeName || null,
        niceClass: row.niceClass || null,
        query: { region, searchString, regionMatch: "unverified" },
        totalCount: result.totalCount,
        returnedCount: hits.length,
        hits,
      };
    } catch (err) {
      entry = {
        sido: row.sido,
        sigungu: row.sigungu,
        itemName: row.itemName,
        noticeName: row.noticeName || null,
        niceClass: row.niceClass || null,
        query: { region, searchString, regionMatch: "unverified" },
        error: err.message,
      };
    }
    processed++;
    if (processed % 10 === 0) {
      console.error(`[matchTrademarksBatch] processed=${processed}/${targetRows.length}`);
    }
    return entry;
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");

  const errored = results.filter((r) => r.error).length;
  const matched = results.filter((r) => !r.error && r.returnedCount > 0).length;
  console.error(
    `[matchTrademarksBatch] done. total=${results.length} matched=${matched} errored=${errored} -> ${outPath}`
  );
}

main().catch((err) => {
  console.error(`[matchTrademarksBatch] 실패: ${err.message}`);
  process.exit(1);
});
