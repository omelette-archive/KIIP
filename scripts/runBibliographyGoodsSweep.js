#!/usr/bin/env node
"use strict";

/**
 * #12 경로C(서지상세) 캐시를 전체 파이프라인 실행과 분리해서 독립적으로 채운다.
 *
 * 배경(2026-09-21): 정식 파이프라인에서 ③e는 ③c(등록원부, ~29분)가 끝난 뒤에야
 * 시작돼 하루에 딱 한 번, 그것도 KIPRIS Plus 접근이 그 순간 열려있을 때만 몇 초
 * 성공한다. 이 스크립트는 그 타이밍 제약과 무관하게 필요할 때마다 독립적으로
 * enrichBibliographyGoods.js를 돌려 같은 공유 캐시(.kiip-operations/state/
 * bibliography-goods-cache.json)를 키운다 — 다음 정식 파이프라인 실행이 이 캐시를
 * 그대로 재사용하므로 재수집이 필요 없다(#12 2026-09-18 확인된 패턴).
 *
 * 사용자가 필요하다고 판단할 때만 수동으로 돌린다 — 예약 자동화 아님(2026-09-21 결정).
 *
 * 사용법:
 *   node scripts/runBibliographyGoodsSweep.js [--limit <n>] [--daily-budget <n>]
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNS_DIR = path.join(ROOT, ".kiip-operations", "runs");
const STATE_DIR = path.join(ROOT, ".kiip-operations", "state");
const SCRATCH_OUT = path.join(ROOT, ".kiip-operations", "state", "bibliography-goods-sweep-output.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  return args;
}

// 가장 최근 정식 실행의 03d(또는 없으면 03c) 산출물을 입력으로 쓴다 — 매번 새로
// 검색할 필요 없이, 최근에 이미 확보된 hit 목록에서 지정상품만 채운다.
function findLatestInput() {
  if (!fs.existsSync(RUNS_DIR)) throw new Error(`실행 이력이 없습니다: ${RUNS_DIR}`);
  const candidates = fs
    .readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(RUNS_DIR, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "03d-supplemental-scoped.json")))
    .map((dir) => ({ dir, mtime: fs.statSync(path.join(dir, "03d-supplemental-scoped.json")).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    throw new Error("03d-supplemental-scoped.json을 가진 실행 이력을 찾지 못했습니다 — 먼저 정식 파이프라인을 한 번 실행하세요.");
  }
  return path.join(candidates[0].dir, "03d-supplemental-scoped.json");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit || "500";
  const dailyBudget = args["daily-budget"] || "1000";
  const inputPath = findLatestInput();

  console.error(`[bibliographyGoodsSweep] 입력: ${inputPath}`);
  console.error(`[bibliographyGoodsSweep] limit=${limit} daily-budget=${dailyBudget}`);

  execFileSync(
    "node",
    [
      path.join(ROOT, "03-match-trademarks", "enrichBibliographyGoods.js"),
      "--input", inputPath,
      "--out", SCRATCH_OUT,
      "--cache", path.join(STATE_DIR, "bibliography-goods-cache.json"),
      "--budget-state", path.join(STATE_DIR, "bibliography-goods-daily-budget.json"),
      "--daily-budget", String(dailyBudget),
      "--limit", String(limit),
      "--concurrency", "3",
      "--checkpoint-every", "25",
    ],
    { stdio: "inherit" }
  );

  // 캐시만 키우는 게 목적이라 이 산출물 자체는 승격 대상이 아니다 — 다음 정식 실행이
  // 캐시를 재사용해 알아서 반영한다. 흔적을 안 남기도록 바로 지운다. 스트리밍 라이터가
  // 핸들을 늦게 놓는 경우가 있어(Windows EBUSY) 짧게 재시도한다.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (fs.existsSync(SCRATCH_OUT)) fs.unlinkSync(SCRATCH_OUT);
      break;
    } catch (error) {
      if (attempt === 9) {
        console.error(`[bibliographyGoodsSweep] 임시 산출물 정리 실패(무시 가능, 다음 실행 때 덮어씀): ${error.message}`);
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }

  console.error("[bibliographyGoodsSweep] 완료 — 캐시가 커졌으면 다음 정식 파이프라인 실행(재승격) 때 자동 반영됩니다.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[bibliographyGoodsSweep] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { findLatestInput };
