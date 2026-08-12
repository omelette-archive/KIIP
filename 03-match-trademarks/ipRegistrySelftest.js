#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { createClient, parseMarkHistoryResponse } = require("./lib/ipRegistryClient");
const {
  enrichDocument,
  evaluateApplicantRegions,
  evaluateGoods,
  normalizeApplicantAddress,
} = require("./lib/ipRegistryEnricher");

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
    });
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
