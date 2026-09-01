#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { summarizeDocument, delta } = require("./summarizeGoodsMatchCoverage");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function hit(method, overrides = {}) {
  return { goodsMatchMethod: method, ...overrides };
}

async function runGoodsMatchCoverageTests() {
  console.log("16-1) summarizeDocument — exact만 확정, contains+class_only는 검토(#12)");
  {
    const doc = {
      results: [
        {
          hits: [
            hit("normalized_exact", { designatedGoodsEvidence: [{ classCode: "31" }] }),
            hit("normalized_exact"),
            hit("normalized_contains", { designatedGoodsEvidence: [{ classCode: "31" }] }),
            hit("class_only"),
            hit("mismatch"),
            hit("unverified"),
          ],
        },
      ],
    };
    const s = summarizeDocument(doc);
    assert.strictEqual(s.byMethod.normalized_exact, 2);
    assert.strictEqual(s.byMethod.normalized_contains, 1);
    assert.strictEqual(s.byMethod.class_only, 1);
    assert.strictEqual(s.confirmed, 2, "확정은 normalized_exact만");
    assert.strictEqual(s.review, 2, "검토 후보는 contains + class_only");
    assert.strictEqual(s.evaluated, 5, "unverified 제외한 대조 완료 hit");
    assert.strictEqual(s.goodsReferenced, 2, "designatedGoodsEvidence가 붙은 hit");
    assert.strictEqual(s.ratios.confirmed, 0.4);
    assert.strictEqual(s.ratios.review, 0.4);
    ok("5분류 집계 + exact-only 확정/contains+class_only 검토 비율");
  }

  console.log("16-2) storageMode=query_facts에서도 동일 집계");
  {
    const results = { results: [{ hits: [hit("normalized_exact"), hit("class_only")] }] };
    const queryFacts = {
      storageMode: "query_facts",
      results: [{ status: "ok", queryKey: "사과" }],
      queryFacts: { 사과: { hits: [hit("normalized_exact"), hit("class_only")] } },
    };
    assert.deepStrictEqual(summarizeDocument(results), summarizeDocument(queryFacts));
    ok("results/query_facts 저장 방식과 무관하게 동일 결과");
  }

  console.log("16-3) delta — 등록원부 보강 전후 분포 변화(#12 완료 조건)");
  {
    const before = summarizeDocument({ results: [{ hits: [hit("unverified"), hit("class_only")] }] });
    const after = summarizeDocument({ results: [{ hits: [hit("normalized_exact"), hit("class_only")] }] });
    const d = delta(before, after);
    assert.strictEqual(d.confirmed, 1, "보강으로 exact 1건 새로 확정");
    assert.strictEqual(d.byMethod.unverified, -1);
    assert.strictEqual(d.evaluated, 1);
    ok("전후 확정·검토·미대조 건수 변화를 자동 계산");
  }

  console.log("16-4) 빈 입력 — 0으로 나누지 않고 null 비율");
  {
    const s = summarizeDocument({ results: [] });
    assert.strictEqual(s.evaluated, 0);
    assert.strictEqual(s.ratios.confirmed, null);
    ok("evaluated가 0이면 비율은 null");
  }
}

if (require.main === module) {
  runGoodsMatchCoverageTests()
    .then(() => console.log("\n지정상품 대조 커버리지 집계 자체 테스트 통과"))
    .catch((error) => {
      console.error(`지정상품 대조 커버리지 집계 자체 테스트 실패: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runGoodsMatchCoverageTests };
