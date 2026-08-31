#!/usr/bin/env node
"use strict";
/**
 * 실제 API 키 없이 파이프라인(법정동코드 파싱 -> 지역 매칭 -> 제공기관 클라이언트
 * 요청/응답 처리)을 검증하는 자체 테스트. fetch를 모킹해서 네트워크 없이 돌린다.
 * 실행: node 01-collect-specialties/selftest.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseCsvLine, loadAdminCodes } = require("./lib/adminCodes");
const {
  splitRegion,
  resolveRegionInput,
  fromGiRegistrations,
  fromNongsaro,
  fromNfqsCertifications,
  fromNfqsGeographicalIndications,
} = require("./lib/normalize");
const {
  loadOfficialSupplement,
  normalizeOfficialSupplement,
} = require("./lib/officialSupplement");
const { getSourceDefinition, loadSourceRegistry } = require("./lib/sourceRegistry");
const {
  DEFAULT_BASE_URL: GI_BASE_URL,
  DEFAULT_DATASET: GI_DATASET,
  createClient: createGiClient,
  normalizeDate: normalizeGiDate,
} = require("./lib/giClient");
const { maskSensitiveUrl } = require("./lib/fetchWithRetry");
const {
  createClient: createNongsaroClient,
  DEFAULT_BASE_URL: NONGSARO_BASE_URL,
} = require("./lib/nongsaroClient");
const { parseNongsaroResponse } = require("./lib/xmlLite");
const { createClient: createNfqsClient } = require("./lib/nfqsClient");
const {
  createClient: createNfqsGeoClient,
  parseCatalogPage: parseNfqsGeoCatalogPage,
} = require("./lib/nfqsGeoClient");
const {
  createCollectionStore,
  makeStoredRecords,
  sourceRecordKey,
} = require("./lib/collectionStore");
const { collectRegionalSpecialtyCrops } = require("./lib/rdaRegionalSpecialtyCrops");

function ok(label) {
  console.log(`  ok - ${label}`);
}

async function run() {
  console.log("1) adminCodes.parseCsvLine");
  {
    assert.deepStrictEqual(parseCsvLine("1111000000,서울특별시,종로구,,"), [
      "1111000000", "서울특별시", "종로구", "", "",
    ]);
    ok("기본 콤마 분리 정상 동작");
  }

  console.log("2) adminCodes.loadAdminCodes — 시군구 레벨만 필터링");
  {
    const fixture = [
      "법정동코드,시도명,시군구명,읍면동명,리명,순위,생성일자",
      "1100000000,서울특별시,,,,11,1988-04-23",
      "1111000000,서울특별시,종로구,,,1,1988-04-23",
      "1111010100,서울특별시,종로구,청운동,,1,1988-04-23",
      "4139000000,경기도,시흥시,,,1,1994-12-26",
    ].join("\n");
    const tmpPath = path.join(os.tmpdir(), `admincode_fixture_${Date.now()}.csv`);
    fs.writeFileSync(tmpPath, "﻿" + fixture, "utf8");
    try {
      const list = loadAdminCodes(tmpPath);
      assert.deepStrictEqual(list, [
        { code: "1111000000", sido: "서울특별시", sigungu: "종로구" },
        { code: "4139000000", sido: "경기도", sigungu: "시흥시" },
      ]);
      ok("시도 단독 행/읍면동 단위 행은 제외하고 시군구 레벨만 남음");
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  const adminList = [
    { code: "1111000000", sido: "서울특별시", sigungu: "종로구" },
    { code: "4721000000", sido: "경상북도", sigungu: "안동시" },
    { code: "4682000000", sido: "경상남도", sigungu: "합천군" },
    // 동명 시군구 회귀 테스트용 — 실제로 고성군은 강원/경남에 둘 다 있음.
    { code: "4280000000", sido: "강원특별자치도", sigungu: "고성군" },
    { code: "4872000000", sido: "경상남도", sigungu: "고성군" },
  ];

  console.log("3) normalize.splitRegion");
  {
    assert.deepStrictEqual(splitRegion("경상북도 안동시", adminList), {
      sido: "경상북도", sigungu: "안동시", matched: true,
    });
    assert.deepStrictEqual(splitRegion("안동시", adminList), {
      sido: "경상북도", sigungu: "안동시", matched: true,
    });
    assert.strictEqual(splitRegion("존재하지않는지역", adminList).matched, false);
    assert.strictEqual(splitRegion("", adminList).matched, false);
    ok("시도 접두어 유무와 무관하게 시군구명으로 매칭, 못 찾으면 matched:false");
  }

  console.log("3-1) normalize.splitRegion — 동명 시군구(고성군: 강원/경남) 오매칭 회귀 테스트");
  {
    assert.deepStrictEqual(splitRegion("강원도 고성군", adminList), {
      sido: "강원특별자치도", sigungu: "고성군", matched: true,
    });
    assert.deepStrictEqual(splitRegion("경상남도 고성군", adminList), {
      sido: "경상남도", sigungu: "고성군", matched: true,
    });
    const ambiguous = splitRegion("고성군", adminList);
    assert.strictEqual(ambiguous.matched, false);
    assert.strictEqual(ambiguous.ambiguous, true);
    assert.deepStrictEqual(ambiguous.candidateSidos.sort(), ["강원특별자치도", "경상남도"]);
    ok("시도명이 함께 있으면 정확히 좁히고, 없으면 틀린 시도를 단정짓지 않고 ambiguous로 표시");
  }

  console.log("3-2) normalize.splitRegion — 중복 시군구(중구/강서구)는 시도까지 검증");
  {
    const duplicateAdminList = [
      { code: "1114000000", sido: "서울특별시", sigungu: "중구" },
      { code: "2611000000", sido: "부산광역시", sigungu: "중구" },
      { code: "1150000000", sido: "서울특별시", sigungu: "강서구" },
      { code: "2644000000", sido: "부산광역시", sigungu: "강서구" },
    ];
    assert.deepStrictEqual(splitRegion("부산광역시 중구", duplicateAdminList), {
      sido: "부산광역시", sigungu: "중구", matched: true,
    });
    assert.deepStrictEqual(splitRegion("부산광역시 강서구", duplicateAdminList), {
      sido: "부산광역시", sigungu: "강서구", matched: true,
    });
    assert.strictEqual(splitRegion("중구", duplicateAdminList).matched, false);
    ok("시도가 있으면 정확한 후보를 고르고, 시도 없는 중복 시군구는 미검증 처리됨");
  }

  console.log("3-3) normalize.splitRegion — 통합 시도(전남광주통합특별시)의 옛 이름(전라남도/광주) 인식");
  {
    const mergedSidoAdminList = [
      { code: "X1", sido: "전남광주통합특별시", sigungu: "테스트구" },
      { code: "X2", sido: "경기도", sigungu: "테스트구" },
    ];
    assert.deepStrictEqual(splitRegion("전라남도 테스트구", mergedSidoAdminList), {
      sido: "전남광주통합특별시", sigungu: "테스트구", matched: true,
    });
    assert.deepStrictEqual(splitRegion("광주 테스트구", mergedSidoAdminList), {
      sido: "전남광주통합특별시", sigungu: "테스트구", matched: true,
    });
    assert.deepStrictEqual(splitRegion("경기도 테스트구", mergedSidoAdminList), {
      sido: "경기도", sigungu: "테스트구", matched: true,
    });
    ok("마스터엔 통합 후 이름만 있어도, 소스가 통합 전 옛 시도명을 써도 정확히 좁혀짐");
  }

  console.log("3-4) normalize.splitRegion — 포함관계 시군구와 광역 단위 원본");
  {
    const containmentAdminList = [
      { code: "A1", sido: "경기도", sigungu: "남양주시" },
      { code: "A2", sido: "경기도", sigungu: "양주시" },
      { code: "B1", sido: "부산광역시", sigungu: "중구" },
      { code: "X1", sido: "전남광주통합특별시", sigungu: "목포시" },
    ];
    assert.deepStrictEqual(splitRegion("경기도 > 남양주시", containmentAdminList), {
      sido: "경기도", sigungu: "남양주시", matched: true,
    });
    assert.deepStrictEqual(splitRegion("부산광역시", containmentAdminList), {
      sido: "부산광역시", sigungu: "", matched: true,
    });
    assert.deepStrictEqual(splitRegion("광주광역시", containmentAdminList), {
      sido: "전남광주통합특별시", sigungu: "", matched: true,
    });
    ok("가장 긴 시군구명을 우선하고 시군구 없는 광역 원본은 시도 단위로 보존");
  }

  console.log("3-5) normalize.splitRegion — 축약·개칭·공백 표기 통합");
  {
    const aliasAdminList = [
      { code: "A1", sido: "서울특별시", sigungu: "중구" },
      { code: "A2", sido: "부산광역시", sigungu: "중구" },
      { code: "B1", sido: "강원특별자치도", sigungu: "고성군" },
      { code: "B2", sido: "경상남도", sigungu: "고성군" },
      { code: "C1", sido: "경상북도", sigungu: "안동시" },
      { code: "D1", sido: "경기도", sigungu: "수원시" },
      { code: "D2", sido: "경기도", sigungu: "수원시영통구" },
      { code: "E1", sido: "경상남도", sigungu: "창원시" },
    ];
    assert.deepStrictEqual(splitRegion("서울시", aliasAdminList), {
      sido: "서울특별시", sigungu: "", matched: true,
    });
    assert.deepStrictEqual(splitRegion("서울시 중구", aliasAdminList), {
      sido: "서울특별시", sigungu: "중구", matched: true,
    });
    assert.deepStrictEqual(splitRegion("강원도 고성군", aliasAdminList), {
      sido: "강원특별자치도", sigungu: "고성군", matched: true,
    });
    assert.deepStrictEqual(splitRegion("경북 안동", aliasAdminList), {
      sido: "경상북도", sigungu: "안동시", matched: true,
    });
    assert.deepStrictEqual(splitRegion("경기도 수원시 영통구", aliasAdminList), {
      sido: "경기도", sigungu: "수원시영통구", matched: true,
    });
    assert.deepStrictEqual(splitRegion("경남 진해시", aliasAdminList), {
      sido: "경상남도", sigungu: "창원시", matched: true,
    });
    const ambiguousStem = splitRegion("고성", aliasAdminList);
    assert.strictEqual(ambiguousStem.matched, false);
    assert.strictEqual(ambiguousStem.ambiguous, true);
    ok("시도 축약·개칭명·시군구 접미사·통합 전 명칭을 보정하되 동명 지역은 보류");
  }

  console.log("4) normalize.fromGiRegistrations / fromNongsaro");
  {
    const gi = fromGiRegistrations(
      [{ registeredName: "안동한우", region: "경상북도 안동시" }, { registeredName: "미상품목", region: "없는지역" }],
      adminList
    );
    assert.strictEqual(gi.rows.length, 2);
    assert.strictEqual(gi.rows[0].sigungu, "안동시");
    assert.strictEqual(gi.rows[0].source, "지리적표시");
    assert.strictEqual(gi.warnings.length, 1);

    const nongsaro = fromNongsaro([{ title: "합천딸기", region: "합천군" }], adminList);
    assert.strictEqual(nongsaro.rows[0].sido, "경상남도");
    assert.strictEqual(nongsaro.rows[0].source, "농사로");
    ok("두 소스 모두 표준 스키마로 정규화되고, 매칭 실패는 경고로만 기록됨");
  }

  console.log("4-1) 과거 행정구역명·코드 승계와 공식 보완자료");
  {
    const historyAdminList = [
      { code: "3611000000", sido: "세종특별자치시", sigungu: "세종시" },
      { code: "5011000000", sido: "제주특별자치도", sigungu: "제주시" },
      { code: "5013000000", sido: "제주특별자치도", sigungu: "서귀포시" },
    ];
    assert.deepStrictEqual(splitRegion("충청남도 연기군", historyAdminList), {
      sido: "세종특별자치시", sigungu: "세종시", matched: true,
    });
    assert.deepStrictEqual(splitRegion("제주도 북제주군", historyAdminList), {
      sido: "제주특별자치도", sigungu: "제주시", matched: true,
    });
    assert.deepStrictEqual(splitRegion("제주도 남제주군", historyAdminList), {
      sido: "제주특별자치도", sigungu: "서귀포시", matched: true,
    });
    const codeRecovered = resolveRegionInput("", historyAdminList, "4473000000");
    assert.strictEqual(codeRecovered.sido, "세종특별자치시");
    assert.strictEqual(codeRecovered.sigungu, "세종시");
    assert.strictEqual(codeRecovered.regionCode, "3611000000");
    assert.strictEqual(codeRecovered.matchMethod, "region_code_successor");

    const sejongDocument = loadOfficialSupplement(
      path.join(__dirname, "data", "sejong-official-specialties.json")
    );
    const sejong = normalizeOfficialSupplement(sejongDocument, historyAdminList, "세종 공식 특산품");
    assert.strictEqual(sejong.rows.length, 7);
    assert.strictEqual(sejong.warnings.length, 0);
    assert.ok(sejong.rows.every((row) => row.sido === "세종특별자치시" && row.sigungu === "세종시"));
    assert.ok(sejong.rows.every((row) => row.regionMatchMethod === "exact_region_code"));
    assert.ok(sejong.rows.some((row) => row.rawItemName === "수박" && row.sourceItemName === "싱싱세종수박"));

    const jejuDocument = loadOfficialSupplement(
      path.join(__dirname, "data", "jeju-naqs-gi-specialties.json")
    );
    const jeju = normalizeOfficialSupplement(jejuDocument, historyAdminList, "제주 지리적표시");
    assert.strictEqual(jeju.rows.length, 3);
    assert.strictEqual(jeju.warnings.length, 0);
    assert.ok(jeju.rows.every((row) => row.sido === "제주특별자치도" && row.sigungu === ""));

    const seogwipoDocument = loadOfficialSupplement(
      path.join(__dirname, "data", "seogwipo-grandculture-specialties.json")
    );
    const seogwipo = normalizeOfficialSupplement(seogwipoDocument, historyAdminList, "디지털서귀포문화대전 특산물");
    assert.strictEqual(seogwipo.rows.length, 12);
    assert.strictEqual(seogwipo.warnings.length, 0);
    assert.ok(seogwipo.rows.every((row) => row.sido === "제주특별자치도" && row.sigungu === "서귀포시"));
    assert.ok(seogwipo.rows.some((row) => row.rawItemName === "은갈치" && row.sourceItemName === "성산읍의 은갈치"));
    ok("연기군·남/북제주군과 과거 코드를 현재 지역으로 승계하고 공식 보완자료를 정규화");
  }

  console.log("5) 소스별 필수 설정 검증");
  {
    assert.throws(() => createGiClient({}), /GI_API_KEY/);
    const gi = createGiClient({ apiKey: "test-key" });
    await assert.rejects(() => gi.listRegistrations(), /registrationDates/);
    assert.throws(() => createNongsaroClient({}), /인증키/);
    assert.strictEqual(normalizeGiDate("2013-02-07"), "20130207");
    assert.throws(() => normalizeGiDate("20130230"), /유효하지/);
    ok("지리적표시는 키·등록일, 농사로는 키 누락 시 명확한 에러로 실패함");
  }

  console.log("6) giClient — MAFRA URL 경로·Grid 응답 매핑");
  {
    const requestedUrls = [];
    let logicalRequests = 0;
    const fakeFetch = async (url) => {
      requestedUrls.push(url);
      const date = new URL(url).searchParams.get("REGIST_NO_REGIST_DE");
      const rows = date === "20130207"
        ? [{
            ROW_NUM: 1,
            REGIST_REQST_PBLANC_NO: "2012-40",
            GGRPH_INDICT_KOREAN_NM: "안성배",
            GGRPH_INDICT_ENG_NM: "Anseong Bae(Pear)",
            REGIST_NO_REGIST_DE: "20130207",
            GRP_NM: "생산자연합회",
            TRGET_AREA: "행정구역상 경기도 안성시 일원",
            PRDCTN_PLAN_QY: "2,400톤",
            GGRPH_INDICT_SFE: "특징",
            HMPG_IMAGE_FILE_NO: "266",
          }]
        : [];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          [GI_DATASET]: {
            totalCnt: rows.length,
            result: { code: "INFO-000", message: "정상 처리되었습니다." },
            row: rows,
          },
        }),
      };
    };
    const gi = createGiClient({
      apiKey: "test-key",
      fetchImpl: fakeFetch,
      onRequest: () => logicalRequests++,
    });
    const rows = await gi.listRegistrations({ registrationDates: ["20130207", "20260810"] });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].registrationNumber, "2012-40");
    assert.strictEqual(rows[0].registeredName, "안성배");
    assert.strictEqual(rows[0].region, "행정구역상 경기도 안성시 일원");
    assert.strictEqual(rows[0].organizationName, "생산자연합회");
    assert.ok(rows[0].raw.GGRPH_INDICT_SFE);
    assert.strictEqual(requestedUrls.length, 2);
    assert.strictEqual(logicalRequests, 2);
    assert.ok(requestedUrls[0].startsWith(`${GI_BASE_URL}/test-key/json/${GI_DATASET}/1/1000?`));
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.get("REGIST_NO_REGIST_DE"), "20130207");
    assert.ok(maskSensitiveUrl(requestedUrls[0]).includes("/openapi/***/json/"));
    assert.strictEqual(maskSensitiveUrl(requestedUrls[0]).includes("test-key"), false);
    ok("발급키 URL 경로와 필수 등록일을 구성하고 Grid 필드를 표준 모델로 매핑함");
  }

  console.log("6-1) giClient — HTTP 200 내부 API 오류 감지");
  {
    const gi = createGiClient({
      apiKey: "bad-key",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: { code: "INFO-100", message: "인증키가 유효하지 않습니다." } }),
      }),
    });
    await assert.rejects(
      () => gi.listRegistrations({ registrationDates: ["20130207"] }),
      /\[INFO-100\] 인증키가 유효하지 않습니다/
    );
    ok("HTTP 200이어도 MAFRA result.code가 INFO-000이 아니면 실패 처리됨");
  }

  console.log("7) nongsaroClient — 공식 XML 계약 파싱 + 샘플 제한");
  {
    const requestedUrls = [];
    let logicalRequests = 0;
    const fakeFetch = async (url) => {
      requestedUrls.push(url);
      const pageNo = Number(new URL(url).searchParams.get("pageNo"));
      const items = pageNo === 1
        ? [
            { areaCode: "4717000000", title: "안동사과", region: "경상북도 안동시", date: "2026-01-01" },
            { areaCode: "4678000000", title: "보성녹차", region: "전라남도 보성군", date: "2026-01-02" },
          ]
        : [{ areaCode: "4889000000", title: "합천딸기", region: "경상남도 합천군", date: "2026-01-03" }];
      const itemXml = items.map((item) => [
        "<item>",
        `<areaCode>${item.areaCode}</areaCode>`,
        `<cntntsSj><![CDATA[${item.title}]]></cntntsSj>`,
        `<areaNm>${item.region}</areaNm>`,
        `<svcDt>${item.date}</svcDt>`,
        "</item>",
      ].join("")).join("");
      return {
        ok: true,
        status: 200,
        text: async () => [
          "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
          "<response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header>",
          `<body><totalCount>3</totalCount><items>${itemXml}</items></body></response>`,
        ].join(""),
      };
    };
    const client = createNongsaroClient({
      apiKey: "test-key",
      baseUrl: "",
      fetchImpl: fakeFetch,
      onRequest: () => logicalRequests++,
    });
    const rows = await client.listSpecialties({ numOfRows: 2, limit: 3 });
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].title, "안동사과");
    assert.strictEqual(rows[2].region, "경상남도 합천군");
    assert.deepStrictEqual(requestedUrls.map((url) => Number(new URL(url).searchParams.get("pageNo"))), [1, 2]);
    assert.strictEqual(logicalRequests, 2);
    assert.ok(requestedUrls[0].startsWith(`${NONGSARO_BASE_URL}/localSpcprdLst?`));
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.get("apiKey"), "test-key");
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.has("serviceKey"), false);
    ok("빈 환경변수에도 공식 URL을 사용하고 apiKey/XML 계약으로 2페이지, limit=3에서 중단함");
  }

  console.log("7-1) nongsaro XML — API 결과코드 오류 감지");
  {
    const parsed = parseNongsaroResponse(
      "<response><header><resultCode>11</resultCode><resultMsg>인증키 오류</resultMsg></header></response>"
    );
    assert.strictEqual(parsed.resultCode, "11");
    const client = createNongsaroClient({
      apiKey: "bad-key",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "<response><header><resultCode>11</resultCode><resultMsg>인증키 오류</resultMsg></header></response>",
      }),
    });
    await assert.rejects(() => client.listSpecialties({ limit: 1 }), /\[11\] 인증키 오류/);
    ok("HTTP 200이어도 농사로 resultCode가 00이 아니면 실패 처리됨");
  }

  console.log("7-2) nfqsClient — cert_key·User-Agent 및 사업장 주소의 비지역화(#114)");
  {
    const requestedUrls = [];
    const requestedHeaders = [];
    const fakeFetch = async (url, options) => {
      requestedUrls.push(url);
      requestedHeaders.push(options?.headers || {});
      const itemXml = [
        "<item>",
        "<jisoknm>부산지원</jisoknm><codeknm>수산물</codeknm><goodknm>간고등어</goodknm>",
        "<certno>G020010</certno><custkfirm><![CDATA[(주)동원해사랑]]></custkfirm>",
        "<headknm>장창익</headknm><resino>6038127694</resino><tel>051-291-5101</tel>",
        "<jisokaddr>부산광역시 사하구 감천항로 24</jisokaddr>",
        "<vdatefrom>20250513</vdatefrom><vdateto>20270512</vdateto>",
        "</item>",
      ].join("");
      return {
        ok: true,
        status: 200,
        text: async () =>
          `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items>${itemXml}</items></body></response>`,
      };
    };
    const client = createNfqsClient({ certKey: "test-cert-key", fetchImpl: fakeFetch });
    const records = await client.listCertifications();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].productName, "간고등어");
    assert.strictEqual(records[0].companyAddress, "부산광역시 사하구 감천항로 24");
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.get("cert_key"), "test-cert-key");
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.has("serviceKey"), false);
    assert.ok(requestedHeaders[0]["User-Agent"], "일반 User-Agent 헤더 없이 호출하면 실제 서버가 빈 응답을 주므로 항상 지정해야 함");
    const adminList = loadAdminCodes();
    const normalized = fromNfqsCertifications(records, adminList);
    assert.strictEqual(normalized.rows[0].sido, "");
    assert.strictEqual(normalized.rows[0].sigungu, "");
    assert.strictEqual(normalized.rows[0].regionMatchMethod, "facility_location_not_specialty_origin");
    assert.strictEqual(normalized.rows[0].sourceScope, "nationwide_certified_product_catalog");
    assert.strictEqual(normalized.rows[0].rawItemName, "간고등어");
    assert.match(normalized.warnings[0], /인증사업장 주소를 지역 특산품 근거로 사용하지 않고/);
    ok("cert_key로 호출하되 인증사업장 주소를 지역 특산품 소재지로 승격하지 않음");
  }

  console.log("7-2a-geo) nfqsGeoClient — API 누락 필드를 공식 등록현황으로 교차 보강");
  {
    const apiXml = [
      "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items><item>",
      "<jisoknm>본원</jisoknm><goodknm>김(마른김, 구운김)</goodknm><certno>제28호</certno>",
      "<reg_title_kor></reg_title_kor><reg_title_eng></reg_title_eng>",
      "<custkfirm>사단법인 무안김생산자협의회</custkfirm><kaddr></kaddr>",
      "<vdatefrom>20240905</vdatefrom><vdateto>29991231</vdateto>",
      "</item></items></body></response>",
    ].join("");
    const catalogHtml = [
      "<p>총 1건 검색되었습니다.</p><table class=\"board-list-table\">",
      "<thead><tr><th>품종</th><th>등록명칭</th><th>등록번호</th></tr></thead><tbody>",
      "<tr><td rowspan=\"2\">본원</td><td>김(마른김, 구운김)</td><td>무안돌김</td>",
      "<td>사단법인 무안김생산자협의회</td><td>010****</td><td rowspan=\"2\">2024-09-05</td></tr>",
      "<tr><td>제28호</td><td>Muan Dolgim(Laver)</td><td colspan=\"2\">전라남도 무안군 해제면 만송로 838-17</td></tr>",
      "</tbody></table>",
    ].join("");
    const parsedCatalog = parseNfqsGeoCatalogPage(catalogHtml);
    assert.strictEqual(parsedCatalog.items.length, 1);
    assert.strictEqual(parsedCatalog.items[0].registeredName, "무안돌김");
    assert.strictEqual(parsedCatalog.items[0].organizationAddress, "전라남도 무안군 해제면 만송로 838-17");

    const requested = [];
    const client = createNfqsGeoClient({
      certKey: "geo-test-key",
      fetchImpl: async (url, options = {}) => {
        requested.push({ url: String(url), options });
        if (String(url).includes("geocert_api.do")) {
          return { ok: true, status: 200, text: async () => apiXml, headers: { getSetCookie: () => [] } };
        }
        return { ok: true, status: 200, text: async () => catalogHtml, headers: { getSetCookie: () => ["JSESSIONID=test; Path=/"] } };
      },
    });
    const registrations = await client.listRegistrations();
    assert.strictEqual(registrations.length, 1);
    assert.strictEqual(registrations[0].registeredName, "무안돌김");
    assert.strictEqual(registrations[0].catalogEnriched, true);
    assert.strictEqual(new URL(requested[0].url).searchParams.get("cert_key"), "geo-test-key");

    const normalized = fromNfqsGeographicalIndications(registrations, loadAdminCodes());
    assert.strictEqual(normalized.rows[0].sigungu, "무안군");
    assert.strictEqual(normalized.rows[0].rawItemName, "무안돌김");
    assert.strictEqual(normalized.rows[0].sourceScope, "regional_geographical_indication");

    const subregion = fromNfqsGeographicalIndications([{
      ...registrations[0],
      registeredName: "진동미더덕",
      organizationAddress: "경상남도 창원시 마산합포구 진동면 해양관광로 12",
    }], loadAdminCodes());
    assert.strictEqual(subregion.rows[0].sourceScope, "regional_geographical_indication");
    assert.match(subregion.rows[0].sigungu, /창원|마산/);

    const review = fromNfqsGeographicalIndications([{
      ...registrations[0],
      registeredName: "여자만새고막",
      organizationAddress: "전라남도 여수시 율촌면 두언길 21",
    }], loadAdminCodes());
    assert.strictEqual(review.rows[0].sido, "");
    assert.strictEqual(review.rows[0].sourceScope, "geographical_indication_region_review");
    ok("빈 API 등록명칭·주소를 공식 등록번호로 보강하고 명칭-행정구역 교차 확인 건만 지역 귀속");
  }

  console.log("7-2b) nfqsClient — API 결과코드 오류 감지");
  {
    const client = createNfqsClient({
      certKey: "bad-key",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "<response><header><resultCode>99</resultCode><resultMsg>알 수 없는 오류</resultMsg></header></response>",
      }),
    });
    await assert.rejects(() => client.listCertifications(), /\[99\] 알 수 없는 오류/);
    ok("HTTP 200이어도 resultCode가 00이 아니면 실패 처리됨");
  }

  console.log("8) collectSpecialties CLI — 모든 소스 실패 시 non-zero 종료");
  {
    const outPath = path.join(os.tmpdir(), `specialties_empty_${Date.now()}.csv`);
    const dbPath = outPath.replace(/\.csv$/, ".sqlite");
    const scriptPath = path.join(__dirname, "collectSpecialties.js");
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--sources", "unknown", "--out", outPath],
      { encoding: "utf8" }
    );
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /모두 실패/);
    assert.strictEqual(fs.existsSync(outPath), false);

    const allowed = spawnSync(
      process.execPath,
      [scriptPath, "--sources", "unknown", "--allow-empty", "--out", outPath],
      { encoding: "utf8" }
    );
    try {
      assert.strictEqual(allowed.status, 0);
      assert.match(
        fs.readFileSync(outPath, "utf8"),
        /sido,sigungu,rawItemName,source,sourceId,sourceContractVersion,sourceUrl,sourceLastVerifiedAt,collectedAt/
      );
      const auditStore = createCollectionStore(dbPath);
      try {
        assert.deepStrictEqual(auditStore.counts(), { runs: 2, records: 0, versions: 0 });
        assert.strictEqual(auditStore.getRun(1).status, "failed");
        assert.strictEqual(auditStore.getRun(2).status, "empty_allowed");
      } finally {
        auditStore.close();
      }
    } finally {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
    ok("기본은 종료 코드 1, --allow-empty를 명시한 경우에만 빈 CSV를 허용함");
  }

  console.log("9) sourceRegistry — 수집 URL·인증·트래픽 정책 중앙 관리");
  {
    const registry = loadSourceRegistry();
    const gi = getSourceDefinition("gi", registry);
    const nongsaro = getSourceDefinition("nongsaro", registry);
    const areaBrand = getSourceDefinition("nongsaro_area_brand", registry);
    const ipRegistry = getSourceDefinition("ip_registry", registry);
    assert.strictEqual(gi.authentication.keyEnv, "GI_API_KEY");
    assert.strictEqual(gi.authentication.defaultBaseUrl, GI_BASE_URL);
    assert.strictEqual(gi.quota.type, "provider_documented_unlimited");
    assert.ok(gi.catalogUrl.startsWith("https://www.data.go.kr/"));
    assert.strictEqual(gi.implementation.status, "live_key_validated");
    assert.strictEqual(gi.dataVersion, "provider-live-api");
    assert.strictEqual(gi.lastVerifiedAt, "2026-08-10");
    assert.deepStrictEqual(nongsaro.formats, ["XML"]);
    assert.strictEqual(nongsaro.implementation.status, "live_key_validated");
    assert.strictEqual(areaBrand.role, "trademark_validation_reference");
    assert.strictEqual(areaBrand.authentication.keyEnv, "NONGSARO_LOCAL_BRAND_API_KEY");
    assert.strictEqual(areaBrand.dataVersion, "nongsaro-area-brand-v1");
    assert.strictEqual(areaBrand.lastVerifiedAt, "2026-08-10");
    assert.strictEqual(areaBrand.implementation.status, "sample_join_live_validated");
    assert.strictEqual(ipRegistry.authentication.keyEnv, "IP_REGISTRY_API_KEY");
    assert.strictEqual(ipRegistry.dataVersion, "ip-registry-mark-history-v1");
    assert.strictEqual(ipRegistry.implementation.status, "sample_enrichment_live_validated");
    ok("소스별 공식 URL·환경변수·포맷·할당량 확인 상태를 레지스트리에서 조회 가능");
  }

  console.log("10) collectionStore — 실행 이력·원문 멱등 저장·변경 버전");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-collection-store-"));
    const dbPath = path.join(tempDir, "specialties.sqlite");
    const store = createCollectionStore(dbPath);
    try {
      const entry = {
        registrationNumber: "2012-40",
        registrationDate: "20130207",
        registeredName: "안성배",
        raw: { REGIST_REQST_PBLANC_NO: "2012-40", GGRPH_INDICT_KOREAN_NM: "안성배" },
      };
      const normalized = {
        sido: "경기도",
        sigungu: "안성시",
        rawItemName: "안성배",
        source: "지리적표시",
        collectedAt: "2026-08-10T00:00:00.000Z",
      };
      assert.strictEqual(sourceRecordKey("gi", entry), "gi:2012-40|20130207");
      assert.strictEqual(
        sourceRecordKey("nongsaro", {
          title: "안동사과",
          raw: { areaCode: "4717000000", linkUrl: "https://example.test/1" },
        }),
        "nongsaro:4717000000|https://example.test/1"
      );

      const records = makeStoredRecords("gi", [entry], [normalized]);
      const run1 = store.startRun({ sources: ["gi"], queryScope: { dates: ["20130207"] } });
      const inserted = store.persistRecords(run1, records);
      store.finishRun(run1, {
        status: "success",
        requestCount: 1,
        succeededSourceCount: 1,
        rowCount: 1,
        stored: inserted,
      });
      assert.deepStrictEqual(inserted, { inserted: 1, updated: 0, unchanged: 0 });

      const run2 = store.startRun({ sources: ["gi"], queryScope: { dates: ["20130207"] } });
      const sameRecordNewTime = makeStoredRecords(
        "gi",
        [entry],
        [{ ...normalized, collectedAt: "2026-08-11T00:00:00.000Z" }]
      );
      const unchanged = store.persistRecords(run2, sameRecordNewTime);
      store.finishRun(run2, {
        status: "success",
        requestCount: 1,
        succeededSourceCount: 1,
        rowCount: 1,
        stored: unchanged,
      });
      assert.deepStrictEqual(unchanged, { inserted: 0, updated: 0, unchanged: 1 });

      const changedEntry = {
        ...entry,
        raw: { ...entry.raw, GGRPH_INDICT_SFE: "당도가 높음" },
      };
      const run3 = store.startRun({ sources: ["gi"], queryScope: { dates: ["20130207"] } });
      const updated = store.persistRecords(
        run3,
        makeStoredRecords("gi", [changedEntry], [{ ...normalized, collectedAt: "2026-08-12T00:00:00.000Z" }])
      );
      store.finishRun(run3, {
        status: "partial",
        requestCount: 2,
        succeededSourceCount: 1,
        failedSourceCount: 1,
        rowCount: 1,
        stored: updated,
        warnings: ["테스트 경고"],
      });
      assert.deepStrictEqual(updated, { inserted: 0, updated: 1, unchanged: 0 });
      assert.deepStrictEqual(store.counts(), { runs: 3, records: 1, versions: 2 });
      const storedRun = store.getRun(run3);
      assert.strictEqual(storedRun.status, "partial");
      assert.strictEqual(storedRun.request_count, 2);
      assert.strictEqual(storedRun.warning_count, 1);
      ok("같은 원본 재실행은 중복 없이 last_seen만 갱신하고, 내용 변경만 append-only 버전으로 보존");

      // 회귀 테스트: 내용이 과거 버전(run1)과 정확히 같은 값으로 되돌아가면 새 버전을 또
      // 만들지 않고 그 버전 번호를 재사용해야 한다. 이전에는 UNIQUE(raw_record_id,
      // payload_hash) 제약을 어겨 전체 실행이 실패했다.
      const run4 = store.startRun({ sources: ["gi"], queryScope: { dates: ["20130207"] } });
      const reverted = store.persistRecords(
        run4,
        makeStoredRecords("gi", [entry], [{ ...normalized, collectedAt: "2026-08-13T00:00:00.000Z" }])
      );
      store.finishRun(run4, {
        status: "success",
        requestCount: 1,
        succeededSourceCount: 1,
        rowCount: 1,
        stored: reverted,
      });
      assert.deepStrictEqual(reverted, { inserted: 0, updated: 1, unchanged: 0 });
      assert.deepStrictEqual(
        store.counts(),
        { runs: 4, records: 1, versions: 2 },
        "버전 수가 그대로 2여야 함 — run1과 동일한 내용이라 새 버전(3)을 만들지 않고 버전 1을 재사용"
      );
      ok("과거 버전과 동일한 내용으로 되돌아가도 UNIQUE 제약 위반 없이 그 버전 번호를 재사용함");
    } finally {
      store.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("\n16) 농촌진흥청 지역특화작목 69개 공식 수집원");
  {
    const collected = collectRegionalSpecialtyCrops();
    assert.strictEqual(collected.rows.length, 69);
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(collected.document.counts).filter(([key]) => key !== "total")),
      { 대표작목: 9, 집중육성작목: 18, 자체육성작목: 42 }
    );
    assert.ok(collected.rows.some((row) => row.sido === "경기도" && row.rawItemName === "선인장·다육식물"));
    assert.ok(collected.rows.some((row) => row.sido === "제주특별자치도" && row.rawItemName === "키위"));
    assert.ok(collected.rows.every((row) => row.sigungu === "" && row.sourceScope === "province_policy_specialty"));
    ok("69개 전량과 도 단위 정책 범위를 보존");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
