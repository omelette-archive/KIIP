#!/usr/bin/env node
"use strict";
/**
 * 실제 KIPRIS API 키 없이 파이프라인(XML 파싱 -> 클라이언트 -> 품목 필터)을 검증하는 자체 테스트.
 * fetch를 모킹해서 네트워크 없이 돌린다. 실행: node 03-match-trademarks/selftest.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseTrademarkResponse } = require("./lib/xmlLite");
const { createClient } = require("./lib/kiprisClient");
const {
  DEFAULT_BASE_URL: AREA_BRAND_BASE_URL,
  createClient: createAreaBrandClient,
  indexByApplicationNumber,
  normalizeApplicationNumber,
} = require("./lib/areaBrandClient");
const {
  createAreaBrandContext,
  enrichHitsWithAreaBrands,
  normalizeAreaBrandRegion,
} = require("./lib/areaBrandEnricher");
const {
  createClient: createIpRegistryClient,
  normalizeRegistrationNumber,
  summarizeMarkHistory,
} = require("./lib/ipRegistryClient");
const {
  createIpRegistryContext,
  enrichDocument,
  enrichHitsWithIpRegistry,
  ipRegistryValidationMetadata,
} = require("./lib/ipRegistryEnricher");
const { loadCache: loadIpRegistryCache, saveCache: saveIpRegistryCache } = require("./lib/ipRegistryCache");
const {
  createClient: createTrademarkApplicantClient,
  parseApplicantResponse,
} = require("./lib/trademarkApplicantClient");
const {
  enrichApplicantRegions,
} = require("./lib/trademarkApplicantEnricher");
const {
  loadCache: loadTrademarkApplicantCache,
  saveCache: saveTrademarkApplicantCache,
} = require("./lib/trademarkApplicantCache");
const { filterByClassCode, FOOD_RELATED_CLASSES } = require("./lib/filters");
const { KiprisApiError } = require("./lib/errors");
const { runIpRegistryTests } = require("./ipRegistrySelftest");
const {
  parseCsvLine,
  readNormalizedCsv,
  makeBatchQuery,
  countSearchableRows,
  buildBatchPlan,
  buildSearchOutput,
  searchOne,
  runBatch,
  loadCheckpoint,
} = require("./matchTrademarks");

const SAMPLE_OK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <totalCount>2</totalCount>
      <item>
        <title>가온키친</title>
        <applicantName>이든키친</applicantName>
        <applicationNumber>40-2026-0100001</applicationNumber>
        <applicationDate>20210101</applicationDate>
        <applicationStatus>등록</applicationStatus>
        <classificationCode>30</classificationCode>
        <registrationNumber>40-1234567</registrationNumber>
        <registrationDate>20211201</registrationDate>
        <publicationNumber></publicationNumber>
        <publicationDate></publicationDate>
        <regPrivilegeName>이든키친</regPrivilegeName>
        <agentName></agentName>
        <drawing></drawing>
      </item>
      <item>
        <title>하늘베이커리</title>
        <applicantName>prime플랫폼</applicantName>
        <applicationNumber>40-2026-0100002</applicationNumber>
        <applicationDate>20220505</applicationDate>
        <applicationStatus>출원중</applicationStatus>
        <classificationCode>43</classificationCode>
        <registrationNumber></registrationNumber>
        <registrationDate></registrationDate>
        <publicationNumber>40-2022-0099999</publicationNumber>
        <publicationDate>20220901</publicationDate>
        <regPrivilegeName></regPrivilegeName>
        <agentName>특허법인 예시</agentName>
        <drawing></drawing>
      </item>
    </items>
  </body>
</response>`;

const SAMPLE_NOT_FOUND_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>20</resultCode><resultMsg>NO_RESULT</resultMsg></header></response>`;

const SAMPLE_ERROR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>30</resultCode><resultMsg>SERVICE NOT REGISTERED</resultMsg></header></response>`;

function areaBrandXml(items, totalCount = items.length, resultCode = "00", resultMsg = "정상 처리되었습니다.") {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<response><header><resultCode>${resultCode}</resultCode><resultMsg>${resultMsg}</resultMsg></header>`,
    `<body><totalCount>${totalCount}</totalCount><items>`,
    ...items.map((item) => [
      "<item>",
      `<aplcnoInfo>${item.applicationNumber}</aplcnoInfo>`,
      `<brandRgsde>${item.registrationDate}</brandRgsde>`,
      `<cntntsNo>${item.contentId}</cntntsNo>`,
      `<cntntsSj><![CDATA[${item.brandName}]]></cntntsSj>`,
      `<imgUrl>${item.imageUrl || ""}</imgUrl>`,
      `<mainPrdlstNm>${item.product}</mainPrdlstNm>`,
      `<rgnoInfo>${item.registrationNumber}</rgnoInfo>`,
      `<signguNm>${item.region}</signguNm>`,
      "</item>",
    ].join("")),
    "</items></body></response>",
  ].join("");
}

function ok(label) {
  console.log(`  ok - ${label}`);
}

async function run() {
  await runIpRegistryTests();

  console.log("1) xmlLite.parseTrademarkResponse");
  {
    const parsed = parseTrademarkResponse(SAMPLE_OK_XML);
    assert.strictEqual(parsed.resultCode, "00");
    assert.strictEqual(parsed.totalCount, 2);
    assert.strictEqual(parsed.hits.length, 2);
    assert.strictEqual(parsed.hits[0].title, "가온키친");
    assert.strictEqual(parsed.hits[0].applicant, "이든키친");
    assert.strictEqual(parsed.hits[0].classificationCode, "30");
    assert.strictEqual(parsed.hits[1].agent, "특허법인 예시");
    ok("정상 응답 필드 13개 매핑 정확");
  }

  console.log("1-1) 농사로 areaBrandLst — 실제 목록 계약·페이지·출원번호 조인 키");
  {
    const requestedUrls = [];
    const allItems = [
      { applicationNumber: "4020190126184", registrationDate: "20200101", contentId: "1", brandName: "구미별미", product: "쌀", registrationNumber: "401234567", region: "구미" },
      { applicationNumber: "40-2020-0000002", registrationDate: "20210101", contentId: "2", brandName: "경북한상", product: "사과", registrationNumber: "402345678", region: "경상북도" },
      { applicationNumber: "4020210000003", registrationDate: "20220101", contentId: "3", brandName: "안동한상", product: "한우", registrationNumber: "403456789", region: "안동시" },
    ];
    const fakeFetch = async (url) => {
      requestedUrls.push(url);
      const parsedUrl = new URL(url);
      const pageNo = Number(parsedUrl.searchParams.get("pageNo"));
      const numOfRows = Number(parsedUrl.searchParams.get("numOfRows"));
      const start = (pageNo - 1) * 2;
      const pageItems = allItems.slice(start, start + numOfRows);
      return { ok: true, status: 200, text: async () => areaBrandXml(pageItems, 602) };
    };
    const client = createAreaBrandClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.listAreaBrands({ limit: 3, pageSize: 2 });
    assert.strictEqual(result.totalCount, 602);
    assert.strictEqual(result.brands.length, 3);
    assert.strictEqual(result.brands[0].brandName, "구미별미");
    assert.strictEqual(result.brands[1].primaryProductName, "사과");
    assert.deepStrictEqual(
      requestedUrls.map((url) => Number(new URL(url).searchParams.get("pageNo"))),
      [1, 2]
    );
    assert.deepStrictEqual(
      requestedUrls.map((url) => Number(new URL(url).searchParams.get("numOfRows"))),
      [2, 2],
      "페이지별 numOfRows가 바뀌면 offset이 겹칠 수 있음"
    );
    assert.ok(requestedUrls[0].startsWith(`${AREA_BRAND_BASE_URL}/areaBrandLst?`));
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.get("apiKey"), "test-key");
    assert.strictEqual(normalizeApplicationNumber("40-2019-0126184"), "4020190126184");
    const index = indexByApplicationNumber(result.brands);
    assert.strictEqual(index.get("4020190126184")[0].regionName, "구미");

    const adminList = [
      { code: "4719000000", sido: "경상북도", sigungu: "구미시" },
      { code: "4717000000", sido: "경상북도", sigungu: "안동시" },
      { code: "4280000000", sido: "강원특별자치도", sigungu: "고성군" },
      { code: "4872000000", sido: "경상남도", sigungu: "고성군" },
      { code: "4161000000", sido: "경기도", sigungu: "광주시" },
      { code: "X1", sido: "전남광주통합특별시", sigungu: "테스트구" },
    ];
    assert.deepStrictEqual(normalizeAreaBrandRegion("구미", adminList), {
      status: "matched",
      level: "sigungu",
      raw: "구미",
      sido: "경상북도",
      sigungu: "구미시",
      normalizedRegion: "경상북도 구미시",
      method: "sigungu_suffix_restored",
    });
    assert.strictEqual(normalizeAreaBrandRegion("경상북도", adminList).level, "sido");
    assert.strictEqual(normalizeAreaBrandRegion("고성", adminList).status, "ambiguous");
    assert.strictEqual(
      normalizeAreaBrandRegion("광주", adminList).sido,
      "전남광주통합특별시",
      "옛 광역시 별칭을 경기도 광주시로 오인하면 안 됨"
    );
    const context = createAreaBrandContext(result.brands, adminList, { fetchedAt: "2026-08-10T00:00:00Z" });
    const enriched = enrichHitsWithAreaBrands(
      [
        { applicationNumber: "40-2019-0126184", title: "일치" },
        { applicationNumber: "40-9999-9999999", title: "미참조" },
      ],
      "경상북도 구미시",
      context
    );
    assert.strictEqual(enriched[0].regionalBrandMatch, "inside");
    assert.strictEqual(enriched[0].regionalBrandMatchVersion, "area-brand-application-region-join-v1");
    assert.strictEqual(enriched[0].regionalBrandEvidence[0].normalizedRegion, "경상북도 구미시");
    assert.strictEqual(
      enriched[0].applicantRegionMatch,
      undefined,
      "지역브랜드 연관 지역을 출원인 주소로 기록하면 안 됨"
    );
    assert.strictEqual(enriched[1].regionalBrandMatchSource, undefined);

    const badClient = createAreaBrandClient({
      apiKey: "bad-key",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => areaBrandXml([], 0, "11", "인증키 오류"),
      }),
    });
    await assert.rejects(() => badClient.listAreaBrands({ limit: 1 }), /\[11\] 인증키 오류/);
    ok("areaBrandLst 계약·페이지·출원번호 조인과 보수적 지역 정규화가 동작함");
  }

  console.log("2) filterByClassCode");
  {
    const parsed = parseTrademarkResponse(SAMPLE_OK_XML);
    const filtered = filterByClassCode(parsed.hits, "43");
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].title, "하늘베이커리");
    assert.strictEqual(filterByClassCode(parsed.hits, undefined).length, 2);
    ok("품목(classCode) 필터링 정상 동작, 미지정 시 전체 반환");
  }

  console.log("2-1) filterByClassCode — 실제 KIPRIS 응답 형태(다중 류/zero-padding)");
  {
    const multiClassHits = [
      { title: "다중류상표", classificationCode: "09|35|42" },
      { title: "제로패딩상표", classificationCode: "008" },
      { title: "무관상표", classificationCode: "12" },
    ];
    assert.strictEqual(
      filterByClassCode(multiClassHits, "35").length,
      1,
      "파이프로 묶인 다중 류 중 하나로 검색해도 매칭돼야 함"
    );
    assert.strictEqual(
      filterByClassCode(multiClassHits, "8").length,
      1,
      "zero-padding된 코드(008)도 8로 검색하면 매칭돼야 함"
    );
    assert.strictEqual(filterByClassCode(multiClassHits, "99").length, 0);
    ok("다중 류(파이프 구분)·zero-padding 코드 정규화 후 매칭 정상 동작");
  }

  console.log("3) createClient().trademarkSearch (fetch 모킹, 정상 응답)");
  {
    const fakeFetch = async (url) => {
      assert.ok(url.includes("getWordSearch"), "getWordSearch 엔드포인트 호출 확인");
      assert.ok(url.includes("ServiceKey=test-key"), "인증키 쿼리 파라미터 확인");
      assert.ok(url.includes("searchString=%EC%BB%A4%ED%94%BC"), "searchString(커피) URL 인코딩 확인");
      return { ok: true, status: 200, text: async () => SAMPLE_OK_XML };
    };
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.trademarkSearch({ searchString: "커피", numOfRows: 20, pageNo: 1 });
    assert.strictEqual(result.hits.length, 2);
    ok("클라이언트가 fetch를 올바른 URL로 호출하고 응답을 파싱함");
  }

  console.log("4) resultCode 20 (결과 없음) -> 정상 처리, hits=[]");
  {
    const fakeFetch = async () => ({ ok: true, status: 200, text: async () => SAMPLE_NOT_FOUND_XML });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.trademarkSearch({ searchString: "존재하지않는상표명" });
    assert.strictEqual(result.resultCode, "20");
    assert.strictEqual(result.hits.length, 0);
    ok("resultCode 20은 에러가 아니라 빈 배열로 처리됨");
  }

  console.log("5) resultCode 30 (미신청) -> KiprisApiError throw");
  {
    const fakeFetch = async () => ({ ok: true, status: 200, text: async () => SAMPLE_ERROR_XML });
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    await assert.rejects(
      () => client.trademarkSearch({ searchString: "카카오" }),
      (err) => {
        assert.ok(err instanceof KiprisApiError);
        assert.strictEqual(err.resultCode, "30");
        assert.strictEqual(err.code, "ACCESS_KEY_NOT_REGISTERED");
        return true;
      }
    );
    ok("resultCode 30은 KiprisApiError(ACCESS_KEY_NOT_REGISTERED)로 던져짐");
  }

  console.log("6) HTTP 5xx -> fetchWithRetry가 재시도 후 최종 응답 반환");
  {
    let attempts = 0;
    const fakeFetch = async () => {
      attempts++;
      if (attempts < 3) return { ok: false, status: 503, headers: { get: () => null } };
      return { ok: true, status: 200, text: async () => SAMPLE_OK_XML };
    };
    const client = createClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.trademarkSearch({ searchString: "재시도테스트" });
    assert.strictEqual(attempts, 3);
    assert.strictEqual(result.hits.length, 2);
    ok("503 두 번 -> 세 번째 시도에서 성공 (지수 백오프 재시도 확인)");
  }

  console.log("7) 배치 CSV 행 -> 검색 쿼리 변환");
  {
    assert.deepStrictEqual(parseCsvLine('안동시,"안동사과, 부사",31'), [
      "안동시", "안동사과, 부사", "31",
    ]);
    assert.deepStrictEqual(
      makeBatchQuery({
        sido: "경상북도",
        sigungu: "안동시",
        rawItemName: "안동사과",
        itemName: "사과",
        noticeName: "사과",
        niceClass: "31",
        status: "ok",
      }),
      { region: "경상북도 안동시", item: "사과", classCode: "31" }
    );
    assert.match(
      makeBatchQuery({ status: "error", rawItemName: "실패품목" }).skipReason,
      /상위 단계/
    );
    assert.match(
      makeBatchQuery({ status: "review_required", rawItemName: "안동하회탈" }).skipReason,
      /상위 단계/
    );
    assert.match(
      makeBatchQuery({ excluded: "true", rawItemName: "사과나무" }).skipReason,
      /분석 제외/
    );
    assert.match(
      makeBatchQuery({ sido: "경상북도", sigungu: "안동시", itemName: "상큼愛", status: "ok" }).skipReason,
      /고시명칭 미확정/
    );
    assert.strictEqual(
      countSearchableRows([
        { sido: "경상북도", sigungu: "안동시", rawItemName: "사과", noticeName: "신선한 사과", niceClass: "31", status: "ok" },
        { rawItemName: "검토", status: "review_required" },
        { rawItemName: "제외", excluded: "true", status: "ok" },
      ]),
      1
    );
    ok("② 출력의 고시명칭/NICE류를 사용하고 검토필요·오류·제외 행은 건너뜀");
  }

  console.log("8) buildSearchOutput — 키워드 전체와 현재 페이지 필터 건수 분리");
  {
    const result = { totalCount: 10000, hits: [{ classificationCode: "31" }, { classificationCode: "30" }] };
    const hits = filterByClassCode(result.hits, "31");
    const output = buildSearchOutput(
      { region: "경상북도 안동시", item: "사과", classCode: "31" },
      result,
      hits,
      { pageNo: 1, numOfRows: 20 }
    );
    assert.strictEqual(output.keywordTotalCount, 10000);
    assert.strictEqual(output.page.unfilteredCount, 2);
    assert.strictEqual(output.page.filteredCount, 1);
    assert.strictEqual(output.page.hasMore, true);
    assert.strictEqual(output.totalCount, undefined);
    assert.strictEqual(output.returnedCount, undefined);
    ok("서로 다른 모집단의 카운트를 이름과 페이지 메타데이터로 명확히 구분함");
  }

  console.log("8-1) searchOne — NICE류 미상 시 식품 관련 기본 류로 좁힘(무필터 아님)");
  {
    const mixedClassXml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <items>
      <totalCount>3</totalCount>
      <item><title>식품상표</title><applicationNumber>1</applicationNumber><classificationCode>30</classificationCode></item>
      <item><title>전자상표</title><applicationNumber>2</applicationNumber><classificationCode>09</classificationCode></item>
      <item><title>다류상표</title><applicationNumber>3</applicationNumber><classificationCode>09|43</classificationCode></item>
    </items>
  </body>
</response>`;
    const client = createClient({
      apiKey: "test-key",
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => mixedClassXml }),
    });

    const withoutClass = await searchOne(client, { region: "경상북도 안동시", item: "품목" }, { pageNo: 1, numOfRows: 20 });
    assert.strictEqual(withoutClass.pages.unfilteredCount, 3);
    assert.strictEqual(withoutClass.pages.filteredCount, 2, "09류 단독 상표만 제외되고 30류·09|43류(43 포함)는 남아야 함");
    assert.strictEqual(withoutClass.query.classCode, null, "실제 요청 류는 여전히 null(정확한 메타데이터)");
    assert.strictEqual(withoutClass.query.classCodeFallbackApplied, true);

    const withClass = await searchOne(client, { region: "경상북도 안동시", item: "품목", classCode: "09" }, { pageNo: 1, numOfRows: 20 });
    assert.strictEqual(withClass.pages.filteredCount, 2, "명시적으로 09류를 요청하면 09류 상표만 남아야 함");
    assert.strictEqual(withClass.query.classCodeFallbackApplied, false);

    assert.deepStrictEqual(FOOD_RELATED_CLASSES, ["29", "30", "31", "32", "33", "40", "43"]);
    ok("NICE류를 모르면 무필터 대신 식품·음료 기본 류로 좁혀 노이즈를 줄이고, 메타데이터로 구분 표시");
  }

  console.log("9) runBatch — 행별 성공/오류/건너뜀 보존");
  {
    let calls = 0;
    const client = {
      trademarkSearch: async () => {
        calls++;
        return {
          resultCode: "00",
          resultMsg: "OK",
          totalCount: 1,
          hits: [{ title: "사과상표", classificationCode: "31" }],
        };
      },
    };
    const batch = await runBatch(
      [
        {
          sido: "경상북도", sigungu: "안동시", rawItemName: "안동사과", noticeName: "사과",
          niceClass: "31", status: "ok", source: "지리적표시", sourceId: "gi",
          sourceContractVersion: "provider-live-api", sourceUrl: "https://www.data.go.kr/data/15080629/openapi.do",
          sourceLastVerifiedAt: "2026-08-10", sourceFetchedAt: "2026-08-10T01:00:00Z",
        },
        { rawItemName: "실패품목", status: "error", source: "테스트", sourceId: "sample" },
        { sido: "경상북도", sigungu: "안동시", rawItemName: "사과나무", excluded: "true", status: "ok" },
      ],
      client,
      { pageNo: 1, numOfRows: 20, concurrency: 2 }
    );
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(batch.results.map((row) => row.status), ["ok", "skipped", "skipped"]);
    assert.strictEqual(batch.results[0].pages.filteredCount, 1);
    assert.strictEqual(batch.results[0].source, "지리적표시", "성공 행도 ②단계 원본 source가 함께 실려야 ④가 대표성 판정에 쓸 수 있음");
    assert.strictEqual(batch.results[0].provenance.sourceId, "gi");
    assert.strictEqual(batch.results[0].provenance.sourceContractVersion, "provider-live-api");
    assert.strictEqual(batch.results[0].provenance.sourceLastVerifiedAt, "2026-08-10");
    assert.strictEqual(batch.results[0].input.noticeName, "사과", "④가 표준 품목명과 고시명칭을 구분하도록 ② 원본 행을 보존해야 함");
    assert.strictEqual(batch.results[1].provenance.sourceId, "sample", "skipped 행도 출처 계보를 잃으면 안 됨");
    ok("검색 가능한 행만 호출하고 입력 순서대로 상태를 보존함, source도 함께 전파됨");
  }

  console.log("9-1) runBatch — 검색 오류 행도 source를 보존함");
  {
    const failingClient = { trademarkSearch: async () => { throw new Error("네트워크 오류"); } };
    const failedBatch = await runBatch(
      [{ sido: "전라남도", sigungu: "보성군", rawItemName: "보성녹차", noticeName: "녹차", niceClass: "30", status: "ok", source: "농사로" }],
      failingClient,
      { pageNo: 1, numOfRows: 20, concurrency: 1 }
    );
    assert.strictEqual(failedBatch.results[0].status, "error");
    assert.strictEqual(failedBatch.results[0].source, "농사로");
    ok("검색 자체가 실패해도 source는 유실되지 않음");
  }

  console.log("9-2) 고유 쿼리 중복 제거·다중 페이지·체크포인트 재개");
  {
    const rows = [
      { sido: "경상북도", sigungu: "안동시", rawItemName: "안동사과", noticeName: "사과", niceClass: "31", status: "ok" },
      { sido: "경기도", sigungu: "포천시", rawItemName: "포천사과", noticeName: "사과", niceClass: "031", status: "ok" },
    ];
    const checkpointQueries = {};
    const calledPages = [];
    const client = {
      trademarkSearch: async ({ pageNo }) => {
        calledPages.push(pageNo);
        const count = pageNo < 3 ? 2 : 1;
        return {
          totalCount: 5,
          hits: Array.from({ length: count }, (_, index) => ({
            title: `사과상표-${pageNo}-${index}`,
            applicationNumber: `${pageNo}-${index}`,
            classificationCode: "31",
          })),
        };
      },
    };
    const baseOptions = {
      pageNo: 1,
      numOfRows: 2,
      maxPages: 3,
      maxHitsPerQuery: 10,
      concurrency: 2,
      checkpointQueries,
      saveCheckpoint: () => {},
    };

    const interrupted = await runBatch(rows, client, { ...baseOptions, maxRequests: 2 });
    assert.deepStrictEqual(calledPages, [1, 2], "중복된 두 지역 행이 페이지를 각각 호출하면 안 됨");
    assert.strictEqual(interrupted.uniqueQueryCount, 1);
    assert.deepStrictEqual(interrupted.uniqueQueryStatusCounts, { complete: 0, partial: 1, error: 0 });
    assert.strictEqual(interrupted.results[0].collectionStatus, "partial");
    assert.strictEqual(interrupted.results[0].stopReason, "request_budget");
    assert.strictEqual(interrupted.results[0].hits.length, 4);
    assert.strictEqual(interrupted.results[1].hits.length, 4);

    calledPages.length = 0;
    const resumed = await runBatch(rows, client, { ...baseOptions, maxRequests: 3, resume: true });
    assert.deepStrictEqual(calledPages, [3], "재개 시 다음 미완료 페이지만 호출해야 함");
    assert.strictEqual(resumed.results[0].collectionStatus, "complete");
    assert.deepStrictEqual(resumed.uniqueQueryStatusCounts, { complete: 1, partial: 0, error: 0 });
    assert.strictEqual(resumed.results[0].hits.length, 5);

    calledPages.length = 0;
    const reused = await runBatch(rows, client, { ...baseOptions, maxRequests: 3, resume: true });
    assert.deepStrictEqual(calledPages, [], "완료 쿼리는 재실행 시 API를 다시 호출하면 안 됨");
    assert.strictEqual(reused.resumedQueryCount, 1);
    assert.ok(reused.results.every((row) => row.reusedFromCheckpoint));
    ok("동일 검색 키 1회 호출, 다중 페이지 순회, 중단 후 다음 페이지 재개, 완료 쿼리 재사용");
  }

  console.log("9-3) max_pages 부분 체크포인트 — 상한을 늘려 다음 페이지부터 재개");
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kipris-checkpoint-"));
    const checkpointPath = path.join(dir, "checkpoint.json");
    fs.writeFileSync(checkpointPath, JSON.stringify({
      schemaVersion: "1.0",
      options: { numOfRows: 20, maxPages: 5, maxHitsPerQuery: 600 },
      queries: {},
    }));
    assert.doesNotThrow(() => loadCheckpoint(checkpointPath, {
      numOfRows: 20, maxPages: 100, maxHitsPerQuery: 600,
    }), "maxPages 증가는 이미 저장한 페이지를 보존하며 안전하게 허용해야 함");
    assert.throws(() => loadCheckpoint(checkpointPath, {
      numOfRows: 20, maxPages: 4, maxHitsPerQuery: 600,
    }), /보다 현재 값 4가 작습니다/);
    assert.throws(() => loadCheckpoint(checkpointPath, {
      numOfRows: 20, maxPages: 100, maxHitsPerQuery: 1200,
    }), /maxHitsPerQuery/,
    "hit 상한 변경은 마지막 수집 페이지의 잘린 hit를 잃을 수 있어 계속 차단해야 함");
    fs.rmSync(dir, { recursive: true, force: true });
    ok("페이지 상한 증가는 허용하고 페이지 크기·hit 상한 변경은 안전을 위해 차단");
  }

  console.log("10) 배치 입력 계약 — ② 출력 필드 강제 + dry-run 계획");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-trademark-contract-"));
    const rawInputPath = path.join(tempDir, "stage1.csv");
    const normalizedInputPath = path.join(tempDir, "stage2.csv");
    try {
      fs.writeFileSync(
        rawInputPath,
        "sido,sigungu,rawItemName\n경상북도,안동시,안동사과\n",
        "utf8"
      );
      assert.throws(() => readNormalizedCsv(rawInputPath), /itemName.*status/);

      fs.writeFileSync(
        normalizedInputPath,
        [
          "sido,sigungu,rawItemName,itemName,noticeName,niceClass,excluded,status",
          "경상북도,안동시,안동사과,사과,신선한 사과,31,false,ok",
          "경상북도,안동시,안동하회탈,하회탈,,,false,review_required",
        ].join("\n") + "\n",
        "utf8"
      );
      const rows = readNormalizedCsv(normalizedInputPath);
      const plan = buildBatchPlan(rows);
      assert.deepStrictEqual(plan.map((row) => row.status), ["planned", "skipped"]);
      assert.strictEqual(plan[0].query.item, "신선한 사과");
      assert.match(plan[1].reason, /review_required/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    ok("① 원시 CSV의 직접 투입을 거부하고 ② 확정/검토 행을 호출 예정/건너뜀으로 분리함");
  }

  console.log("11) ipRegistryClient.getMarkHistory — 요청 구성·응답 요약·오류 코드(000이 성공)");
  {
    let requestedUrl;
    const fakeFetch = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resultCode: "000",
          resultMsg: "REQUEST_SUCCESS",
          items: {
            title: "양양 해풍 사과",
            rgstNo: "4025303310000",
            applNo: "4020240190374",
            applicant: [{ applicantName: "김흥수", applicantAddr: "강원특별자치도 양양군 ..." }],
            owner: [{ ownerName: "김흥수", ownerAddr: "강원특별자치도 양양군 ..." }],
            productList: [
              { productClsCd: "31", desProduct: "미가공사과(강원도양양군에서생산된해풍사과에한함)" },
              { productClsCd: null, desProduct: null },
            ],
          },
        }),
      };
    };
    const client = createIpRegistryClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.getMarkHistory("4025-3033-0000");
    const parsedUrl = new URL(requestedUrl);
    assert.ok(requestedUrl.startsWith(`https://apis.data.go.kr/1430000/PttRgstRtInfoInqSvc/getMarkHistory?`));
    assert.strictEqual(parsedUrl.searchParams.get("serviceKey"), "test-key");
    assert.strictEqual(parsedUrl.searchParams.get("type"), "json");
    assert.strictEqual(parsedUrl.searchParams.get("rgstNo"), "402530330000", "하이픈 등 숫자 아닌 문자는 제거해서 조회");
    assert.strictEqual(normalizeRegistrationNumber("4025-3033-0000"), "402530330000");
    assert.strictEqual(result.applicantAddr, "강원특별자치도 양양군 ...");
    assert.strictEqual(result.ownerAddr, "강원특별자치도 양양군 ...");
    assert.deepStrictEqual(result.productList, [
      { productClsCd: "31", desProduct: "미가공사과(강원도양양군에서생산된해풍사과에한함)" },
    ], "productClsCd/desProduct가 둘 다 없는 빈 행은 제거함");
    ok("serviceKey/type=json/rgstNo(숫자만) 쿼리 구성과 출원인 주소·지정상품 요약이 정확함");
  }

  console.log("11-1) ipRegistryClient.getMarkHistory — resultCode가 000이 아니면 오류");
  {
    const client = createIpRegistryClient({
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ resultCode: "010", resultMsg: "잘못된 요청 파라미터입니다." }),
      }),
    });
    await assert.rejects(() => client.getMarkHistory("4025303310000"), /\[010\] 잘못된 요청 파라미터/);
    ok("다른 KIPRIS/MAFRA 서비스와 규약이 달라 000 이외는 성공이 아니라 오류로 처리됨");
  }

  console.log("12) enrichHitsWithIpRegistry — 출원인 주소를 applicantRegionMatch 본류에 직접 반영");
  {
    const adminList = [
      { code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" },
      { code: "4682000000", sido: "경상남도", sigungu: "합천군" },
    ];
    let calls = 0;
    const fakeClient = {
      getMarkHistory: async (rgstNo) => {
        calls++;
        if (rgstNo === "1") {
          return summarizeMarkHistory({
            rgstNo: "1",
            applicant: [{ applicantAddr: "강원특별자치도 양양군 ..." }],
            productList: [{ productClsCd: "31", desProduct: "신선한사과" }],
          });
        }
        if (rgstNo === "2") {
          return summarizeMarkHistory({
            rgstNo: "2",
            applicant: [{ applicantAddr: "경상남도 합천군 ..." }],
            productList: [],
          });
        }
        throw new Error("등록번호 미등록");
      },
    };
    const context = createIpRegistryContext({ client: fakeClient, adminList, maxRequests: 10 });
    const hits = [
      { applicationNumber: "A1", registrationNumber: "1" }, // inside(양양군 쿼리와 일치)
      { applicationNumber: "A2", registrationNumber: "2" }, // outside(합천군, 양양군 쿼리와 불일치)
      { applicationNumber: "A3", registrationNumber: "1" }, // 캐시 재사용 확인용 중복
      { applicationNumber: "A4" }, // 등록번호 없음
      { applicationNumber: "A5", registrationNumber: "999" }, // 조회 실패
    ];
    const enriched = await enrichHitsWithIpRegistry(hits, "강원특별자치도 양양군", context);

    assert.strictEqual(enriched[0].applicantRegionMatch, "inside");
    assert.strictEqual(enriched[0].applicantRegion.sigungu, "양양군");
    assert.strictEqual(enriched[0].applicantRegion.raw, undefined, "전체 주소는 산출물에 복사하지 않음");
    assert.strictEqual(enriched[0].designatedGoodsEvidence.productList[0].desProduct, "신선한사과");

    assert.strictEqual(enriched[1].applicantRegionMatch, "outside");
    assert.strictEqual(enriched[1].designatedGoodsEvidence, undefined, "지정상품이 없으면 필드 자체를 안 만듦");

    assert.strictEqual(calls, 3, "등록번호 1·2·999 각 1회, 중복된 등록번호(1)는 캐시로 재사용해 추가 호출 없음");
    assert.strictEqual(enriched[2].applicantRegionMatch, "inside", "캐시로 얻은 결과도 동일하게 반영됨");

    assert.deepStrictEqual(enriched[3].ipRegistryLookup, { status: "no_registration_number" });
    assert.strictEqual(enriched[3].applicantRegionMatch, undefined);

    assert.strictEqual(enriched[4].ipRegistryLookup.status, "error");
    assert.match(enriched[4].ipRegistryLookup.error, /등록번호 미등록/);
    assert.strictEqual(enriched[4].applicantRegionMatch, undefined, "조회 실패 hit는 배치 전체를 죽이지 않고 값만 비움");

    ok("등록번호 기준으로 캐시·조회실패·무등록번호를 구분하고, 진짜 출원인 주소는 applicantRegionMatch에 직접 반영됨");
  }

  console.log("12-1) enrichHitsWithIpRegistry — 호출 예산 소진 시 배치를 죽이지 않고 건너뜀");
  {
    const adminList = [{ code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" }];
    const fakeClient = {
      getMarkHistory: async (rgstNo) =>
        summarizeMarkHistory({ rgstNo, applicant: [{ applicantAddr: "강원특별자치도 양양군 ..." }], productList: [] }),
    };
    const context = createIpRegistryContext({ client: fakeClient, adminList, maxRequests: 1 });
    const hits = [
      { registrationNumber: "1" },
      { registrationNumber: "2" },
    ];
    const enriched = await enrichHitsWithIpRegistry(hits, "강원특별자치도 양양군", context);
    assert.strictEqual(enriched[0].applicantRegionMatch, "inside");
    assert.strictEqual(enriched[1].ipRegistryLookup.status, "skipped_budget");
    assert.strictEqual(context.stats.skippedBudget, 1);
    ok("--max-registry-requests 상한에 도달하면 초과 hit는 skipped_budget으로 남기고 예외를 던지지 않음");
  }

  console.log("12-1b) enrichHitsWithIpRegistry — concurrency로 동시 호출 수를 제한(429 방지)");
  {
    const adminList = [{ code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" }];
    let inFlight = 0;
    let maxInFlight = 0;
    const fakeClient = {
      getMarkHistory: async (rgstNo) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
        return summarizeMarkHistory({ rgstNo, applicant: [{ applicantAddr: "강원특별자치도 양양군 ..." }], productList: [] });
      },
    };
    const context = createIpRegistryContext({ client: fakeClient, adminList, maxRequests: 10, concurrency: 2 });
    const hits = Array.from({ length: 6 }, (_, i) => ({ registrationNumber: String(i + 1) }));
    const enriched = await enrichHitsWithIpRegistry(hits, "강원특별자치도 양양군", context);
    assert.strictEqual(enriched.length, 6);
    assert.ok(maxInFlight <= 2, `동시 호출은 concurrency(2)를 넘지 않아야 함 (실제 최대: ${maxInFlight})`);
    ok("실키 검증(2026-08-11)에서 무제한 동시 호출이 등록원부 API 429를 유발한 문제를 concurrency 상한으로 방지함");
  }

  console.log("12-1c) 등록원부 429 이후 후속 호출 회로 차단");
  {
    const adminList = [{ code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" }];
    let calls = 0;
    const fakeClient = {
      getMarkHistory: async (rgstNo) => {
        calls++;
        if (rgstNo === "2") throw new Error("getMarkHistory: API 오류 (429)");
        return summarizeMarkHistory({ rgstNo, applicant: [], productList: [] });
      },
    };
    const context = createIpRegistryContext({ client: fakeClient, adminList, maxRequests: 10, concurrency: 1 });
    const enriched = await enrichHitsWithIpRegistry(
      ["1", "2", "3", "4"].map((registrationNumber) => ({ registrationNumber })),
      "강원특별자치도 양양군",
      context
    );
    assert.strictEqual(calls, 2, "첫 429 이후 남은 등록번호는 실제 API를 호출하지 않아야 함");
    assert.strictEqual(enriched[1].ipRegistryStatus, "error", "429를 받은 실제 요청은 오류 근거로 보존");
    assert.strictEqual(enriched[2].ipRegistryLookup.status, "skipped_rate_limit");
    assert.strictEqual(enriched[3].ipRegistryLookup.status, "skipped_rate_limit");
    assert.strictEqual(context.stats.skippedRateLimit, 2);
    ok("일일/속도 제한이 감지되면 같은 배치에서 실패 요청을 반복하지 않음");
  }

  console.log("12-1d) 별도 등록원부 보강 CLI도 429 이후 실제 요청 수를 보존");
  {
    let calls = 0;
    const fakeClient = {
      getMarkHistory: async ({ registrationNumber }) => {
        calls++;
        if (registrationNumber === "2") throw new Error("getMarkHistory: API 오류 (429)");
        return summarizeMarkHistory({ rgstNo: registrationNumber, applicant: [], productList: [] });
      },
    };
    const document = {
      results: [{
        query: { region: "강원특별자치도 양양군", item: "신선한 사과", classCode: "31" },
        hits: ["1", "2", "3", "4"].map((registrationNumber) => ({ registrationNumber })),
      }],
    };
    const output = await enrichDocument(document, fakeClient, { limit: 4, concurrency: 1 });
    assert.strictEqual(calls, 2);
    assert.strictEqual(output.ipRegistryEnrichment.selectedRegistrationCount, 4);
    assert.strictEqual(output.ipRegistryEnrichment.requestedRegistrationCount, 2);
    assert.strictEqual(output.ipRegistryEnrichment.rateLimitSkippedRegistrationCount, 2);
    assert.strictEqual(output.ipRegistryEnrichment.notCollectedRegistrationCount, 2);
    assert.deepStrictEqual(output.results[0].hits.map((hit) => hit.ipRegistryStatus), [
      "complete", "error", "not_collected", "not_collected",
    ]);
    ok("선택 상한과 실제 요청 수를 구분하고 회로 차단된 건을 미수집으로 기록");
  }

  console.log("12-1e) 등록원부 영속 캐시 — 성공 응답 누적·상세주소 비저장");
  {
    const adminList = [{ code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" }];
    let calls = 0;
    const fakeClient = {
      getMarkHistory: async ({ registrationNumber }) => {
        calls++;
        return summarizeMarkHistory({
          rgstNo: registrationNumber,
          applNo: `A${registrationNumber}`,
          applicant: [{ applicantAddr: "강원특별자치도 양양군 상세주소 123" }],
          productList: [{ productClsCd: "31", desProduct: "신선한사과" }],
        });
      },
    };
    const document = {
      results: [{
        query: { region: "강원특별자치도 양양군", item: "신선한 사과", classCode: "31" },
        hits: ["1", "2"].map((registrationNumber) => ({ registrationNumber })),
      }],
    };
    const entries = new Map();
    const first = await enrichDocument(document, fakeClient, {
      limit: 1,
      concurrency: 1,
      cacheEntries: entries,
      adminList,
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(first.ipRegistryEnrichment.completeRegistrationCount, 1);
    assert.strictEqual(entries.get("1").record.applicants[0].address, "강원특별자치도 양양군");
    assert.ok(!JSON.stringify(entries.get("1")).includes("상세주소"));

    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-registry-cache-"));
    const cachePath = path.join(cacheDir, "cache.json");
    saveIpRegistryCache(cachePath, entries, "2026-08-11T00:00:00.000Z");
    const reloaded = loadIpRegistryCache(cachePath);
    const second = await enrichDocument(document, fakeClient, {
      limit: 1,
      concurrency: 1,
      cacheEntries: reloaded,
      adminList,
    });
    assert.strictEqual(calls, 2, "등록번호 1은 캐시 재사용, 미수집 등록번호 2만 추가 호출");
    assert.strictEqual(second.ipRegistryEnrichment.cachedRegistrationCount, 1);
    assert.strictEqual(second.ipRegistryEnrichment.newlyCompleteRegistrationCount, 1);
    assert.strictEqual(second.ipRegistryEnrichment.completeRegistrationCount, 2);
    assert.strictEqual(second.ipRegistryEnrichment.notCollectedRegistrationCount, 0);
    assert.deepStrictEqual(
      second.results[0].hits.map((hit) => hit.applicantRegionMatch),
      ["inside", "inside"]
    );
    fs.rmSync(cacheDir, { recursive: true, force: true });
    ok("성공 주소를 시도·시군구로만 영속 저장하고 다음 실행은 미수집 등록번호부터 조회함");
  }

  console.log("12-2) ipRegistryValidationMetadata — 요약 통계·기준 문서화");
  {
    const adminList = [
      { code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" },
      { code: "4682000000", sido: "경상남도", sigungu: "합천군" },
    ];
    const fakeClient = {
      getMarkHistory: async (rgstNo) =>
        summarizeMarkHistory({
          rgstNo,
          applicant: [{ applicantAddr: rgstNo === "1" ? "강원특별자치도 양양군 ..." : "경상남도 합천군 ..." }],
          productList: [{ productClsCd: "31", desProduct: "신선한사과" }],
        }),
    };
    const context = createIpRegistryContext({ client: fakeClient, adminList, maxRequests: 10 });
    const results = [
      {
        status: "ok",
        query: { region: "강원특별자치도 양양군" },
        hits: await enrichHitsWithIpRegistry(
          [{ registrationNumber: "1" }, { registrationNumber: "2" }],
          "강원특별자치도 양양군",
          context
        ),
      },
    ];
    const metadata = ipRegistryValidationMetadata(context, results);
    assert.strictEqual(metadata.enabled, true);
    assert.deepStrictEqual(metadata.matchCounts, {
      inside: 1, outside: 1, unverified: 0, referenced: 2, goodsReferenced: 2,
    });
    assert.strictEqual(ipRegistryValidationMetadata(null).enabled, false);
    ok("활성화 여부·기준·요약 통계를 함께 보존해 감사 가능함");
  }

  console.log("12-3) 출원번호 기반 상표 출원인 주소 — 응답 파싱·영속 누적");
  {
    const parsed = parseApplicantResponse(`
      <response><header><resultCode>00</resultCode><resultMsg>success</resultMsg></header>
      <body><items><trademarkApplicantInfo>
      <nameKoreanLong>저장하지 않을 이름</nameKoreanLong>
      <applicantAddress>강원특별자치도 양양군 상세주소 123</applicantAddress>
      <nationalCode>KR</nationalCode><applicantCode>123</applicantCode><seq>1</seq>
      </trademarkApplicantInfo></items></body></response>`);
    assert.strictEqual(parsed.found, true);
    assert.strictEqual(parsed.applicants[0].address, "강원특별자치도 양양군 상세주소 123");

    let requestedUrl = null;
    let applicantRequestCount = 0;
    const applicantClient = createTrademarkApplicantClient({
      apiKey: "test-key",
      emptyRetryDelay: 0,
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        applicantRequestCount++;
        if (applicantRequestCount < 3) {
          return { ok: true, status: 200, text: async () => `
            <response><header><resultCode>00</resultCode><resultMsg>success</resultMsg></header>
            <body><items></items></body></response>`,
          };
        }
        return { ok: true, status: 200, text: async () => `
          <response><header><resultCode>00</resultCode><resultMsg>success</resultMsg></header>
          <body><items><trademarkApplicantInfo><applicantAddress>강원특별자치도 양양군</applicantAddress>
          </trademarkApplicantInfo></items></body></response>`,
        };
      },
    });
    await applicantClient.getApplicants("40-2026-1234567");
    assert.ok(requestedUrl.pathname.endsWith("/trademarkApplicantInfo"));
    assert.strictEqual(requestedUrl.searchParams.get("applicationNumber"), "4020261234567");
    assert.strictEqual(requestedUrl.searchParams.get("accessKey"), "test-key");
    assert.strictEqual(applicantRequestCount, 3, "성공 코드의 빈 항목은 완료로 캐시하지 않고 재시도");

    const terminalEmpty = await createTrademarkApplicantClient({
      apiKey: "test-key",
      emptyRetries: 0,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => `
          <response><header><resultCode>00</resultCode><resultMsg>success</resultMsg></header>
          <body><items></items></body></response>`,
      }),
    }).getApplicants("40-2026-7654321");
    assert.strictEqual(terminalEmpty.retryExhausted, true);
    assert.strictEqual(terminalEmpty.found, false);

    const adminList = [{ code: "4280000000", sido: "강원특별자치도", sigungu: "양양군" }];
    let calls = 0;
    const fakeClient = {
      getApplicants: async (applicationNumber) => {
        calls++;
        return { applicationNumber, found: true, applicants: parsed.applicants };
      },
    };
    const document = {
      results: [{
        query: { region: "강원특별자치도 양양군", item: "신선한 사과", classCode: "31" },
        hits: ["A1", "A2"].map((applicationNumber) => ({ applicationNumber })),
      }],
    };
    const entries = new Map();
    const first = await enrichApplicantRegions(document, fakeClient, {
      limit: 1,
      concurrency: 1,
      cacheEntries: entries,
      adminList,
      onCacheUpdate: ({ cacheEntries }) => {
        assert.strictEqual(cacheEntries.size, 1);
      },
    });
    assert.strictEqual(first.applicationApplicantEnrichment.completeApplicationCount, 1);
    assert.strictEqual(first.results[0].hits[0].applicantRegionMatch, "inside");
    assert.strictEqual(entries.get("1").applicants[0].address, "강원특별자치도 양양군");
    assert.ok(!JSON.stringify([...entries.values()]).includes("저장하지 않을 이름"));

    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-applicant-cache-"));
    const cachePath = path.join(cacheDir, "cache.json");
    entries.set("20", {
      status: "complete",
      fetchedAt: "2026-08-11T00:00:00.000Z",
      found: false,
      resultCode: "20",
      applicants: [],
    });
    saveTrademarkApplicantCache(cachePath, entries, "2026-08-11T00:00:00.000Z");
    const reloaded = loadTrademarkApplicantCache(cachePath);
    assert.strictEqual(reloaded.get("20").resultCode, "20");
    reloaded.delete("20");
    const second = await enrichApplicantRegions(document, fakeClient, {
      limit: 1, concurrency: 1, cacheEntries: reloaded, adminList,
    });
    assert.strictEqual(calls, 2, "첫 출원번호는 캐시 재사용하고 두 번째 출원번호만 추가 호출");
    assert.strictEqual(second.applicationApplicantEnrichment.cachedApplicationCount, 1);
    assert.strictEqual(second.applicationApplicantEnrichment.completeApplicationCount, 2);
    assert.deepStrictEqual(
      second.results[0].hits.map((hit) => hit.applicantRegionMatch),
      ["inside", "inside"]
    );
    const cacheDocument = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const persistedEntries = JSON.stringify(cacheDocument.entries);
    assert.ok(!persistedEntries.includes("상세주소"));
    assert.ok(!persistedEntries.includes("applicantCode"));
    fs.rmSync(cacheDir, { recursive: true, force: true });
    ok("등록번호 없는 출원도 출원번호로 주소를 조회하고 시도·시군구 캐시에 누적함");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
