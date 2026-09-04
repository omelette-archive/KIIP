"use strict";

const assert = require("node:assert");
const { reconcilePublicSnapshot, regionItemKey, unionYearCounts } = require("./snapshotReconcile");

function ok(message) {
  console.log(`  ok - ${message}`);
}

function metric(value, availability = "available", extra = {}) {
  return { value, availability, ...extra };
}

function item(name, { niceClass = null, unique = 0, registered = 0, appYears = null, matchingBasis = "notice_name_and_nice_class" } = {}) {
  return {
    itemName: name,
    noticeName: name,
    niceClass,
    matchingBasis,
    metrics: {
      uniqueTrademarkCount: metric(unique, unique > 0 ? "available" : "blocked"),
      registeredTrademarkCount: metric(registered),
    },
    applicationYearCounts: appYears,
  };
}

function snapshot(id, regions) {
  return { schemaVersion: "dashboard-snapshot-v1", snapshotId: id, mode: "full", regions };
}

console.log("snapshotReconcile 자체 테스트");

// 1) 기존 100 + 재수집 80(중복) + 신규 20, 과거 일부 미응답 → canonical 120 유지
{
  const previous = snapshot("prev", [
    { region: "경기도 가평군", sido: "경기도", sigungu: "가평군", items: [
      item("잣", { niceClass: "31", unique: 100, registered: 40, appYears: { "2020": 30, "2021": 70 } }),
      item("사과", { niceClass: "31", unique: 12, registered: 5 }),
    ] },
    { region: "강원특별자치도 홍천군", sido: "강원특별자치도", sigungu: "홍천군", items: [
      item("포도", { niceClass: "31", unique: 8, registered: 3 }),
    ] },
  ]);
  // 이번 재수집: 잣은 80만 잡힘(경계 재랭킹으로 20 빠짐), 사과는 15로 늘고, 포도는 아예 응답 없음, 신규 배 20.
  const next = snapshot("next", [
    { region: "경기도 가평군", sido: "경기도", sigungu: "가평군", items: [
      item("잣", { niceClass: "31", unique: 80, registered: 40, appYears: { "2021": 65, "2022": 15 } }),
      item("사과", { niceClass: "31", unique: 15, registered: 6 }),
      item("배", { niceClass: "31", unique: 20, registered: 9 }),
    ] },
  ]);

  const { report, blocked } = reconcilePublicSnapshot(next, previous, [], { massRevivalLimit: 50 });
  assert.strictEqual(blocked, false);

  const gapyeong = next.regions.find((r) => r.region === "경기도 가평군");
  const jat = gapyeong.items.find((i) => i.itemName === "잣");
  assert.strictEqual(jat.metrics.uniqueTrademarkCount.value, 100, "재수집이 낮으면 이전 last-known-good 유지");
  assert.ok(jat.metrics.uniqueTrademarkCount.retainedFromPrevious, "floor 유지 근거 기록");
  assert.deepStrictEqual(jat.applicationYearCounts, { "2020": 30, "2021": 70, "2022": 15 }, "연도별 집계는 연도별 max union");

  const apple = gapyeong.items.find((i) => i.itemName === "사과");
  assert.strictEqual(apple.metrics.uniqueTrademarkCount.value, 15, "재수집이 더 크면 새 값 사용");
  assert.ok(next.regions.some((r) => r.items.some((i) => i.itemName === "배")), "신규 항목은 그대로 추가");

  const hongcheon = next.regions.find((r) => r.region === "강원특별자치도 홍천군");
  assert.ok(hongcheon, "응답 없던 지역을 되살림");
  const grape = hongcheon.items.find((i) => i.itemName === "포도");
  assert.strictEqual(grape.metrics.uniqueTrademarkCount.value, 8, "응답 없던 항목은 이전 값 그대로");
  assert.strictEqual(grape.presence.state, "retained_last_known_good");
  assert.strictEqual(report.counts.revivedLastKnownGood, 1);
  assert.strictEqual(report.counts.added, 1);
  ok("기존∪재수집∪신규 — 감소 없음, 미응답은 last-known-good 복원");
}

// 2) failed/partial 상태여도 이전 값 유지
{
  const previous = snapshot("prev", [
    { region: "경상북도 안동시", sido: "경상북도", sigungu: "안동시", items: [
      item("사과", { niceClass: "31", unique: 30, registered: 12 }),
    ] },
  ]);
  const next = snapshot("next", [
    { region: "경상북도 안동시", sido: "경상북도", sigungu: "안동시", items: [
      { ...item("사과", { niceClass: "31" }), metrics: {
        uniqueTrademarkCount: { value: null, availability: "blocked", status: "error" },
        registeredTrademarkCount: { value: null, availability: "blocked" },
      } },
    ] },
  ]);
  reconcilePublicSnapshot(next, previous, [], { massRevivalLimit: 50 });
  const apple = next.regions[0].items[0];
  assert.strictEqual(apple.metrics.uniqueTrademarkCount.value, 30, "이번에 error여도 이전 값 유지");
  ok("failed/partial이면 이전 last-known-good 유지");
}

// 3) tombstone이 있는 키만 제거 허용
{
  const previous = snapshot("prev", [
    { region: "전라남도 보성군", sido: "전라남도", sigungu: "보성군", items: [
      item("녹차", { niceClass: "30", unique: 20 }),
      item("폐지품목", { niceClass: "31", unique: 5 }),
    ] },
  ]);
  const next = snapshot("next", [
    { region: "전라남도 보성군", sido: "전라남도", sigungu: "보성군", items: [
      item("녹차", { niceClass: "30", unique: 22 }),
    ] },
  ]);
  const tombstones = [{ key: "전라남도 / 보성군 / 폐지품목", reason: "공식 특산품 목록에서 삭제(2026-09)", runId: "20260904-integ" }];
  const { report } = reconcilePublicSnapshot(next, previous, tombstones, { massRevivalLimit: 50 });
  assert.strictEqual(report.counts.removedWithTombstone, 1);
  assert.strictEqual(report.counts.revivedLastKnownGood, 0, "tombstone 있으면 되살리지 않음");
  assert.ok(!next.regions.some((r) => r.items.some((i) => i.itemName === "폐지품목")));
  ok("tombstone이 있는 키만 제거 허용(사유·runId 기록)");
}

// 4) 대량 unexplained removal → 배포 차단
{
  const prevItems = Array.from({ length: 80 }, (_, i) => item(`품목${i}`, { niceClass: "31", unique: 3 }));
  const previous = snapshot("prev", [{ region: "충청북도 청주시", sido: "충청북도", sigungu: "청주시", items: prevItems }]);
  const next = snapshot("next", [{ region: "충청북도 청주시", sido: "충청북도", sigungu: "청주시", items: [item("품목0", { niceClass: "31", unique: 3 })] }]);
  const { report, blocked } = reconcilePublicSnapshot(next, previous, [], { massRevivalLimit: 50 });
  assert.strictEqual(blocked, true, "설명 없는 대량 실종은 배포 차단");
  assert.ok(report.blockReason.includes("한계"));
  ok("설명 없는 대량 실종(>한계)이면 배포 차단");
}

// 5) niceClass 승격(null -> 31)은 삭제가 아님
{
  const previous = snapshot("prev", [
    { region: "경기도 남양주시", sido: "경기도", sigungu: "남양주시", items: [item("깻잎", { niceClass: null, unique: 7, matchingBasis: "raw_item_name_unclassified" })] },
  ]);
  const next = snapshot("next", [
    { region: "경기도 남양주시", sido: "경기도", sigungu: "남양주시", items: [item("깻잎", { niceClass: "31", unique: 9 })] },
  ]);
  const { report } = reconcilePublicSnapshot(next, previous, [], { massRevivalLimit: 50 });
  assert.strictEqual(report.counts.revivedLastKnownGood, 0, "niceClass만 붙은 건 같은 항목");
  assert.strictEqual(next.regions[0].items.length, 1);
  ok("미분류 -> 고시명칭 매칭 승격은 삭제로 보지 않음");
}

// 6) 전국 카탈로그가 지역 행으로 이동하면 되살리지 않음(중복 방지)
{
  const previous = snapshot("prev", [
    { region: "전국 지역 검토대기", sido: "전국", sigungu: "지역 검토대기", items: [item("밤", { niceClass: null, unique: 40 })] },
  ]);
  const next = snapshot("next", [
    { region: "충청남도 부여군", sido: "충청남도", sigungu: "부여군", items: [item("밤", { niceClass: "31", unique: 12 })] },
  ]);
  const { report } = reconcilePublicSnapshot(next, previous, [], { massRevivalLimit: 50 });
  assert.strictEqual(report.counts.revivedLastKnownGood, 0);
  assert.strictEqual(report.counts.relocatedNationwideToRegional, 1);
  ok("전국 카탈로그 -> 특정 지역 이동은 실종이 아님");
}

// unionYearCounts 단위
assert.deepStrictEqual(unionYearCounts({ "2020": 5, "2021": 3 }, { "2021": 7, "2022": 1 }), { "2020": 5, "2021": 7, "2022": 1 });
assert.strictEqual(regionItemKey({ sido: "경기도", sigungu: "가평군" }, { itemName: "잣(청정)" }), regionItemKey({ sido: "경기도", sigungu: "가평군" }, { itemName: "잣" }));

console.log("\n모든 자체 테스트 통과");
