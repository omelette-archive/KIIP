#!/usr/bin/env node
"use strict";
/**
 * ⑤단계 브랜드 공백 랭킹만 입력으로 받아 고정 템플릿 비즈니스 확장 전략 초안을 만든다
 * (이슈 #16의 ⑥-1). 생성형 AI를 쓰지 않는다 — 동일 입력은 항상 동일 문장이 나온다.
 *
 * ⑥-2(필요한 건만 개별 AI 검토)는 이 스크립트의 범위 밖이다. 여기서 만든 초안의 수치·
 * 근거를 사람이 바꾸지 않는 한, 이 산출물이 그대로 최종본이다.
 *
 * 사용법:
 *   node 06-generate-business-strategy/generateStrategy.js \
 *     --input 05-detect-brand-gap/output/gap.json \
 *     --out 06-generate-business-strategy/output/strategy.json
 */

const fs = require("fs");
const path = require("path");
const { TEMPLATE_VERSION, buildBriefing } = require("./lib/templates");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    args[key] = hasValue ? next : true;
    if (hasValue) i++;
  }
  return args;
}

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 06-generate-business-strategy/generateStrategy.js --input <05단계 gap.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>   결과 JSON 저장 경로 (기본: 06-generate-business-strategy/output/strategy.json)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

/**
 * @param {object} gap ⑤단계 detectGaps() 출력
 */
function generateStrategies(gap) {
  if (!gap || !Array.isArray(gap.ranking)) {
    throw new Error("입력은 ⑤단계 gap.json이어야 합니다 (ranking 배열 필요).");
  }

  const briefings = gap.ranking.map(buildBriefing);
  const alertCount = briefings.filter((b) => b.isGapAlert).length;

  return {
    schemaVersion: "1.0",
    templateVersion: TEMPLATE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceScoreVersion: gap.scoreVersion || null,
    sourceGeneratedAt: gap.generatedAt || null,
    provenance: {
      inputSchemaVersion: gap.schemaVersion || null,
      inputScoreVersion: gap.scoreVersion || null,
      upstream: gap.provenance || null,
    },
    methodology: {
      generationMode: "deterministic_template",
      factSource: "⑤ ranking의 evidence와 수치만 사용",
      aiReviewApplied: false,
      rationale: "생성형 AI 검토 전에도 재현 가능하고 근거를 감사할 수 있는 초안을 우선 생성",
      criteriaIssue: "#16",
      lastUpdatedAt: "2026-08-10",
    },
    warnings: [
      "문장 임계값(공백 경고 기준, 지역 외 비중 경고 기준)은 예시값이다(templateVersion 참고) — " +
        "실제 기준 확정 후 06-generate-business-strategy/lib/templates.js만 교체하면 된다.",
      "AI 검토(⑥-2)를 거치지 않은 고정 템플릿 초안이다. 문장은 evidence 필드의 수치에서만 " +
        "만들어지며 그 밖의 사실을 추가하지 않는다.",
    ],
    summary: { briefingCount: briefings.length, alertCount },
    briefings,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "strategy.json"));

  let gap;
  try {
    gap = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new Error(`입력 JSON을 읽을 수 없습니다 (${inputPath}): ${error.message}`);
  }

  const result = generateStrategies(gap);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.error(
    `[generateStrategy] briefings=${result.summary.briefingCount}, alerts=${result.summary.alertCount} -> ${outPath}`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[generateStrategy] 실패: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { generateStrategies, parseArgs };
