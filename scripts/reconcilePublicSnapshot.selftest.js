"use strict";
/**
 * scripts/reconcilePublicSnapshot.js 자체 검증.
 *
 * 2026-09-18 발견: coverage.regionItemCount/catalogItemCount와 pipelineStatus.
 * regionalMetricGate.availableRegionItemCount는 07_snapshot(07-dashboard/lib/snapshot.js)이
 * ③입력 기준으로 한 번만 계산하는데, reconcile이 그 뒤 revived/relocated/
 * methodologyUpgraded로 행을 추가·재배치해도 이 카운트를 다시 안 써서 최종 스냅샷이
 * 자기모순에 빠졌다(scripts/auditDashboardSnapshot.js가 실제 행 수와 대조해 차단).
 */
const assert = require("assert");
const { recomputeRowDependentCoverage } = require("./reconcilePublicSnapshot");

function ok(label) {
  console.log(`  ok - ${label}`);
}

console.log("1) recomputeRowDependentCoverage — 지역/전국·availability 기준으로 카운트 재계산");
{
  const snapshot = {
    coverage: { regionItemCount: 10, catalogItemCount: 12, nationwideCatalogItemCount: 2 },
    pipelineStatus: { regionalMetricGate: { availableRegionItemCount: 5 } },
    regions: [
      {
        sido: "강원특별자치도",
        items: [
          { metrics: { uniqueTrademarkCount: { availability: "available" } } },
          { metrics: { uniqueTrademarkCount: { availability: "blocked" } } },
        ],
      },
      { sido: "전국", items: [{ metrics: { uniqueTrademarkCount: { availability: "available" } } }] },
    ],
  };
  recomputeRowDependentCoverage(snapshot);
  assert.strictEqual(snapshot.coverage.regionItemCount, 2, "전국 제외한 지역 행만 센다");
  assert.strictEqual(snapshot.coverage.catalogItemCount, 3, "전체 행(지역+전국) 카운트");
  assert.strictEqual(snapshot.coverage.nationwideCatalogItemCount, 1, "전국 행만 카운트");
  assert.strictEqual(
    snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount,
    1,
    "전국 제외 + availability=available만(blocked 제외) 카운트"
  );
  ok("region/전국 분리, availability=available만 집계");
}

console.log("2) recomputeRowDependentCoverage — reconcile로 행이 늘어도(예: revived) 최종 스냅샷과 일치");
{
  // 07d_reconcile 실행 후를 재현: 원래 coverage는 이전 값(더 적은 행 기준)이지만
  // regions[].items[]는 이미 revived/relocated로 늘어난 최종 상태.
  const snapshot = {
    coverage: { regionItemCount: 1, catalogItemCount: 1 },
    pipelineStatus: { regionalMetricGate: { availableRegionItemCount: 0 } },
    regions: [
      {
        sido: "전북특별자치도",
        items: [
          { metrics: { uniqueTrademarkCount: { availability: "available" } } },
          { metrics: { uniqueTrademarkCount: { availability: "available" } } },
          { metrics: { uniqueTrademarkCount: { availability: "blocked" } } },
        ],
      },
    ],
  };
  recomputeRowDependentCoverage(snapshot);
  assert.strictEqual(snapshot.coverage.regionItemCount, 3);
  assert.strictEqual(snapshot.coverage.catalogItemCount, 3);
  assert.strictEqual(snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount, 2);
  ok("reconcile이 추가한 행까지 반영해 실제 행 수와 다시 맞춰짐");
}

console.log("3) recomputeRowDependentCoverage — 필드가 원래 없으면(undefined) 새로 만들지 않음");
{
  const snapshot = { regions: [{ sido: "서울특별시", items: [{}] }] };
  recomputeRowDependentCoverage(snapshot);
  assert.strictEqual(snapshot.coverage, undefined, "coverage 객체 자체가 없으면 건드리지 않음");
  ok("coverage/pipelineStatus.regionalMetricGate가 없는 입력(예: 샘플 모드)은 그대로 둠");
}

console.log("\n모든 reconcilePublicSnapshot 자체 검증 통과.");
