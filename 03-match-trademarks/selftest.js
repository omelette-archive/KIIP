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
const { filterByClassCode, FOOD_RELATED_CLASSES } = require("./lib/filters");
const { KiprisApiError } = require("./lib/errors");
const {
  parseCsvLine,
  readNormalizedCsv,
  makeBatchQuery,
  countSearchableRows,
  buildBatchPlan,
  buildSearchOutput,
  searchOne,
  runBatch,
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
    assert.strictEqual(
      countSearchableRows([
        { sido: "경상북도", sigungu: "안동시", rawItemName: "사과", status: "ok" },
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
    assert.strictEqual(interrupted.results[0].collectionStatus, "partial");
    assert.strictEqual(interrupted.results[0].stopReason, "request_budget");
    assert.strictEqual(interrupted.results[0].hits.length, 4);
    assert.strictEqual(interrupted.results[1].hits.length, 4);

    calledPages.length = 0;
    const resumed = await runBatch(rows, client, { ...baseOptions, maxRequests: 3, resume: true });
    assert.deepStrictEqual(calledPages, [3], "재개 시 다음 미완료 페이지만 호출해야 함");
    assert.strictEqual(resumed.results[0].collectionStatus, "complete");
    assert.strictEqual(resumed.results[0].hits.length, 5);

    calledPages.length = 0;
    const reused = await runBatch(rows, client, { ...baseOptions, maxRequests: 3, resume: true });
    assert.deepStrictEqual(calledPages, [], "완료 쿼리는 재실행 시 API를 다시 호출하면 안 됨");
    assert.strictEqual(reused.resumedQueryCount, 1);
    assert.ok(reused.results.every((row) => row.reusedFromCheckpoint));
    ok("동일 검색 키 1회 호출, 다중 페이지 순회, 중단 후 다음 페이지 재개, 완료 쿼리 재사용");
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

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
