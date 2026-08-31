#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  parseYmd,
  classifyStalenessCacheEntry,
  buildStalenessManifest,
  diffRegistryRecords,
} = require("./lib/registryStaleness");
const { sanitizeRegistryRecordForCache } = require("./lib/ipRegistryEnricher");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function completeEntry(recordOverrides = {}) {
  return {
    status: "complete",
    fetchedAt: "2026-08-31T00:00:00Z",
    record: {
      found: true,
      resultCode: "00",
      applicants: [],
      products: [],
      expectedRightExpiryDate: null,
      rightHistory: [],
      ...recordOverrides,
    },
  };
}

async function runRegistryStalenessTests() {
  console.log("14-1) parseYmd — YYYYMMDD 파싱");
  {
    assert.strictEqual(parseYmd("20241020").toISOString().slice(0, 10), "2024-10-20");
    assert.strictEqual(parseYmd(""), null);
    assert.strictEqual(parseYmd(null), null);
    assert.strictEqual(parseYmd("2024-10-20"), null, "구분자가 있으면 형식 불일치로 처리");
    ok("8자리 숫자만 날짜로 인정하고 그 외는 null");
  }

  console.log("14-2) classifyStalenessCacheEntry — 만료예정일 기반 재검증 후보 판정(정책: expiry_only, #81 2026-08-31 확정)");
  {
    const asOf = new Date("2026-08-31T00:00:00Z");

    assert.deepStrictEqual(classifyStalenessCacheEntry("1", undefined, asOf), {
      registrationNumber: "1",
      category: "not_collected",
      refreshCandidate: false,
    });
    assert.strictEqual(
      classifyStalenessCacheEntry("1", completeEntry({ found: false }), asOf).category,
      "not_collected"
    );
    assert.strictEqual(
      classifyStalenessCacheEntry("1", completeEntry({ expectedRightExpiryDate: null }), asOf).category,
      "no_expiry_date",
      "만료예정일 필드가 없는(구버전 파서로 수집된) 항목은 이번 정책의 재검증 대상에 넣지 않음"
    );
    assert.strictEqual(
      classifyStalenessCacheEntry("1", completeEntry({ expectedRightExpiryDate: "20350101" }), asOf).category,
      "not_yet_due",
      "만료예정일이 미래면 재검증 불필요"
    );

    const dueUnconfirmed = classifyStalenessCacheEntry(
      "1",
      completeEntry({ expectedRightExpiryDate: "20240101", rightHistory: [] }),
      asOf
    );
    assert.strictEqual(dueUnconfirmed.category, "due_unconfirmed");
    assert.strictEqual(dueUnconfirmed.refreshCandidate, true, "만료예정일이 지났는데 캐시에 그 이후 처분 이력이 없으면 재검증 대상");

    const dueConfirmed = classifyStalenessCacheEntry(
      "1",
      completeEntry({
        expectedRightExpiryDate: "20240101",
        rightHistory: [{ name: "소멸등록", date: "20240601", reason: "존속기간만료" }],
      }),
      asOf
    );
    assert.strictEqual(dueConfirmed.category, "due_confirmed");
    assert.strictEqual(dueConfirmed.refreshCandidate, false, "만료 이후 처분 이력이 이미 캐시에 있으면 다시 볼 필요 없음");

    const staleHistoryBeforeExpiry = classifyStalenessCacheEntry(
      "1",
      completeEntry({
        expectedRightExpiryDate: "20240101",
        rightHistory: [{ name: "상표설정등록", date: "20140101", reason: null }],
      }),
      asOf
    );
    assert.strictEqual(
      staleHistoryBeforeExpiry.category,
      "due_unconfirmed",
      "처분 이력이 있어도 전부 만료예정일 이전 사건이면 여전히 재검증 대상"
    );

    ok("not_collected/no_expiry_date/not_yet_due/due_confirmed/due_unconfirmed 다섯 가지로 분리하고 due_unconfirmed만 재검증 후보로 표시");
  }

  console.log("14-3) buildStalenessManifest — 전체 캐시 집계와 결정론적 정렬");
  {
    const asOf = new Date("2026-08-31T00:00:00Z");
    const cache = new Map([
      ["3", completeEntry({ expectedRightExpiryDate: "20350101" })],
      ["1", completeEntry({ expectedRightExpiryDate: "20240101", rightHistory: [] })],
      ["2", completeEntry({ expectedRightExpiryDate: null })],
    ]);
    const manifest = buildStalenessManifest(cache, { asOf });
    assert.strictEqual(manifest.totalRowCount, 3);
    assert.strictEqual(manifest.refreshCandidateCount, 1);
    assert.deepStrictEqual(manifest.candidates.map((row) => row.registrationNumber), ["1"]);
    assert.strictEqual(manifest.byCategory.not_yet_due, 1);
    assert.strictEqual(manifest.byCategory.no_expiry_date, 1);
    assert.strictEqual(manifest.policy, "expiry_only");

    const withUniverse = buildStalenessManifest(cache, { asOf, registrationNumbers: ["1", "2", "3", "4"] });
    assert.strictEqual(withUniverse.byCategory.not_collected, 1, "캐시에 없는 등록번호는 not_collected로 집계");

    // 같은 입력·정책이면 후보가 결정론적이다(완료 조건).
    const manifestAgain = buildStalenessManifest(cache, { asOf });
    assert.deepStrictEqual(manifest.candidates, manifestAgain.candidates);

    ok("만료 기준일별로 결정론적으로 집계하고 재검증 후보만 안정적으로 뽑아냄");
  }

  console.log("14-4) diffRegistryRecords — 재조회 전후 변경 종류 구분(완료 조건)");
  {
    const before = {
      applicants: [{ address: "강원특별자치도 고성군" }],
      products: [{ classCode: "29", designatedProductName: "간고등어" }],
      rightHistory: [{ name: "상표설정등록", date: "20010321", reason: null }],
    };

    const noChange = diffRegistryRecords(before, completeEntry({ ...before }));
    assert.strictEqual(noChange.category, "no_change");

    const addressChanged = diffRegistryRecords(
      before,
      completeEntry({ ...before, applicants: [{ address: "경상북도 안동시" }] })
    );
    assert.strictEqual(addressChanged.category, "address_changed");
    assert.strictEqual(addressChanged.addressChanged, true);

    const goodsChanged = diffRegistryRecords(
      before,
      completeEntry({ ...before, products: [{ classCode: "30", designatedProductName: "고등어잼" }] })
    );
    assert.strictEqual(goodsChanged.category, "goods_changed");

    const statusChanged = diffRegistryRecords(
      before,
      completeEntry({
        ...before,
        rightHistory: [...before.rightHistory, { name: "소멸등록", date: "20250429", reason: "존속기간만료" }],
      })
    );
    assert.strictEqual(statusChanged.category, "status_changed");

    const multiple = diffRegistryRecords(
      before,
      completeEntry({
        ...before,
        applicants: [{ address: "경상북도 안동시" }],
        products: [{ classCode: "30", designatedProductName: "고등어잼" }],
      })
    );
    assert.strictEqual(multiple.category, "multiple_changed");

    const fetchFailed = diffRegistryRecords(before, { status: "error" });
    assert.strictEqual(fetchFailed.category, "fetch_failed");
    const fetchFailedNotFound = diffRegistryRecords(before, completeEntry({ found: false }));
    assert.strictEqual(fetchFailedNotFound.category, "fetch_failed");

    ok("no_change/address_changed/goods_changed/status_changed/multiple_changed/fetch_failed을 분리");
  }

  console.log("14-5) sanitizeRegistryRecordForCache — 만료예정일·처분 이력을 개인정보 없이 캐시에 보존");
  {
    const sanitized = sanitizeRegistryRecordForCache({
      found: true,
      resultCode: "00",
      applicationNumber: "4020260000001",
      registrationNumber: "4012345670000",
      registrationDate: "20260101",
      expectedRightExpiryDate: "20360101",
      rightHistory: [{ name: "상표설정등록", date: "20260101", reason: null }],
      applicants: [],
      products: [],
    });
    assert.strictEqual(sanitized.expectedRightExpiryDate, "20360101");
    assert.deepStrictEqual(sanitized.rightHistory, [{ name: "상표설정등록", date: "20260101", reason: null }]);
    ok("클라이언트가 파싱한 만료예정일·처분 이력이 캐시 저장 형태까지 그대로 유지됨(사유·일자만, 개인정보 없음)");
  }
}

if (require.main === module) {
  runRegistryStalenessTests()
    .then(() => console.log("\n등록원부 캐시 변경 감지 자체 테스트 통과"))
    .catch((error) => {
      console.error(`등록원부 캐시 변경 감지 자체 테스트 실패: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runRegistryStalenessTests };
