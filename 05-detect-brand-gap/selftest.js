#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  scoreBucket,
  isRepresentative,
  activityScore,
  registrationScore,
  ACTIVITY_SATURATION_COUNT,
  REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD,
  GAP_SCORE_VERSION,
} = require("./lib/scorer");
const { detectGaps } = require("./detectBrandGap");

function ok(label) {
  console.log(`  ok - ${label}`);
}

console.log("1) isRepresentative — GI 출처 또는 상표 3건 이상(OR, #29 확정 기준)");
{
  assert.strictEqual(isRepresentative({ sources: ["지리적표시"] }), true, "GI 출처만으로도 대표");
  assert.strictEqual(isRepresentative({ sources: ["농사로"] }), false, "GI도 없고 상표도 없으면 비대표");
  assert.strictEqual(isRepresentative({ sources: ["농사로", "지리적표시"] }), true);
  assert.strictEqual(isRepresentative({ sources: [] }), false);
  assert.strictEqual(isRepresentative({}), false, "sources 필드가 없어도 죽지 않아야 함");

  assert.strictEqual(
    isRepresentative({ sources: ["농사로"], uniqueTrademarkCount: REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD }),
    true,
    "GI가 없어도 상표 출원이 임계값 이상이면 대표(OR 조건)"
  );
  assert.strictEqual(
    isRepresentative({ sources: ["농사로"], uniqueTrademarkCount: REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD - 1 }),
    false,
    "임계값 미만이고 GI도 없으면 비대표"
  );
  assert.strictEqual(
    isRepresentative({ sources: [], uniqueTrademarkCount: 100 }),
    true,
    "GI 출처가 아예 없어도 상표 건수만으로 대표 판정 가능"
  );
  ok("GI 출처가 있거나(OR) 고유 상표 출원이 3건 이상이면 대표 특산품으로 판정됨(#29 확정)");
}

console.log("2) activityScore/registrationScore — 0~1 정규화");
{
  assert.strictEqual(activityScore({ uniqueTrademarkCount: 0 }), 0);
  assert.strictEqual(activityScore({ uniqueTrademarkCount: ACTIVITY_SATURATION_COUNT }), 1);
  assert.strictEqual(activityScore({ uniqueTrademarkCount: ACTIVITY_SATURATION_COUNT * 10 }), 1, "상한을 넘어도 1로 클램프");
  assert.strictEqual(registrationScore({ registrationRate: 0.5 }), 0.5);
  assert.strictEqual(registrationScore({ registrationRate: null }), 0, "등록률 null은 0으로 간주(공백 방향)");
  ok("활용도·등록률 모두 0~1로 정규화되고 결측은 공백 방향(0)으로 채워짐");
}

console.log("3) scoreBucket — 비대표 품목은 점수 없이 사유만");
{
  const result = scoreBucket({ sources: ["농사로"], uniqueTrademarkCount: 0, registrationRate: null });
  assert.strictEqual(result.representative, false);
  assert.strictEqual(result.gapScore, null);
  assert.match(result.gapReason, /대표 특산품/);
  ok("대표성 기준 미충족이면 gapScore=null, gapReason만 남김");
}

console.log("4) scoreBucket — 활용 전무 vs 포화 상태의 점수 대비");
{
  const emptyMarket = scoreBucket({ sources: ["지리적표시"], uniqueTrademarkCount: 0, registrationRate: null });
  const saturatedMarket = scoreBucket({
    sources: ["지리적표시"],
    uniqueTrademarkCount: ACTIVITY_SATURATION_COUNT,
    registrationRate: 1,
  });
  assert.strictEqual(emptyMarket.gapScore, 1, "상표가 전혀 없으면 공백 점수가 최대(1)여야 함");
  assert.strictEqual(saturatedMarket.gapScore, 0, "활용도·등록률이 모두 포화면 공백 점수가 최소(0)여야 함");
  assert.ok(emptyMarket.gapScore > saturatedMarket.gapScore);
  ok("상표 활용이 적을수록 공백 점수가 높게 나옴(방향성 검증)");
}

console.log("5) detectGaps — ④ 출력 -> 랭킹, 비대표 제외, 결정론성");
{
  const analysis = {
    generatedAt: "2026-08-10T00:00:00.000Z",
    regionItems: [
      { region: "경기도 안성시", sido: "경기도", sigungu: "안성시", itemName: "배", noticeName: "신선한 배", niceClass: "31",
        sources: ["지리적표시"], uniqueTrademarkCount: 0, registrationRate: null, regionVerificationRate: 0 },
      { region: "전라남도 보성군", sido: "전라남도", sigungu: "보성군", itemName: "녹차", noticeName: "녹차", niceClass: "30",
        sources: ["지리적표시"], uniqueTrademarkCount: 3, registrationRate: 0.5, regionVerificationRate: 1 },
      { region: "경상남도 합천군", sido: "경상남도", sigungu: "합천군", itemName: "딸기", noticeName: "신선한 딸기", niceClass: "31",
        sources: ["샘플"], uniqueTrademarkCount: 1, registrationRate: 0, regionVerificationRate: 0 },
    ],
  };
  const resultA = detectGaps(analysis);
  const resultB = detectGaps(analysis);

  assert.strictEqual(resultA.scoreVersion, GAP_SCORE_VERSION);
  assert.strictEqual(resultA.rows.length, 3, "대표성과 무관하게 모든 지역×품목 행은 보존");
  assert.strictEqual(resultA.ranking.length, 2, "샘플 출처(비대표)는 랭킹에서 제외됨");
  assert.strictEqual(resultA.ranking[0].region, "경기도 안성시", "상표가 전혀 없는 안성배가 가장 공백이 커야 함");
  assert.strictEqual(resultA.ranking[1].region, "전라남도 보성군");
  assert.ok(resultA.ranking[0].gapScore > resultA.ranking[1].gapScore);

  const strawberry = resultA.rows.find((row) => row.itemName === "딸기");
  assert.strictEqual(strawberry.representative, false);
  assert.strictEqual(strawberry.gapScore, null);
  assert.strictEqual(strawberry.regionMatchVerified, false, "지역매칭 검증여부는 참고용으로만 보존");

  const { generatedAt: gA, ...restA } = resultA;
  const { generatedAt: gB, ...restB } = resultB;
  assert.deepStrictEqual(restA, restB, "generatedAt을 빼면 동일 입력은 항상 동일 결과여야 함(결정론성)");

  assert.ok(resultA.warnings.some((w) => w.includes("예시값")));
  assert.ok(resultA.warnings.some((w) => w.includes("localApplicantShare")));
  ok("랭킹은 대표 품목만 공백 점수 내림차순, 비대표는 사유와 함께 보존, 동일 입력은 동일 출력");
}

console.log("5-1) detectGaps — GI 미등록이어도 상표 3건 이상이면 랭킹에 포함(#29 확정 OR 조건)");
{
  const analysis = {
    generatedAt: "2026-08-11T00:00:00.000Z",
    regionItems: [
      { region: "경상남도 합천군", sido: "경상남도", sigungu: "합천군", itemName: "딸기", noticeName: "신선한 딸기", niceClass: "31",
        sources: ["농사로"], uniqueTrademarkCount: 3, registrationRate: 0.2, regionVerificationRate: 0 },
      { region: "충청북도 제천시", sido: "충청북도", sigungu: "제천시", itemName: "인삼", noticeName: "인삼", niceClass: "5",
        sources: ["농사로"], uniqueTrademarkCount: 2, registrationRate: 0, regionVerificationRate: 0 },
    ],
  };
  const result = detectGaps(analysis);
  const strawberry = result.rows.find((row) => row.itemName === "딸기");
  const ginseng = result.rows.find((row) => row.itemName === "인삼");
  assert.strictEqual(strawberry.representative, true, "GI가 없어도 상표 3건이면 대표로 랭킹에 포함");
  assert.strictEqual(typeof strawberry.gapScore, "number");
  assert.strictEqual(ginseng.representative, false, "상표 2건은 임계값(3건) 미만이라 여전히 비대표");
  assert.ok(result.methodology.representativeBasis.includes("3건"));
  assert.strictEqual(result.methodology.weightsConfirmed, false, "가중치는 아직 미확정임을 산출물에 명시");
  ok("대표 특산품 판정에서 GI 출처와 상표 3건 이상 OR 조건이 실제 랭킹까지 정확히 반영됨");
}

console.log("6) detectGaps — 입력 계약 위반 시 명확한 오류");
{
  assert.throws(() => detectGaps({}), /regionItems/);
  assert.throws(() => detectGaps(null), /regionItems/);
  ok("④ 출력 형태가 아니면 즉시 실패");
}

console.log("\n모든 자체 테스트 통과");
