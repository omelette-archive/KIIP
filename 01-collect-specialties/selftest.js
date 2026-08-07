#!/usr/bin/env node
"use strict";
/**
 * 실제 API 키 없이 파이프라인(법정동코드 파싱 -> 지역 매칭 -> data.go.kr 클라이언트
 * 요청/응답 처리)을 검증하는 자체 테스트. fetch를 모킹해서 네트워크 없이 돌린다.
 * 실행: node 01-collect-specialties/selftest.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parseCsvLine, loadAdminCodes } = require("./lib/adminCodes");
const { splitRegion, fromGiRegistrations, fromNongsaro } = require("./lib/normalize");
const { createClient: createDataGoKrClient } = require("./lib/dataGoKrClient");
const { getSourceDefinition, loadSourceRegistry } = require("./lib/sourceRegistry");
const { createClient: createGiClient } = require("./lib/giClient");
const {
  createClient: createNongsaroClient,
  DEFAULT_BASE_URL: NONGSARO_BASE_URL,
} = require("./lib/nongsaroClient");
const { parseNongsaroResponse } = require("./lib/xmlLite");

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

  console.log("5) dataGoKrClient.createClient — apiKey 없으면 즉시 throw");
  {
    assert.throws(() => createDataGoKrClient({}), /서비스키/);
    ok("apiKey 누락 시 첫 호출 전에 즉시 에러 발생 (kiprisClient.js/llmClient.js와 동일 패턴)");
  }

  console.log("6) dataGoKrClient.callOperation — 요청 구성 + 표준 응답 파싱");
  {
    let capturedUrl;
    const fakeFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE" },
            body: { totalCount: 2, items: { item: [{ a: 1 }, { a: 2 }] } },
          },
        }),
      };
    };
    const client = createDataGoKrClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.callOperation({
      baseUrl: "http://apis.data.go.kr/test/Service",
      operation: "getList",
      params: { pageNo: 1, numOfRows: 50 },
    });
    assert.ok(capturedUrl.includes("serviceKey=test-key"));
    assert.ok(capturedUrl.includes("type=json"));
    assert.strictEqual(result.totalCount, 2);
    assert.strictEqual(result.items.length, 2);
    ok("serviceKey/type=json 쿼리 구성 및 response.header/body 표준 포맷 파싱 정상");
  }

  console.log("7) dataGoKrClient.callOperation — item이 배열이 아니라 단일 객체인 경우");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          header: { resultCode: "00", resultMsg: "OK" },
          body: { totalCount: 1, items: { item: { a: 1 } } },
        },
      }),
    });
    const client = createDataGoKrClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.callOperation({ baseUrl: "http://x", operation: "op" });
    assert.strictEqual(result.items.length, 1);
    ok("결과가 1건이라 item이 배열이 아닌 객체로 와도 배열로 정규화됨");
  }

  console.log("8) dataGoKrClient.callOperation — resultCode가 00이 아니면 throw");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        response: { header: { resultCode: "30", resultMsg: "SERVICE_ACCESS_DENIED_ERROR" }, body: {} },
      }),
    });
    const client = createDataGoKrClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    await assert.rejects(
      () => client.callOperation({ baseUrl: "http://x", operation: "op" }),
      /SERVICE_ACCESS_DENIED_ERROR/
    );
    ok("resultCode 30(서비스 미승인 등) 응답은 에러로 던져짐");
  }

  console.log("8-1) dataGoKrClient.fetchAllPages — totalCount까지 여러 페이지 순회");
  {
    const callsByPage = [];
    const fakeFetch = async (url) => {
      const pageNo = Number(new URL(url).searchParams.get("pageNo"));
      callsByPage.push(pageNo);
      const itemsByPage = { 1: [{ id: 1 }, { id: 2 }], 2: [{ id: 3 }, { id: 4 }], 3: [{ id: 5 }] };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: { totalCount: 5, items: { item: itemsByPage[pageNo] || [] } },
          },
        }),
      };
    };
    const client = createDataGoKrClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.fetchAllPages({ baseUrl: "http://x", operation: "op", pageSize: 2 });
    assert.deepStrictEqual(callsByPage, [1, 2, 3]);
    assert.strictEqual(result.items.length, 5);
    assert.strictEqual(result.totalCount, 5);
    ok("pageSize=2, totalCount=5 -> 3페이지 순회해서 5건 전부 수집 (numOfRows:200 한 페이지만 받던 이전 버그 수정)");
  }

  console.log("9) 소스별 필수 설정 검증");
  {
    const gi = createGiClient({ apiKey: "test-key" });
    await assert.rejects(() => gi.listRegistrations(), /baseUrl/);
    assert.throws(() => createNongsaroClient({}), /인증키/);
    ok("지리적표시는 baseUrl, 농사로는 apiKey 누락 시 명확한 에러로 실패함");
  }

  console.log("9-1) dataGoKrClient.callAllPages — totalCount까지 페이지 순회");
  {
    const requestedPages = [];
    const fakeFetch = async (url) => {
      const pageNo = Number(new URL(url).searchParams.get("pageNo"));
      requestedPages.push(pageNo);
      const items = pageNo === 1 ? [{ a: 1 }, { a: 2 }] : [{ a: 3 }];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            header: { resultCode: "00", resultMsg: "OK" },
            body: { totalCount: 3, items: { item: items } },
          },
        }),
      };
    };
    const client = createDataGoKrClient({ apiKey: "test-key", fetchImpl: fakeFetch });
    const result = await client.callAllPages({
      baseUrl: "http://x",
      operation: "op",
      numOfRows: 2,
    });
    assert.deepStrictEqual(requestedPages, [1, 2]);
    assert.deepStrictEqual(result.items, [{ a: 1 }, { a: 2 }, { a: 3 }]);
    ok("한 페이지를 초과하는 목록도 totalCount까지 모두 수집됨");
  }

  console.log("10) giClient — baseUrl 지정 시 정상 매핑");
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          header: { resultCode: "00", resultMsg: "OK" },
          body: { totalCount: 1, items: { item: { registNo: "1", registName: "보성녹차", registArea: "전라남도 보성군" } } },
        },
      }),
    });
    const gi = createGiClient({ apiKey: "test-key", baseUrl: "http://apis.data.go.kr/x/GeoIndi", fetchImpl: fakeFetch });
    const rows = await gi.listRegistrations();
    assert.strictEqual(rows[0].registeredName, "보성녹차");
    assert.strictEqual(rows[0].region, "전라남도 보성군");
    ok("응답 필드를 registeredName/region 등으로 정상 매핑, raw 원본도 보존");
  }

  console.log("10-1) nongsaroClient — 공식 XML 계약 파싱 + 샘플 제한");
  {
    const requestedUrls = [];
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
    const client = createNongsaroClient({ apiKey: "test-key", baseUrl: "", fetchImpl: fakeFetch });
    const rows = await client.listSpecialties({ numOfRows: 2, limit: 3 });
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].title, "안동사과");
    assert.strictEqual(rows[2].region, "경상남도 합천군");
    assert.deepStrictEqual(requestedUrls.map((url) => Number(new URL(url).searchParams.get("pageNo"))), [1, 2]);
    assert.ok(requestedUrls[0].startsWith(`${NONGSARO_BASE_URL}/localSpcprdLst?`));
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.get("apiKey"), "test-key");
    assert.strictEqual(new URL(requestedUrls[0]).searchParams.has("serviceKey"), false);
    ok("빈 환경변수에도 공식 URL을 사용하고 apiKey/XML 계약으로 2페이지, limit=3에서 중단함");
  }

  console.log("10-2) nongsaro XML — API 결과코드 오류 감지");
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

  console.log("11) collectSpecialties CLI — 모든 소스 실패 시 non-zero 종료");
  {
    const outPath = path.join(os.tmpdir(), `specialties_empty_${Date.now()}.csv`);
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
      assert.match(fs.readFileSync(outPath, "utf8"), /sido,sigungu,rawItemName,source,collectedAt/);
    } finally {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
    ok("기본은 종료 코드 1, --allow-empty를 명시한 경우에만 빈 CSV를 허용함");
  }

  console.log("12) sourceRegistry — 수집 URL·인증·트래픽 정책 중앙 관리");
  {
    const registry = loadSourceRegistry();
    const gi = getSourceDefinition("gi", registry);
    const nongsaro = getSourceDefinition("nongsaro", registry);
    assert.strictEqual(gi.authentication.keyEnv, "GI_API_KEY");
    assert.strictEqual(gi.quota.type, "provider_policy");
    assert.ok(gi.catalogUrl.startsWith("https://www.data.go.kr/"));
    assert.deepStrictEqual(nongsaro.formats, ["XML"]);
    assert.strictEqual(nongsaro.implementation.status, "xml_sample_validated_live_key_required");
    ok("소스별 공식 URL·환경변수·포맷·할당량 확인 상태를 레지스트리에서 조회 가능");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
