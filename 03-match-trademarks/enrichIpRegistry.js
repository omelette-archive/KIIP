#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { createClient } = require("./lib/ipRegistryClient");
const { enrichDocument, registryNumbers } = require("./lib/ipRegistryEnricher");
const { loadCache, saveCache } = require("./lib/ipRegistryCache");

loadEnv();

function parseArgs(argv) {
  const args = { limit: 3, concurrency: 1 };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
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
  console.error(
    [
      "사용법:",
      "  node 03-match-trademarks/enrichIpRegistry.js --input <03단계 결과.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>        출력 경로 (기본: output/ip-registry-enriched.json)",
      "  --limit <n>         등록번호 최대 호출 수 (기본 3, 최대 100)",
      "  --concurrency <n>   동시 호출 수 (기본 1, 최대 5)",
      "  --cache <path>      등록번호별 영속 캐시 (기본: output/ip-registry-cache.json)",
      "  --no-cache          영속 캐시를 읽거나 저장하지 않음",
      "  --dry-run           호출 없이 등록번호 대상 건수만 확인",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input) usage("--input 은 필수입니다.");
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(
    args.out || path.join(__dirname, "output", "ip-registry-enriched.json")
  );
  const cachePath = args["no-cache"]
    ? null
    : path.resolve(args.cache || path.join(__dirname, "output", "ip-registry-cache.json"));
  const cacheEntries = cachePath ? loadCache(cachePath) : new Map();
  const document = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  const numbers = registryNumbers(document);
  if (args["dry-run"]) {
    const cached = numbers.filter((number) => cacheEntries.get(number)?.status === "complete").length;
    const uncached = numbers.length - cached;
    console.error(
      `[enrichIpRegistry] dry-run uniqueRegistration=${numbers.length}, cached=${cached}, ` +
        `uncached=${uncached}, requested=${Math.min(uncached, Number(args.limit))}`
    );
    return Promise.resolve();
  }
  const client = createClient();
  return enrichDocument(document, client, {
    limit: Number(args.limit),
    concurrency: Number(args.concurrency),
    cacheEntries,
  }).then((output) => {
    if (cachePath) saveCache(cachePath, cacheEntries);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
    const summary = output.ipRegistryEnrichment;
    console.error(
      `[enrichIpRegistry] status=${summary.status}, requested=${summary.requestedRegistrationCount}, ` +
        `complete=${summary.completeRegistrationCount}, error=${summary.errorRegistrationCount}, ` +
        `cached=${summary.cachedRegistrationCount || 0}, new=${summary.newlyCompleteRegistrationCount || 0}, ` +
        `notCollected=${summary.notCollectedRegistrationCount} -> ${outPath}`
    );
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[enrichIpRegistry] 실패: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
