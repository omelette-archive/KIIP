#!/usr/bin/env node
"use strict";
/**
 * normalizeItems.js가 규칙 기반으로 확정한 결과 CSV를 입력받아, 행별로 별도의 AI 검토
 * 단계를 거친다. 매칭을 다시 처음부터 결정하지 않고, 이미 나온 결과를 ok/flag로
 * 검수하고 필요하면 대안을 제안하는 감사(audit) 역할만 한다 — normalizeItems.js와 완전히
 * 분리된 단계라, API 키가 없어도 규칙 기반 결과만으로 다음 단계(③)를 진행할 수 있다.
 *
 * 사용법:
 *   node 02-normalize-items/reviewWithAi.js --input 02-normalize-items/output/normalized.csv \
 *     --out 02-normalize-items/output/reviewed.csv
 *
 * 인증키: .env 의 ANTHROPIC_API_KEY, 또는 --apiKey 로 직접 전달.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { loadDictionary, parseCsvLine } = require("./lib/noticeDictionary");
const { findCandidates } = require("./lib/candidateSearch");
const { createClient } = require("./lib/reviewClient");

loadEnv();

const SCOPES = ["unmatched", "excluded", "matched", "all"];

function parseArgs(argv) {
  const args = { concurrency: 4, topK: 20, scope: "unmatched" };
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
      "  node 02-normalize-items/reviewWithAi.js --input <normalized.csv> [옵션]",
      "",
      "normalizeItems.js 출력 CSV를 입력으로 받아, 행별로 AI 검토를 실행한다.",
      "매칭을 다시 결정하지 않고 이미 나온 결과를 ok/flag로 검수만 한다.",
      "",
      "옵션:",
      "  --out <path>          결과 CSV 저장 경로 (기본: 02-normalize-items/output/reviewed.csv)",
      `  --scope <범위>        검토 대상 (${SCOPES.join("|")}, 기본 unmatched)`,
      "                        unmatched: noticeName이 비어있는 행만",
      "                        excluded:  excluded=true인 행만",
      "                        matched:   noticeName이 있는 행만",
      "                        all:       전체 행",
      "  --concurrency <n>     동시 API 호출 수 (기본 4)",
      "  --topK <n>            후보 재검색 개수 (기본 20)",
      "  --model <id>          Anthropic 모델 ID (기본 claude-haiku-4-5)",
      "  --apiKey <key>        ANTHROPIC_API_KEY 대신 직접 인증키 전달",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function parseBool(v) {
  return String(v).trim().toLowerCase() === "true";
}

function readNormalizedCsv(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const requiredCols = [
    "sido", "sigungu", "rawItemName", "itemName", "noticeName", "niceClass", "similarGroupCode", "excluded",
  ];
  const idx = {};
  for (const col of requiredCols) {
    idx[col] = header.indexOf(col);
    if (idx[col] === -1) throw new Error(`입력 CSV에 ${col} 컬럼이 필요합니다: ${header.join(",")}`);
  }
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return {
      sido: fields[idx.sido] || "",
      sigungu: fields[idx.sigungu] || "",
      rawItemName: fields[idx.rawItemName] || "",
      itemName: fields[idx.itemName] || "",
      noticeName: fields[idx.noticeName] || "",
      niceClass: fields[idx.niceClass] || "",
      similarGroupCode: fields[idx.similarGroupCode] || "",
      excluded: parseBool(fields[idx.excluded]),
    };
  });
}

function matchesScope(row, scope) {
  if (scope === "unmatched") return !row.noticeName;
  if (scope === "excluded") return row.excluded;
  if (scope === "matched") return Boolean(row.noticeName);
  return true; // all
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeOutputCsv(outPath, rows) {
  const fields = [
    "sido", "sigungu", "rawItemName", "itemName", "noticeName", "niceClass", "similarGroupCode", "excluded",
    "reviewed", "verdict", "note", "suggestedNoticeName", "suggestedNiceClass", "suggestedSimilarGroupCode", "suggestedExcluded",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");
  if (!SCOPES.includes(args.scope)) printUsageAndExit(`--scope 는 ${SCOPES.join("|")} 중 하나여야 합니다.`);

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "reviewed.csv"));
  const concurrency = Number(args.concurrency);
  const topK = Number(args.topK);

  const apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY;
  const client = createClient({ apiKey, model: args.model });

  const rows = readNormalizedCsv(inputPath);
  console.error(`[reviewWithAi] input=${rows.length}행, scope=${args.scope}`);

  const dictionary = loadDictionary();

  let reviewed = 0;
  let flagged = 0;
  const results = await runWithConcurrency(rows, concurrency, async (row) => {
    if (!matchesScope(row, args.scope)) {
      return {
        ...row,
        reviewed: false,
        verdict: "",
        note: "",
        suggestedNoticeName: "",
        suggestedNiceClass: "",
        suggestedSimilarGroupCode: "",
        suggestedExcluded: "",
      };
    }

    const candidates = findCandidates(row.rawItemName, dictionary, { sido: row.sido, sigungu: row.sigungu }, { topK });
    const result = await client.reviewItem(row, candidates);

    reviewed++;
    if (result.verdict === "flag") flagged++;
    if (reviewed % 20 === 0) console.error(`[reviewWithAi] reviewed=${reviewed}`);

    return {
      ...row,
      reviewed: true,
      verdict: result.verdict,
      note: result.note,
      suggestedNoticeName: result.suggestedNoticeName || "",
      suggestedNiceClass: result.suggestedNiceClass || "",
      suggestedSimilarGroupCode: result.suggestedSimilarGroupCode || "",
      suggestedExcluded: result.suggestedExcluded,
    };
  });

  writeOutputCsv(outPath, results);
  console.error(`[reviewWithAi] done. reviewed=${reviewed}/${results.length} (flag=${flagged}건) -> ${outPath}`);
}

main().catch((err) => {
  console.error(`[reviewWithAi] 실패: ${err.message}`);
  process.exit(1);
});
