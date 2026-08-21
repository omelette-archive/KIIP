#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { auditSnapshot, isConfirmedSpecialty } = require("./auditDashboardSnapshot");

function metric(availability, value) {
  return { availability, value };
}

function snapshotFixture() {
  return {
    schemaVersion: "dashboard-snapshot-v1",
    snapshotId: "audit-selftest",
    generatedAt: "2026-08-19T00:00:00.000Z",
    coverage: { regionItemCount: 2 },
    pipelineStatus: { regionalMetricGate: { availableRegionItemCount: 2 } },
    regions: [
      {
        regionCode: "5182000000",
        regionCodeStatus: "resolved",
        region: "강원특별자치도 고성군",
        items: [
          {
            specialtyId: "confirmed-honey",
            itemName: "벌꿀",
            noticeName: "벌꿀",
            niceClass: "30",
            matchingBasis: "notice_name_and_nice_class",
            trademarkExamples: [],
            metrics: { uniqueTrademarkCount: metric("available", 3) },
          },
          {
            specialtyId: "review-brand",
            itemName: "검토대기 브랜드",
            noticeName: "검토대기 브랜드",
            niceClass: null,
            matchingBasis: "raw_item_name_unclassified",
            trademarkExamples: [{ title: "검토대기 브랜드" }],
            metrics: { uniqueTrademarkCount: metric("available", 7) },
          },
        ],
      },
    ],
  };
}

const fixture = snapshotFixture();
const report = auditSnapshot(fixture);
assert.strictEqual(report.ok, true);
assert.strictEqual(report.summary.confirmedSpecialtyRows, 1);
assert.strictEqual(report.summary.reviewPendingRows, 1);
assert.strictEqual(report.summary.confirmedRegionalMetricAvailableRows, 1);
assert.strictEqual(report.summary.reviewRowsWithAvailableRegionalMetrics, 1);
assert.ok(report.warnings.some((warning) => warning.code === "review_rows_have_regional_metrics"));
assert.ok(report.warnings.some((warning) => warning.code === "review_rows_have_trademark_examples"));
assert.strictEqual(isConfirmedSpecialty(fixture.regions[0].items[0]), true);
assert.strictEqual(isConfirmedSpecialty(fixture.regions[0].items[1]), false);

const invalid = snapshotFixture();
invalid.regions[0].items[0].niceClass = null;
const invalidReport = auditSnapshot(invalid);
assert.strictEqual(invalidReport.ok, false);
assert.ok(invalidReport.errors.some((error) => error.code === "incomplete_confirmed_specialty"));

// 2026-08-20 AI 검토(커밋 119a1a2)로 확정된 raw_item_goods_matched 항목은 고시명칭
// 사전 매칭이 아니라 등록원부 지정상품 대조로 확정된 것이라 niceClass가 없어도
// 확인된 특산품(review가 아님)으로 인식해야 한다.
const goodsMatchedFixture = snapshotFixture();
goodsMatchedFixture.regions[0].items.push({
  specialtyId: "goods-matched-chikso",
  itemName: "칡소",
  noticeName: "칡소",
  niceClass: null,
  matchingBasis: "raw_item_goods_matched",
  trademarkExamples: [{ title: "강원 고성칡소", goodsEvidence: [{ designatedProductName: "소고기(칡소에한함)", classCode: "29" }] }],
  metrics: { uniqueTrademarkCount: metric("available", 1) },
});
const goodsMatchedReport = auditSnapshot(goodsMatchedFixture);
assert.strictEqual(goodsMatchedReport.summary.confirmedSpecialtyRows, 2, "raw_item_goods_matched는 확인된 특산품으로 집계돼야 함");
assert.strictEqual(goodsMatchedReport.summary.reviewPendingRows, 1, "raw_item_goods_matched는 review-pending에 남으면 안 됨");
assert.strictEqual(isConfirmedSpecialty(goodsMatchedFixture.regions[0].items[2]), true);

const incompleteGoodsMatched = snapshotFixture();
incompleteGoodsMatched.regions[0].items.push({
  specialtyId: "goods-matched-incomplete",
  itemName: "표고버섯",
  noticeName: null,
  niceClass: null,
  matchingBasis: "raw_item_goods_matched",
  trademarkExamples: [],
  metrics: { uniqueTrademarkCount: metric("available", 1) },
});
const incompleteGoodsMatchedReport = auditSnapshot(incompleteGoodsMatched);
assert.strictEqual(incompleteGoodsMatchedReport.ok, false);
assert.ok(incompleteGoodsMatchedReport.errors.some((error) => error.code === "incomplete_confirmed_specialty"));

console.log("[auditDashboardSnapshot.selftest] OK");
