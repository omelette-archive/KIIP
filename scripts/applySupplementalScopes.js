#!/usr/bin/env node
"use strict";

/**
 * #70: ③→④ 사이 단계. NFQS·KOFPI 보완 소스의 지역 스코프를 정규화한다.
 * (NFQS 인증사업장 소재지 → 전국, KOFPI 임산물 → 주산지 근거별 시군구 행 또는 전국)
 * API 호출 없음. 저장된 ③ 산출물만 읽고 다시 쓴다.
 *
 * 사용법:
 *   node scripts/applySupplementalScopes.js --input <③ JSON> --out <경로> [--forest-regions <json>]
 */

const fs = require("fs");
const path = require("path");
const { writeJsonStreaming } = require("./lib/streamJsonWrite");
const { applySupplementalScopes } = require("./lib/supplementalScopes");
const { loadAdminCodes } = require("../01-collect-specialties/lib/adminCodes");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_FOREST_REGIONS = path.join(ROOT, "02-normalize-items", "data", "kofpi-primary-regions-2024.json");

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
    } else args[key] = true;
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^﻿/, ""));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || !args.input || !args.out) {
    console.error("사용법: node scripts/applySupplementalScopes.js --input <③ JSON> --out <경로> [--forest-regions <json>]");
    process.exit(args.help || args.h ? 0 : 1);
  }
  const document = readJson(args.input);
  const forestPath = path.resolve(args["forest-regions"] || DEFAULT_FOREST_REGIONS);
  const forestRegionEvidence = fs.existsSync(forestPath) ? readJson(forestPath) : null;

  const adminList = loadAdminCodes();
  const before = (document.results || []).length;
  applySupplementalScopes(document, { forestRegionEvidence, adminList });
  const after = (document.results || []).length;

  const outPath = path.resolve(args.out);
  // 03c 산출물(수백MB)을 그대로 다시 쓰므로 큰 컬렉션만 항목 단위로 스트리밍한다(03c OOM 대응).
  await writeJsonStreaming(outPath, document);
  console.error(
    `[applySupplementalScopes] results ${before} -> ${after} (KOFPI 주산지 확장 포함) -> ${outPath}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[applySupplementalScopes] 실패: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
