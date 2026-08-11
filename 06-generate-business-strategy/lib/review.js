"use strict";
/**
 * ⑥-2: ⑥-1 고정 템플릿 초안 중 근거가 약한 것만 사람이(또는 사람이 감수하는 AI 세션이)
 * 개별 검토해서 제안하고, 그 제안을 원본과 분리된 append-only 기록에 감사 가능하게 남긴다
 * (이슈 #16). 파이프라인이 자동으로 생성형 AI를 호출하지 않는다 — 제안은 사람이
 * recordReviewProposal로 직접 제출한다. 사람이 approve하기 전에는 strategy.json 원본에
 * 아무것도 반영하지 않는다.
 *
 * 선정 조건(OR, 2026-08-11 확정): evidence.collectionPartial === true 이거나
 * evidence.regionMatchVerified === false 인 briefing만 검토 대상으로 좁힌다 — 근거가
 * 이미 충분히 검증된 briefing은 사람이 다시 볼 필요가 없다.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REVIEW_SELECTION_VERSION = "review-selection-v1";
const VALID_DECISIONS = ["approved", "rejected", "keep_pending"];

function selectionReasons(briefing) {
  const evidence = briefing.evidence || {};
  const reasons = [];
  if (evidence.collectionPartial) reasons.push("collection_partial");
  if (evidence.regionMatchVerified === false) reasons.push("region_unverified");
  return reasons;
}

function needsReview(briefing) {
  return selectionReasons(briefing).length > 0;
}

/**
 * region/itemName/niceClass/templateVersion 조합은 ⑥-1 안에서 유일하다(⑤ ranking 키와 동일
 * 성격). 재실행해도 같은 briefing은 같은 candidateId를 가지므로 append-only 기록을 같은
 * 후보에 계속 이어붙일 수 있다.
 */
function candidateId(briefing, templateVersion) {
  const raw = [briefing.region, briefing.itemName, briefing.niceClass || "", templateVersion || ""].join(
    ""
  );
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * @param {object} strategy ⑥-1 generateStrategies() 출력 (이 함수의 유일한 입력이어야 함 — #16)
 * @param {{limit?: number}} options 1회 최대 선정 건수(기본 20)
 */
function selectReviewCandidates(strategy, options = {}) {
  if (!strategy || !Array.isArray(strategy.briefings)) {
    throw new Error("입력은 ⑥-1 strategy.json이어야 합니다 (briefings 배열 필요).");
  }
  const limit = options.limit || 20;
  const templateVersion = strategy.templateVersion || null;

  const matched = strategy.briefings
    .map((briefing) => ({ briefing, reasons: selectionReasons(briefing) }))
    .filter((entry) => entry.reasons.length > 0);

  // 결정론적 정렬: gapScore 내림차순 -> region/itemName 사전순(⑤ ranking 정렬 규칙과 동일) —
  // limit에 걸려 잘려도 항상 같은 후보 집합이 선택되게 한다.
  matched.sort(
    (a, b) =>
      (b.briefing.gapScore || 0) - (a.briefing.gapScore || 0) ||
      String(a.briefing.region).localeCompare(String(b.briefing.region), "ko") ||
      String(a.briefing.itemName).localeCompare(String(b.briefing.itemName), "ko")
  );

  const selected = matched.slice(0, limit);

  return {
    schemaVersion: "1.0",
    selectionVersion: REVIEW_SELECTION_VERSION,
    generatedAt: new Date().toISOString(),
    sourceTemplateVersion: templateVersion,
    sourceGeneratedAt: strategy.generatedAt || null,
    totalBriefingCount: strategy.briefings.length,
    matchedCount: matched.length,
    selectedCount: selected.length,
    truncated: matched.length > selected.length,
    criteria: {
      rule: "evidence.collectionPartial === true OR evidence.regionMatchVerified === false",
      limit,
    },
    candidates: selected.map(({ briefing, reasons }) => ({
      candidateId: candidateId(briefing, templateVersion),
      region: briefing.region,
      itemName: briefing.itemName,
      niceClass: briefing.niceClass,
      gapScore: briefing.gapScore,
      reasons,
      sentences: briefing.sentences,
      evidence: briefing.evidence,
    })),
  };
}

function appendJsonLine(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function nextProposalVersion(existingProposals, id) {
  const versions = existingProposals
    .filter((record) => record.candidateId === id)
    .map((record) => record.proposalVersion);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

/**
 * 제안을 append-only로 기록한다. 기존 레코드를 수정·삭제하지 않고 항상 새 줄을 추가한다 —
 * 같은 candidateId를 다시 제출해도 proposalVersion이 올라간 새 레코드가 될 뿐, 이전 제안은
 * 그대로 남는다. 모델/생성 오류는 error 필드에 담고 예외를 던지지 않는다(⑥-1 결과에
 * 영향 없음).
 */
function recordReviewProposal(proposalsPath, input) {
  if (!input || !input.candidateId) {
    throw new Error("recordReviewProposal: candidateId가 필요합니다.");
  }
  if (!input.proposedSentences && !input.error) {
    throw new Error("recordReviewProposal: proposedSentences 또는 error 중 하나는 있어야 합니다.");
  }
  const existing = readJsonLines(proposalsPath);
  const record = {
    recordType: "proposal",
    candidateId: input.candidateId,
    proposalVersion: nextProposalVersion(existing, input.candidateId),
    region: input.region || null,
    itemName: input.itemName || null,
    niceClass: input.niceClass || null,
    sourceTemplateVersion: input.sourceTemplateVersion || null,
    modelProvider: input.modelProvider || null,
    modelName: input.modelName || null,
    promptVersion: input.promptVersion || null,
    proposedSentences: input.proposedSentences || null,
    rationale: input.rationale || null,
    error: input.error || null,
    costTokens: typeof input.costTokens === "number" ? input.costTokens : null,
    submittedBy: input.submittedBy || null,
    createdAt: new Date().toISOString(),
  };
  appendJsonLine(proposalsPath, record);
  return record;
}

/**
 * 사람의 approve/reject/keep_pending 결정을 append-only로 기록한다. 재실행 시에도 이전
 * 결정을 덮어쓰지 않고 새 레코드를 추가한다 — 최신 레코드가 유효한 결정이다.
 */
function recordReviewDecision(decisionsPath, input) {
  if (!input || !input.candidateId) {
    throw new Error("recordReviewDecision: candidateId가 필요합니다.");
  }
  if (!VALID_DECISIONS.includes(input.decision)) {
    throw new Error(
      `recordReviewDecision: decision은 ${VALID_DECISIONS.join("/")} 중 하나여야 합니다 (받음: ${input.decision})`
    );
  }
  if (!input.reviewer) {
    throw new Error("recordReviewDecision: reviewer가 필요합니다.");
  }
  const record = {
    recordType: "decision",
    candidateId: input.candidateId,
    proposalVersion: typeof input.proposalVersion === "number" ? input.proposalVersion : null,
    decision: input.decision,
    reviewer: input.reviewer,
    note: input.note || null,
    reviewedAt: new Date().toISOString(),
  };
  appendJsonLine(decisionsPath, record);
  return record;
}

function latestByCandidateId(records) {
  const map = new Map();
  for (const record of records) {
    const list = map.get(record.candidateId) || [];
    list.push(record);
    map.set(record.candidateId, list);
  }
  return map;
}

/**
 * strategy.json 원본은 절대 수정하지 않고, 승인된 제안만 반영한 새 객체를 반환한다.
 * approve되지 않은 briefing은 원본 sentences를 그대로 유지하며 review.status로 상태만
 * 남긴다. approve됐어도 참조한 제안이 없거나 오류였다면 원본을 그대로 지킨다.
 *
 * @param {object} strategy ⑥-1 산출물
 * @param {object[]} proposals recordReviewProposal로 쌓인 레코드 배열(readJsonLines 결과)
 * @param {object[]} decisions recordReviewDecision으로 쌓인 레코드 배열(readJsonLines 결과)
 */
function applyReviewedStrategy(strategy, proposals, decisions) {
  if (!strategy || !Array.isArray(strategy.briefings)) {
    throw new Error("입력은 ⑥-1 strategy.json이어야 합니다 (briefings 배열 필요).");
  }
  const templateVersion = strategy.templateVersion || null;
  const proposalsById = latestByCandidateId(proposals || []);
  const decisionsById = latestByCandidateId(decisions || []);

  const briefings = strategy.briefings.map((briefing) => {
    const id = candidateId(briefing, templateVersion);
    const decisionRecords = decisionsById.get(id) || [];
    const latestDecision = decisionRecords[decisionRecords.length - 1] || null;

    if (!latestDecision || latestDecision.decision !== "approved") {
      return {
        ...briefing,
        review: {
          status: latestDecision ? latestDecision.decision : needsReview(briefing) ? "not_reviewed" : "not_applicable",
          candidateId: needsReview(briefing) ? id : null,
        },
      };
    }

    const proposalRecords = (proposalsById.get(id) || []).filter(
      (record) => record.proposalVersion === latestDecision.proposalVersion
    );
    const proposal = proposalRecords[proposalRecords.length - 1];

    if (!proposal || proposal.error || !proposal.proposedSentences) {
      return {
        ...briefing,
        review: { status: "approved_but_missing_proposal", candidateId: id },
      };
    }

    return {
      ...briefing,
      sentences: proposal.proposedSentences,
      originalSentences: briefing.sentences,
      review: {
        status: "approved",
        candidateId: id,
        proposalVersion: proposal.proposalVersion,
        modelProvider: proposal.modelProvider,
        modelName: proposal.modelName,
        promptVersion: proposal.promptVersion,
        reviewer: latestDecision.reviewer,
        reviewedAt: latestDecision.reviewedAt,
      },
    };
  });

  return {
    ...strategy,
    briefings,
    reviewApplied: true,
    reviewAppliedAt: new Date().toISOString(),
  };
}

module.exports = {
  REVIEW_SELECTION_VERSION,
  VALID_DECISIONS,
  needsReview,
  selectionReasons,
  candidateId,
  selectReviewCandidates,
  appendJsonLine,
  readJsonLines,
  recordReviewProposal,
  recordReviewDecision,
  applyReviewedStrategy,
};
