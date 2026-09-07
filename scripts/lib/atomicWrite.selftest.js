"use strict";

const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { renameWithRetry, writeFileAtomic, writeJsonAtomic } = require("./atomicWrite");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));

// 1) writeJsonAtomic: 새 파일 생성 + 덮어쓰기
{
  const target = path.join(tmp, "a", "b", "state.json");
  writeJsonAtomic(target, { n: 1 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8")), { n: 1 });
  writeJsonAtomic(target, { n: 2 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8")), { n: 2 });
  assert.ok(fs.readFileSync(target, "utf8").endsWith("\n"));
  assert.ok(!fs.existsSync(`${target}.${process.pid}.tmp`), "임시 파일이 남으면 안 됨");
}

// 2) writeFileAtomic: 임의 문자열
{
  const target = path.join(tmp, "note.txt");
  writeFileAtomic(target, "hello");
  assert.strictEqual(fs.readFileSync(target, "utf8"), "hello");
}

// 3) renameWithRetry: 재시도 가능한 오류는 몇 번 실패해도 결국 성공
{
  const from = path.join(tmp, "src.tmp");
  const to = path.join(tmp, "dst.json");
  fs.writeFileSync(from, "payload");
  const realRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (a, b) => {
    calls += 1;
    if (calls < 3) {
      const err = new Error("EPERM: operation not permitted, rename");
      err.code = "EPERM";
      throw err;
    }
    return realRename(a, b);
  };
  try {
    renameWithRetry(from, to, { attempts: 20, baseDelayMs: 1 });
  } finally {
    fs.renameSync = realRename;
  }
  assert.strictEqual(calls, 3);
  assert.strictEqual(fs.readFileSync(to, "utf8"), "payload");
}

// 4) renameWithRetry: 재시도 불가 오류(ENOENT)는 즉시 전파
{
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error("ENOENT");
    err.code = "ENOENT";
    throw err;
  };
  try {
    assert.throws(() => renameWithRetry("x", "y", { attempts: 5, baseDelayMs: 1 }), /ENOENT/);
  } finally {
    fs.renameSync = realRename;
  }
}

// 5) renameWithRetry: 계속 실패하면 attempts 소진 후 마지막 오류 전파 + 임시파일 정리
{
  const from = path.join(tmp, "doomed.tmp");
  fs.writeFileSync(from, "x");
  const realRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = () => {
    calls += 1;
    const err = new Error("EBUSY");
    err.code = "EBUSY";
    throw err;
  };
  try {
    assert.throws(
      () => renameWithRetry(from, path.join(tmp, "nope"), { attempts: 4, baseDelayMs: 1 }),
      /EBUSY/
    );
  } finally {
    fs.renameSync = realRename;
  }
  assert.strictEqual(calls, 4);
  assert.ok(!fs.existsSync(from), "최종 실패 시 임시 파일을 지워야 함");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("atomicWrite 자체 테스트 통과");
