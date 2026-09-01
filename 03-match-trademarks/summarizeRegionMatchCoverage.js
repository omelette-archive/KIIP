#!/usr/bin/env node
"use strict";
/**
 * #73 남은 범위 — ③ 검색 스냅샷(matchTrademarks.js 출력) 기준 지역 매칭 상태
 * (inside/outside/unverified) 비율을 자동 집계한다. 지금까지는
 * `docs/applicant-region-recovery-runbook.md` 6절 "재분석 전·후 검증표"의
 * 이 항목을 사람이 두 스냅샷을 열어 손으로 비교해야 했다.
 *
 * API 호출 없이 이미 저장된 ③ 산출물 JSON만 읽는다. storageMode=query_facts는
 * hit이 지역행마다 복제되지 않고 queryFact에 한 번만 저장되며 그 저장값은 빈 지역
 * 기준이다 — regionEvaluatedHitSources()가 results를 펼쳐 각 entry.query.region에
 * 대해 저장된 applicantRegionEvidence로 관계를 다시 판정한다(expanded 저장 방식과
 * 동일한 지역×검색행 모집단). summarizeIpRegistryMatches()도 경로 A(출원번호)·경로 B
 * (등록번호) 둘 다 세도록 넓혔다 — 이전에는 경로 B만 세고 있었다.
 */

const fs = require("fs");
const path = require("path");
const { regionEvaluatedHitSources, summarizeIpRegistryMatches } = require("./lib/ipRegistryEnricher");

function parseArgs(argv) {
  const args = {};
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
      "  node 03-match-trademarks/summarizeRegionMatchCoverage.js --input <③ 산출물 JSON> [옵션]",
      "  node 03-match-trademarks/summarizeRegionMatchCoverage.js --before <이전> --after <이후> [옵션]",
      "",
      "옵션:",
      "  --out <path>   결과 JSON 저장 경로(선택, 생략하면 stdout에 표로만 출력)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function loadDocument(inputPath) {
  return JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8").replace(/^﻿/, ""));
}

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

/**
 * @param {object} document ③ 산출물(storageMode 무관)
 */
function summarizeDocument(document) {
  const counts = summarizeIpRegistryMatches(regionEvaluatedHitSources(document));
  return {
    ...counts,
    ratios: {
      inside: ratio(counts.inside, counts.referenced),
      outside: ratio(counts.outside, counts.referenced),
      unverified: ratio(counts.unverified, counts.referenced),
    },
  };
}

function delta(before, after) {
  return {
    referenced: after.referenced - before.referenced,
    inside: after.inside - before.inside,
    outside: after.outside - before.outside,
    unverified: after.unverified - before.unverified,
    ratios: {
      inside: after.ratios.inside !== null && before.ratios.inside !== null
        ? Number((after.ratios.inside - before.ratios.inside).toFixed(4))
        : null,
      outside: after.ratios.outside !== null && before.ratios.outside !== null
        ? Number((after.ratios.outside - before.ratios.outside).toFixed(4))
        : null,
      unverified: after.ratios.unverified !== null && before.ratios.unverified !== null
        ? Number((after.ratios.unverified - before.ratios.unverified).toFixed(4))
        : null,
    },
  };
}

function printSummary(label, summary) {
  console.error(
    `[regionMatchCoverage] ${label}: referenced=${summary.referenced} ` +
      `inside=${summary.inside}(${summary.ratios.inside ?? "n/a"}) ` +
      `outside=${summary.outside}(${summary.ratios.outside ?? "n/a"}) ` +
      `unverified=${summary.unverified}(${summary.ratios.unverified ?? "n/a"}) ` +
      `bySource=${JSON.stringify(summary.bySource)}`
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();

  let report;
  if (args.before || args.after) {
    if (!args.before || !args.after) usage("--before와 --after는 함께 줘야 합니다.");
    const before = summarizeDocument(loadDocument(args.before));
    const after = summarizeDocument(loadDocument(args.after));
    printSummary("전(before)", before);
    printSummary("후(after)", after);
    report = {
      generatedAt: new Date().toISOString(),
      beforePath: path.resolve(args.before),
      afterPath: path.resolve(args.after),
      before,
      after,
      delta: delta(before, after),
    };
    console.error(`[regionMatchCoverage] 변화: ${JSON.stringify(report.delta)}`);
  } else {
    if (!args.input) usage("--input 또는 --before/--after 중 하나는 필수입니다.");
    const summary = summarizeDocument(loadDocument(args.input));
    printSummary(path.basename(args.input), summary);
    report = {
      generatedAt: new Date().toISOString(),
      inputPath: path.resolve(args.input),
      summary,
    };
  }

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(`[regionMatchCoverage] -> ${outPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[regionMatchCoverage] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { main, parseArgs, summarizeDocument, delta };
