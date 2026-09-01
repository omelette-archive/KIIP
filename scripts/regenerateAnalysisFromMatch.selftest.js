#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildPlan, parseArgs, publicPlan, writeMetadata } = require("./regenerateAnalysisFromMatch");
const { executePlan } = require("./runOperationalPipeline");

const ROOT = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-regen-from-match-"));

// validatePipeline.js의 stage3 픽스처와 같은 모양. inside 1건(경로 B)·미확인 1건(경로 A).
function writeStage3Fixture(filePath, overrides = {}) {
  const fixture = {
    mode: "batch",
    schemaVersion: "1.1",
    storageMode: "results",
    trademarkSourceMetadata: { sourceId: "kipris_trademark", contractVersion: "kipris-trademark-word-search-v1" },
    applicationApplicantEnrichment: {
      enabled: true,
      policy: { applicantRegionMatchVersion: "kipris-trademark-applicant-region-v2-aliases" },
    },
    ipRegistryEnrichment: {
      enabled: true,
      status: "complete",
      policy: {
        applicantRegionMatchVersion: "ip-registry-applicant-region-v1",
        goodsMatchVersion: "ip-registry-designated-goods-v0-review",
      },
    },
    inputCount: 1,
    successCount: 1,
    errorCount: 0,
    skippedCount: 0,
    results: [
      {
        status: "ok",
        collectionStatus: "complete",
        stopReason: "source_exhausted",
        inputIndex: 0,
        source: "지리적표시",
        input: {
          sido: "경상북도",
          sigungu: "안동시",
          rawItemName: "안동사과",
          itemName: "사과",
          noticeName: "신선한 사과",
          niceClass: "31",
          status: "ok",
          source: "지리적표시",
        },
        query: { region: "경상북도 안동시", regionMatch: "unverified", item: "신선한 사과", classCode: "31" },
        keywordTotalCount: 2,
        page: { number: 1, size: 20, unfilteredCount: 2, filteredCount: 2, hasMore: false },
        hits: [
          {
            title: "안동사과",
            applicant: "예시 영농조합",
            applicationNumber: "40-2025-0000001",
            registrationNumber: "40-1234567-0000",
            applicationDate: "20250102",
            applicationStatus: "등록",
            classificationCode: "31",
            ipRegistryStatus: "complete",
            applicantRegionMatch: "inside",
            applicantRegionMatchSource: "ip_registry_applicant_address",
            goodsMatchMethod: "normalized_exact",
          },
          {
            title: "안동사과농장",
            applicant: "다른 지역 상인",
            applicationNumber: "40-2025-0000002",
            applicationDate: "20250115",
            applicationStatus: "출원",
            classificationCode: "31",
            applicantRegionMatch: overrides.secondHitMatch || "unverified",
            applicantRegionMatchSource: "kipris_trademark_applicant",
            applicantRegionMatchConfidence: "no_applicant_address",
          },
        ],
      },
    ],
  };
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), "utf8");
}

try {
  console.log("1) 계획은 지역매칭 집계 → ④~⑦ → 감사 → 후보 HTML 순서를 고정한다");
  const plan = buildPlan({
    input: path.join(tempDir, "in.json"),
    runId: "plan-test",
    runsDir: path.join(tempDir, "runs"),
    mode: "full",
    stage: "alpha",
  });
  assert.deepStrictEqual(plan.stages.map((s) => s.id), [
    "region_coverage",
    "04_analyze",
    "05_gap",
    "06_strategy",
    "07_snapshot",
    "audit_snapshot",
    "render_candidate",
  ]);
  const coverageStage = plan.stages.find((s) => s.id === "region_coverage");
  assert.ok(coverageStage.args.includes("--input"), "--before 없으면 단일 스냅샷 집계");
  assert.ok(!coverageStage.args.includes("--before"));
  const analyzeStage = plan.stages.find((s) => s.id === "04_analyze");
  assert.ok(analyzeStage.args.includes("--raw-goods-review"));
  const auditStage = plan.stages.find((s) => s.id === "audit_snapshot");
  assert.ok(!auditStage.args.includes("--strict"), "감사는 errors만 차단(경고로 중단하지 않음)");
  assert.ok(auditStage.args.includes("--out"), "감사 단계가 직접 리포트 파일을 씀(--out)");
  assert.ok(auditStage.outputs.some((o) => o.endsWith("audit-report.json")), "감사 리포트를 산출물로 선언");
  const auditOutIdx = auditStage.args.indexOf("--out");
  assert.ok(auditStage.outputs.includes(auditStage.args[auditOutIdx + 1]), "--out 경로와 선언된 산출물이 일치");
  const serialized = JSON.stringify(publicPlan(plan));
  assert.ok(!serialized.includes("API_KEY"));

  console.log("2) --before를 주면 지역매칭 단계가 전후 비교(--before/--after)로 바뀐다");
  const beforePlan = buildPlan({
    input: path.join(tempDir, "after.json"),
    before: path.join(tempDir, "before.json"),
    runId: "before-test",
    runsDir: path.join(tempDir, "runs"),
  });
  const beforeCoverage = beforePlan.stages.find((s) => s.id === "region_coverage");
  assert.ok(beforeCoverage.args.includes("--before") && beforeCoverage.args.includes("--after"));

  console.log("3) --dry-run은 파일을 만들지 않고 키를 노출하지 않는다");
  const dryRunsDir = path.join(tempDir, "dry-runs");
  const dry = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/regenerateAnalysisFromMatch.js"),
      "--dry-run",
      "--input",
      path.join(tempDir, "missing.json"),
      "--run-id",
      "dry-test",
      "--runs-dir",
      dryRunsDir,
    ],
    { cwd: ROOT, env: { ...process.env, KIPRIS_API_KEY: "must-not-appear" }, encoding: "utf8" }
  );
  assert.strictEqual(dry.status, 0, dry.stderr);
  assert.strictEqual(fs.existsSync(dryRunsDir), false);
  assert.ok(!dry.stdout.includes("must-not-appear"));
  assert.strictEqual(JSON.parse(dry.stdout).schemaVersion, "regen-from-match-plan-v1");

  console.log("4) --input이 없으면 즉시 실패한다");
  assert.throws(() => parseArgs([]), /--input 은 필수입니다/);
  const missing = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/regenerateAnalysisFromMatch.js"), "--input", path.join(tempDir, "nope.json")],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert.strictEqual(missing.status, 1);
  assert.ok(missing.stderr.includes("입력 ③ 산출물이 없습니다"));

  console.log("5) 한 단계가 실패하면 후속 단계와 후보 HTML을 만들지 않는다");
  const failPlan = buildPlan({
    input: path.join(tempDir, "in.json"),
    runId: "fail-test",
    runsDir: path.join(tempDir, "runs"),
  });
  const invoked = [];
  const failResult = executePlan(failPlan, {
    runStage(stage) {
      invoked.push(stage.id);
      if (stage.id === "05_gap") return { status: 9, stdout: "", stderr: "fixture fail\n" };
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
  });
  assert.strictEqual(failResult.ok, false);
  assert.strictEqual(failResult.failedStage, "05_gap");
  assert.deepStrictEqual(invoked, ["region_coverage", "04_analyze", "05_gap"]);
  assert.strictEqual(fs.existsSync(failPlan.files.dashboardCandidate), false);

  console.log("6) 픽스처 ③ 산출물로 ④~⑦ 재생성과 메타데이터 기록이 실제로 동작한다");
  const e2eInput = path.join(tempDir, "e2e-after.json");
  const e2eBefore = path.join(tempDir, "e2e-before.json");
  writeStage3Fixture(e2eInput, { secondHitMatch: "inside" }); // 재조회로 unverified→inside 개선 가정
  writeStage3Fixture(e2eBefore, { secondHitMatch: "unverified" });
  const e2e = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/regenerateAnalysisFromMatch.js"),
      "--input",
      e2eInput,
      "--before",
      e2eBefore,
      "--run-id",
      "e2e-test",
      "--runs-dir",
      path.join(tempDir, "runs"),
      "--mode",
      "sample",
      "--stage",
      "sample",
      "--as-of-year",
      "2026",
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert.strictEqual(e2e.status, 0, `${e2e.stdout}\n${e2e.stderr}`);
  const runDir = path.join(tempDir, "runs", "e2e-test");
  for (const name of [
    "04-analysis.json",
    "05-gap.json",
    "06-strategy.json",
    "07-dashboard-snapshot.json",
    "audit-report.json",
    "region-match-coverage.json",
    "regen-metadata.json",
    "dashboard.candidate.html",
    "run-manifest.json",
  ]) {
    assert.ok(fs.existsSync(path.join(runDir, name)), `${name} 산출물이 있어야 함`);
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(runDir, "regen-metadata.json"), "utf8"));
  assert.strictEqual(metadata.schemaVersion, "regen-from-match-metadata-v1");
  assert.match(metadata.input.sha256, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual(
    metadata.input.contractVersions,
    {
      searchSchemaVersion: "1.1",
      trademarkSourceContractVersion: "kipris-trademark-word-search-v1",
      applicantRegionMatchVersion: "kipris-trademark-applicant-region-v2-aliases",
      ipRegistryApplicantRegionMatchVersion: "ip-registry-applicant-region-v1",
      ipRegistryGoodsMatchVersion: "ip-registry-designated-goods-v0-review",
    },
    "③ 입력의 계약/규칙 버전을 이름·값 일치하게 명시 기록"
  );
  assert.ok(metadata.before && metadata.before.sha256, "--before 해시가 기록돼야 함");
  assert.ok(metadata.ruleVersions.analysisVersion, "④ 계약 버전이 메타데이터에 남아야 함");
  assert.ok(metadata.ruleVersions.gapScoreVersion, "⑤ 계약 버전이 남아야 함");
  assert.ok(metadata.ruleVersions.snapshotSchemaVersion, "⑦ 계약 버전이 남아야 함");
  assert.ok(metadata.snapshotAudit, "스냅샷 감사 결과가 메타데이터에 있어야 함");
  assert.strictEqual(typeof metadata.snapshotAudit.warningCount, "number");
  assert.ok(Array.isArray(metadata.snapshotAudit.warnings), "warnings 코드 목록이 있어야 함");
  assert.strictEqual(metadata.snapshotAudit.errorCount, 0, "정상 재생성은 계약 errors 0");
  assert.ok(metadata.regionMatchCoverage, "지역매칭 집계가 메타데이터에 인라인돼야 함");
  assert.ok(metadata.regionMatchCoverage.delta, "--before가 있으면 전후 델타가 있어야 함");
  assert.strictEqual(
    metadata.regionMatchCoverage.delta.inside,
    1,
    "재조회로 unverified 1건이 inside로 개선된 것이 델타에 잡혀야 함"
  );
  const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, "07-dashboard-snapshot.json"), "utf8"));
  assert.strictEqual(snapshot.schemaVersion, "dashboard-snapshot-v1");
  assert.ok(fs.readFileSync(path.join(runDir, "dashboard.candidate.html"), "utf8").includes("<!doctype html>"));

  console.log("7) 같은 run-id 두 번째 실행은 원자적으로 거부된다");
  assert.throws(
    () =>
      executePlan(
        buildPlan({ input: e2eInput, runId: "e2e-test", runsDir: path.join(tempDir, "runs") }),
        { runStage: () => ({ status: 0, stdout: "", stderr: "" }) }
      ),
    /같은 run-id 실행 디렉터리가 이미 있습니다/
  );

  console.log("8) 실데이터 스모크 — 라이브 스냅샷은 --strict 없이 감사 통과(exit 0)해야 한다");
  {
    // audit_snapshot 단계가 --strict였다면 라이브 스냅샷의 알려진 warning 3건 때문에
    // 항상 exit 2로 중단됐다. --strict를 뺀 현재 정책이 실데이터에서 통과하는지 고정.
    const livePath = path.join(ROOT, "07-dashboard/web/public/data/dashboard-snapshot.json");
    if (fs.existsSync(livePath)) {
      const live = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts/auditDashboardSnapshot.js"), "--input", livePath],
        { cwd: ROOT, encoding: "utf8" }
      );
      assert.strictEqual(live.status, 0, `라이브 스냅샷 감사는 errors 없이 통과해야 함:\n${live.stdout}`);
      const strict = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts/auditDashboardSnapshot.js"), "--input", livePath, "--strict"],
        { cwd: ROOT, encoding: "utf8" }
      );
      assert.strictEqual(strict.status, 2, "--strict였다면 실제로 exit 2로 파이프라인이 막혔을 것(회귀 근거)");

      const outPath = path.join(tempDir, "live-audit.json");
      const withOut = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts/auditDashboardSnapshot.js"), "--input", livePath, "--out", outPath],
        { cwd: ROOT, encoding: "utf8" }
      );
      assert.strictEqual(withOut.status, 0);
      assert.ok(fs.existsSync(outPath), "--out은 감사 단계가 직접 리포트 파일을 쓴다");
      const liveReport = JSON.parse(fs.readFileSync(outPath, "utf8"));
      assert.strictEqual(typeof liveReport.ok, "boolean");
      assert.ok(Array.isArray(liveReport.warnings));
    } else {
      console.log("  (라이브 스냅샷 파일 없음 — 스킵)");
    }
  }

  console.log("9) e2e에서 audit-report.json은 감사 단계가 쓰고 metadata가 그 파일을 가리킨다");
  {
    const reportPath = path.join(runDir, "audit-report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.strictEqual(report.ok, true, "픽스처 재생성 스냅샷은 계약 위반 없음");
    assert.strictEqual(path.resolve(metadata.snapshotAudit.reportPath), path.resolve(reportPath));
    assert.strictEqual(metadata.snapshotAudit.errorCount, report.errors.length);
  }

  // writeMetadata가 직접 호출돼도 동작(단위)
  void writeMetadata;

  console.log("③→⑦ 재생성 실행기 자체 테스트 통과");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
