"use strict";
/**
 * 품목별 전국 상표 흐름 분석(lib/nationwideFlow.js) 자체 검증. 네트워크·API 키 없이
 * 분류 규칙과 집계 로직만 검증한다(이슈 #116/#74/#110).
 */

const assert = require("assert");
const {
  classifyHitStage,
  aggregateHits,
  topApplicantsByStage,
  stageExamples,
  stageClassDistribution,
  stageTopRegions,
  collectNationwideHits,
  resolveApplicantRegion,
  deriveAgriCoreItems,
  isProducerLikeApplicant,
  rawSignalConfidence,
} = require("./lib/nationwideFlow");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function hit({ title, classificationCode, applicant = "출원인", applicationNumber = "4020200000001" }) {
  return { title, classificationCode, applicant, applicationNumber };
}

async function runNationwideFlowTests() {
  console.log("1) classifyHitStage — 서비스류는 원물/가공품 판정 없이 바로 서비스로 분류");
  {
    assert.strictEqual(classifyHitStage(hit({ title: "인삼 축제", classificationCode: "41" }), "인삼"), "service");
    assert.strictEqual(classifyHitStage(hit({ title: "인삼 식당", classificationCode: "43" }), "인삼"), "service");
    ok("35·39·41·43·44·45류는 원물류(29-31) 판정과 무관하게 서비스로 분류");
  }

  console.log("2) classifyHitStage — 원물류(29-31) 안에서 가공 지표 단어로 가공품 판정");
  {
    assert.strictEqual(classifyHitStage(hit({ title: "인삼 생막걸리", classificationCode: "33" }), "인삼"), "processed");
    assert.strictEqual(classifyHitStage(hit({ title: "인삼분말 건강식품", classificationCode: "30" }), "인삼"), "processed");
    assert.strictEqual(classifyHitStage(hit({ title: "인삼 GINSENG", classificationCode: "31" }), "인삼"), "raw");
    ok("가공 지표 단어(막걸리·분말 등)가 있으면 가공품, 없으면 원물");
  }

  console.log("2b) classifyHitStage — \"미가공\"·\"무가공\"은 부정 표현이라 가공품으로 오판정하면 안 됨(#74 실측)");
  {
    assert.strictEqual(classifyHitStage(hit({ title: "미가공 감자", classificationCode: "29" }), "감자"), "raw");
    assert.strictEqual(classifyHitStage(hit({ title: "무가공 옥수수", classificationCode: "29" }), "옥수수"), "raw");
    assert.strictEqual(classifyHitStage(hit({ title: "미가공 감자로 만든 잼", classificationCode: "29" }), "감자"), "processed");
    ok("\"가공\"을 담고 있어도 부정형(미가공/무가공)이면 원물, 뒤에 실제 가공 지표가 더 있으면 가공품");
  }

  console.log("3) classifyHitStage — 1글자 접미어는 품목명 바로 옆에 합성어로 붙을 때만 인정");
  {
    // "청정" 안의 "청"이 오탐(false positive)으로 잡히면 안 된다 — 품목명+음절 인접 매칭만 허용.
    assert.strictEqual(classifyHitStage(hit({ title: "청정자연 인삼", classificationCode: "29" }), "인삼"), "raw");
    assert.strictEqual(classifyHitStage(hit({ title: "인삼차 세트", classificationCode: "30" }), "인삼"), "processed");
    ok("무관한 단어 속 1글자 우연 일치(청정)는 무시하고, 실제 합성어(인삼차)만 가공품으로 인정");
  }

  console.log("4) classifyHitStage — 원물류·서비스류 어디에도 안 걸리면 제외(동음이의어 노이즈)");
  {
    assert.strictEqual(classifyHitStage(hit({ title: "사과 APPLE", classificationCode: "09" }), "사과"), "excluded");
    ok("전자제품(09류) 같은 무관 분야 히트는 excluded로 분리해 통계에서 뺀다");
  }

  console.log("5) classifyHitStage — craft 모드는 원물/가공품 구분 없이 제품/서비스만");
  {
    assert.strictEqual(classifyHitStage(hit({ title: "도자기 식기", classificationCode: "21" }), "도자기", "craft"), "product");
    assert.strictEqual(classifyHitStage(hit({ title: "도자기 교실", classificationCode: "41" }), "도자기", "craft"), "service");
    ok("공예품 등 농수임산물이 아닌 품목은 원물/가공품 구분을 적용하지 않는다");
  }

  console.log("6) aggregateHits — 히트 배열을 단계별로 나눔");
  {
    const hits = [
      hit({ title: "인삼 GINSENG", classificationCode: "31" }),
      hit({ title: "인삼 생막걸리", classificationCode: "33" }),
      hit({ title: "인삼 축제", classificationCode: "41" }),
      hit({ title: "사과 APPLE", classificationCode: "09" }),
    ];
    const stages = aggregateHits(hits, "인삼");
    assert.strictEqual(stages.raw.length, 1);
    assert.strictEqual(stages.processed.length, 1);
    assert.strictEqual(stages.service.length, 1);
    assert.strictEqual(stages.excluded.length, 1);
    ok("네 히트가 각각 원물·가공품·서비스·제외로 정확히 1건씩 분류됨");
  }

  console.log("7) topApplicantsByStage — 출원인별 건수 집계 후 상위 N개만");
  {
    const hits = [
      hit({ applicant: "A", applicationNumber: "1" }),
      hit({ applicant: "A", applicationNumber: "2" }),
      hit({ applicant: "B", applicationNumber: "3" }),
    ];
    const top = topApplicantsByStage(hits, 5);
    assert.strictEqual(top[0].applicant, "A");
    assert.strictEqual(top[0].count, 2);
    assert.strictEqual(top[1].applicant, "B");
    ok("출원 건수 내림차순으로 정렬되고 대표 출원번호를 보존함");
  }

  console.log("8) collectNationwideHits — 가짜 클라이언트로 페이지네이션·상한 확인");
  {
    let calls = 0;
    const fakeClient = {
      async trademarkSearch({ pageNo }) {
        calls += 1;
        if (pageNo === 1) return { totalCount: 3, hits: [hit({ title: "a", classificationCode: "31" })] };
        if (pageNo === 2) return { totalCount: 3, hits: [hit({ title: "b", classificationCode: "31" })] };
        return { totalCount: 3, hits: [] };
      },
    };
    const result = await collectNationwideHits(fakeClient, "테스트", { maxPages: 5, numOfRows: 1, maxHits: 10 });
    assert.strictEqual(result.fetchedCount, 2);
    assert.strictEqual(result.collectionStatus, "complete");
    assert.strictEqual(calls, 3); // 3페이지째 빈 결과로 종료
    ok("결과가 소진되면 complete로 멈춤");

    let calls2 = 0;
    const infiniteClient = {
      async trademarkSearch() {
        calls2 += 1;
        return { totalCount: 999999, hits: [hit({ title: "c", classificationCode: "31" })] };
      },
    };
    const bounded = await collectNationwideHits(infiniteClient, "흔한말", { maxPages: 3, numOfRows: 1, maxHits: 10 });
    assert.strictEqual(bounded.collectionStatus, "bounded");
    assert.strictEqual(bounded.stopReason, "max_pages");
    assert.strictEqual(calls2, 3);
    ok("무한정 남아있으면 maxPages에서 bounded로 멈추고 무한 호출하지 않음");
  }

  console.log("7b) stageExamples — 단계별 상표명 예시를 대표(짧은 브랜딩)·이색(확장형)으로 분리 (#116)");
  {
    const hits = [
      hit({ title: "인삼", classificationCode: "31" }),
      hit({ title: "풍기 인삼", classificationCode: "31" }),
      hit({ title: "인삼", classificationCode: "31" }), // 중복 title은 한 번만
      hit({ title: "여섯해살이 산양삼 프리미엄 인삼 에디션", classificationCode: "31" }),
      hit({ title: "", classificationCode: "31" }), // 빈 title은 제외
    ];
    const examples = stageExamples(hits, "인삼", 2);
    assert.deepStrictEqual(examples.representative, ["인삼", "풍기 인삼"]);
    assert.ok(examples.unusual.includes("여섯해살이 산양삼 프리미엄 인삼 에디션"));
    assert.ok(!examples.unusual.includes("인삼")); // 대표에 이미 있으면 이색에서 제외
    assert.deepStrictEqual(stageExamples([], "인삼"), { representative: [], unusual: [] });
    ok("중복·빈 title 제거, coreTerm 담은 짧은 브랜딩을 대표, 나머지에서 이색");
  }
  {
    // 2026-09-04(#116): 실데이터 회귀 방지 — 한 글자·기호뿐인 상표와 슬로건형 장문은
    // 예시 후보에서 빠져야 한다("A"·"j"가 대표로, 100자 문구가 이색으로 뽑히던 문제).
    const noisy = [
      hit({ title: "A", classificationCode: "29" }),
      hit({ title: "j", classificationCode: "29" }),
      hit({ title: "!!", classificationCode: "29" }),
      hit({ title: "발효마늘", classificationCode: "29" }),
      hit({ title: "국산 쥐눈이콩으로 띄운 청국장 발효 마늘 발효 한약재 다시마로 빚은 천연식품입니다 100퍼센트 천연", classificationCode: "29" }),
      hit({ title: "마늘빵 공장", classificationCode: "29" }),
    ];
    const examples = stageExamples(noisy, "마늘", 3);
    assert.ok(!examples.representative.includes("A") && !examples.representative.includes("j") && !examples.representative.includes("!!"));
    assert.ok(examples.representative.includes("발효마늘"));
    assert.ok(examples.representative.every((title) => title.replace(/\s+/g, "").length >= 2));
    assert.ok(![...examples.representative, ...examples.unusual].some((title) => title.replace(/\s+/g, "").length > 40));
    ok("한 글자·기호 상표 제외, 40자 초과 슬로건형 제외");
  }

  console.log("7c) stageClassDistribution / stageTopRegions — 단계별 주요 상품류·상위 지역 (#119)");
  {
    const hits = [
      hit({ title: "인삼", classificationCode: "31" }),
      hit({ title: "인삼차", classificationCode: "30" }),
      hit({ title: "인삼음료", classificationCode: "30" }),
      hit({ title: "인삼", classificationCode: "31|30" }),
    ];
    const classes = stageClassDistribution(hits, 5);
    assert.strictEqual(classes[0].classCode, "30"); // 30류 3건
    assert.strictEqual(classes[0].count, 3);
    assert.ok(Math.abs(classes[0].share - 3 / 5) < 1e-9); // 전체 클래스 등장 5회 중 3
    const regions = stageTopRegions([
      { applicant: "A", count: 5, region: "충청남도 금산군" },
      { applicant: "B", count: 3, region: "강원특별자치도 홍천군" },
      { applicant: "C", count: 2, region: "충청남도 금산군" },
      { applicant: "D", count: 1, region: null },
    ], 5);
    assert.strictEqual(regions[0].region, "충청남도 금산군");
    assert.strictEqual(regions[0].count, 7);
    assert.ok(Math.abs(regions[0].share - 7 / 10) < 1e-9);
    ok("상품류는 등장 횟수, 상위 지역은 상위 출원인 count 합산·점유율로 계산");
  }

  console.log("8b) topApplicantsByStage — 출원번호가 비어있는 첫 히트가 있어도 이후 정상 값으로 채움");
  {
    const hits = [
      hit({ applicant: "A", applicationNumber: "" }),
      hit({ applicant: "A", applicationNumber: "123" }),
    ];
    const top = topApplicantsByStage(hits, 5);
    assert.strictEqual(top[0].sampleApplicationNumber, "123");
    ok("빈 출원번호를 건너뛰고 실제 값이 있는 히트로 대표 출원번호를 채움");
  }

  console.log("8c) resolveApplicantRegion — 대표 출원번호가 아예 없으면 API를 부르지 않고 unmatched");
  {
    let calls = 0;
    const fakeClient = { async getApplicants() { calls += 1; return { found: false, applicants: [] }; } };
    const region = await resolveApplicantRegion(fakeClient, null, [], () => ({ status: "matched" }), new Map());
    assert.strictEqual(region.status, "unmatched");
    assert.strictEqual(calls, 0);
    ok("출원번호가 없으면 API 오류 대신 unmatched를 즉시 반환");
  }

  console.log("9) resolveApplicantRegion — 캐시 재사용 및 주소 정규화");
  {
    let apiCalls = 0;
    const fakeApplicantClient = {
      async getApplicants() {
        apiCalls += 1;
        return { found: true, resultCode: "00", applicants: [{ address: "충청남도 금산군 금산읍 ...", nationality: "대한민국" }] };
      },
    };
    const fakeNormalize = (address) => ({ status: "matched", level: "sigungu", sido: "충청남도", sigungu: "금산군", normalizedRegion: "충청남도 금산군" });
    const cache = new Map();
    const first = await resolveApplicantRegion(fakeApplicantClient, "4020200000001", [], fakeNormalize, cache);
    assert.strictEqual(first.normalizedRegion, "충청남도 금산군");
    assert.strictEqual(apiCalls, 1);
    const second = await resolveApplicantRegion(fakeApplicantClient, "4020200000001", [], fakeNormalize, cache);
    assert.strictEqual(second.normalizedRegion, "충청남도 금산군");
    assert.strictEqual(apiCalls, 1); // 캐시 재사용 — API 재호출 없음
    ok("같은 출원번호는 캐시에서 재사용하고 API를 다시 호출하지 않음");
  }

  console.log("10) deriveAgriCoreItems — 브랜드 수식어 병합·복합 표시명 분리·비농수임산물 제외");
  {
    const snapshot = {
      regions: [
        {
          items: [
            { matchingBasis: "notice_name_and_nice_class", category: { label: "곡물" }, noticeName: "쌀" },
            { matchingBasis: "notice_name_and_nice_class", category: { label: "곡물" }, noticeName: "마춤 쌀" },
            { matchingBasis: "notice_name_and_nice_class", category: { label: "과일" }, noticeName: "신선한 배 / 사과" },
            { matchingBasis: "notice_name_and_nice_class", category: { label: "공예품" }, noticeName: "도자기" },
            { matchingBasis: "rule_unresolved", category: { label: "곡물" }, noticeName: "미확정품목" },
          ],
        },
      ],
    };
    const terms = deriveAgriCoreItems(snapshot);
    assert.ok(terms.includes("쌀"));
    assert.ok(!terms.includes("마춤 쌀")); // "쌀"로 병합됨
    assert.ok(terms.includes("배"));
    assert.ok(terms.includes("사과")); // "배 / 사과" 분리
    assert.ok(!terms.includes("도자기")); // 공예품은 농수임산물이 아니므로 제외
    assert.ok(!terms.includes("미확정품목")); // matchingBasis 미확정은 제외
    ok("브랜드 수식어 병합, 복합 표시명 분리, 공예품·미확정 품목 제외가 모두 동작함");
  }

  console.log("11) isProducerLikeApplicant/rawSignalConfidence — 176개 파일럿 실측 기반 신뢰도 필터");
  {
    assert.ok(isProducerLikeApplicant("해남고구마생산자협회"));
    assert.ok(isProducerLikeApplicant("풍기인삼협동조합"));
    assert.ok(isProducerLikeApplicant("괴산대학찰옥수수영농조합법인"));
    assert.ok(isProducerLikeApplicant("청송군"));
    assert.ok(isProducerLikeApplicant("경기도 여주시"));
    assert.ok(!isProducerLikeApplicant("주식회사농심"));
    assert.ok(!isProducerLikeApplicant("이랜드리테일"));
    assert.ok(!isProducerLikeApplicant("이석열")); // 여러 무관 품목에 걸쳐 나타난 개인 다량 출원인(#110 실측)
    assert.ok(!isProducerLikeApplicant("에취.제이.헤인즈캄파니"));
    // 2026-08-31 uncertain 재검토 확장: 지역 연계 공공 농업기관("~연구소"·"~기술센터")도 인정.
    assert.ok(isProducerLikeApplicant("고양시농업기술센터"));
    assert.ok(isProducerLikeApplicant("(재)남해마늘연구소"));
    // 단, 전국 단위 기관("~진흥원")은 주소가 실제 산지가 아닐 수 있어 여전히 제외.
    assert.ok(!isProducerLikeApplicant("한국임업진흥원"));
    ok("생산자단체·영농조합법인·협동조합·지자체 단독표기만 생산자형으로 인정, 대기업·개인·외국사는 제외");

    assert.strictEqual(rawSignalConfidence([{ applicant: "청송군" }]), "producer_confirmed");
    assert.strictEqual(rawSignalConfidence([{ applicant: "주식회사농심" }]), "uncertain");
    assert.strictEqual(rawSignalConfidence([]), "uncertain");
    assert.strictEqual(rawSignalConfidence(undefined), "uncertain");
    ok("원물 단계 1위 출원인이 생산자형일 때만 producer_confirmed, 데이터 없으면 보수적으로 uncertain");
  }

  console.log("\n모든 nationwideFlow 자체 검증 통과.");
}

if (require.main === module) {
  runNationwideFlowTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runNationwideFlowTests };
