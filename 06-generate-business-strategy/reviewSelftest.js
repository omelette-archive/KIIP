"use strict";
/**
 * ⑥-2(#16) 검토 선정·append-only 저장·승인 반영을 네트워크·AI 키 없이 검증한다.
 * 06-generate-business-strategy/selftest.js에서 runReviewTests()로 호출된다.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  REVIEW_SELECTION_VERSION,
  needsReview,
  candidateId,
  selectReviewCandidates,
  readJsonLines,
  recordReviewProposal,
  recordReviewDecision,
  applyReviewedStrategy,
} = require("./lib/review");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function makeBriefing(overrides = {}) {
  return {
    region: "경상북도 안동시",
    itemName: "사과",
    niceClass: "31",
    gapScore: 0.8,
    isGapAlert: true,
    sentences: ["원본 문장 1."],
    evidence: {
      uniqueTrademarkCount: 1,
      registrationRate: 0,
      localApplicantShare: null,
      regionMatchVerified: false,
      collectionPartial: false,
      scoreInputs: null,
      sourceProvenance: [],
    },
    ...overrides,
  };
}

async function runReviewTests() {
  console.log("11) needsReview/selectReviewCandidates — collectionPartial OR regionMatchVerified=false(#29 아님, #16)");
  {
    const verifiedGood = makeBriefing({
      region: "전라남도 보성군",
      itemName: "녹차",
      evidence: { ...makeBriefing().evidence, regionMatchVerified: true, collectionPartial: false },
    });
    const partialOnly = makeBriefing({
      region: "충청북도 제천시",
      itemName: "인삼",
      evidence: { ...makeBriefing().evidence, regionMatchVerified: true, collectionPartial: true },
    });
    const unverifiedOnly = makeBriefing(); // regionMatchVerified: false

    assert.strictEqual(needsReview(verifiedGood), false, "검증되고 partial도 아니면 검토 불필요");
    assert.strictEqual(needsReview(partialOnly), true, "partial이면 검증 여부와 무관하게 검토 필요");
    assert.strictEqual(needsReview(unverifiedOnly), true, "지역매칭 미검증이면 검토 필요");

    const strategy = {
      templateVersion: "strategy-template-v0-example",
      generatedAt: "2026-08-11T00:00:00.000Z",
      briefings: [verifiedGood, partialOnly, unverifiedOnly],
    };
    const queue = selectReviewCandidates(strategy, { limit: 20 });
    assert.strictEqual(queue.selectionVersion, REVIEW_SELECTION_VERSION);
    assert.strictEqual(queue.totalBriefingCount, 3);
    assert.strictEqual(queue.matchedCount, 2, "검증되고 partial 아닌 보성군 녹차는 후보에서 빠짐");
    assert.strictEqual(queue.selectedCount, 2);
    assert.strictEqual(queue.truncated, false);
    assert.ok(queue.candidates.every((c) => c.region !== "전라남도 보성군"));
    ok("collectionPartial 또는 regionMatchVerified=false(OR)만 후보로 선정되고, 검증된 행은 제외됨");
  }

  console.log("11-1) selectReviewCandidates — limit 초과 시 결정론적으로 잘림(gapScore 내림차순)");
  {
    const strategy = {
      templateVersion: "strategy-template-v0-example",
      generatedAt: "2026-08-11T00:00:00.000Z",
      briefings: [
        makeBriefing({ region: "A", itemName: "품목A", gapScore: 0.3 }),
        makeBriefing({ region: "B", itemName: "품목B", gapScore: 0.9 }),
        makeBriefing({ region: "C", itemName: "품목C", gapScore: 0.6 }),
      ],
    };
    const queue = selectReviewCandidates(strategy, { limit: 2 });
    assert.strictEqual(queue.matchedCount, 3);
    assert.strictEqual(queue.selectedCount, 2);
    assert.strictEqual(queue.truncated, true);
    assert.deepStrictEqual(
      queue.candidates.map((c) => c.region),
      ["B", "C"],
      "gapScore가 높은 순으로 limit만큼만 선정되어야 함"
    );

    const queueAgain = selectReviewCandidates(strategy, { limit: 2 });
    assert.deepStrictEqual(queue.candidates, queueAgain.candidates, "generatedAt 외 동일 입력은 항상 동일 후보 집합(결정론성)");
    ok("limit 초과분은 gapScore 내림차순으로 결정론적으로 잘리고, 재실행해도 같은 후보가 선정됨");
  }

  console.log("11-2) selectReviewCandidates — 입력 계약 위반 시 명확한 오류");
  {
    assert.throws(() => selectReviewCandidates({}), /briefings/);
    assert.throws(() => selectReviewCandidates(null), /briefings/);
    ok("⑥-1 산출물 형태가 아니면 즉시 실패");
  }

  console.log("12) recordReviewProposal/recordReviewDecision — append-only, 원본 파일 불변");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-review-test-"));
    try {
      const proposalsPath = path.join(tempDir, "review-proposals.jsonl");
      const decisionsPath = path.join(tempDir, "review-decisions.jsonl");
      const briefing = makeBriefing();
      const id = candidateId(briefing, "strategy-template-v0-example");

      const p1 = recordReviewProposal(proposalsPath, {
        candidateId: id,
        region: briefing.region,
        itemName: briefing.itemName,
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-5",
        promptVersion: "review-prompt-v1",
        proposedSentences: ["검토된 문장 1."],
        submittedBy: "test-reviewer",
      });
      assert.strictEqual(p1.proposalVersion, 1);

      const p2 = recordReviewProposal(proposalsPath, {
        candidateId: id,
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-5",
        promptVersion: "review-prompt-v2",
        proposedSentences: ["검토된 문장 2(재제출)."],
      });
      assert.strictEqual(p2.proposalVersion, 2, "같은 candidateId 재제출은 버전이 올라간 새 레코드로 추가됨");

      const proposals = readJsonLines(proposalsPath);
      assert.strictEqual(proposals.length, 2, "이전 제안이 삭제·수정되지 않고 그대로 남아있어야 함(append-only)");
      assert.strictEqual(proposals[0].proposedSentences[0], "검토된 문장 1.", "1번 레코드는 원본 그대로 보존");

      assert.throws(
        () => recordReviewProposal(proposalsPath, { candidateId: id, modelProvider: "x", modelName: "y", promptVersion: "z" }),
        /proposedSentences 또는 error/,
        "제안 내용도 오류도 없으면 거부됨"
      );

      const errorProposal = recordReviewProposal(proposalsPath, {
        candidateId: "other-candidate",
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-5",
        promptVersion: "review-prompt-v1",
        error: "모델 응답 파싱 실패",
      });
      assert.strictEqual(errorProposal.error, "모델 응답 파싱 실패");
      assert.strictEqual(errorProposal.proposedSentences, null);

      const decision = recordReviewDecision(decisionsPath, {
        candidateId: id,
        proposalVersion: 2,
        decision: "approved",
        reviewer: "이준형",
        note: "재제출본 승인",
      });
      assert.strictEqual(decision.decision, "approved");

      assert.throws(
        () => recordReviewDecision(decisionsPath, { candidateId: id, decision: "maybe", reviewer: "x" }),
        /approved\/rejected\/keep_pending/,
        "잘못된 decision 값은 거부됨"
      );
      assert.throws(
        () => recordReviewDecision(decisionsPath, { candidateId: id, decision: "approved" }),
        /reviewer/,
        "reviewer 없이는 결정을 기록할 수 없음"
      );

      const decisions = readJsonLines(decisionsPath);
      assert.strictEqual(decisions.length, 1);
      ok("제안·결정 모두 append-only로 쌓이고, 모델 오류는 예외 없이 error 필드로 기록됨");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("13) applyReviewedStrategy — 승인 전 원본 불변, 승인 후에도 원본 문장 보존");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-review-apply-test-"));
    try {
      const proposalsPath = path.join(tempDir, "review-proposals.jsonl");
      const decisionsPath = path.join(tempDir, "review-decisions.jsonl");

      const approvedTarget = makeBriefing({ region: "경상북도 안동시", itemName: "사과" });
      const rejectedTarget = makeBriefing({ region: "충청북도 제천시", itemName: "인삼" });
      const pendingTarget = makeBriefing({ region: "경상남도 합천군", itemName: "딸기" });
      const notReviewedTarget = makeBriefing({
        region: "전라남도 보성군",
        itemName: "녹차",
        evidence: { ...makeBriefing().evidence, regionMatchVerified: true, collectionPartial: false },
      });

      const strategy = {
        schemaVersion: "1.0",
        templateVersion: "strategy-template-v0-example",
        generatedAt: "2026-08-11T00:00:00.000Z",
        briefings: [approvedTarget, rejectedTarget, pendingTarget, notReviewedTarget],
      };
      const strategyBefore = JSON.parse(JSON.stringify(strategy));

      const approvedId = candidateId(approvedTarget, strategy.templateVersion);
      const rejectedId = candidateId(rejectedTarget, strategy.templateVersion);
      const pendingId = candidateId(pendingTarget, strategy.templateVersion);

      recordReviewProposal(proposalsPath, {
        candidateId: approvedId,
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-5",
        promptVersion: "review-prompt-v1",
        proposedSentences: ["승인된 검토 문장."],
      });
      recordReviewDecision(decisionsPath, {
        candidateId: approvedId,
        proposalVersion: 1,
        decision: "approved",
        reviewer: "이준형",
      });

      recordReviewProposal(proposalsPath, {
        candidateId: rejectedId,
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-5",
        promptVersion: "review-prompt-v1",
        proposedSentences: ["반려된 검토 문장."],
      });
      recordReviewDecision(decisionsPath, {
        candidateId: rejectedId,
        proposalVersion: 1,
        decision: "rejected",
        reviewer: "이준형",
        note: "근거 부족",
      });

      recordReviewDecision(decisionsPath, {
        candidateId: pendingId,
        decision: "keep_pending",
        reviewer: "이준형",
      });

      const proposals = readJsonLines(proposalsPath);
      const decisions = readJsonLines(decisionsPath);
      const result = applyReviewedStrategy(strategy, proposals, decisions);

      assert.deepStrictEqual(strategy, strategyBefore, "applyReviewedStrategy는 입력 strategy 객체를 절대 변형하지 않음");

      const approvedResult = result.briefings.find((b) => b.region === "경상북도 안동시");
      assert.strictEqual(approvedResult.review.status, "approved");
      assert.deepStrictEqual(approvedResult.sentences, ["승인된 검토 문장."]);
      assert.deepStrictEqual(approvedResult.originalSentences, ["원본 문장 1."], "승인돼도 원본 문장은 별도 필드로 항상 보존됨");
      assert.strictEqual(approvedResult.review.reviewer, "이준형");
      assert.strictEqual(approvedResult.review.modelProvider, "Anthropic");

      const rejectedResult = result.briefings.find((b) => b.region === "충청북도 제천시");
      assert.strictEqual(rejectedResult.review.status, "rejected");
      assert.deepStrictEqual(rejectedResult.sentences, ["원본 문장 1."], "반려되면 원본 문장이 그대로 유지됨");
      assert.strictEqual(rejectedResult.originalSentences, undefined, "반려는 sentences를 바꾸지 않으므로 originalSentences도 없음");

      const pendingResult = result.briefings.find((b) => b.region === "경상남도 합천군");
      assert.strictEqual(pendingResult.review.status, "keep_pending");
      assert.deepStrictEqual(pendingResult.sentences, ["원본 문장 1."]);

      const notReviewedResult = result.briefings.find((b) => b.region === "전라남도 보성군");
      assert.strictEqual(notReviewedResult.review.status, "not_applicable", "애초에 검토 대상이 아니었던 행");
      assert.strictEqual(notReviewedResult.review.candidateId, null);

      ok("승인된 것만 문장이 교체되고 원본은 항상 별도 필드로 보존됨, 반려·보류·비대상은 원본 그대로 유지됨");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("13-1) applyReviewedStrategy — 승인됐지만 참조 제안이 없거나 오류면 원본을 지킴");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-review-apply-error-test-"));
    try {
      const proposalsPath = path.join(tempDir, "review-proposals.jsonl");
      const decisionsPath = path.join(tempDir, "review-decisions.jsonl");
      const target = makeBriefing({ region: "경상북도 안동시", itemName: "사과" });
      const strategy = {
        templateVersion: "strategy-template-v0-example",
        generatedAt: "2026-08-11T00:00:00.000Z",
        briefings: [target],
      };
      const id = candidateId(target, strategy.templateVersion);

      recordReviewProposal(proposalsPath, {
        candidateId: id,
        modelProvider: "Anthropic",
        modelName: "claude-sonnet-5",
        promptVersion: "review-prompt-v1",
        error: "모델 응답 파싱 실패",
      });
      recordReviewDecision(decisionsPath, {
        candidateId: id,
        proposalVersion: 1,
        decision: "approved",
        reviewer: "이준형",
      });

      const result = applyReviewedStrategy(strategy, readJsonLines(proposalsPath), readJsonLines(decisionsPath));
      const applied = result.briefings[0];
      assert.strictEqual(applied.review.status, "approved_but_missing_proposal");
      assert.deepStrictEqual(applied.sentences, ["원본 문장 1."], "오류였던 제안은 승인돼도 원본을 훼손하지 않음");
      ok("승인이 참조한 제안이 오류였다면 원본 문장을 그대로 지킴(모델 오류가 ⑥-1 결과를 망가뜨리지 않음)");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("\n⑥-2 검토 자체 테스트 통과");
}

module.exports = { runReviewTests };

if (require.main === module) {
  runReviewTests().catch((err) => {
    console.error(`자체 테스트 실패: ${err.message}`);
    process.exit(1);
  });
}
