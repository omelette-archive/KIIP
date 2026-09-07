"use strict";

const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { evaluateArchiveIntegrity } = require("./verifyArchiveIntegrity");

function ok(message) {
  console.log(`  ok - ${message}`);
}

const FULL = {
  specialtyRawRecords: 2211,
  checkpointQueryCount: 1052,
  checkpointCompleteCount: 834,
  checkpointPartialCount: 216,
  applicantCacheEntries: 218573,
  ipRegistryCacheEntries: 32,
};

console.log("1) high-water 없음 → 통과 + 기준 수립");
{
  const r = evaluateArchiveIntegrity(FULL, null, { tombstoneCount: 0 });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.violations, []);
  assert.strictEqual(r.nextHighwater.specialtyRawRecords, 2211);
  ok("최초 실행은 위반 없이 nextHighwater를 채운다");
}

console.log("2) 동일값 → 통과, 증가 → 통과·high-water 상승");
{
  assert.strictEqual(evaluateArchiveIntegrity(FULL, FULL, {}).ok, true);
  const grown = { ...FULL, specialtyRawRecords: 2300, checkpointCompleteCount: 900 };
  const r = evaluateArchiveIntegrity(grown, FULL, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.nextHighwater.specialtyRawRecords, 2300);
  assert.strictEqual(r.nextHighwater.checkpointCompleteCount, 900);
  ok("비감소는 통과하고 최고치를 올린다");
}

console.log("3) SQLite 원본레코드 감소 + tombstone 없음 → 위반");
{
  const shrunk = { ...FULL, specialtyRawRecords: 2205 };
  const r = evaluateArchiveIntegrity(shrunk, FULL, { tombstoneCount: 0 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes("원본레코드")));
  ok("사유 없는 원본레코드 감소는 차단");
}

console.log("4) 감소분이 tombstone 수 이내 → 통과");
{
  const shrunk = { ...FULL, specialtyRawRecords: 2205 };
  const r = evaluateArchiveIntegrity(shrunk, FULL, { tombstoneCount: 6 });
  assert.strictEqual(r.ok, true, "tombstone 6개면 6건 감소는 허용");
  const tooMuch = evaluateArchiveIntegrity({ ...FULL, specialtyRawRecords: 2200 }, FULL, { tombstoneCount: 6 });
  assert.strictEqual(tooMuch.ok, false, "tombstone 초과 감소는 여전히 차단");
  ok("tombstone으로 설명되는 감소만 허용");
}

console.log("5) 검색 체크포인트 쿼리 수 감소 → 위반 (쿼리 소멸은 tombstone 무관)");
{
  const r = evaluateArchiveIntegrity({ ...FULL, checkpointQueryCount: 1050 }, FULL, { tombstoneCount: 100 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes("쿼리 수")));
  ok("체크포인트에서 쿼리가 사라지면 차단");
}

console.log("6) complete → partial 후퇴: 허용 폭 이내는 통과, 초과는 위반");
{
  const small = evaluateArchiveIntegrity(
    { ...FULL, checkpointCompleteCount: 820, checkpointPartialCount: 230 },
    FULL,
    { completeShrinkTolerance: 25 }
  );
  assert.strictEqual(small.ok, true, "overlap refresh로 소수 complete가 partial이 되는 건 정상");
  const big = evaluateArchiveIntegrity(
    { ...FULL, checkpointCompleteCount: 700, checkpointPartialCount: 350 },
    FULL,
    { completeShrinkTolerance: 25 }
  );
  assert.strictEqual(big.ok, false);
  ok("대량 complete→partial 후퇴는 차단");
}

console.log("7) 캐시 엔트리 감소 → 경고만(차단 아님)");
{
  const r = evaluateArchiveIntegrity({ ...FULL, applicantCacheEntries: 100000, ipRegistryCacheEntries: 10 }, FULL, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.warnings.length, 2);
  ok("캐시는 TTL/정리 정책 여지가 있어 경고만 남긴다");
}

console.log("8) CLI — 없는 state 디렉터리는 exit 2");
{
  const res = spawnSync(
    process.execPath,
    [path.join(__dirname, "verifyArchiveIntegrity.js"), "--state-dir", path.join(os.tmpdir(), "no-such-dir-" + Date.now())],
    { encoding: "utf8" }
  );
  assert.strictEqual(res.status, 2);
  ok("state 디렉터리 부재는 파이프라인 차단");
}

console.log("9) CLI — 최초 실행은 통과하고 high-water 파일을 만든다");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-integrity-"));
  try {
    fs.writeFileSync(
      path.join(dir, "kipris-search-checkpoint.json"),
      JSON.stringify({ queries: { a: { collectionStatus: "complete" }, b: { collectionStatus: "partial" } } })
    );
    const res = spawnSync(
      process.execPath,
      [path.join(__dirname, "verifyArchiveIntegrity.js"), "--state-dir", dir, "--phase", "before"],
      { encoding: "utf8" }
    );
    assert.strictEqual(res.status, 0, res.stderr);
    const hw = JSON.parse(fs.readFileSync(path.join(dir, "archive-highwater.json"), "utf8"));
    assert.strictEqual(hw.checkpointQueryCount, 2);
    assert.strictEqual(hw.checkpointCompleteCount, 1);

    // 이후 쿼리가 사라지면 exit 2
    fs.writeFileSync(
      path.join(dir, "kipris-search-checkpoint.json"),
      JSON.stringify({ queries: { a: { collectionStatus: "complete" } } })
    );
    const res2 = spawnSync(
      process.execPath,
      [path.join(__dirname, "verifyArchiveIntegrity.js"), "--state-dir", dir, "--phase", "before"],
      { encoding: "utf8" }
    );
    assert.strictEqual(res2.status, 2);
    ok("최초 기준 수립 후 쿼리 소멸을 감지해 차단");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n모든 자체 테스트 통과");
