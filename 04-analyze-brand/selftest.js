#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  analyzeEntries,
  applicationYear,
  regionCategory,
  statusCategory,
  trademarkKey,
} = require("./lib/analyzer");

function hit(number, title, date, status, regionMatch) {
  return {
    title,
    applicant: `${title} 영농조합`,
    applicationNumber: number,
    applicationDate: date,
    applicationStatus: status,
    classificationCode: "31",
    regionMatch,
  };
}

function ok(label) {
  console.log(`  ok - ${label}`);
}

const input = [
  {
    sido: "경상북도",
    sigungu: "안동시",
    itemName: "사과",
    noticeName: "신선한 사과",
    niceClass: "31",
    query: { region: "경상북도 안동시", searchString: "신선한 사과", regionMatch: "unverified" },
    totalCount: 20,
    returnedCount: 5,
    hits: [
      hit("40-2025-1", "안동햇사과", "20250102", "등록", "inside"),
      hit("40-2024-2", "아침사과", "2024-03-04", "출원중", "outside"),
      hit("40-2023-3", "푸른사과", "20230102", "거절", "unverified"),
      hit("40-2025-1", "안동햇사과", "20250102", "등록", "inside"),
      hit("40-X", "날짜미상", "", "", "unverified"),
    ],
  },
  {
    sido: "경상북도",
    sigungu: "안동시",
    itemName: "사과",
    niceClass: "31",
    query: { region: "경상북도 안동시", searchString: "사과" },
    error: "테스트 오류",
  },
  {
    sido: "경상북도",
    sigungu: "안동시",
    itemName: "탈",
    niceClass: "28",
    query: { region: "경상북도 안동시", searchString: "탈" },
    totalCount: 0,
    returnedCount: 0,
    hits: [],
  },
  {
    sido: "경기도",
    sigungu: "포천시",
    itemName: "사과",
    niceClass: "31",
    query: { region: "경기도 포천시", searchString: "사과" },
    totalCount: 1,
    returnedCount: 1,
    hits: [hit("40-2025-1", "안동햇사과", "20250102", "등록", false)],
  },
];

console.log("1) 필드 정규화");
assert.strictEqual(applicationYear("2024-01-02"), 2024);
assert.strictEqual(applicationYear("날짜없음"), null);
assert.strictEqual(statusCategory("등록결정"), "registered");
assert.strictEqual(statusCategory("출원공고"), "pending");
assert.strictEqual(statusCategory("거절"), "inactive");
assert.strictEqual(statusCategory("등록취소"), "inactive");
assert.strictEqual(regionCategory({ applicantRegionMatch: true }), "inside");
assert.strictEqual(regionCategory({ regionMatch: "out-of-region" }), "outside");
assert.strictEqual(trademarkKey({ applicationNumber: "40-1" }), "app:40-1");
ok("날짜·상태·지역·중복 키 정규화");

console.log("2) 전체/지역×품목 집계");
const result = analyzeEntries(input, { asOfYear: 2026, recentYears: 2, maxRecentBrands: 2 });
assert.strictEqual(result.summary.queryCount, 4);
assert.strictEqual(result.summary.erroredQueryCount, 1);
assert.strictEqual(result.summary.returnedHitCount, 6);
assert.strictEqual(result.summary.uniqueTrademarkCount, 4, "지역 간 동일 출원번호도 전체에서는 한 번만 집계");
assert.strictEqual(result.regionItems.length, 3, "결과 0건인 지역×품목도 유지");
const andongApple = result.regionItems.find(
  (row) => row.region === "경상북도 안동시" && row.itemName === "사과"
);
assert.ok(andongApple);
assert.strictEqual(andongApple.queryCount, 2);
assert.strictEqual(andongApple.uniqueTrademarkCount, 4);
assert.strictEqual(andongApple.duplicateHitCount, 1);
assert.strictEqual(andongApple.statusCounts.registered, 1);
assert.strictEqual(andongApple.statusCounts.pending, 1);
assert.strictEqual(andongApple.statusCounts.inactive, 1);
assert.strictEqual(andongApple.invalidApplicationDateCount, 1);
ok("오류·0건 포함, 출원번호 중복 제거, 상태별 집계");

console.log("3) 시계열과 지역 검증 지표");
assert.deepStrictEqual(andongApple.recentPeriod, { startYear: 2024, endYear: 2025, count: 2 });
assert.deepStrictEqual(andongApple.previousPeriod, { startYear: 2022, endYear: 2023, count: 1 });
assert.strictEqual(andongApple.recentTrend, "increase");
assert.strictEqual(andongApple.recentChangeRate, 1);
assert.strictEqual(andongApple.regionVerifiedHitCount, 2);
assert.strictEqual(andongApple.regionVerificationRate, 0.5);
assert.strictEqual(andongApple.localApplicantShare, 0.5);
assert.strictEqual(andongApple.recentBrands.length, 2);
ok("현재 연도 제외 최근/직전 기간 비교와 검증된 지역 비중");

console.log("\n모든 자체 테스트 통과");
