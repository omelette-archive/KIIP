#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { createClient } = require("./lib/areaBrandClient");

loadEnv();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit === undefined ? 3 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 602) {
    throw new Error("--limit은 1~602 정수여야 합니다. 샘플 검증은 기본값 3을 사용하세요.");
  }
  const outPath = path.resolve(
    args.out || path.join(__dirname, "output", "area-brand-sample.json")
  );
  const client = createClient();
  const result = await client.listAreaBrands({ limit });
  const output = {
    schemaVersion: 1,
    source: "농사로 지역브랜드",
    service: "areaBrand/areaBrandLst",
    fetchedAt: new Date().toISOString(),
    totalCount: result.totalCount,
    returnedCount: result.brands.length,
    brands: result.brands,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.error(
    `[fetchAreaBrands] total=${result.totalCount}, returned=${result.brands.length} -> ${outPath}`
  );
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exit(1);
});
