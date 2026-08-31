#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { summarizeIpRegistryMatches, factHitSources } = require("./lib/ipRegistryEnricher");
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

  console.log("15-2) factHitSources — storageMode 무관하게 동일 집계");
  {
    const resultsDoc = { results: [{ hits: [hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" })] }] };
    const queryFactsDoc = {
      storageMode: "query_facts",
      results: [{ status: "ok", queryKey: "사과" }],
      queryFacts: {
        사과: { hits: [hit({ applicantRegionMatch: "inside", applicantRegionMatchSource: "kipris_trademark_applicant" })] },
      },
    };
    const a = summarizeIpRegistryMatches(factHitSources(resultsDoc));
    const b = summarizeIpRegistryMatches(factHitSources(queryFactsDoc));
    assert.deepStrictEqual(a, b, "results 저장 방식과 query_facts 저장 방식이 같은 집계를 내야 함");
    assert.strictEqual(b.inside, 1);
    ok("③ 저장 방식(results/query_facts)과 무관하게 동일한 집계 결과");
  }

  console.log("15-3) summarizeDocument — 비율 계산");
  {
    const doc = {
      results: [
        {
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
