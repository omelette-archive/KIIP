#!/usr/bin/env node
"use strict";
/**
 * 원시 특산품 목록(sido, sigungu, rawItemName[, source])을 받아, 사전 후보 검색
 * (candidateSearch) + 규칙 기반 매칭(ruleBasedMatch)을 거쳐 고시명칭/NICE류/유사군코드를
 * 붙인 CSV를 출력한다. LLM을 호출하지 않는 결정론적 코드로만 동작한다 — 애매해서 자동
 * 확정하지 못한 행은 noticeName이 빈 값으로 남고, 필요하면 별도로 reviewWithAi.js를 돌려
 * AI에게 검토를 맡긴다.
 *
 * 사용법:
 *   node 02-normalize-items/normalizeItems.js --input path/to/raw.csv --out 02-normalize-items/output/result.csv
 */

const fs = require("fs");
const path = require("path");
const { loadDictionary, parseCsvLine } = require("./lib/noticeDictionary");
const { matchItem } = require("./lib/ruleBasedMatch");

function parseArgs(argv) {
  const args = { topK: 20 };
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
      "  --topK <n>            후보 검색 개수 (기본 20)",
      "",
      "AI 검토가 필요하면 이 스크립트 실행 후 reviewWithAi.js를 별도로 실행한다.",
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "normalized.csv"));
  const topK = Number(args.topK);

  const rawRows = readInputCsv(inputPath);
  console.error(`[normalizeItems] input=${rawRows.length}행`);

  const dictionary = loadDictionary();
  console.error(`[normalizeItems] 고시상품명칭 사전 ${dictionary.length.toLocaleString()}건 로드`);

  const results = rawRows.map((row) => {
    const matched = matchItem(row.rawItemName, dictionary, { sido: row.sido, sigungu: row.sigungu }, { topK });
    return {
      sido: row.sido,
      sigungu: row.sigungu,
      rawItemName: row.rawItemName,
      itemName: matched.itemName,
      noticeName: matched.noticeName || "",
      niceClass: matched.niceClass || "",
      similarGroupCode: matched.similarGroupCode || "",
      excluded: matched.excluded,
    };
  });

  writeOutputCsv(outPath, results);
  const matched = results.filter((r) => r.noticeName).length;
  const unmatched = results.length - matched;
  console.error(
    `[normalizeItems] done. matched=${matched}/${results.length} (미확정 ${unmatched}건) -> ${outPath}`
  );
  if (unmatched > 0) {
    console.error(
      `[normalizeItems] 미확정 ${unmatched}건은 필요 시 reviewWithAi.js로 AI 검토를 돌려 확인하세요.`
    );
  }
}

try {
  main();
} catch (err) {
  console.error(`[normalizeItems] 실패: ${err.message}`);
  process.exit(1);
}
