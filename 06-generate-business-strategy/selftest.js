#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  buildBriefing,
  gapSentence,
  outsideShareSentence,
  unverifiedRegionNote,
  attachTopicMarker,
  GAP_ALERT_THRESHOLD,
  TEMPLATE_VERSION,
} = require("./lib/templates");
const { generateStrategies } = require("./generateStrategy");
const { runReviewTests } = require("./reviewSelftest");

function ok(label) {
  console.log(`  ok - ${label}`);
}

console.log("0) attachTopicMarker — 받침 유무로 은/는 선택 (실측: '안성시은(는)' 오타 회귀)");
{
  assert.strictEqual(attachTopicMarker("경기도 안성시"), "경기도 안성시는", "받침 없는 '시'는 '는'");
  assert.strictEqual(attachTopicMarker("전라남도 보성군"), "전라남도 보성군은", "받침 있는 '군'은 '은'");
  assert.strictEqual(attachTopicMarker("서울특별시 강남구"), "서울특별시 강남구는", "받침 없는 '구'는 '는'");
  assert.strictEqual(attachTopicMarker(""), "는", "빈 문자열도 죽지 않고 무난한 '는'으로 대체");
  ok("실제 GI E2E(안성시)에서 발견된 '은(는)' 노출 오류를 받침 판정으로 수정함");
}

console.log("1) gapSentence — 공백/양호 분기 (project-plan.md 예시 문장 형태)");
{
  const gapRow = { region: "경기도 안성시", itemName: "배", noticeName: "신선한 배", gapScore: 1, uniqueTrademarkCount: 0, registrationRate: null };
  const healthyRow = { region: "전라남도 보성군", itemName: "녹차", noticeName: "녹차", gapScore: 0, uniqueTrademarkCount: 8, registrationRate: 0.8 };
  assert.match(gapSentence(gapRow), /공동브랜드 육성이 필요한 지역/);
  assert.match(gapSentence(gapRow), /고유 상표 0건/);
  assert.match(gapSentence(healthyRow), /비교적 양호함/);
  assert.match(gapSentence(healthyRow), /등록률 80%/);
  ok("gapScore 임계값에 따라 project-plan.md의 예시 문장 형태로 분기됨");
}

console.log("2) outsideShareSentence — 지역매칭 검증 여부에 따라 문장 생성/보류");
{
  const verifiedHighOutside = { region: "△△시", regionMatchVerified: true, localApplicantShare: 0.2 };
  const verifiedLowOutside = { region: "○○군", regionMatchVerified: true, localApplicantShare: 0.9 };
  const unverified = { region: "□□구", regionMatchVerified: false, localApplicantShare: null };
  // 이슈 #136 코멘트(2026-09-03) 06번: 같은 카드의 "지역 출원인 비중" 통계와 문장이
  // 서로 다른 지표(1-x)를 말하는 것처럼 보이던 문제 — 문장도 localApplicantShare를
  // 그대로 인용한다(20%, 80%가 아님).
  assert.match(outsideShareSentence(verifiedHighOutside), /지역 출원인 비중이 낮아/);
  assert.match(outsideShareSentence(verifiedHighOutside), /20%/, "문장은 localApplicantShare를 그대로 인용(통계 카드와 같은 값)");
  assert.doesNotMatch(outsideShareSentence(verifiedHighOutside), /80%/, "역수(1-x)를 별도로 계산해 보여주지 않음");
  assert.strictEqual(outsideShareSentence(verifiedLowOutside), null, "지역 외 비중이 낮으면 문장을 만들지 않음");
  assert.strictEqual(outsideShareSentence(unverified), null, "미검증이면 절대 문장을 만들지 않음");
  assert.match(unverifiedRegionNote(unverified), /검증되지 않아/);
  assert.strictEqual(unverifiedRegionNote(verifiedHighOutside), null);
  ok("검증된 지역 내·외 비중이 있을 때만 project-plan.md의 두 번째 예시 문장을 만들고, 미검증이면 대신 보류 문구를 남김");
}

console.log("3) buildBriefing — 문장·근거를 함께 담고 환각 없이 evidence 수치만 사용");
{
  const row = {
    region: "경기도 안성시", itemName: "배", noticeName: "신선한 배", niceClass: "31",
    gapScore: 0.8, uniqueTrademarkCount: 1, registrationRate: 0,
    regionMatchVerified: true, localApplicantShare: 0.1, partialQueryCount: 2,
    scoreInputs: { uniqueTrademarkCount: 1, registrationRate: 0, activityScore: 0.2, registrationScore: 0 },
  };
  const briefing = buildBriefing(row);
  assert.strictEqual(briefing.isGapAlert, row.gapScore >= GAP_ALERT_THRESHOLD);
  assert.strictEqual(briefing.sentences.length, 2, "공백 문장 + 지역외비중 문장");
  assert.strictEqual(briefing.evidence.uniqueTrademarkCount, 1);
  assert.strictEqual(briefing.evidence.collectionPartial, true, "⑤의 partialQueryCount>0이 evidence.collectionPartial로 전파됨(#16 선정 조건)");
  assert.deepStrictEqual(briefing.evidence.scoreInputs, row.scoreInputs, "⑤의 점수 근거를 그대로 보존");
  ok("문장은 evidence의 수치에서만 생성되고, 근거 필드가 함께 남음");
}

console.log("4) generateStrategies — ⑤ ranking -> briefings, 결정론성");
{
  const gap = {
    scoreVersion: "gap-score-v0-example",
    generatedAt: "2026-08-10T00:00:00.000Z",
    ranking: [
      { region: "경기도 안성시", itemName: "배", noticeName: "신선한 배", niceClass: "31", gapScore: 1, uniqueTrademarkCount: 0, registrationRate: null, regionMatchVerified: false, localApplicantShare: null },
      { region: "전라남도 보성군", itemName: "녹차", noticeName: "녹차", niceClass: "30", gapScore: 0.3, uniqueTrademarkCount: 6, registrationRate: 0.6, regionMatchVerified: true, localApplicantShare: 0.9 },
    ],
  };
  const resultA = generateStrategies(gap);
  const resultB = generateStrategies(gap);
  assert.strictEqual(resultA.templateVersion, TEMPLATE_VERSION);
  assert.strictEqual(resultA.summary.briefingCount, 2);
  assert.strictEqual(resultA.summary.alertCount, 1, "gapScore>=임계값인 안성 배만 경고");
  const { generatedAt: gA, ...restA } = resultA;
  const { generatedAt: gB, ...restB } = resultB;
  assert.deepStrictEqual(restA, restB, "동일 입력은 항상 동일 문장이어야 함(결정론성, AI 미사용)");
  ok("⑤ 랭킹을 그대로 브리핑으로 바꾸고, 동일 입력은 항상 동일 산출물을 냄");
}

console.log("5) generateStrategies — 입력 계약 위반 시 명확한 오류");
{
  assert.throws(() => generateStrategies({}), /ranking/);
  assert.throws(() => generateStrategies(null), /ranking/);
  ok("⑤ 출력 형태가 아니면 즉시 실패");
}

runReviewTests()
  .then(() => console.log("\n모든 자체 테스트 통과"))
  .catch((err) => {
    console.error(`자체 테스트 실패: ${err.message}`);
    process.exit(1);
  });
