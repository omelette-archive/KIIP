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

console.log("[auditDashboardSnapshot.selftest] OK");
