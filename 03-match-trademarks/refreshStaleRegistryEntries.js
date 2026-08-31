#!/usr/bin/env node
"use strict";
/**
 * #81 — 등록원부 캐시 변경 감지: 이미 complete로 캐시된 등록번호 중 공식 권리존속기간
 * 만료예정일(cndrtExptnDate)이 지났는데 캐시에는 아직 그 이후 처분 이력(right[])이 없는
 * 건만 선별해 다시 조회한다. 신규 미수집 등록번호 증분(matchTrademarks.js --enrich-registry)
 * 과는 완전히 분리된 별도 CLI다 — 기존 complete 캐시는 이 스크립트를 돌리지 않으면 절대
 * 재검증되지 않는다.
 *
 * #73(refreshUnverifiedRegistryRegions.js)과 구조를 맞췄다: 기준 캐시는 읽기 전용,
 * 재조회 결과는 분리된 캐시에 쌓고, --merged-out으로만 명시적으로 병합 결과를 만든다.
 * 자세한 정책은 03-match-trademarks/lib/registryStaleness.js와
 * docs/applicant-region-recovery-runbook.md 참고.
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { loadAdminCodes } = require("../01-collect-specialties/lib/adminCodes");
const { createClient } = require("./lib/ipRegistryClient");
const { sanitizeRegistryRecordForCache, isRateLimitError } = require("./lib/ipRegistryEnricher");
const { loadCache, saveCache } = require("./lib/ipRegistryCache");
const { buildStalenessManifest, diffRegistryRecords } = require("./lib/registryStaleness");
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
      "  node 03-match-trademarks/refreshStaleRegistryEntries.js --cache <기준 캐시> [옵션]",
      "",
      "재검증 대상: 공식 권리존속기간만료예정일(cndrtExptnDate)이 지났는데 캐시에는 아직",
      "그 이후 처분 이력(right[])이 없는 complete 항목만(정책: expiry_only, #81 2026-08-31 확정).",
      "",
      "옵션:",
      "  --dry-run                API 호출 없이 재조회 후보 manifest만 생성",
      "  --manifest-out <path>    manifest JSON 경로 (기본: <cache 옆> registry-staleness-manifest.json)",
      "  --refresh-cache <path>   재조회 결과 전용 캐시(기준 캐시와 달라야 함, 재실행 시 이어서 진행)",
      "  --limit <n>              이번 실행에서 새로 호출할 후보 수 상한(기본 50)",
      "  --concurrency <n>        동시 호출 수(기본 1, 최대 5)",
      "  --checkpoint-every <n>   성공 n건마다 재조회 캐시 저장(기본 50)",
      "  --daily-budget <n>       하루(KST) 누적 호출 상한(선택)",
      "  --budget-state <path>    일별 호출량·429 재개 시점 기록 경로",
      "  --max-consecutive-errors <n>  연속 오류 시 회로 차단(기본 20)",
      "  --merged-out <path>      기준 캐시 + 조회 성공한 재검증 결과만 반영한 병합 결과를 별도 파일로 생성",
      "  --report-out <path>      재조회 전후 비교 리포트 JSON 경로",
      "  --as-of <YYYY-MM-DD>     만료예정일 판정 기준일(테스트/재현용, 기본 오늘)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
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
  const asOf = args["as-of"] ? new Date(`${args["as-of"]}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(asOf.getTime())) usage("--as-of는 YYYY-MM-DD 형식이어야 합니다.");
  const manifest = buildStalenessManifest(baseCache, { asOf });

  const manifestOutPath = path.resolve(
    args["manifest-out"] || path.join(path.dirname(cachePath), "registry-staleness-manifest.json")
  );
  writeJson(manifestOutPath, manifest);
  console.error(
    `[refreshStale] manifest: total=${manifest.totalRowCount}, ` +
      `candidates=${manifest.refreshCandidateCount}, byCategory=${JSON.stringify(manifest.byCategory)} ` +
      `-> ${manifestOutPath}`
  );

  if (args["dry-run"]) return;

  const refreshCachePath = path.resolve(
    args["refresh-cache"] || path.join(path.dirname(cachePath), "ip-registry-staleness-refresh-cache.json")
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
    args["budget-state"] || path.join(path.dirname(cachePath), "registry-staleness-daily-budget.json")
  );

  const now = new Date();
  const budgetState = loadBudgetState(budgetStatePath, now);
  const blocked = isResumeBlocked(budgetState, now);
  const remaining = remainingBudget(budgetState, dailyBudget);
  const effectiveLimit = blocked ? 0 : Math.min(limit, remaining);
  if (blocked) {
    console.error(
      `[refreshStale] 이전 429 이후 재개 대기 중 - resumeNotBefore=${budgetState.resumeNotBefore}. 새 호출 없이 종료합니다.`
    );
  } else if (dailyBudget !== undefined && effectiveLimit < limit) {
    console.error(
      `[refreshStale] 일일 예산(${dailyBudget}) 중 ${budgetState.callsUsed}건 사용 - 이번 실행은 ${effectiveLimit}건만 호출합니다.`
    );
  }

  const pending = manifest.candidates
    .map((row) => row.registrationNumber)
    .filter((number) => !refreshEntries.has(number));
  const selected = pending.slice(0, effectiveLimit);
  console.error(
    `[refreshStale] 재검증 후보 ${manifest.refreshCandidateCount}건 중 미처리 ${pending.length}건, ` +
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
      const registrationNumber = selected[cursor++];
      if (rateLimitError || haltError) continue;
      nextBudgetState = { ...nextBudgetState, callsUsed: nextBudgetState.callsUsed + 1 };
      saveBudgetState(budgetStatePath, nextBudgetState);
      try {
        const record = await client.getMarkHistory({ registrationNumber });
        const entry = {
          status: "complete",
          fetchedAt: new Date().toISOString(),
          record: sanitizeRegistryRecordForCache(record, adminList),
        };
        refreshEntries.set(registrationNumber, entry);
        consecutiveErrors = 0;
        completedThisRun++;
        if (completedThisRun % checkpointEvery === 0) {
          saveCache(refreshCachePath, refreshEntries);
          console.error(`[refreshStale] checkpoint new=${completedThisRun}, cache=${refreshEntries.size}`);
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
    asOf: asOf.toISOString(),
    requested: selected.length,
    newlyComplete: completedThisRun,
    rateLimitDetected: Boolean(rateLimitError),
    circuitBreakerDetected: Boolean(haltError),
    resumeNotBefore: nextBudgetState.resumeNotBefore,
    beforeAfter: selected
      .filter((number) => refreshEntries.has(number))
      .map((number) => ({
        registrationNumber: number,
        ...diffRegistryRecords(baseCache.get(number)?.record, refreshEntries.get(number)),
      })),
  };
  report.byCategory = {};
  for (const row of report.beforeAfter) {
    report.byCategory[row.category] = (report.byCategory[row.category] || 0) + 1;
  }
  const reportOutPath = path.resolve(
    args["report-out"] || path.join(path.dirname(cachePath), "registry-staleness-report.json")
  );
  writeJson(reportOutPath, report);
  console.error(
    `[refreshStale] 완료: 요청 ${report.requested}, 신규 완료 ${report.newlyComplete}, ` +
      `변경 분류=${JSON.stringify(report.byCategory)} -> ${refreshCachePath}, ${reportOutPath}`
  );

  if (args["merged-out"]) {
    const merged = new Map(baseCache);
    let mergedCount = 0;
    for (const [number, entry] of refreshEntries) {
      // 검증 후에만 병합한다(완료 조건) — 조회가 성공(found)한 재검증 결과만 기준 캐시를
      // 덮어쓰고, 실패(fetch_failed)한 건은 이전에 확보한 값을 그대로 지킨다.
      if (entry.status === "complete" && entry.record?.found !== false) {
        merged.set(number, entry);
        mergedCount++;
      }
    }
    const mergedOutPath = path.resolve(args["merged-out"]);
    saveCache(mergedOutPath, merged);
    console.error(
      `[refreshStale] 병합 결과(조회 성공 ${mergedCount}건 반영) -> ${mergedOutPath} ` +
        "(기준 캐시는 변경되지 않았습니다 — 검증 후 사람이 직접 교체하세요)"
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[refreshStale] 실패: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
