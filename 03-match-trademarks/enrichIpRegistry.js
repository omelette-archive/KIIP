#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { createClient } = require("./lib/ipRegistryClient");
const { enrichDocument, registryNumbers } = require("./lib/ipRegistryEnricher");
const { loadCache, saveCache } = require("./lib/ipRegistryCache");
const {
  loadBudgetState,
  saveBudgetState,
  isResumeBlocked,
  recordRateLimit,
  remainingBudget,
} = require("./lib/ipRegistryBudget");

loadEnv();

function parseArgs(argv) {
  const args = { limit: 3, concurrency: 1, "checkpoint-every": 50 };
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
      "  --checkpoint-every <n> 성공 n건마다 캐시 저장 (기본 50)",
      "  --daily-budget <n>  하루(KST) 누적 호출 상한. 지정 시 --limit과 겹치는 만큼만 호출",
      "  --budget-state <path> 일별 호출량·재개 시점 기록 (기본: output/ip-registry-daily-budget.json)",
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
  const budgetStatePath = path.resolve(
    args["budget-state"] || path.join(__dirname, "output", "ip-registry-daily-budget.json")
  );
  const checkpointEvery = Number(args["checkpoint-every"]);
  if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > 10000) {
    usage("--checkpoint-every\uB294 1~10000 \uC815\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  }
  const dailyBudget = args["daily-budget"] === undefined ? undefined : Number(args["daily-budget"]);
  if (dailyBudget !== undefined && (!Number.isInteger(dailyBudget) || dailyBudget < 1 || dailyBudget > 100000)) {
    usage("--daily-budget\uB294 1~100000 \uC815\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
  }
  const cacheEntries = cachePath ? loadCache(cachePath) : new Map();
  const document = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  const numbers = registryNumbers(document);
  if (args["dry-run"]) {
    const cached = numbers.filter((number) => cacheEntries.get(number)?.status === "complete").length;
    const uncached = numbers.length - cached;
    const budgetState = loadBudgetState(budgetStatePath);
    console.error(
      `[enrichIpRegistry] dry-run uniqueRegistration=${numbers.length}, cached=${cached}, ` +
        `uncached=${uncached}, requested=${Math.min(uncached, Number(args.limit))}, ` +
        `todayUsed=${budgetState.callsUsed}, resumeNotBefore=${budgetState.resumeNotBefore || "\uC5C6\uC74C"}`
    );
    return Promise.resolve();
  }
  const now = new Date();
  const budgetState = loadBudgetState(budgetStatePath, now);
  const blocked = isResumeBlocked(budgetState, now);
  const effectiveLimit = blocked
    ? 0
    : Math.min(Number(args.limit), remainingBudget(budgetState, dailyBudget));
  if (blocked) {
    console.error(
      `[enrichIpRegistry] \uC774\uC804 429 \uC774\uD6C4 \uC7AC\uAC1C \uB300\uAE30 \uC911 - resumeNotBefore=${budgetState.resumeNotBefore}. ` +
        "\uC0C8 \uD638\uCD9C \uC5C6\uC774 \uCE90\uC2DC\uB9CC \uC801\uC6A9\uD569\uB2C8\uB2E4."
    );
  } else if (dailyBudget !== undefined && effectiveLimit < Number(args.limit)) {
    console.error(
      `[enrichIpRegistry] \uC77C\uC77C \uC608\uC0B0(${dailyBudget}) \uC911 ${budgetState.callsUsed}\uAC74 \uC0AC\uC6A9 - ` +
        `\uC774\uBC88 \uC2E4\uD589\uC740 ${effectiveLimit}\uAC74\uB9CC \uD638\uCD9C\uD569\uB2C8\uB2E4.`
    );
  }
  let completedThisRun = 0;
  const client = createClient();
  return enrichDocument(document, client, {
    limit: effectiveLimit,
    concurrency: Number(args.concurrency),
    cacheEntries,
    onCacheUpdate: () => {
      completedThisRun++;
      if (cachePath && completedThisRun % checkpointEvery === 0) {
        saveCache(cachePath, cacheEntries);
        console.error(`[enrichIpRegistry] checkpoint new=${completedThisRun}, cache=${cacheEntries.size}`);
      }
    },
  }).then((output) => {
    if (cachePath) saveCache(cachePath, cacheEntries);
    const summary = output.ipRegistryEnrichment;
    let nextBudgetState = {
      ...budgetState,
      callsUsed: budgetState.callsUsed + summary.requestedRegistrationCount,
    };
    if (summary.rateLimitDetected) nextBudgetState = recordRateLimit(nextBudgetState, now);
    saveBudgetState(budgetStatePath, nextBudgetState);
    summary.dailyBudget = {
      limit: dailyBudget ?? null,
      usedToday: nextBudgetState.callsUsed,
      remainingToday: remainingBudget(nextBudgetState, dailyBudget),
      resumeNotBefore: nextBudgetState.resumeNotBefore,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.error(
      `[enrichIpRegistry] status=${summary.status}, requested=${summary.requestedRegistrationCount}, ` +
        `complete=${summary.completeRegistrationCount}, error=${summary.errorRegistrationCount}, ` +
        `cached=${summary.cachedRegistrationCount || 0}, new=${summary.newlyCompleteRegistrationCount || 0}, ` +
        `notCollected=${summary.notCollectedRegistrationCount}, todayUsed=${nextBudgetState.callsUsed}, ` +
        `resumeNotBefore=${nextBudgetState.resumeNotBefore || "\uC5C6\uC74C"} -> ${outPath}`
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
