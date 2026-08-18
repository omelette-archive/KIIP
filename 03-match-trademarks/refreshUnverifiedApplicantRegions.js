#!/usr/bin/env node
"use strict";
/**
 * #73 — 출원인 주소 미확인(unmatched/ambiguous) 건만 선별해 원문 주소를 다시
 * 조회하고, 새 시도·시군구 별칭 규칙(#72)을 적용한 결과를 기준 캐시와 분리된
 * 별도 캐시에 남긴다. 기준 캐시는 절대 직접 수정하지 않는다 — 검증 후 사람이
 * `--merged-out`으로 명시적으로 병합 결과를 만들어 확인한 뒤 교체한다.
 *
 * 자세한 정책은 docs/applicant-region-recovery-runbook.md 참고.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { loadAdminCodes } = require("../01-collect-specialties/lib/adminCodes");
const { createClient } = require("./lib/trademarkApplicantClient");
const { applicationNumbers, sanitizeApplicants } = require("./lib/trademarkApplicantEnricher");
const { loadCache, saveCache } = require("./lib/trademarkApplicantCache");
const { buildRefreshManifest, classifyCacheEntry } = require("./lib/applicantRegionRefresh");
const { isRateLimitError } = require("./lib/ipRegistryEnricher");
const {
  loadBudgetState,
  saveBudgetState,
  isResumeBlocked,
  recordRateLimit,
  remainingBudget,
} = require("./lib/ipRegistryBudget");

loadEnv();

function parseArgs(argv) {
  const args = { limit: 50, concurrency: 1, "checkpoint-every": 50, "max-consecutive-errors": 20 };
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
      "  node 03-match-trademarks/refreshUnverifiedApplicantRegions.js --cache <기준 캐시> [옵션]",
      "",
      "옵션:",
      "  --input <path>          ③ 검색 결과 JSON — 주면 캐시에 아예 없는 출원번호도 not_collected로 집계",
      "  --dry-run                API 호출 없이 재조회 후보 manifest만 생성",
      "  --manifest-out <path>    manifest JSON 경로 (기본: <cache 옆> refresh-manifest.json)",
      "  --refresh-cache <path>   재조회 결과 전용 캐시(기준 캐시와 달라야 함, 재실행 시 이어서 진행)",
      "  --limit <n>              이번 실행에서 새로 호출할 후보 수 상한(기본 50)",
      "  --concurrency <n>        동시 호출 수(기본 1, 최대 5)",
      "  --checkpoint-every <n>   성공 n건마다 재조회 캐시 저장(기본 50)",
      "  --daily-budget <n>       하루(KST) 누적 호출 상한(선택)",
      "  --budget-state <path>    일별 호출량·429 재개 시점 기록 경로",
      "  --max-consecutive-errors <n>  연속 오류 시 회로 차단(기본 20)",
      "  --merged-out <path>      기준 캐시 + 재조회로 개선된 건만 반영한 병합 결과를 별도 파일로 생성",
      "  --report-out <path>      재조회 전후 비교 리포트 JSON 경로",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function loadDocument(inputPath) {
  if (!inputPath) return null;
  return JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8").replace(/^﻿/, ""));
}

function writeJson(outPath, data) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.cache) usage("--cache 는 필수입니다(기준 캐시, 읽기 전용).");

  const cachePath = path.resolve(args.cache);
  const baseCache = loadCache(cachePath);
  const document = loadDocument(args.input);
  const universe = document ? applicationNumbers(document) : undefined;
  const manifest = buildRefreshManifest(baseCache, { applicationNumbers: universe });

  const manifestOutPath = path.resolve(
    args["manifest-out"] || path.join(path.dirname(cachePath), "refresh-manifest.json")
  );
  writeJson(manifestOutPath, manifest);
  console.error(
    `[refreshUnverified] manifest: total=${manifest.totalRowCount}, ` +
      `candidates=${manifest.refreshCandidateCount}, byCategory=${JSON.stringify(manifest.byCategory)} ` +
      `-> ${manifestOutPath}`
  );

  if (args["dry-run"]) return;

  const refreshCachePath = path.resolve(
    args["refresh-cache"] || path.join(path.dirname(cachePath), "applicant-region-refresh-cache.json")
  );
  if (refreshCachePath === cachePath) {
    usage("--refresh-cache는 --cache(기준 캐시)와 다른 경로여야 합니다.");
  }
  const refreshEntries = loadCache(refreshCachePath);

  const limit = Number(args.limit);
  const concurrency = Number(args.concurrency);
  const checkpointEvery = Number(args["checkpoint-every"]);
  const maxConsecutiveErrors = Number(args["max-consecutive-errors"]);
  if (!Number.isInteger(limit) || limit < 0 || limit > 50000) usage("--limit은 0~50000 정수여야 합니다.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) usage("--concurrency는 1~5 정수여야 합니다.");
  if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > 10000) {
    usage("--checkpoint-every는 1~10000 정수여야 합니다.");
  }
  if (!Number.isInteger(maxConsecutiveErrors) || maxConsecutiveErrors < 1 || maxConsecutiveErrors > 1000) {
    usage("--max-consecutive-errors는 1~1000 정수여야 합니다.");
  }
  const dailyBudget = args["daily-budget"] === undefined ? undefined : Number(args["daily-budget"]);
  if (dailyBudget !== undefined && (!Number.isInteger(dailyBudget) || dailyBudget < 1 || dailyBudget > 100000)) {
    usage("--daily-budget는 1~100000 정수여야 합니다.");
  }
  const budgetStatePath = path.resolve(
    args["budget-state"] || path.join(path.dirname(cachePath), "applicant-region-refresh-daily-budget.json")
  );

  const now = new Date();
  const budgetState = loadBudgetState(budgetStatePath, now);
  const blocked = isResumeBlocked(budgetState, now);
  const remaining = remainingBudget(budgetState, dailyBudget);
  const effectiveLimit = blocked ? 0 : Math.min(limit, remaining);
  if (blocked) {
    console.error(
      `[refreshUnverified] 이전 429 이후 재개 대기 중 - resumeNotBefore=${budgetState.resumeNotBefore}. 새 호출 없이 종료합니다.`
    );
  } else if (dailyBudget !== undefined && effectiveLimit < limit) {
    console.error(
      `[refreshUnverified] 일일 예산(${dailyBudget}) 중 ${budgetState.callsUsed}건 사용 - 이번 실행은 ${effectiveLimit}건만 호출합니다.`
    );
  }

  const pending = manifest.candidates
    .map((row) => row.applicationNumber)
    .filter((number) => !refreshEntries.has(number));
  const selected = pending.slice(0, effectiveLimit);
  console.error(
    `[refreshUnverified] 재조회 후보 ${manifest.refreshCandidateCount}건 중 미처리 ${pending.length}건, ` +
      `이번 실행 ${selected.length}건 호출 예정`
  );

  const adminList = loadAdminCodes();
  const client = createClient();
  let cursor = 0;
  let rateLimitError = null;
  let haltError = null;
  let consecutiveErrors = 0;
  let completedThisRun = 0;
  let nextBudgetState = { ...budgetState };

  async function worker() {
    while (cursor < selected.length) {
      const applicationNumber = selected[cursor++];
      if (rateLimitError || haltError) continue;
      nextBudgetState = { ...nextBudgetState, callsUsed: nextBudgetState.callsUsed + 1 };
      saveBudgetState(budgetStatePath, nextBudgetState);
      try {
        const response = await client.getApplicants(applicationNumber);
        const entry = {
          status: "complete",
          fetchedAt: new Date().toISOString(),
          found: response.found,
          resultCode: response.resultCode || null,
          terminalReason: response.retryExhausted ? "empty_after_retries" : null,
          applicants: sanitizeApplicants(response.applicants, adminList),
        };
        refreshEntries.set(applicationNumber, entry);
        consecutiveErrors = 0;
        completedThisRun++;
        if (completedThisRun % checkpointEvery === 0) {
          saveCache(refreshCachePath, refreshEntries);
          console.error(`[refreshUnverified] checkpoint new=${completedThisRun}, cache=${refreshEntries.size}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isRateLimitError(error)) {
          rateLimitError = message;
          nextBudgetState = recordRateLimit(nextBudgetState, new Date());
          saveBudgetState(budgetStatePath, nextBudgetState);
        }
        consecutiveErrors++;
        if (!rateLimitError && consecutiveErrors >= maxConsecutiveErrors) haltError = message;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  saveCache(refreshCachePath, refreshEntries);
  saveBudgetState(budgetStatePath, nextBudgetState);

  const report = {
    generatedAt: new Date().toISOString(),
    requested: selected.length,
    newlyComplete: completedThisRun,
    rateLimitDetected: Boolean(rateLimitError),
    circuitBreakerDetected: Boolean(haltError),
    resumeNotBefore: nextBudgetState.resumeNotBefore,
    beforeAfter: selected
      .filter((number) => refreshEntries.has(number))
      .map((number) => ({
        applicationNumber: number,
        before: classifyCacheEntry(number, baseCache.get(number)).category,
        after: classifyCacheEntry(number, refreshEntries.get(number)).category,
      })),
  };
  report.recoveredCount = report.beforeAfter.filter(
    (row) => row.before !== "matched" && row.after === "matched"
  ).length;
  const reportOutPath = path.resolve(
    args["report-out"] || path.join(path.dirname(cachePath), "refresh-report.json")
  );
  writeJson(reportOutPath, report);
  console.error(
    `[refreshUnverified] 완료: 요청 ${report.requested}, 신규 완료 ${report.newlyComplete}, ` +
      `복구(matched로 개선) ${report.recoveredCount} -> ${refreshCachePath}, ${reportOutPath}`
  );

  if (args["merged-out"]) {
    const merged = new Map(baseCache);
    let mergedCount = 0;
    for (const [number, entry] of refreshEntries) {
      const before = classifyCacheEntry(number, baseCache.get(number)).category;
      const after = classifyCacheEntry(number, entry).category;
      if (before !== "matched" && after === "matched") {
        merged.set(number, entry);
        mergedCount++;
      }
    }
    const mergedOutPath = path.resolve(args["merged-out"]);
    saveCache(mergedOutPath, merged);
    console.error(
      `[refreshUnverified] 병합 결과(개선된 ${mergedCount}건만 반영) -> ${mergedOutPath} ` +
        "(기준 캐시는 변경되지 않았습니다 — 검증 후 사람이 직접 교체하세요)"
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[refreshUnverified] 실패: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
