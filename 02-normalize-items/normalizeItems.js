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
  const fields = [
    "sido",
    "sigungu",
    "rawItemName",
    "source",
    "itemName",
    "noticeName",
    "niceClass",
    "similarGroupCode",
    "excluded",
    "status",
    "error",
  ];
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

async function normalizeRow(row, { dictionary, client, topK }) {
  const base = {
    sido: row.sido,
    sigungu: row.sigungu,
    rawItemName: row.rawItemName,
    source: row.source || "",
  };

  try {
    const candidates = findCandidates(
      row.rawItemName,
      dictionary,
      { sido: row.sido, sigungu: row.sigungu },
      { topK }
    );
    const normalized = await client.normalizeItem({
      rawItemName: row.rawItemName,
      candidates,
    });
    return {
      ...base,
      itemName: normalized.itemName,
      noticeName: normalized.noticeName || "",
      niceClass: normalized.niceClass || "",
      similarGroupCode: normalized.similarGroupCode || "",
      excluded: normalized.excluded,
      status: "ok",
      error: "",
    };
  } catch (err) {
    return {
      ...base,
      itemName: "",
      noticeName: "",
      niceClass: "",
      similarGroupCode: "",
      excluded: "",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "normalized.csv"));
  const concurrency = Number(args.concurrency);
  const topK = Number(args.topK);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    printUsageAndExit("--concurrency 는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isInteger(topK) || topK < 1) {
    printUsageAndExit("--topK 는 1 이상의 정수여야 합니다.");
  }

  const apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY;
  const client = createClient({ apiKey, model: args.model });

  const rawRows = readInputCsv(inputPath);
  console.error(`[normalizeItems] input=${rawRows.length}행`, { flush: true });

  const dictionary = loadDictionary();
  console.error(`[normalizeItems] 고시상품명칭 사전 ${dictionary.length.toLocaleString()}건 로드`);

  let processed = 0;
  const results = await runWithConcurrency(rawRows, concurrency, async (row) => {
    const result = await normalizeRow(row, { dictionary, client, topK });
    processed++;
    if (processed % 20 === 0) {
      console.error(`[normalizeItems] processed=${processed}/${rawRows.length}`);
    }
    return result;
  });

  writeOutputCsv(outPath, results);
  const succeeded = results.filter((r) => r.status === "ok");
  const failed = results.length - succeeded.length;
  const matched = succeeded.filter((r) => r.noticeName).length;
  console.error(
    `[normalizeItems] done. success=${succeeded.length}, failed=${failed}, matched=${matched}/${results.length} -> ${outPath}`
  );
  if (failed > 0) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[normalizeItems] 실패: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  normalizeRow,
  runWithConcurrency,
  readInputCsv,
  writeOutputCsv,
};
