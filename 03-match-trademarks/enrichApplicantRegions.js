#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { createClient } = require("./lib/trademarkApplicantClient");
const { applicationNumbers, enrichApplicantRegions } = require("./lib/trademarkApplicantEnricher");
const { loadCache, saveCache } = require("./lib/trademarkApplicantCache");

loadEnv();

function parseArgs(argv) {
  const args = { limit: 10, concurrency: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
  return args;
}

function usage(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error([
    "사용법:",
    "  node 03-match-trademarks/enrichApplicantRegions.js --input <03단계 결과.json> [옵션]",
    "",
    "옵션:",
    "  --out <path>        보강 결과 JSON",
    "  --limit <n>         이번 실행의 신규 출원번호 호출 상한 (기본 10, 최대 1000)",
    "  --concurrency <n>   동시 호출 수 (기본 1, 최대 5)",
    "  --cache <path>      영속 캐시 (기본: output/trademark-applicant-region-cache.json)",
    "  --dry-run           호출 없이 캐시·잔여량 확인",
  ].join("\n"));
  process.exit(message ? 1 : 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input) usage("--input 은 필수입니다.");
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "applicant-regions.json"));
  const cachePath = path.resolve(
    args.cache || path.join(__dirname, "output", "trademark-applicant-region-cache.json")
  );
  const document = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  const entries = loadCache(cachePath);
  const numbers = applicationNumbers(document);
  const cached = numbers.filter((number) => entries.has(number)).length;
  const uncached = numbers.length - cached;
  if (args["dry-run"]) {
    console.error(
      `[enrichApplicantRegions] dry-run uniqueApplication=${numbers.length}, cached=${cached}, ` +
        `uncached=${uncached}, requested=${Math.min(uncached, Number(args.limit))}`
    );
    return;
  }
  const output = await enrichApplicantRegions(document, createClient(), {
    limit: Number(args.limit),
    concurrency: Number(args.concurrency),
    cacheEntries: entries,
  });
  saveCache(cachePath, entries);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  const s = output.applicationApplicantEnrichment;
  console.error(
    `[enrichApplicantRegions] requested=${s.requestedApplicationCount}, cached=${s.cachedApplicationCount}, ` +
      `new=${s.newlyCompleteApplicationCount}, complete=${s.completeApplicationCount}, ` +
      `error=${s.errorApplicationCount}, remaining=${s.notCollectedApplicationCount} -> ${outPath}`
  );
}

if (require.main === module) main().catch((error) => {
  console.error(`[enrichApplicantRegions] 실패: ${error.message}`);
  process.exit(1);
});

module.exports = { main, parseArgs };
