"use strict";

const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { writeJsonStreaming } = require("./streamJsonWrite");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stream-json-"));

async function roundTrip(obj, options) {
  const out = path.join(tmp, `doc-${Math.random().toString(36).slice(2)}.json`);
  await writeJsonStreaming(out, obj, options);
  const text = fs.readFileSync(out, "utf8");
  return { text, parsed: JSON.parse(text) };
}

(async () => {
  // 1) 스트리밍 결과가 JSON.stringify 와 의미상 동일(키 순서·값 보존)
  {
    const doc = {
      schemaVersion: "1.3",
      storageMode: "query_facts",
      meta: { a: 1, b: [2, 3], nested: { x: "y" } },
      results: [{ id: 1, hits: [{ n: "a" }] }, { id: 2, hits: [] }],
      queryFacts: {
        "q1": { query: { item: "감귤" }, hits: [{ registrationNumber: "40-1", v: 1 }] },
        q2: { query: { item: "콩" }, hits: [] },
      },
      trailer: null,
    };
    const { parsed } = await roundTrip(doc);
    assert.deepStrictEqual(parsed, doc);
    assert.deepStrictEqual(Object.keys(parsed), Object.keys(doc), "최상위 키 순서 보존");
    assert.deepStrictEqual(
      Object.keys(parsed.queryFacts),
      Object.keys(doc.queryFacts),
      "queryFacts 키 순서 보존"
    );
  }

  // 2) 큰 컬렉션이 배열이든 객체든 항목 단위 직렬화
  {
    const doc = { results: [], queryFacts: {} };
    const { text, parsed } = await roundTrip(doc);
    assert.strictEqual(text, '{"results":[],"queryFacts":{}}\n');
    assert.deepStrictEqual(parsed, doc);
  }

  // 3) collectionKeys 를 커스터마이즈
  {
    const doc = { regionItems: [{ a: 1 }, { a: 2 }], summary: { total: 2 } };
    const { parsed } = await roundTrip(doc, { collectionKeys: ["regionItems"] });
    assert.deepStrictEqual(parsed, doc);
  }

  // 4) trailingNewline 옵션
  {
    const { text } = await roundTrip({ a: 1 }, { trailingNewline: false });
    assert.strictEqual(text, '{"a":1}');
  }

  // 5) 컬렉션 키가 실제로는 스칼라/누락이어도 안전
  {
    const doc = { queryFacts: undefined, results: 5, other: "ok" };
    const { parsed } = await roundTrip(doc);
    // undefined 값은 JSON.stringify 와 동일하게 "null" 로 나간다(항목 아님)
    assert.strictEqual(parsed.results, 5);
    assert.strictEqual(parsed.other, "ok");
  }

  // 6) 잘못된 경로면 거부(디렉터리 자동 생성 후에도 파일 못 열면)
  {
    await assert.rejects(() => writeJsonStreaming(tmp, { a: 1 }), /EISDIR|illegal|directory/i);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("streamJsonWrite 자체 테스트 통과");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
