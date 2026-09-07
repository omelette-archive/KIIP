"use strict";

const fs = require("fs");
const path = require("path");

// 큰 파이프라인 중간 산출물(수백 MB)을 쓸 때 `JSON.stringify(전체, null, 2)` 한 방은
// (1) V8 문자열 길이 한도("Invalid string length")에 걸리거나 (2) pretty 문자열 +
// 원본 객체 그래프 + 복제본이 동시에 살아 피크 메모리가 5~8GB까지 튄다(2026-09-07
// 운영 파이프라인 03c_ip_registry OOM). 큰 컬렉션 키만 항목 단위로 나눠 스트리밍하면
// 각 JSON.stringify 호출이 항목 하나(수 KB~수백 KB) 크기로 끝나 한도를 안 넘고
// 피크 메모리도 항목 하나 수준이다. 값(JSON 의미)은 완전히 동일하며 pretty-print만 없다.
//
// collectionKeys 에 지정한 최상위 키의 값이:
//   - 배열이면  [ 항목, 항목, ... ] 으로
//   - 평범한 객체면 { "k": 값, ... } 으로
// 항목 단위 직렬화한다. 그 외 키·값은 통째로 JSON.stringify 한다(대개 작음).
const DEFAULT_COLLECTION_KEYS = ["queryFacts", "results"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function writeJsonStreaming(outPath, obj, options = {}) {
  const collectionKeys = new Set(options.collectionKeys || DEFAULT_COLLECTION_KEYS);
  const trailingNewline = options.trailingNewline !== false;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });
  let streamError = null;
  stream.on("error", (err) => {
    streamError = streamError || err;
  });

  const write = async (chunk) => {
    if (streamError) throw streamError;
    if (!stream.write(chunk)) {
      await new Promise((resolve) => stream.once("drain", resolve));
      if (streamError) throw streamError;
    }
  };

  try {
    await write("{");
    let firstTopKey = true;
    for (const [key, value] of Object.entries(obj)) {
      const streamed = collectionKeys.has(key) && (Array.isArray(value) || isPlainObject(value));
      // JSON.stringify 와 동일하게, 스칼라 값이 undefined 로 직렬화되는 키(undefined·함수·
      // 심볼)는 통째로 건너뛴다.
      const scalar = streamed ? undefined : JSON.stringify(value);
      if (!streamed && scalar === undefined) continue;

      if (!firstTopKey) await write(",");
      firstTopKey = false;
      await write(`${JSON.stringify(key)}:`);

      if (streamed && Array.isArray(value)) {
        await write("[");
        let first = true;
        for (const item of value) {
          const rendered = JSON.stringify(item);
          const chunk = rendered === undefined ? "null" : rendered;
          await write(first ? chunk : `,${chunk}`);
          first = false;
        }
        await write("]");
      } else if (streamed) {
        await write("{");
        let first = true;
        for (const [entryKey, entryValue] of Object.entries(value)) {
          const rendered = JSON.stringify(entryValue);
          if (rendered === undefined) continue;
          const pair = `${JSON.stringify(entryKey)}:${rendered}`;
          await write(first ? pair : `,${pair}`);
          first = false;
        }
        await write("}");
      } else {
        await write(scalar);
      }
    }
    await write(trailingNewline ? "}\n" : "}");
  } catch (error) {
    stream.destroy();
    throw error;
  }

  await new Promise((resolve, reject) => {
    stream.end((err) => (err || streamError ? reject(err || streamError) : resolve()));
  });
}

module.exports = { writeJsonStreaming, DEFAULT_COLLECTION_KEYS };
