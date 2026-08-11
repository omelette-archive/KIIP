#!/usr/bin/env node
"use strict";
/**
 * ⑥-2 개별 AI 검토 CLI (이슈 #16). 사람이 직접 실행하는 4개 하위 명령이며, 파이프라인이
 * 자동으로 생성형 AI를 호출하지 않는다 — propose 단계는 사람(또는 사람이 감수하는 AI 세션)이
 * 결과를 --proposedSentences로 직접 제출한다. select의 유일한 입력은 ⑥-1 strategy.json이고,
 * apply는 그 원본을 절대 수정하지 않는다.
 *
 *   select  ⑥-1 산출물에서 검토가 필요한 후보만 뽑는다 (부분 수집 또는 지역매칭 미검증)
 *   propose 후보 하나에 대한 제안을 append-only로 기록한다 (모델/프롬프트/제안/오류)
 *   decide  제안에 대한 사람의 approve/reject/keep_pending 결정을 append-only로 기록한다
 *   apply   승인된 제안만 반영한 별도 산출물을 만든다 (원본 strategy.json은 바꾸지 않는다)
 */

const fs = require("fs");
const path = require("path");
const {
  selectReviewCandidates,
  recordReviewProposal,
  recordReviewDecision,
  applyReviewedStrategy,
  readJsonLines,
} = require("./lib/review");

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
}

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 06-generate-business-strategy/reviewStrategy.js <select|propose|decide|apply> [옵션]",
      "",
      "select  --input <strategy.json> [--limit 20] --out <review-queue.json>",
      "propose --candidateId <id> --provider <p> --model <m> --promptVersion <v>",
      "        (--proposedSentences <JSON배열> | --error <메시지>)",
      "        [--rationale <text>] [--costTokens <n>] [--submittedBy <name>]",
      "        [--queue <review-queue.json>] --proposals <review-proposals.jsonl>",
      "decide  --candidateId <id> --decision approved|rejected|keep_pending --reviewer <name>",
      "        [--proposalVersion <n>] [--note <text>] --decisions <review-decisions.jsonl>",
      "apply   --strategy <strategy.json> --proposals <review-proposals.jsonl>",
      "        --decisions <review-decisions.jsonl> --out <strategy-reviewed.json>",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function runSelect(args) {
  if (!args.input) printUsageAndExit("select --input 은 필수입니다.");
  const strategy = readJson(path.resolve(args.input));
  const limit = args.limit ? Number(args.limit) : 20;
  if (!Number.isInteger(limit) || limit < 1) printUsageAndExit("--limit 은 1 이상의 정수여야 합니다.");
  const queue = selectReviewCandidates(strategy, { limit });
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "review-queue.json"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(queue, null, 2), "utf8");
  console.error(
    `[reviewStrategy select] matched=${queue.matchedCount}, selected=${queue.selectedCount} -> ${outPath}`
  );
}

function runPropose(args) {
  if (!args.candidateId) printUsageAndExit("propose --candidateId 는 필수입니다.");
  if (!args.provider || !args.model || !args.promptVersion) {
    printUsageAndExit("propose --provider --model --promptVersion 은 필수입니다.");
  }
  if (!args.proposedSentences && !args.error) {
    printUsageAndExit("propose --proposedSentences 또는 --error 중 하나는 필요합니다.");
  }
  const proposalsPath = path.resolve(
    args.proposals || path.join(__dirname, "output", "review-proposals.jsonl")
  );

  let queueEntry = null;
  if (args.queue) {
    const queue = readJson(path.resolve(args.queue));
    queueEntry = (queue.candidates || []).find((c) => c.candidateId === args.candidateId);
    if (!queueEntry) printUsageAndExit(`--queue 에서 candidateId=${args.candidateId} 를 찾을 수 없습니다.`);
  }

  const record = recordReviewProposal(proposalsPath, {
    candidateId: args.candidateId,
    region: queueEntry ? queueEntry.region : args.region || null,
    itemName: queueEntry ? queueEntry.itemName : args.itemName || null,
    niceClass: queueEntry ? queueEntry.niceClass : args.niceClass || null,
    sourceTemplateVersion: args.sourceTemplateVersion || null,
    modelProvider: args.provider,
    modelName: args.model,
    promptVersion: args.promptVersion,
    proposedSentences: args.proposedSentences ? JSON.parse(args.proposedSentences) : null,
    rationale: args.rationale || null,
    error: args.error || null,
    costTokens: args.costTokens ? Number(args.costTokens) : null,
    submittedBy: args.submittedBy || null,
  });
  console.error(
    `[reviewStrategy propose] candidateId=${record.candidateId} proposalVersion=${record.proposalVersion} -> ${proposalsPath}`
  );
}

function runDecide(args) {
  if (!args.candidateId) printUsageAndExit("decide --candidateId 는 필수입니다.");
  if (!args.decision) printUsageAndExit("decide --decision 은 필수입니다.");
  if (!args.reviewer) printUsageAndExit("decide --reviewer 는 필수입니다.");
  const decisionsPath = path.resolve(
    args.decisions || path.join(__dirname, "output", "review-decisions.jsonl")
  );
  const record = recordReviewDecision(decisionsPath, {
    candidateId: args.candidateId,
    proposalVersion: args.proposalVersion ? Number(args.proposalVersion) : null,
    decision: args.decision,
    reviewer: args.reviewer,
    note: args.note || null,
  });
  console.error(
    `[reviewStrategy decide] candidateId=${record.candidateId} decision=${record.decision} -> ${decisionsPath}`
  );
}

function runApply(args) {
  if (!args.strategy) printUsageAndExit("apply --strategy 는 필수입니다.");
  const strategy = readJson(path.resolve(args.strategy));
  const proposals = readJsonLines(
    path.resolve(args.proposals || path.join(__dirname, "output", "review-proposals.jsonl"))
  );
  const decisions = readJsonLines(
    path.resolve(args.decisions || path.join(__dirname, "output", "review-decisions.jsonl"))
  );
  const result = applyReviewedStrategy(strategy, proposals, decisions);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "strategy-reviewed.json"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  const approvedCount = result.briefings.filter((b) => b.review.status === "approved").length;
  console.error(
    `[reviewStrategy apply] briefings=${result.briefings.length}, approved=${approvedCount} -> ${outPath}`
  );
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (args.help || args.h || !subcommand) printUsageAndExit();
  if (subcommand === "select") return runSelect(args);
  if (subcommand === "propose") return runPropose(args);
  if (subcommand === "decide") return runDecide(args);
  if (subcommand === "apply") return runApply(args);
  printUsageAndExit(`알 수 없는 하위 명령: ${subcommand}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[reviewStrategy] 실패: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, runSelect, runPropose, runDecide, runApply };
