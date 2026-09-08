"use strict";
/**
 * lib/bibliographyGoodsEnricher.js 자체 검증. 네트워크·API 키 없이 가짜 클라이언트로 검증한다.
 */
const assert = require("node:assert");
const {
  isAlreadyConfirmedByRegistry,
  isRegistryUnreachable,
  isAccessDeniedError,
  collectCandidates,
  applyBibliographyGoods,
  enrichDocument,
} = require("./lib/bibliographyGoodsEnricher");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function hit(overrides = {}) {
  return { title: "블루베리팜", applicationNumber: "4020240000001", registrationNumber: "", ...overrides };
}

function docOf(queryFacts) {
  return { schemaVersion: "1.3", storageMode: "query_facts", queryFacts };
}

async function runBibliographyGoodsTests() {
  console.log("1) isAlreadyConfirmedByRegistry / isRegistryUnreachable");
  {
    assert.strictEqual(isAlreadyConfirmedByRegistry({ goodsMatchMethod: "normalized_exact" }), true);
    assert.strictEqual(isAlreadyConfirmedByRegistry({ goodsMatchMethod: "normalized_exact", goodsSource: "bibliography" }), false, "서지상세로 확정된 건 재대상(등록원부 authoritative 아님)");
    assert.strictEqual(isAlreadyConfirmedByRegistry({ goodsMatchMethod: "class_only" }), false);
    assert.strictEqual(isRegistryUnreachable({ registrationNumber: "" }), true);
    assert.strictEqual(isRegistryUnreachable({ registrationNumber: "4012345670000" }), false);
    ok("등록원부 확정(등록원부 출처만) 제외, 등록번호 없으면 도달불가로 분류");
  }

  console.log("2) isAccessDeniedError — KiprisApiError의 SERVICE_ACCESS_DENIED만 인식");
  {
    assert.strictEqual(isAccessDeniedError({ code: "SERVICE_ACCESS_DENIED" }), true);
    assert.strictEqual(isAccessDeniedError({ code: "INVALID_PARAMETER" }), false);
    assert.strictEqual(isAccessDeniedError(null), false);
    ok("SERVICE_ACCESS_DENIED만 회로차단 신호로 인식");
  }

  console.log("3) collectCandidates — 등록원부 도달불가(pending) 먼저, 확정건 제외, 출원번호 없으면 제외");
  {
    const doc = docOf({
      q1: {
        query: { item: "블루베리", classCode: "31" },
        hits: [
          hit({ applicationNumber: "1", registrationNumber: "4010000000000", goodsMatchMethod: "normalized_exact" }), // 제외: 등록원부 확정
          hit({ applicationNumber: "2", registrationNumber: "" }), // pending
          hit({ applicationNumber: "", registrationNumber: "" }), // 제외: 출원번호 없음
          hit({ applicationNumber: "3", registrationNumber: "4010000000001", goodsMatchMethod: "class_only" }), // 등록됐지만 미확정
        ],
      },
    });
    const candidates = collectCandidates(doc);
    assert.strictEqual(candidates.length, 2);
    assert.strictEqual(candidates[0].hit.applicationNumber, "2", "등록원부 도달불가(pending)가 먼저");
    assert.strictEqual(candidates[0].pending, true);
    assert.strictEqual(candidates[1].hit.applicationNumber, "3");
    assert.strictEqual(candidates[1].pending, false);
    ok("우선순위·제외 규칙대로 후보 선별");
  }

  console.log("4) applyBibliographyGoods — evaluateGoods 재사용(query는 fact 레벨에서 별도 전달), goodsSource=bibliography");
  {
    const noQuery = applyBibliographyGoods(
      hit(),
      undefined,
      [{ classCode: "31", name: "신선한 블루베리", subCode: "G0211" }],
      "2026-09-08T00:00:00.000Z"
    );
    assert.strictEqual(noQuery.goodsSource, "bibliography");
    assert.strictEqual(noQuery.goodsMatchVersion, "bibliography-designated-goods-v1");
    assert.notStrictEqual(noQuery.goodsMatchMethod, "normalized_exact", "query 없으면 확정 안 됨(안전한 기본값)");

    const withQuery = applyBibliographyGoods(
      hit(),
      { item: "신선한 블루베리", classCode: "31" },
      [{ classCode: "31", name: "신선한 블루베리", subCode: "G0211" }],
      "2026-09-08T00:00:00.000Z"
    );
    assert.strictEqual(withQuery.goodsMatchMethod, "normalized_exact");
    assert.strictEqual(withQuery.goodsSource, "bibliography");
    ok("지정상품과 query.item이 정규화 일치하면 normalized_exact로 확정, 출처 표시");
  }

  console.log("5) enrichDocument — 출원번호 dedupe, 캐시 재사용, limit 적용, 결과를 원위치에 반영");
  {
    const calls = [];
    const fakeClient = {
      async designatedGoods(appNo) {
        calls.push(appNo);
        if (appNo === "2") return { found: true, resultCode: "00", designatedGoods: [{ classCode: "31", name: "신선한 블루베리" }] };
        return { found: true, resultCode: "00", designatedGoods: [{ classCode: "35", name: "블루베리 도매업" }] };
      },
    };
    const doc = docOf({
      q1: {
        query: { item: "신선한 블루베리", classCode: "31" },
        hits: [hit({ applicationNumber: "2", registrationNumber: "" }), hit({ applicationNumber: "2", registrationNumber: "" })], // 같은 출원번호 중복
      },
      q2: {
        query: { item: "신선한 블루베리", classCode: "31" },
        hits: [hit({ applicationNumber: "9", registrationNumber: "4010000000002", goodsMatchMethod: "class_only" })],
      },
    });
    const cache = new Map();
    const { document, summary } = await enrichDocument(doc, fakeClient, { limit: 10, concurrency: 2, goodsCache: cache });
    assert.deepStrictEqual([...calls].sort(), ["2", "9"], "같은 출원번호는 API를 한 번만 호출");
    assert.strictEqual(document.queryFacts.q1.hits[0].goodsMatchMethod, "normalized_exact");
    assert.strictEqual(document.queryFacts.q1.hits[1].goodsMatchMethod, "normalized_exact", "중복 hit 둘 다 결과 반영");
    assert.strictEqual(document.queryFacts.q2.hits[0].goodsMatchMethod, "mismatch", "다른 상품류(35류 도매업)만 있으면 mismatch");
    assert.strictEqual(summary.uniqueApplicationCount, 2);
    assert.strictEqual(summary.appliedExactCount, 2);
    assert.strictEqual(cache.has("2") && cache.has("9"), true, "캐시에 저장됨");

    // 캐시 재사용: 같은 문서를 다시 돌리면 API를 다시 안 부름
    calls.length = 0;
    const doc2 = docOf({ q1: { query: { item: "신선한 블루베리", classCode: "31" }, hits: [hit({ applicationNumber: "2", registrationNumber: "" })] } });
    await enrichDocument(doc2, fakeClient, { limit: 10, goodsCache: cache });
    assert.strictEqual(calls.length, 0, "캐시 히트는 API를 다시 안 부름");
    ok("출원번호 dedupe·중복 hit 반영·캐시 재사용 확인");
  }

  console.log("6) enrichDocument — SERVICE_ACCESS_DENIED면 회로 차단(0건 완료로 안 삼킴)");
  {
    const deniedError = new Error("서비스 접근 거부");
    deniedError.code = "SERVICE_ACCESS_DENIED";
    let calls = 0;
    const fakeClient = { async designatedGoods() { calls++; throw deniedError; } };
    const doc = docOf({
      q1: { query: { item: "블루베리" }, hits: [hit({ applicationNumber: "1", registrationNumber: "" }), hit({ applicationNumber: "2", registrationNumber: "" })] },
    });
    let denied = null;
    const { summary } = await enrichDocument(doc, fakeClient, { limit: 10, concurrency: 1, onAccessDenied: (e) => { denied = e; } });
    assert.strictEqual(summary.accessDeniedDetected, true);
    assert.ok(denied, "onAccessDenied 훅 호출됨");
    assert.strictEqual(calls, 1, "접근거부 감지 즉시 후속 호출 중단(전부 재시도하며 소진 안 함)");
    ok("접근 거부는 회로 차단, '결과 없음'으로 위장 안 함");
  }

  console.log("\n모든 bibliographyGoodsEnricher 자체 검증 통과.");
}

if (require.main === module) {
  runBibliographyGoodsTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runBibliographyGoodsTests };
