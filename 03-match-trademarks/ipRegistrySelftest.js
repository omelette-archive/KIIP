#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient, parseMarkHistoryResponse } = require("./lib/ipRegistryClient");
const { parseArgs: parseIpRegistryArgs } = require("./enrichIpRegistry");
const {
  enrichDocument,
  evaluateApplicantRegions,
  evaluateGoods,
  normalizeApplicantAddress,
} = require("./lib/ipRegistryEnricher");
const {
  kstDateString,
  nextKstMidnightIso,
  loadBudgetState,
  saveBudgetState,
  isResumeBlocked,
  recordRateLimit,
  remainingBudget,
} = require("./lib/ipRegistryBudget");

function ok(label) {
  console.log(`  ok - ${label}`);
}

const ADMIN_LIST = [
  { code: "4717000000", sido: "경상북도", sigungu: "안동시" },
  { code: "4824000000", sido: "경상남도", sigungu: "사천시" },
  { code: "5183000000", sido: "강원특별자치도", sigungu: "양양군" },
];

const RESPONSE = {
  resultCode: "000",
  resultMsg: "REQUEST_SUCCESS",
  totalCount: 1,
  items: {
    applNo: "4020250000001",
    rgstNo: "4012345670000",
    rgstDate: "20260101",
    applicant: [
      {
        applicantAddr: "경상북도 안동시 나머지주소 비공개",
        applicantNatl: "대한민국",
        rpstrYn: "Y",
      },
    ],
    productList: [
      { productClsCd: "31", desProduct: "신선한사과" },
      { productClsCd: "31", desProduct: "미가공사과(안동시에서생산된사과에한함)" },
    ],
  },
};

async function runIpRegistryTests() {
  console.log("1-1) 등록원부 CLI — 무호출 캐시 재적용 옵션");
  {
    const args = parseIpRegistryArgs(["--input", "sample.json", "--cache-only"]);
    assert.strictEqual(args.input, "sample.json");
    assert.strictEqual(args["cache-only"], true);
    ok("--cache-only를 값 없는 boolean 옵션으로 파싱");
  }

  console.log("1-2) 등록원부 API — 응답 계약과 인증 파라미터");
  {
    const parsed = parseMarkHistoryResponse(RESPONSE);
    assert.strictEqual(parsed.found, true);
    assert.strictEqual(parsed.applicants.length, 1);
    assert.strictEqual(parsed.products.length, 2);
    assert.strictEqual(parsed.products[0].designatedProductName, "신선한사과");
    let requestedUrl;
    const client = createClient({
      apiKey: "test-key",
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        return { ok: true, status: 200, text: async () => JSON.stringify(RESPONSE) };
      },
    });
    const result = await client.getMarkHistory({ registrationNumber: "40-1234567-0000" });
    assert.strictEqual(requestedUrl.searchParams.get("serviceKey"), "test-key");
    assert.strictEqual(requestedUrl.searchParams.get("type"), "json");
    assert.strictEqual(requestedUrl.searchParams.get("rgstNo"), "4012345670000");
    assert.strictEqual(result.registrationNumber, "4012345670000");
    await assert.rejects(
      () =>
        createClient({
          apiKey: "bad-key",
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ resultCode: "30", resultMsg: "KEY ERROR" }),
          }),
        }).getMarkHistory({ registrationNumber: "1" }),
      /\[30\]/
    );
    ok("최상위 items 계약과 serviceKey/type/rgstNo 요청을 고정");
  }

  console.log("1-3) 등록원부 주소·지정상품 결정론적 판정");
  {
    assert.deepStrictEqual(
      normalizeApplicantAddress("경상북도 안동시 나머지주소 비공개", ADMIN_LIST),
      {
        status: "matched",
        level: "sigungu",
        sido: "경상북도",
        sigungu: "안동시",
        normalizedRegion: "경상북도 안동시",
        method: "admin_sigungu_in_masked_address",
      }
    );
    const inside = evaluateApplicantRegions(
      "경상북도 안동시",
      [{ address: "경상북도 안동시 비공개" }],
      ADMIN_LIST
    );
    const outside = evaluateApplicantRegions(
      "경상북도 안동시",
      [{ address: "경상남도 사천시 비공개" }],
      ADMIN_LIST
    );
    assert.strictEqual(inside.match, "inside");
    assert.strictEqual(inside.confidence, "exact_registry_address_sigungu");
    assert.strictEqual(outside.match, "outside");
    assert.strictEqual(outside.confidence, "exact_registry_address_sido");

    const aliasAdminList = [
      { code: "1114000000", sido: "서울특별시", sigungu: "중구" },
      { code: "2611000000", sido: "부산광역시", sigungu: "중구" },
      { code: "4812000000", sido: "경상남도", sigungu: "창원시" },
    ];
    assert.deepStrictEqual(
      normalizeApplicantAddress("서울시 중구 상세주소 비공개", aliasAdminList),
      {
        status: "matched",
        level: "sigungu",
        sido: "서울특별시",
        sigungu: "중구",
        normalizedRegion: "서울특별시 중구",
        method: "admin_sigungu_in_masked_address",
      }
    );
    assert.deepStrictEqual(
      normalizeApplicantAddress("경남 진해시 상세주소 비공개", aliasAdminList),
      {
        status: "matched",
        level: "sigungu",
        sido: "경상남도",
        sigungu: "창원시",
        normalizedRegion: "경상남도 창원시",
        method: "admin_sigungu_successor_alias_in_address",
      }
    );
    const aliasEvidence = evaluateApplicantRegions(
      "경상남도 창원시",
      [{ address: "경남 진해시 상세주소 비공개" }],
      aliasAdminList
    );
    assert.strictEqual(aliasEvidence.match, "inside");
    assert.strictEqual(
      aliasEvidence.evidence[0].normalizationMethod,
      "admin_sigungu_successor_alias_in_address"
    );
    assert.strictEqual(
      evaluateGoods(
        { item: "신선한 사과", classCode: "31" },
        [{ classCode: "031", designatedProductName: "신선한사과" }]
      ).method,
      "normalized_exact"
    );
    const containsResult = evaluateGoods(
        { item: "미가공사과", classCode: "31" },
        [{ classCode: "31", designatedProductName: "미가공사과(강원도양양군에서생산된사과에한함)" }]
      );
    assert.strictEqual(containsResult.method, "normalized_contains");
    assert.strictEqual(containsResult.reviewRequired, false);
    assert.strictEqual(
      evaluateGoods(
        { item: "배", classCode: "31" },
        [{ classCode: "31", designatedProductName: "신선한사과" }]
      ).method,
      "class_only"
    );
    assert.strictEqual(
      evaluateGoods(
        { item: "사과", classCode: "30" },
        [{ classCode: "31", designatedProductName: "신선한사과" }]
      ).method,
      "mismatch"
    );
    ok("주소 inside/outside와 exact/contains/class-only/mismatch 근거를 분리");
  }

  console.log("1-4) 등록원부 소량 보강 — 중복 호출 제거와 미수집 상태");
  {
    let calls = 0;
    let reservedCalls = 0;
    const client = {
      getMarkHistory: async ({ registrationNumber }) => {
        calls++;
        assert.strictEqual(registrationNumber, "4012345670000");
        return parseMarkHistoryResponse(RESPONSE);
      },
    };
    const document = {
      schemaVersion: "1.1",
      results: [
        {
          status: "ok",
          query: { region: "경상북도 안동시", item: "신선한 사과", classCode: "31" },
          hits: [
            { applicationNumber: "1", registrationNumber: "40-1234567-0000" },
            { applicationNumber: "1", registrationNumber: "4012345670000" },
            { applicationNumber: "2", registrationNumber: "" },
            { applicationNumber: "3", registrationNumber: "4099999990000" },
          ],
        },
      ],
    };
    const enriched = await enrichDocument(document, client, {
      limit: 1,
      concurrency: 1,
      fetchedAt: "2026-08-11T00:00:00Z",
      onRequest: () => reservedCalls++,
    });
    assert.strictEqual(reservedCalls, 1, "실제 호출 직전에 예산을 한 번 예약해야 함");
    assert.strictEqual(calls, 1, "같은 등록번호는 한 번만 조회해야 함");
    assert.strictEqual(enriched.ipRegistryEnrichment.status, "partial");
    assert.strictEqual(enriched.ipRegistryEnrichment.uniqueRegistrationCount, 2);
    assert.strictEqual(enriched.ipRegistryEnrichment.completeRegistrationCount, 1);
    assert.strictEqual(enriched.ipRegistryEnrichment.notCollectedRegistrationCount, 1);
    assert.strictEqual(enriched.ipRegistryEnrichment.counts.completeHitCount, 2);
    assert.strictEqual(enriched.ipRegistryEnrichment.counts.noRegistrationHitCount, 1);
    assert.strictEqual(enriched.results[0].hits[0].applicantRegionMatch, "inside");
    assert.strictEqual(enriched.results[0].hits[0].goodsMatchMethod, "normalized_exact");
    assert.strictEqual(enriched.results[0].hits[2].ipRegistryStatus, "not_applicable");
    assert.strictEqual(enriched.results[0].hits[3].ipRegistryStatus, "not_collected");
    ok("등록번호별 1회 호출, 제한 밖·등록번호 없음 상태를 보존");
  }

  console.log("1-5) 등록원부 일별 호출 예산 — KST 경계·재개 시점 기록");
  {
    const noon2026 = new Date("2026-08-11T03:00:00.000Z"); // KST 정오
    assert.strictEqual(kstDateString(noon2026), "2026-08-11");
    const beforeMidnightKst = new Date("2026-08-11T14:59:59.000Z"); // KST 23:59:59
    assert.strictEqual(kstDateString(beforeMidnightKst), "2026-08-11");
    const afterMidnightKst = new Date("2026-08-11T15:00:01.000Z"); // KST 00:00:01(다음날)
    assert.strictEqual(kstDateString(afterMidnightKst), "2026-08-12");
    assert.strictEqual(nextKstMidnightIso(noon2026), "2026-08-11T15:00:00.000Z");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ip-registry-budget-"));
    const statePath = path.join(tempDir, "budget.json");
    const fresh = loadBudgetState(statePath, noon2026);
    assert.strictEqual(fresh.callsUsed, 0);
    assert.strictEqual(fresh.resumeNotBefore, null);
    assert.strictEqual(isResumeBlocked(fresh, noon2026), false);
    assert.strictEqual(remainingBudget(fresh, 100), 100);
    assert.strictEqual(remainingBudget(fresh, undefined), Infinity);

    const used = { ...fresh, callsUsed: 40 };
    saveBudgetState(statePath, used);
    const reloadedSameDay = loadBudgetState(statePath, new Date(noon2026.getTime() + 60 * 60 * 1000));
    assert.strictEqual(reloadedSameDay.callsUsed, 40, "같은 KST 날짜 안에서는 사용량이 유지돼야 함");
    assert.strictEqual(remainingBudget(reloadedSameDay, 100), 60);

    const limited = recordRateLimit(reloadedSameDay, noon2026);
    assert.strictEqual(limited.resumeNotBefore, "2026-08-11T15:00:00.000Z");
    assert.strictEqual(isResumeBlocked(limited, noon2026), true);
    assert.strictEqual(
      isResumeBlocked(limited, new Date("2026-08-11T15:00:01.000Z")),
      false,
      "다음날 KST 자정 이후에는 재개 차단이 풀려야 함"
    );
    saveBudgetState(statePath, limited);
    const nextDay = new Date("2026-08-12T03:00:00.000Z"); // 다음날 KST 정오
    const rolledOver = loadBudgetState(statePath, nextDay);
    assert.strictEqual(rolledOver.callsUsed, 0, "날짜가 바뀌면 사용량·재개 기록이 초기화돼야 함");
    assert.strictEqual(rolledOver.resumeNotBefore, null);
    fs.rmSync(tempDir, { recursive: true, force: true });
    ok("KST 날짜 경계로 예산이 초기화되고, 429 발생 시 다음날 자정까지 재개를 차단");
  }

  console.log("1-6) 등록원부 예산 소진 시 limit=0 캐시 전용 통과");
  {
    let calls = 0;
    const client = {
      getMarkHistory: async () => {
        calls++;
        return parseMarkHistoryResponse(RESPONSE);
      },
    };
    const document = {
      schemaVersion: "1.1",
      results: [
        {
          status: "ok",
          query: { region: "경상북도 안동시", item: "신선한 사과", classCode: "31" },
          hits: [{ applicationNumber: "1", registrationNumber: "40-1234567-0000" }],
        },
      ],
    };
    const enriched = await enrichDocument(document, client, {
      limit: 0,
      concurrency: 1,
      fetchedAt: "2026-08-11T00:00:00Z",
    });
    assert.strictEqual(calls, 0, "limit=0이면 새 호출을 하지 않아야 함");
    assert.strictEqual(enriched.ipRegistryEnrichment.requestedRegistrationCount, 0);
    assert.strictEqual(enriched.results[0].hits[0].ipRegistryStatus, "not_collected");
    ok("일별 예산 소진·재개 대기 중에도 새 호출 없이 캐시만 적용 가능");
  }

  console.log("1-7) 등록원부 429 — 호출 예약과 재개 차단 훅");
  {
    let calls = 0;
    let reservedCalls = 0;
    let rateLimitSignals = 0;
    const client = {
      getMarkHistory: async () => {
        calls++;
        throw new Error("getMarkHistory: API 오류 (429)");
      },
    };
    const document = {
      schemaVersion: "1.1",
      results: [
        {
          status: "ok",
          query: { region: "경상북도 안동시", item: "신선한 사과", classCode: "31" },
          hits: [
            { applicationNumber: "1", registrationNumber: "40-1234567-0000" },
            { applicationNumber: "2", registrationNumber: "40-9999999-0000" },
          ],
        },
      ],
    };
    const enriched = await enrichDocument(document, client, {
      limit: 2,
      concurrency: 1,
      onRequest: () => reservedCalls++,
      onRateLimit: () => rateLimitSignals++,
    });
    assert.strictEqual(calls, 1, "첫 429 뒤에는 후속 API 호출을 중단해야 함");
    assert.strictEqual(reservedCalls, 1, "실제로 시작한 호출만 예산에 예약해야 함");
    assert.strictEqual(rateLimitSignals, 1, "429 재개 차단 상태를 즉시 한 번 기록해야 함");
    assert.strictEqual(enriched.ipRegistryEnrichment.requestedRegistrationCount, 1);
    assert.strictEqual(enriched.ipRegistryEnrichment.rateLimitSkippedRegistrationCount, 1);
    ok("429 발생 즉시 예산·재개 상태 훅을 기록하고 후속 호출을 차단");
  }
}

if (require.main === module) {
  runIpRegistryTests()
    .then(() => console.log("\n등록원부 자체 테스트 통과"))
    .catch((error) => {
      console.error(`등록원부 자체 테스트 실패: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runIpRegistryTests };
