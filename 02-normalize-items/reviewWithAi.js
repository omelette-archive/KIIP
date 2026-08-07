#!/usr/bin/env node
"use strict";
/**
 * normalizeItems.js가 만든 review-required.csv(규칙 기반으로 확정 못한 소수의 행)만
 * 개별적으로 AI 검토한다. 규칙 기반 결과를 덮어쓰지 않고, ai* 컬럼에 제안만 추가한다 —
 * 최종 반영 여부는 사람이 결과 CSV를 보고 결정한다.
 *
 * 사용법:
 *   node 02-normalize-items/reviewWithAi.js --input 02-normalize-items/output/review-required.csv \
 *     --out 02-normalize-items/output/review-required-ai.csv
 *
 * 인증키: .env 의 ANTHROPIC_API_KEY, 또는 --apiKey 로 직접 전달.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { parseCsvLine } = require("./lib/noticeDictionary");
const { createClient } = require("./lib/reviewClient");
const { OUTPUT_FIELDS } = require("./normalizeItems");

loadEnv();

function parseArgs(argv) {
  const args = { concurrency: 4 };
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
      "  node 02-normalize-items/reviewWithAi.js --input <review-required.csv> [옵션]",
      "",
      "normalizeItems.js가 만든 review-required.csv만 대상으로 한다.",
      "규칙 기반 결과를 다시 결정하지 않고, ai로 시작하는 컬럼에 제안만 추가한다.",
      "",
      "옵션:",
      "  --out <path>          결과 CSV 저장 경로 (기본: <입력 디렉터리>/review-required-ai.csv)",
      "  --concurrency <n>     동시 API 호출 수 (기본 4)",
      "  --model <id>          Anthropic 모델 ID (기본 claude-haiku-4-5)",
      "  --apiKey <key>        ANTHROPIC_API_KEY 대신 직접 인증키 전달",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function readReviewCsv(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  for (const field of ["sido", "sigungu", "rawItemName", "itemName", "status", "reviewCandidates"]) {
    if (!header.includes(field)) {
      throw new Error(`입력 CSV에 ${field} 컬럼이 필요합니다(normalizeItems.js 출력이어야 함): ${header.join(",")}`);
    }
  }
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return Object.fromEntries(header.map((name, i) => [name, fields[i] || ""]));
  });
}

function parseCandidates(row) {
  if (!row.reviewCandidates) return [];
  try {
    const parsed = JSON.parse(row.reviewCandidates);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const AI_FIELDS = ["aiNoticeName", "aiNiceClass", "aiSimilarGroupCode", "aiNote", "aiError"];

function writeOutputCsv(outPath, rows) {
  const fields = [...OUTPUT_FIELDS, ...AI_FIELDS];
  const lines = [fields.join(",")];
  for (const row of rows) {
    lines.push(fields.map((field) => csvEscape(row[field])).join(","));
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
  const outPath = path.resolve(
    args.out || path.join(path.dirname(inputPath), "review-required-ai.csv")
  );
  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    printUsageAndExit("--concurrency 는 1 이상의 정수여야 합니다.");
  }

  const apiKey = args.apiKey || process.env.ANTHROPIC_API_KEY;
  const client = createClient({ apiKey, model: args.model });

  const rows = readReviewCsv(inputPath);
  const targetRows = rows.filter((row) => row.status === "review_required");
  console.error(`[reviewWithAi] input=${rows.length}행, 검토 대상=${targetRows.length}행`);

  let reviewed = 0;
  let resolved = 0;
  let failed = 0;

  const results = await runWithConcurrency(rows, concurrency, async (row) => {
    if (row.status !== "review_required") return { ...row };

    const candidates = parseCandidates(row);
    try {
      const result = await client.reviewItem(row, candidates);
      reviewed++;
      if (result.noticeName) resolved++;
      if (reviewed % 10 === 0) console.error(`[reviewWithAi] reviewed=${reviewed}/${targetRows.length}`);
      return {
        ...row,
        aiNoticeName: result.noticeName || "",
        aiNiceClass: result.niceClass || "",
        aiSimilarGroupCode: result.similarGroupCode || "",
        aiNote: result.note,
        aiError: "",
      };
    } catch (err) {
      failed++;
      return {
        ...row,
        aiNoticeName: "",
        aiNiceClass: "",
        aiSimilarGroupCode: "",
        aiNote: "",
        aiError: err instanceof Error ? err.message : String(err),
      };
    }
  });

  writeOutputCsv(outPath, results);
  console.error(
    `[reviewWithAi] done. reviewed=${reviewed}, resolved=${resolved}, failed=${failed} -> ${outPath}`
  );
  if (failed > 0) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[reviewWithAi] 실패: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { readReviewCsv, parseCandidates, writeOutputCsv, AI_FIELDS };
