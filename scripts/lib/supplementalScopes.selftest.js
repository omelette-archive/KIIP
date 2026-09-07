"use strict";

const assert = require("node:assert");
const { expandForestRegionalResults } = require("./supplementalScopes");
const { loadAdminCodes } = require("../../01-collect-specialties/lib/adminCodes");

function ok(message) {
  console.log(`  ok - ${message}`);
}

console.log("supplementalScopes 자체 테스트");

// 1) expandForestRegionalResults — 임산물생산조사 원자료의 통합 전 도명(전라남도)을
//    마스터가 주어지면 현재 시도명(전남광주통합특별시)으로 정규화(#이슈: 도 단위 중복 지역행)
{
  const document = {
    results: [
      {
        inputIndex: 0,
        status: "ok",
        input: { sourceId: "kofpi_forest_product", itemName: "표고" },
        query: {},
      },
    ],
  };
  const evidenceDocument = {
    items: {
      표고: [
        {
          tableNumber: "3-1",
          sido: "전라남도",
          sigungu: "장흥군",
          region: "전라남도 장흥군",
          evidenceType: "production_survey_top_region",
        },
      ],
    },
  };
  const adminList = loadAdminCodes();
  expandForestRegionalResults(document, evidenceDocument, adminList);
  assert.strictEqual(document.results.length, 1);
  assert.strictEqual(document.results[0].input.sido, "전남광주통합특별시");
  assert.strictEqual(document.results[0].input.sigungu, "장흥군");
  // query.region도 통합 도명으로 정규화돼야 ④ 분석이 같은 지역×품목을 한 버킷에 모은다.
  // (input.sido만 정규화하고 query.region은 원문이면, ④가 원문 도명으로 버킷팅한 뒤
  //  정규화된 sido로 마무리해 다른 소스 행과 중복 키가 된다 — 장흥 표고 실사례.)
  assert.strictEqual(document.results[0].query.region, "전남광주통합특별시 장흥군");
  ok("마스터가 주어지면 임산물 주산지 근거의 통합 전 도명이 현재 시도명으로 정규화됨(input·query.region 모두)");
}

// 2) 마스터 없이 호출하면 원문 도명을 그대로 보존(하위호환)
{
  const document = {
    results: [
      {
        inputIndex: 0,
        status: "ok",
        input: { sourceId: "kofpi_forest_product", itemName: "표고" },
        query: {},
      },
    ],
  };
  const evidenceDocument = {
    items: {
      표고: [
        {
          tableNumber: "3-1",
          sido: "전라남도",
          sigungu: "장흥군",
          region: "전라남도 장흥군",
          evidenceType: "production_survey_top_region",
        },
      ],
    },
  };
  expandForestRegionalResults(document, evidenceDocument);
  assert.strictEqual(document.results[0].input.sido, "전라남도");
  ok("마스터를 안 주면 원문 도명을 그대로 보존(하위호환)함");
}

console.log("모든 자체 테스트 통과");
