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
const { splitRegion, fromGiRegistrations, fromNongsaro } = require("./lib/normalize");
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
const {
  createCollectionStore,
  makeStoredRecords,
  sourceRecordKey,
} = require("./lib/collectionStore");

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
      assert.match(fs.readFileSync(outPath, "utf8"), /sido,sigungu,rawItemName,source,collectedAt/);
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
    assert.strictEqual(gi.authentication.keyEnv, "GI_API_KEY");
    assert.strictEqual(gi.authentication.defaultBaseUrl, GI_BASE_URL);
    assert.strictEqual(gi.quota.type, "provider_documented_unlimited");
    assert.ok(gi.catalogUrl.startsWith("https://www.data.go.kr/"));
    assert.strictEqual(gi.implementation.status, "live_key_validated");
    assert.deepStrictEqual(nongsaro.formats, ["XML"]);
    assert.strictEqual(nongsaro.implementation.status, "live_key_validated");
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
    } finally {
      store.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
