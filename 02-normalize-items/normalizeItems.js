#!/usr/bin/env node
"use strict";
/**
 * 원시 특산품 목록(sido, sigungu, rawItemName[, source])을 받아, 사전 후보 검색
 * (candidateSearch) + LLM 정제(llmClient)를 거쳐 고시명칭/NICE류/유사군코드를 붙인
 * CSV를 출력한다.
 *
 * 사용법:
 *   node 02-normalize-items/normalizeItems.js --input path/to/raw.csv --out 02-normalize-items/output/result.csv
 *
 * 인증키: .env 의 ANTHROPIC_API_KEY, 또는 --apiKey 로 직접 전달.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { loadDictionary, parseCsvLine } = require("./lib/noticeDictionary");
const { findCandidates } = require("./lib/candidateSearch");
const { createClient } = require("./lib/llmClient");

loadEnv();

function parseArgs(argv) {
  const args = { concurrency: 4, topK: 20 };
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
      "  node 02-normalize-items/normalizeItems.js --input <csv> [옵션]",
      "",
      "입력 CSV 컬럼: sido, sigungu, rawItemName[, source]",
      "",
      "옵션:",
      "  --out <path>          결과 CSV 저장 경로 (기본: 02-normalize-items/output/normalized.csv)",
      "  --concurrency <n>     동시 LLM 호출 수 (기본 4)",
      "  --topK <n>            후보 검색 개수 (기본 20)",
      "  --model <id>          Anthropic 모델 ID (기본 claude-haiku-4-5)",
      "  --apiKey <key>        ANTHROPIC_API_KEY 대신 직접 인증키 전달",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
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
    rawItemName: header.indexOf("rawItemName"),
    source: header.indexOf("source"),
  };
  if (idx.sido === -1 || idx.sigungu === -1 || idx.rawItemName === -1) {
    throw new Error(`입력 CSV에 sido/sigungu/rawItemName 컬럼이 필요합니다: ${header.join(",")}`);
  }
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return {
      sido: fields[idx.sido] || "",
      sigungu: fields[idx.sigungu] || "",
      rawItemName: fields[idx.rawItemName] || "",
      source: idx.source === -1 ? "" : fields[idx.source] || "",
    };
  });
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeOutputCsv(outPath, rows) {
  const fields = ["sido", "sigungu", "rawItemName", "itemName", "noticeName", "niceClass", "similarGroupCode", "excluded"];
  const lines = [fields.join(",")];
  for (const row of rows) {
    lines.push(fields.map((f) => csvEscape(row[f])).join(","));
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, "﻿" + lines.join("\n") + "\n", "utf8");
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
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "normalized.csv"));
  const concurrency = Number(args.concurrency);
  const topK = Number(args.topK);

  const apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY;
  const client = createClient({ apiKey, model: args.model });

  const rawRows = readInputCsv(inputPath);
  console.error(`[normalizeItems] input=${rawRows.length}행`, { flush: true });

  const dictionary = loadDictionary();
  console.error(`[normalizeItems] 고시상품명칭 사전 ${dictionary.length.toLocaleString()}건 로드`);

  // 같은 (지역, 원시 품목명) 조합이 여러 행에서 중복되면(다른 소스에서 같은 품목이
  // 중복 수집되는 경우 등) 후보검색+LLM 호출을 매번 새로 하지 않고 결과를 재사용한다.
  // 진행 중인 호출도 Promise로 캐싱해서 동시에 들어온 중복 요청이 API를 두 번 타지
  // 않게 한다.
  const normalizeCache = new Map();
  let cacheHits = 0;
  let processed = 0;

  const results = await runWithConcurrency(rawRows, concurrency, async (row) => {
    const cacheKey = `${row.sido}|${row.sigungu}|${row.rawItemName}`;
    let normalizedPromise = normalizeCache.get(cacheKey);
    if (normalizedPromise) {
      cacheHits++;
    } else {
      normalizedPromise = (async () => {
        const candidates = findCandidates(row.rawItemName, dictionary, { sido: row.sido, sigungu: row.sigungu }, { topK });
        return client.normalizeItem({ rawItemName: row.rawItemName, candidates });
      })();
      normalizeCache.set(cacheKey, normalizedPromise);
    }
    const normalized = await normalizedPromise;

    processed++;
    if (processed % 20 === 0) {
      console.error(`[normalizeItems] processed=${processed}/${rawRows.length}`);
    }
    return {
      sido: row.sido,
      sigungu: row.sigungu,
      rawItemName: row.rawItemName,
      itemName: normalized.itemName,
      noticeName: normalized.noticeName || "",
      niceClass: normalized.niceClass || "",
      similarGroupCode: normalized.similarGroupCode || "",
      excluded: normalized.excluded,
    };
  });

  writeOutputCsv(outPath, results);
  const matched = results.filter((r) => r.noticeName).length;
  console.error(
    `[normalizeItems] done. matched=${matched}/${results.length} (캐시 재사용 ${cacheHits}건) -> ${outPath}`
  );
}

main().catch((err) => {
  console.error(`[normalizeItems] 실패: ${err.message}`);
  process.exit(1);
});
