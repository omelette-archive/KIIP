#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  classifyApplicant,
  classifyCacheEntry,
  buildRefreshManifest,
  isForeignNationality,
  classifyRegistryCacheEntry,
  buildRegistryRefreshManifest,
} = require("./lib/applicantRegionRefresh");

function ok(label) {
  console.log(`  ok - ${label}`);
}

function applicant(overrides = {}) {
  return {
    address: null,
    nationality: null,
    regionNormalizationMethod: null,
    regionNormalizationReason: null,
    hasSourceAddress: false,
    ...overrides,
  };
}

function completeEntry(applicants, overrides = {}) {
  return {
    status: "complete",
    fetchedAt: "2026-08-11T00:00:00Z",
    found: true,
    resultCode: "00",
    terminalReason: null,
    applicants,
    ...overrides,
  };
}

async function runApplicantRegionRefreshTests() {
  console.log("13-1) applicantRegionRefresh — 국적 코드로 해외 주소 판별");
  {
    assert.strictEqual(isForeignNationality("KR"), false);
    assert.strictEqual(isForeignNationality("대한민국"), false);
    assert.strictEqual(isForeignNationality(""), false);
    assert.strictEqual(isForeignNationality(null), false);
    assert.strictEqual(isForeignNationality("US"), true);
    ok("국적 코드가 없거나 국내면 해외로 판정하지 않음(불명은 재조회 후보에서 배제하지 않음)");
  }

  console.log("13-2) classifyApplicant — 개별 출원인 판정");
  {
    assert.strictEqual(classifyApplicant(applicant({ hasSourceAddress: false })), "no_address");
    assert.strictEqual(
      classifyApplicant(applicant({ hasSourceAddress: true, nationality: "US" })),
      "foreign_address"
    );
    assert.strictEqual(
      classifyApplicant(applicant({ hasSourceAddress: true, address: "경상북도 안동시" })),
      "matched"
    );
    assert.strictEqual(
      classifyApplicant(
        applicant({ hasSourceAddress: true, address: null, regionNormalizationReason: "ambiguous_sigungu" })
      ),
      "ambiguous"
    );
    assert.strictEqual(
      classifyApplicant(
        applicant({ hasSourceAddress: true, address: null, regionNormalizationReason: "address_not_in_admin_master" })
      ),
      "unmatched"
    );
    ok("주소 유무·국적·정규화 실패 사유로 5가지 상태를 분리");
  }

  console.log("13-3) classifyCacheEntry — 캐시 항목 단위 판정과 재조회 후보 표시");
  {
    assert.deepStrictEqual(classifyCacheEntry("1", undefined), {
      applicationNumber: "1",
      category: "not_collected",
      refreshCandidate: false,
    });
    assert.strictEqual(
      classifyCacheEntry("1", completeEntry([], { found: false, resultCode: "20" })).category,
      "no_result"
    );
    assert.strictEqual(
      classifyCacheEntry("1", completeEntry([], { terminalReason: "empty_after_retries" })).category,
      "empty_after_retries"
    );
    assert.strictEqual(
      classifyCacheEntry("1", completeEntry([applicant({ hasSourceAddress: false })])).category,
      "no_address"
    );

    const unmatched = classifyCacheEntry(
      "1",
      completeEntry([applicant({ hasSourceAddress: true, regionNormalizationReason: "address_not_in_admin_master" })])
    );
    assert.strictEqual(unmatched.category, "unmatched");
    assert.strictEqual(unmatched.refreshCandidate, true);

    const ambiguous = classifyCacheEntry(
      "1",
      completeEntry([applicant({ hasSourceAddress: true, regionNormalizationReason: "ambiguous_sigungu" })])
    );
    assert.strictEqual(ambiguous.category, "ambiguous");
    assert.strictEqual(ambiguous.refreshCandidate, true);

    const matched = classifyCacheEntry(
      "1",
      completeEntry([applicant({ hasSourceAddress: true, address: "경상북도 안동시" })])
    );
    assert.strictEqual(matched.category, "matched");
    assert.strictEqual(matched.refreshCandidate, false);

    const conflicting = classifyCacheEntry(
      "1",
      completeEntry([
        applicant({ hasSourceAddress: true, address: "경상북도 안동시" }),
        applicant({ hasSourceAddress: true, address: "전라남도 보성군" }),
      ])
    );
    assert.strictEqual(conflicting.category, "conflicting");
    assert.strictEqual(conflicting.refreshCandidate, false, "출원인 주소가 상충하면 별칭 재조회로 해결되지 않으므로 후보에서 제외");

    // #118: --include-conflicting 옵션이면 conflicting도 재조회 후보(producerOrg 채우기용).
    const conflictingOptIn = classifyCacheEntry(
      "1",
      completeEntry([
        applicant({ hasSourceAddress: true, address: "경상북도 안동시" }),
        applicant({ hasSourceAddress: true, address: "전라남도 보성군" }),
      ]),
      { includeConflicting: true }
    );
    assert.strictEqual(conflictingOptIn.category, "conflicting");
    assert.strictEqual(conflictingOptIn.refreshCandidate, true, "includeConflicting=true면 상충 건도 재조회 후보");

    ok("not_collected/no_result/empty_after_retries/no_address/unmatched/ambiguous/matched/conflicting을 분리하고 unmatched·ambiguous만 재조회 후보로 표시(includeConflicting 시 conflicting 포함)");
  }

  console.log("13-4) buildRefreshManifest — 전체 캐시 집계와 결정론적 정렬");
  {
    const cache = new Map([
      ["3", completeEntry([applicant({ hasSourceAddress: true, address: "경상북도 안동시" })])],
      ["1", completeEntry([applicant({ hasSourceAddress: true, regionNormalizationReason: "address_not_in_admin_master" })])],
      ["2", completeEntry([applicant({ hasSourceAddress: true, regionNormalizationReason: "ambiguous_sigungu" })])],
    ]);
    const manifest = buildRefreshManifest(cache);
    assert.strictEqual(manifest.totalRowCount, 3);
    assert.strictEqual(manifest.refreshCandidateCount, 2);
    assert.deepStrictEqual(manifest.candidates.map((row) => row.applicationNumber), ["1", "2"], "출원번호 오름차순 결정론적 정렬");
    assert.strictEqual(manifest.byCategory.matched, 1);
    assert.strictEqual(manifest.byCategory.unmatched, 1);
    assert.strictEqual(manifest.byCategory.ambiguous, 1);

    const withUniverse = buildRefreshManifest(cache, { applicationNumbers: ["1", "2", "3", "4"] });
    assert.strictEqual(withUniverse.byCategory.not_collected, 1, "캐시에 없는 출원번호는 not_collected로 집계");
    assert.strictEqual(withUniverse.totalRowCount, 4);

    ok("전체 모집단을 카테고리별로 집계하고 재조회 후보만 결정론적으로 뽑아냄");
  }

  console.log("13-5) classifyRegistryCacheEntry — 경로 B(등록번호, ip-registry-cache.json 형태)");
  {
    // 경로 B 캐시는 {status, fetchedAt, record: {...}}로 한 단계 더 감싼다 —
    // applicant 판정 자체는 classifyApplicant()를 그대로 재사용한다(#73).
    function registryEntry(applicants, recordOverrides = {}) {
      return {
        status: "complete",
        fetchedAt: "2026-08-11T00:00:00Z",
        record: { found: true, resultCode: "00", applicants, ...recordOverrides },
      };
    }
    assert.deepStrictEqual(classifyRegistryCacheEntry("1", undefined), {
      registrationNumber: "1",
      category: "not_collected",
      refreshCandidate: false,
    });
    assert.strictEqual(
      classifyRegistryCacheEntry("1", registryEntry([], { found: false, resultCode: "20" })).category,
      "no_result"
    );
    assert.strictEqual(
      classifyRegistryCacheEntry("1", registryEntry([applicant({ hasSourceAddress: false })])).category,
      "no_address"
    );
    const unmatched = classifyRegistryCacheEntry(
      "1",
      registryEntry([applicant({ hasSourceAddress: true, regionNormalizationReason: "address_not_in_admin_master" })])
    );
    assert.strictEqual(unmatched.category, "unmatched");
    assert.strictEqual(unmatched.refreshCandidate, true);
    const matched = classifyRegistryCacheEntry(
      "1",
      registryEntry([applicant({ hasSourceAddress: true, address: "경상북도 안동시" })])
    );
    assert.strictEqual(matched.category, "matched");
    assert.strictEqual(matched.refreshCandidate, false);
    ok("경로 A와 동일한 applicant 판정 로직을 경로 B의 중첩 캐시 형태에도 그대로 적용");
  }

  console.log("13-6) buildRegistryRefreshManifest — 경로 B 전체 캐시 집계");
  {
    function registryEntry(applicants) {
      return { status: "complete", fetchedAt: "2026-08-11T00:00:00Z", record: { found: true, applicants } };
    }
    const cache = new Map([
      ["30202000001", registryEntry([applicant({ hasSourceAddress: true, address: "경상북도 안동시" })])],
      [
        "30202000002",
        registryEntry([applicant({ hasSourceAddress: true, regionNormalizationReason: "ambiguous_sigungu" })]),
      ],
    ]);
    const manifest = buildRegistryRefreshManifest(cache);
    assert.strictEqual(manifest.totalRowCount, 2);
    assert.strictEqual(manifest.refreshCandidateCount, 1);
    assert.deepStrictEqual(manifest.candidates.map((row) => row.registrationNumber), ["30202000002"]);

    const withUniverse = buildRegistryRefreshManifest(cache, {
      registrationNumbers: ["30202000001", "30202000002", "30202000003"],
    });
    assert.strictEqual(withUniverse.byCategory.not_collected, 1, "캐시에 없는 등록번호는 not_collected로 집계");
    ok("등록번호 기준으로도 결정론적 집계·재조회 후보 선별이 동작함");
  }
}

if (require.main === module) {
  runApplicantRegionRefreshTests()
    .then(() => console.log("\n출원인 주소 재조회 자체 테스트 통과"))
    .catch((error) => {
      console.error(`출원인 주소 재조회 자체 테스트 실패: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { runApplicantRegionRefreshTests };
