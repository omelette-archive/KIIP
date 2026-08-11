#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  buildDashboardSnapshot,
  createRegionIndex,
  dataState,
  resolveRegion,
  specialtyIdentity,
} = require("./lib/snapshot");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function bucket(overrides = {}) {
  return {
    sido: "경상북도",
    sigungu: "안동시",
    region: "경상북도 안동시",
    itemName: "사과",
    noticeName: "신선한 사과",
    niceClass: "31",
    queryCount: 1,
    successfulQueryCount: 1,
    partialQueryCount: 0,
    erroredQueryCount: 0,
    skippedQueryCount: 0,
    sourceTotalCount: 1,
    uniqueTrademarkCount: 1,
    statusCounts: { registered: 1, pending: 0, inactive: 0, unknown: 0 },
    registrationRate: 1,
    regionVerificationRate: 0,
    localApplicantShare: null,
    regionalBrandReferenceHitCount: 0,
    regionalBrandInsideShare: null,
    goodsConfirmedHitCount: 1,
    goodsReviewRequiredHitCount: 0,
    ipRegistryStatusCounts: {
      complete: 1,
      not_applicable: 0,
      not_collected: 0,
      not_found: 0,
      error: 0,
      unknown: 0,
    },
    sources: ["지리적표시"],
    sourceProvenance: [
      {
        sourceId: "gi",
        sourceLabel: "지리적표시",
        sourceContractVersion: "provider-live-api",
        sourceFetchedAt: "2026-08-10T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

function fixture() {
  const andong = bucket();
  const boseong = bucket({
    sido: "전라남도",
    sigungu: "보성군",
    region: "전라남도 보성군",
    itemName: "녹차",
    noticeName: "차",
    niceClass: "30",
    sourceTotalCount: 0,
    uniqueTrademarkCount: 0,
    statusCounts: { registered: 0, pending: 0, inactive: 0, unknown: 0 },
    registrationRate: null,
    sources: ["농사로"],
    sourceProvenance: [{ sourceId: "nongsaro", sourceLabel: "농사로" }],
  });
  const analysis = {
    schemaVersion: "1.2",
    analysisVersion: "brand-analysis-v2-regional-brand-separated",
    generatedAt: "2026-08-10T01:00:00Z",
    parameters: { asOfYear: 2026 },
    provenance: {
      sources: [
        { sourceId: "kipris_trademark" },
        {
          sourceId: "ip_registry",
          dataset: "등록원부 실시간 정보 조회 서비스",
          catalogUrl: "https://www.data.go.kr/data/15124946/openapi.do",
          contractVersion: "ip-registry-mark-history-v1",
          fetchedAt: "2026-08-11T00:00:00Z",
          lastContractVerifiedAt: "2026-08-11",
        },
      ],
    },
    warnings: [],
    summary: {
      queryCount: 2,
      successfulQueryCount: 2,
      partialQueryCount: 0,
      erroredQueryCount: 0,
      skippedQueryCount: 0,
      uniqueTrademarkCount: 1,
    },
    regionItems: [andong, boseong],
    regions: [
      { ...andong, itemName: undefined, noticeName: undefined, niceClass: undefined },
      { ...boseong, itemName: undefined, noticeName: undefined, niceClass: undefined },
    ],
  };
  const gapRow = {
    region: andong.region,
    sido: andong.sido,
    sigungu: andong.sigungu,
    itemName: andong.itemName,
    noticeName: andong.noticeName,
    niceClass: andong.niceClass,
    sources: andong.sources,
    sourceProvenance: andong.sourceProvenance,
    uniqueTrademarkCount: 1,
    registrationRate: 1,
    representative: true,
    gapScore: 0.56,
    gapReason: null,
  };
  const gap = {
    schemaVersion: "1.0",
    scoreVersion: "gap-score-v0-example",
    generatedAt: "2026-08-10T01:01:00Z",
    provenance: { inputAnalysisVersion: analysis.analysisVersion },
    warnings: ["예시 점수"],
    rows: [
      gapRow,
      {
        region: boseong.region,
        sido: boseong.sido,
        sigungu: boseong.sigungu,
        itemName: boseong.itemName,
        noticeName: boseong.noticeName,
        niceClass: boseong.niceClass,
        representative: false,
        gapScore: null,
        gapReason: "대표성 미확정",
      },
    ],
    ranking: [gapRow],
  };
  const strategy = {
    schemaVersion: "1.0",
    templateVersion: "strategy-template-v0-example",
    sourceScoreVersion: gap.scoreVersion,
    generatedAt: "2026-08-10T01:02:00Z",
    warnings: ["AI 미사용"],
    briefings: [
      {
        region: andong.region,
        itemName: andong.noticeName,
        niceClass: andong.niceClass,
        gapScore: 0.56,
        isGapAlert: true,
        sentences: ["샘플 고정 문장"],
        evidence: { uniqueTrademarkCount: 1 },
      },
    ],
  };
  return { analysis, gap, strategy };
}

console.log("1) 품목 ID 결정론성");
const identityA = specialtyIdentity({ noticeName: " 신선한   사과 ", niceClass: "031" });
const identityB = specialtyIdentity({ noticeName: "신선한 사과", niceClass: "31" });
assert.strictEqual(identityA.specialtyId, identityB.specialtyId);
assert.match(identityA.specialtyId, /^sp-v1-[a-f0-9]{16}$/);
ok("고시명칭·NICE류 정규화 조합으로 동일 ID 생성");
const province = resolveRegion({ region: "경상북도" }, createRegionIndex());
assert.strictEqual(province.regionCode, "4700000000");
assert.strictEqual(province.regionCodeStatus, "resolved");
ok("시도 단위 집계도 공식 법정동코드 원본의 상위 코드를 사용");

console.log("2) 수집 상태 분리");
assert.strictEqual(dataState(bucket({ uniqueTrademarkCount: 0 })), "complete_zero");
assert.strictEqual(dataState(bucket()), "complete_nonzero");
assert.strictEqual(dataState(bucket({ partialQueryCount: 1 })), "partial");
assert.strictEqual(
  dataState(bucket({ successfulQueryCount: 0, erroredQueryCount: 1 })),
  "error"
);
assert.strictEqual(
  dataState(bucket({ successfulQueryCount: 0, skippedQueryCount: 1 })),
  "skipped"
);
assert.strictEqual(dataState(bucket({ queryCount: 0, successfulQueryCount: 0 })), "not_collected");
ok("0건·결과 있음·부분·오류·건너뜀·미수집을 별도 상태로 유지");

console.log("3) ④·⑤·⑥ 통합 스냅샷");
const input = fixture();
const snapshot = buildDashboardSnapshot(input, {
  mode: "sample",
  generatedAt: "2026-08-10T02:00:00Z",
});
const repeated = buildDashboardSnapshot(input, {
  mode: "sample",
  generatedAt: "2026-08-10T03:00:00Z",
});
assert.strictEqual(snapshot.schemaVersion, "dashboard-snapshot-v1");
assert.strictEqual(snapshot.snapshotId, repeated.snapshotId, "입력 버전·시점이 같으면 snapshotId도 같아야 함");
assert.strictEqual(snapshot.mode, "sample");
assert.strictEqual(snapshot.coverage.completeQueryCount, 2);
assert.strictEqual(snapshot.regions.length, 2);
assert.strictEqual(snapshot.rankings.length, 1);
assert.strictEqual(snapshot.briefings.length, 1);
assert.strictEqual(snapshot.alerts.length, 1);
assert.ok(snapshot.sources.some((source) => source.sourceId === "admin_codes"));
assert.ok(snapshot.sources.some((source) => source.sourceId === "gi"));
const registrySource = snapshot.sources.find((source) => source.sourceId === "ip_registry");
assert.strictEqual(registrySource.sourceContractVersion, "ip-registry-mark-history-v1");
assert.strictEqual(registrySource.sourceLastVerifiedAt, "2026-08-11");
assert.strictEqual(registrySource.sourceUrl, "https://www.data.go.kr/data/15124946/openapi.do");
assert.ok(snapshot.warnings.some((warning) => warning.includes("전국 모집단")));
const andong = snapshot.regions.find((row) => row.region === "경상북도 안동시");
const boseong = snapshot.regions.find((row) => row.region === "전라남도 보성군");
assert.match(andong.regionCode, /^\d+$/);
assert.strictEqual(andong.regionCodeStatus, "resolved");
assert.strictEqual(snapshot.briefings[0].regionCode, andong.regionCode);
assert.strictEqual(andong.items[0].metrics.localApplicantShare.availability, "blocked");
assert.strictEqual(andong.items[0].metrics.localApplicantShare.blockingIssue, "#11");
assert.strictEqual(andong.items[0].metrics.gapScore.availability, "preview");
assert.strictEqual(andong.items[0].metrics.gapScore.blockingIssue, "#29");
assert.strictEqual(andong.items[0].metrics.confirmedGoodsMatchCount.availability, "preview");
assert.strictEqual(andong.items[0].metrics.confirmedGoodsMatchCount.blockingIssue, "#12");
assert.ok(andong.items[0].metrics.confirmedGoodsMatchCount.sourceIds.includes("ip_registry"));
assert.ok(andong.items[0].metrics.uniqueTrademarkCount.sourceIds.includes("kipris_trademark"));
assert.strictEqual(boseong.dataState, "complete_zero");
assert.strictEqual(snapshot.map.availability, "blocked");
assert.strictEqual(snapshot.coverage.targetRegionCount, null);
ok("안정 ID·상태·지표 메타데이터·출처·랭킹·브리핑을 한 JSON으로 결합");

console.log("4) 상위 단계 버전 불일치 차단");
assert.throws(
  () =>
    buildDashboardSnapshot({
      ...input,
      strategy: { ...input.strategy, sourceScoreVersion: "different-score-version" },
    }),
  /scoreVersion/
);
ok("서로 다른 실행/규칙 버전의 ⑤·⑥ 결과를 조용히 혼합하지 않음");

console.log("\n모든 자체 테스트 통과");
