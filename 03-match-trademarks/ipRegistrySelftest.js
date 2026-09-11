#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient, parseMarkHistoryResponse, gatewayError } = require("./lib/ipRegistryClient");
const { parseArgs: parseIpRegistryArgs } = require("./enrichIpRegistry");
const {
  enrichDocument,
  evaluateApplicantRegions,
  evaluateGoods,
  normalizeApplicantAddress,
  regionEvaluatedHitSources,
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
    cndrtExptnDate: "20360101",
    right: [
      { rgstCsName: "상표설정등록", rgstCsDate: "20260101", rgstCsReason: null },
    ],
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
    assert.strictEqual(parsed.registrationDate, "20260101");
    assert.strictEqual(parsed.applicants.length, 1);
    assert.strictEqual(parsed.products.length, 2);
    assert.strictEqual(parsed.products[0].designatedProductName, "신선한사과");
    // #81: right[](처분 이력)·cndrtExptnDate(권리존속기간만료예정일)는 개인정보 없이
    // 재검증 신호로 쓰인다 — 이전 파서는 두 필드를 버리고 있었다.
    assert.strictEqual(parsed.expectedRightExpiryDate, "20360101");
    assert.strictEqual(parsed.rightHistory.length, 1);
    assert.strictEqual(parsed.rightHistory[0].name, "상표설정등록");
    assert.strictEqual(parsed.rightHistory[0].date, "20260101");
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

    // 2026-09-09(사용자 재확인): #192에서 producerOrg 아닌 공동출원인은 잠시 unverified로
    // 되돌렸으나, "일반 기업 공동출원인도 미분류로 남기지 말고 그 지역으로 인정해달라 —
    // 건수가 늘어나는 게 맞다"고 재확인받아 #187 원안(출원인 중 하나라도 이 지역이면
    // 이 지역 출원)으로 복원한다. 공동출원인은 그 상표가 여러 지역에 실제로 걸쳐 있는
    // 것이지 주소가 틀린 게 아니다.
    const coApplicantPlain = evaluateApplicantRegions(
      "경상북도 안동시",
      [{ address: "경상북도 안동시 비공개" }, { address: "경상남도 사천시 비공개" }],
      ADMIN_LIST
    );
    assert.strictEqual(coApplicantPlain.match, "inside", "공동출원인 중 하나가 이 지역이면 이 지역 출원");
    assert.strictEqual(coApplicantPlain.confidence, "coapplicant_inside");
    // 반대편 지역에서 같은 상표를 봐도 inside다 — 의도된 더블 카운트. 각 지역의 건수는
    // 출원번호 기준 고유 집계라 지역 안에서는 부풀지 않는다.
    const coApplicantOtherSide = evaluateApplicantRegions(
      "경상남도 사천시",
      [{ address: "경상북도 안동시 비공개" }, { address: "경상남도 사천시 비공개" }],
      ADMIN_LIST
    );
    assert.strictEqual(coApplicantOtherSide.match, "inside", "같은 상표가 양쪽 지역에서 집계돼야 함");
    // 생산자 단체형이 두 지역에 걸쳐 있어도 마찬가지로 양쪽에서 집계된다.
    const producerBoth = [
      { address: "경상북도 안동시 비공개", producerOrg: true },
      { address: "경상남도 사천시 비공개", producerOrg: true },
    ];
    assert.strictEqual(evaluateApplicantRegions("경상북도 안동시", producerBoth, ADMIN_LIST).match, "inside");
    assert.strictEqual(
      evaluateApplicantRegions("경상남도 사천시", producerBoth, ADMIN_LIST).match,
      "inside",
      "산지 주체가 양쪽에 있으면 두 지역 모두에서 집계돼야 함"
    );
    // 기업이 산지 조합과 공동출원해도, 기업 소재지 자체도 이제 이 지역 출원으로 인정한다
    // (위 재확인 — 기업 편중보다 미분류 방지가 우선).
    const firmAndCoop = [
      { address: "경상북도 안동시 비공개", producerOrg: true },
      { address: "경상남도 사천시 비공개" },
    ];
    assert.strictEqual(evaluateApplicantRegions("경상북도 안동시", firmAndCoop, ADMIN_LIST).match, "inside");
    assert.strictEqual(
      evaluateApplicantRegions("경상남도 사천시", firmAndCoop, ADMIN_LIST).match,
      "inside",
      "기업 소재지도 공동출원 근거로 이 지역 출원으로 인정한다"
    );
    // 이 지역 출원인이 하나도 없고 전원 주소가 읽혔으면 외부로 확정한다.
    const coApplicantNone = evaluateApplicantRegions(
      "강원특별자치도 양양군",
      [{ address: "경상북도 안동시 비공개" }, { address: "경상남도 사천시 비공개" }],
      ADMIN_LIST
    );
    assert.strictEqual(coApplicantNone.match, "outside");
    const coApplicantProducerInside = evaluateApplicantRegions(
      "경상북도 안동시",
      [
        { address: "경상북도 안동시 비공개", producerOrg: true },
        { address: "서울특별시 중구 비공개" },
      ],
      ADMIN_LIST
    );
    assert.strictEqual(coApplicantProducerInside.match, "inside");
    assert.strictEqual(coApplicantProducerInside.confidence, "producer_org_coapplicant_inside");
    // 생산자 주체형이 지역 밖이면 인정하지 않는다.
    const coApplicantProducerOutside = evaluateApplicantRegions(
      "경상북도 안동시",
      [
        { address: "서울특별시 중구 비공개", producerOrg: true },
        { address: "경상남도 사천시 비공개" },
      ],
      ADMIN_LIST
    );
    assert.strictEqual(coApplicantProducerOutside.match, "unverified");

    // 2026-09-09(사용자): "협동조합은 원물일 경우에만 공동출원인 인정해주고, 가공품인
    // 특산품의 경우 일반 기업 등 모두 가능해." 원물의 산지 귀속은 생산 주체가 그 지역에
    // 있어야 뜻이 있으므로 위 producerOrg 규칙까지만 인정하고, 가공품은 기업이 가공·판매
    // 주체이므로 일반 공동출원인도 인정한다.
    const firmCoapplicant = [
      { address: "경상북도 안동시 비공개" },
      { address: "경상남도 사천시 비공개" },
    ];
    const rawFirm = evaluateApplicantRegions("경상북도 안동시", firmCoapplicant, ADMIN_LIST, {
      itemName: "신선한 인삼",
    });
    // 주소를 전원 읽었고 산지 주체가 없으므로 보류가 아니라 외부로 확정된다 —
    // 원물 규칙이 미확인을 늘리지 않는다.
    assert.strictEqual(rawFirm.match, "outside", "원물은 일반 기업 공동출원인만으로 인정하지 않는다");
    assert.strictEqual(rawFirm.confidence, "coapplicant_outside");
    const rawProducer = evaluateApplicantRegions(
      "경상북도 안동시",
      [{ address: "경상북도 안동시 비공개", producerOrg: true }, { address: "경상남도 사천시 비공개" }],
      ADMIN_LIST,
      { itemName: "신선한 인삼" }
    );
    assert.strictEqual(rawProducer.match, "inside", "원물이라도 산지 생산자 주체형은 인정한다");
    assert.strictEqual(rawProducer.confidence, "producer_org_coapplicant_inside");
    const processedFirm = evaluateApplicantRegions("경상북도 안동시", firmCoapplicant, ADMIN_LIST, {
      itemName: "인삼차",
    });
    assert.strictEqual(processedFirm.match, "inside", "가공품은 일반 기업 공동출원인도 인정한다");
    assert.strictEqual(processedFirm.confidence, "coapplicant_inside");
    // 2026-09-10(사용자): "쌀도 원물이라고 봐야지 — 탈곡 전의 쌀은 지정상품으로 안 쓰니."
    // 지정상품에 오르는 이름은 이미 유통 형태를 전제하므로, 가공 표지가 없으면 원물이다.
    const bareName = evaluateApplicantRegions("경상북도 안동시", firmCoapplicant, ADMIN_LIST, {
      itemName: "쌀",
    });
    assert.strictEqual(bareName.match, "outside", "가공 표지 없는 이름(「쌀」)은 원물로 본다");
    // 품목명을 아예 못 넘긴 호출부는 조용히 엄격해지지 않도록 완화 쪽으로 남긴다.
    const noItemName = evaluateApplicantRegions("경상북도 안동시", firmCoapplicant, ADMIN_LIST, {
      itemName: "",
    });
    assert.strictEqual(noItemName.match, "inside", "품목명이 없으면 완화 쪽");
    // 원물 판정에도 지역 밖 기업만 있으면 결론은 그대로 외부다.
    assert.strictEqual(
      evaluateApplicantRegions("강원특별자치도 양양군", firmCoapplicant, ADMIN_LIST, {
        itemName: "신선한 인삼",
      }).match,
      "outside"
    );

    // 2026-09-09(회귀 방지): storageMode=query_facts 재판정 경로(regionEvaluatedHitSources)가
    // evaluateApplicantRegions와 별도로 공동출원인 조합 규칙을 구현하고 있었다 — 한쪽만
    // 고치고 잊어서 재계산 전후 delta가 0으로 나온 사고가 있었다(2026-09-09). 이제
    // combineApplicantMatches를 공유하므로 두 경로가 항상 같은 결론을 내야 한다.
    const queryFactsPlain = {
      storageMode: "query_facts",
      results: [{ queryKey: "q1", query: { region: "경상북도 안동시" } }],
      queryFacts: {
        q1: {
          hits: [
            {
              applicantRegionMatch: "unverified",
              applicantRegionEvidence: coApplicantPlain.evidence,
            },
          ],
        },
      },
    };
    const reevaluatedHits = regionEvaluatedHitSources(queryFactsPlain, ADMIN_LIST);
    assert.strictEqual(
      reevaluatedHits[0].hits[0].applicantRegionMatch,
      coApplicantPlain.match,
      "query_facts 재판정도 evaluateApplicantRegions와 같은 결론이어야 함(회귀 방지)"
    );

    // 2026-09-08(사용자): "동명지역인 경우 광역지자체 단위를 우선 체크해줘."
    // 시군구를 못 고르더라도 주소에 시도가 들어 있으면 광역 단위로는 확정한다 —
    // 지금까지는 통째로 버려 미확인으로 남았다.
    const sidoOnly = normalizeApplicantAddress("경상북도 없는읍 12-3 비공개", ADMIN_LIST);
    assert.strictEqual(sidoOnly.status, "matched", "시군구를 못 읽어도 시도가 있으면 확정");
    assert.strictEqual(sidoOnly.level, "sido");
    assert.strictEqual(sidoOnly.sido, "경상북도");
    assert.strictEqual(sidoOnly.sigungu, "");
    // 시도조차 없으면 여전히 미확인이다 — 없는 근거를 지어내지 않는다.
    const noSido = normalizeApplicantAddress("없는도 없는읍 12-3", ADMIN_LIST);
    assert.strictEqual(noSido.status, "unmatched");
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
    // 2026-09-09(사용자): "품목 1개에 n개의 관련 고시명칭이 있는 거고, 그 중 하나가
    // 출원되어도 해당 품목은 출원된 것으로." 「신선한 인삼」으로 검색한 품목이라도
    // 지정상품이 「인삼차」면 인삼을 실제로 쓴 출원이므로 특산품 활용으로 인정한다.
    const aliasQuery = { item: "신선한 인삼", classCode: "29|30|31|32|33|40" };
    const aliasHit = evaluateGoods(aliasQuery, [
      { classCode: "30", designatedProductName: "인삼차" },
    ]);
    assert.strictEqual(aliasHit.method, "normalized_exact", "별칭 고시명칭도 완전일치로 인정");
    assert.strictEqual(aliasHit.matchedNoticeName, "인삼차", "어느 이름으로 걸렸는지 남긴다");
    assert.strictEqual(aliasHit.matchedNoticeStage, "processed");
    // 질의 고시명칭 자신으로 걸리면 종전과 같이 별칭 정보는 비어 있다.
    const selfHit = evaluateGoods(aliasQuery, [
      { classCode: "31", designatedProductName: "신선한 인삼" },
    ]);
    assert.strictEqual(selfHit.method, "normalized_exact");
    assert.strictEqual(selfHit.matchedNoticeName, null);
    // 별칭 세트가 없는 품목은 종전대로 고시명칭 하나와만 대조한다 — 확대 범위는
    // 데이터 파일이 정하고, 코드가 임의로 넓히지 않는다.
    const noAlias = evaluateGoods({ item: "신선한 유자", classCode: "30" }, [
      { classCode: "30", designatedProductName: "유자차" },
    ]);
    // 「신선한유자」와 「유자차」는 서로 포함 관계도 아니라 류만 맞는 후보로 남는다 —
    // 별칭 세트가 메우려는 구멍이 바로 이것이다.
    assert.strictEqual(noAlias.method, "class_only", "별칭 없는 품목은 류만 맞는 후보로 남는다");
    assert.strictEqual(noAlias.matchedNoticeName, null);
    // 류가 다르면 여전히 안 센다 — 별칭은 이름을 넓히는 것이지 류 대조를 없애지 않는다.
    const wrongClass = evaluateGoods({ item: "신선한 인삼", classCode: "31" }, [
      { classCode: "30", designatedProductName: "인삼차" },
    ]);
    assert.strictEqual(wrongClass.method, "mismatch");
    const containsResult = evaluateGoods(
        { item: "미가공사과", classCode: "31" },
        [{ classCode: "31", designatedProductName: "미가공사과(강원도양양군에서생산된사과에한함)" }]
      );
    assert.strictEqual(containsResult.method, "normalized_contains");
    // #12(2026-09-01): 포함만 한 경우는 확정이 아니라 검토 후보(reviewRequired=true)
    assert.strictEqual(containsResult.reviewRequired, true);
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
    // #52 후속: 초당 제한(per_second)은 90초만 미루고 자정 냉각 안 함.
    const perSecond = recordRateLimit(reloadedSameDay, noon2026, "per_second");
    assert.strictEqual(perSecond.rateLimitKind, "per_second");
    assert.strictEqual(perSecond.resumeNotBefore, new Date(noon2026.getTime() + 90000).toISOString());
    assert.strictEqual(isResumeBlocked(perSecond, new Date(noon2026.getTime() + 91000)), false, "90초 뒤 재개 가능");
    // 종류 미상은 보수적으로 daily(자정)로 처리.
    assert.strictEqual(recordRateLimit(reloadedSameDay, noon2026).resumeNotBefore, "2026-08-11T15:00:00.000Z");
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
