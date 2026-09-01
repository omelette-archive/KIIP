#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  summarizeIpRegistryMatches,
  regionEvaluatedHitSources,
} = require("./lib/ipRegistryEnricher");
const { summarizeDocument, delta } = require("./summarizeRegionMatchCoverage");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function hit(overrides = {}) {
  return {
    applicantRegionMatch: undefined,
    applicantRegionMatchSource: undefined,
    applicantRegionMatchConfidence: undefined,
    ...overrides,
  };
}

async function runRegionMatchCoverageTests() {
  console.log("15-1) summarizeIpRegistryMatches — 경로 A·B 모두 카운트(#73)");
  {
    const results = [
      {
        hits: [
          hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "ip_registry_applicant_address" }),
          hit({ applicantRegionMatch: "outside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
          hit({
            applicantRegionMatch: "unverified",
            applicantRegionMatchSource: "kipris_trademark_applicant",
            applicantRegionMatchConfidence: "no_applicant_address",
          }),
          hit(), // 아직 지역 판정을 시도하지 않은 hit(applicantRegionMatch 없음) — referenced에서 제외
        ],
      },
    ];
    const counts = summarizeIpRegistryMatches(results);
    assert.strictEqual(counts.referenced, 3, "applicantRegionMatch가 있는 hit만 referenced로 셈(경로 무관)");
    assert.strictEqual(counts.inside, 1);
    assert.strictEqual(counts.outside, 1);
    assert.strictEqual(counts.unverified, 1);
    assert.deepStrictEqual(counts.bySource, {
      ip_registry_applicant_address: 1,
      kipris_trademark_applicant: 2,
      unknown: 0,
    });
    assert.deepStrictEqual(counts.unverifiedByReason, { no_applicant_address: 1 });
    ok("경로 A(kipris_trademark_applicant)·경로 B(ip_registry_applicant_address) 모두 세고, 미확인 사유별로도 분리함");
  }

  console.log("15-2) regionEvaluatedHitSources — 주소 근거 없는 hit은 저장 방식 무관하게 그대로");
  {
    // applicantRegionEvidence가 없는(=주소 없음, 지역 무관 unverified) hit은 재판정하지
    // 않고 저장값을 그대로 쓴다. expanded와 query_facts가 같은 결과를 내야 한다.
    const resultsDoc = {
      results: [
        { query: { region: "경상북도 안동시" }, hits: [hit({ applicantRegionMatch: "unverified", applicantRegionMatchSource: "kipris_trademark_applicant" })] },
      ],
    };
    const queryFactsDoc = {
      storageMode: "query_facts",
      results: [{ status: "ok", queryKey: "사과", query: { region: "경상북도 안동시" } }],
      queryFacts: {
        사과: { hits: [hit({ applicantRegionMatch: "unverified", applicantRegionMatchSource: "kipris_trademark_applicant" })] },
      },
    };
    const a = summarizeIpRegistryMatches(regionEvaluatedHitSources(resultsDoc));
    const b = summarizeIpRegistryMatches(regionEvaluatedHitSources(queryFactsDoc));
    assert.deepStrictEqual(a, b, "results 저장 방식과 query_facts 저장 방식이 같은 집계를 내야 함");
    assert.strictEqual(b.unverified, 1);
    assert.strictEqual(b.referenced, 1);
    ok("주소 근거 없는 hit은 재판정 없이 저장값 유지, 저장 방식 무관하게 동일");
  }

  console.log("15-6) query_facts — 같은 queryKey가 두 지역에서 재사용되면 지역별로 다시 판정");
  {
    // 출원인이 '경상북도 안동시'에 있는 hit 하나가, 같은 검색어를 쓴 두 지역행(안동/영월)
    // 아래에서 각각 inside / outside로 잡혀야 한다. compactBatchOutput은 queryFact의
    // region을 null로 지우므로 저장된 applicantRegionMatch만 보면 둘 다 unverified가 된다.
    const andongApplicant = { regionStatus: "matched", sido: "경상북도", sigungu: "안동시", regionLevel: "sigungu" };
    const doc = {
      storageMode: "query_facts",
      results: [
        { queryKey: "감fallback", query: { region: "경상북도 안동시" } },
        { queryKey: "감fallback", query: { region: "강원도 영월군" } },
      ],
      queryFacts: {
        "감fallback": {
          query: { region: null, regionMatch: "not_applicable" },
          hits: [
            hit({
              applicantRegionMatch: "unverified", // 빈 지역 기준 저장값
              applicantRegionMatchSource: "kipris_trademark_applicant",
              applicantRegionEvidence: [andongApplicant],
            }),
          ],
        },
      },
    };
    const counts = summarizeIpRegistryMatches(regionEvaluatedHitSources(doc));
    assert.strictEqual(counts.referenced, 2, "hit 1건 × 지역행 2개 = 2");
    assert.strictEqual(counts.inside, 1, "안동시 행에서는 inside");
    assert.strictEqual(counts.outside, 1, "영월군 행에서는 outside(시도 불일치)");
    assert.strictEqual(counts.unverified, 0, "빈 지역 저장값이 아니라 실제 지역으로 재판정");
    ok("같은 queryKey를 여러 지역에서 재사용해도 지역별로 관계를 다시 계산");
  }

  console.log("15-7) 전국 카탈로그 행(entry.query.region 없음)은 지역 집계 모집단에서 제외");
  {
    const doc = {
      storageMode: "query_facts",
      results: [
        { queryKey: "감fallback", query: { region: "부산광역시 사하구" } },
        { queryKey: "감fallback", query: { region: null, classCodeFallbackApplied: true } }, // 전국 카탈로그
      ],
      queryFacts: {
        감fallback: {
          query: { region: null },
          hits: Array.from({ length: 5 }, () =>
            hit({
              applicantRegionMatch: "unverified",
              applicantRegionMatchSource: "kipris_trademark_applicant",
              applicantRegionEvidence: [],
            })
          ),
        },
      },
    };
    const counts = summarizeIpRegistryMatches(regionEvaluatedHitSources(doc));
    assert.strictEqual(counts.referenced, 5, "지역행 1개의 hit 5건만 셈(전국행 hit 5건은 제외)");
    // expanded 저장 방식에서도 지역 없는 행은 동일하게 걸러진다
    const expanded = {
      results: [
        { query: { region: "부산광역시 사하구" }, hits: [hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" })] },
        { query: { region: null }, hits: [hit({ applicantRegionMatch: "unverified", applicantRegionMatchSource: "kipris_trademark_applicant" })] },
      ],
    };
    assert.strictEqual(summarizeIpRegistryMatches(regionEvaluatedHitSources(expanded)).referenced, 1);
    ok("region 없는 행의 hit은 query_facts·expanded 모두에서 집계되지 않음");
  }

  console.log("15-3) summarizeDocument — 비율 계산");
  {
    const doc = {
      results: [
        {
          query: { region: "경상북도 안동시" },
          hits: [
            hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
            hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
            hit({ applicantRegionMatch: "outside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
            hit({ applicantRegionMatch: "unverified", applicantRegionMatchSource: "kipris_trademark_applicant" }),
          ],
        },
      ],
    };
    const summary = summarizeDocument(doc);
    assert.strictEqual(summary.referenced, 4);
    assert.strictEqual(summary.ratios.inside, 0.5);
    assert.strictEqual(summary.ratios.outside, 0.25);
    assert.strictEqual(summary.ratios.unverified, 0.25);
    ok("referenced 대비 inside/outside/unverified 비율을 정확히 계산");
  }

  console.log("15-4) delta — 전후 비교(완료 조건: ③ 전후 비율 자동 집계)");
  {
    const before = summarizeDocument({
      results: [
        {
          query: { region: "경상북도 안동시" },
          hits: [
            hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
            hit({ applicantRegionMatch: "unverified", applicantRegionMatchSource: "kipris_trademark_applicant" }),
          ],
        },
      ],
    });
    const after = summarizeDocument({
      results: [
        {
          query: { region: "경상북도 안동시" },
          hits: [
            hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
            hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" }),
          ],
        },
      ],
    });
    const d = delta(before, after);
    assert.strictEqual(d.inside, 1, "재조회로 unverified 1건이 inside로 개선됨");
    assert.strictEqual(d.unverified, -1);
    assert.strictEqual(d.ratios.unverified, -0.5, "unverified 비율이 50%p 감소");
    ok("재검증 전후 건수·비율 변화를 자동으로 계산");
  }

  console.log("15-5) 빈 입력 — 0으로 나누지 않고 null 반환");
  {
    const summary = summarizeDocument({ results: [] });
    assert.strictEqual(summary.referenced, 0);
    assert.strictEqual(summary.ratios.inside, null);
    ok("referenced가 0이면 비율은 null(0/0 방지)");
  }
}

if (require.main === module) {
  runRegionMatchCoverageTests()
    .then(() => console.log("\n지역 매칭 커버리지 집계 자체 테스트 통과"))
    .catch((error) => {
      console.error(`지역 매칭 커버리지 집계 자체 테스트 실패: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runRegionMatchCoverageTests };
