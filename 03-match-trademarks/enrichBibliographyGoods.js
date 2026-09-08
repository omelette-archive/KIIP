#!/usr/bin/env node
"use strict";
/**
 * #12 확장(경로 C) — 서지상세(getBibliographyDetailInfoSearch)로 지정상품을 조회해
 * 등록원부(경로 B)가 도달 못 하는 미등록 출원까지 지정상품 대조를 넓힌다.
 * 이미 등록원부로 normalized_exact 확정된 hit는 절대 건드리지 않는다(등록원부 authoritative).
 * 우선순위: 등록번호 없음(등록원부 영구 도달 불가) 먼저, 그다음 등록됐지만 미확정.
 *
 * 03c 교훈 반영: SERVICE_ACCESS_DENIED를 "0건 완료"로 삼키지 않음(7dd502d 가드),
 * 재개 가능(캐시), 저장 스로틀(예산은 N건마다만 디스크 반영), 스트리밍 쓰기(대용량 출력).
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { writeJsonStreaming } = require("../scripts/lib/streamJsonWrite");
const { createClient } = require("./lib/kiprisClient");
const { enrichDocument, collectCandidates } = require("./lib/bibliographyGoodsEnricher");
const { loadCache, saveCache } = require("./lib/bibliographyGoodsCache");
const {
  loadBudgetState,
  saveBudgetState,
  isResumeBlocked,
  recordRateLimit,
  remainingBudget,
} = require("./lib/ipRegistryBudget");

loadEnv();

function parseArgs(argv) {
  const args = {
    limit: 100,
    concurrency: 2,
    "checkpoint-every": 50,
    out: path.join(__dirname, "output", "bibliography-goods-enriched.json"),
    cache: path.join(__dirname, "output", "bibliography-goods-cache.json"),
    "budget-state": path.join(__dirname, "output", "bibliography-goods-daily-budget.json"),
  };
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
      "  node 03-match-trademarks/enrichBibliographyGoods.js --input <③/03d 결과.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>          출력 경로 (기본: output/bibliography-goods-enriched.json)",
      "  --cache <path>        출원번호별 지정상품 영속 캐시",
      "  --budget-state <path> 일별 호출량·재개 상태 (기본: output/bibliography-goods-daily-budget.json)",
      "  --daily-budget <n>    하루(KST) 누적 호출 상한(미지정=무제한, 일일 한도 미확인이라 보수적으로 지정 권장)",
      "  --limit <n>           이번 실행 신규 호출 상한(기본 100)",
      "  --concurrency <n>     동시 호출 수(기본 2, 최대 5)",
      "  --checkpoint-every <n> 성공 n건마다 캐시 저장(기본 50)",
      "  --dry-run             API 호출 없이 후보 수만 확인",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();
  if (!args.input) usage("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out);
  const cachePath = path.resolve(args.cache);
  const budgetStatePath = path.resolve(args["budget-state"]);
  const limit = Number(args.limit);
  if (!Number.isInteger(limit) || limit < 0 || limit > 50000) usage("--limit은 0~50000 정수여야 합니다.");
  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) usage("--concurrency는 1~5 정수여야 합니다.");
  const checkpointEvery = Number(args["checkpoint-every"]);
  if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1) usage("--checkpoint-every는 1 이상 정수여야 합니다.");
  const dailyBudget = args["daily-budget"] === undefined ? undefined : Number(args["daily-budget"]);
  if (dailyBudget !== undefined && (!Number.isInteger(dailyBudget) || dailyBudget < 1)) {
    usage("--daily-budget은 1 이상 정수여야 합니다.");
  }

  const document = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^﻿/, ""));
  const goodsCache = loadCache(cachePath);
  const now = new Date();
  const budgetState = loadBudgetState(budgetStatePath, now);
  const blocked = isResumeBlocked(budgetState, now);
  const effectiveLimit = blocked ? 0 : Math.min(limit, remainingBudget(budgetState, dailyBudget));

  if (args["dry-run"]) {
    const candidates = collectCandidates(document);
    const pending = candidates.filter((c) => c.pending).length;
    console.error(
      `[enrichBibliographyGoods] dry-run 후보=${candidates.length}(등록원부 도달불가=${pending}, 등록완료 미확정=${candidates.length - pending}), ` +
        `todayUsed=${budgetState.callsUsed}, resumeNotBefore=${budgetState.resumeNotBefore || "없음"}`
    );
    return;
  }

  if (blocked) {
    console.error(`[enrichBibliographyGoods] 이전 접근거부 이후 재개 대기 중 — resumeNotBefore=${budgetState.resumeNotBefore}. 캐시만 적용합니다.`);
  } else if (dailyBudget !== undefined && effectiveLimit < limit) {
    console.error(`[enrichBibliographyGoods] 일일 예산(${dailyBudget}) 중 ${budgetState.callsUsed}건 사용 — 이번 실행은 ${effectiveLimit}건만 호출합니다.`);
  }

  let nextBudgetState = { ...budgetState };
  let requestsSinceBudgetSave = 0;
  const BUDGET_SAVE_EVERY = 25; // bd44b3e 교훈: 매 요청 디스크 저장은 이벤트 루프를 막는다.
  let completedThisRun = 0;

  const client = createClient({ apiKey: process.env.KIPRIS_API_KEY });

  const result = await enrichDocument(document, client, {
    limit: effectiveLimit,
    concurrency,
    goodsCache,
    onRequest: () => {
      nextBudgetState = { ...nextBudgetState, callsUsed: nextBudgetState.callsUsed + 1 };
      if (++requestsSinceBudgetSave >= BUDGET_SAVE_EVERY) {
        requestsSinceBudgetSave = 0;
        saveBudgetState(budgetStatePath, nextBudgetState);
      }
    },
    onAccessDenied: (error) => {
      nextBudgetState = recordRateLimit(nextBudgetState, new Date(), "daily");
      saveBudgetState(budgetStatePath, nextBudgetState);
      console.error(`[enrichBibliographyGoods] 접근 거부 감지 — 회로 차단: ${error.message}`);
    },
    onCacheUpdate: () => {
      completedThisRun++;
      if (completedThisRun % checkpointEvery === 0) {
        saveCache(cachePath, goodsCache);
        console.error(`[enrichBibliographyGoods] checkpoint new=${completedThisRun}, cache=${goodsCache.size}`);
      }
    },
  });

  saveCache(cachePath, goodsCache);
  saveBudgetState(budgetStatePath, nextBudgetState);
  await writeJsonStreaming(outPath, result.document);

  const s = result.summary;
  console.error(
    `[enrichBibliographyGoods] 후보=${s.candidateCount} 선택=${s.selectedCount} 고유출원=${s.uniqueApplicationCount} ` +
      `요청=${s.requestedCount} 신규완료=${s.newlyCompleteCount} 오류=${s.errorCount} ` +
      `확정(exact)=${s.appliedExactCount} 기타=${s.appliedOtherCount} ` +
      `접근거부=${s.accessDeniedDetected} todayUsed=${nextBudgetState.callsUsed} -> ${outPath}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[enrichBibliographyGoods] 실패: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
