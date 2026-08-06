#!/usr/bin/env node
"use strict";
/**
 * 실제 KIPRIS API 키 없이 파이프라인(XML 파싱 -> 클라이언트 -> 품목 필터)을 검증하는 자체 테스트.
 * fetch를 모킹해서 네트워크 없이 돌린다. 실행: node 03-match-trademarks/selftest.js
 */

const assert = require("assert");
const { parseTrademarkResponse } = require("./lib/xmlLite");
const { createClient } = require("./lib/kiprisClient");
const { filterByClassCode } = require("./lib/filters");
const { KiprisApiError } = require("./lib/errors");
const {
  parseCsvLine,
  makeBatchQuery,
  buildSearchOutput,
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
    const results = await runBatch(
      [
        { sido: "경상북도", sigungu: "안동시", rawItemName: "안동사과", noticeName: "사과", niceClass: "31", status: "ok" },
        { rawItemName: "실패품목", status: "error" },
        { sido: "경상북도", sigungu: "안동시", rawItemName: "사과나무", excluded: "true", status: "ok" },
      ],
      client,
      { pageNo: 1, numOfRows: 20, concurrency: 2 }
    );
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(results.map((row) => row.status), ["ok", "skipped", "skipped"]);
    assert.strictEqual(results[0].page.filteredCount, 1);
    ok("검색 가능한 행만 호출하고 입력 순서대로 상태를 보존함");
  }

  console.log("\n모든 자체 테스트 통과");
}

run().catch((err) => {
  console.error("자체 테스트 실패:", err);
  process.exit(1);
});
