#!/usr/bin/env node
"use strict";
/**
 * 지역 특산품 원시 목록을 여러 소스에서 수집해 표준 스키마로 합친다.
 * { sido, sigungu, rawItemName, source, collectedAt }[]
 *
 * 사용법:
 *   node 01-collect-specialties/collectSpecialties.js --sources gi,nongsaro --out <path>
 *
 * 소스:
 *   gi        국립농산물품질관리원 지리적표시 등록정보 (GI_API_KEY, GI_API_BASE_URL 필요)
 *   nongsaro  농촌진흥청 지역특산물 (NONGSARO_API_KEY, NONGSARO_API_BASE_URL 필요)
 * 두 소스 모두 data.go.kr 활용신청 승인이 필요 — 키/baseUrl이 없으면 해당 소스만 건너뛰고
 * 경고를 남긴다(전체 실패시키지 않음).
 */

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("./lib/loadEnv");
const { loadAdminCodes } = require("./lib/adminCodes");
const { createClient: createGiClient } = require("./lib/giClient");
const { createClient: createNongsaroClient } = require("./lib/nongsaroClient");
const { fromGiRegistrations, fromNongsaro } = require("./lib/normalize");
const { getSourceDefinition, loadSourceRegistry } = require("./lib/sourceRegistry");

loadEnv();

function parseArgs(argv) {
  const args = { sources: "gi,nongsaro" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    const isFlagValue = next !== undefined && !next.startsWith("--");
    args[key] = isFlagValue ? next : true;
    if (isFlagValue) i++;
  }
  return args;
}

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 01-collect-specialties/collectSpecialties.js [옵션]",
      "",
      "옵션:",
      "  --sources <목록>   콤마로 구분된 소스 목록 (기본 gi,nongsaro)",
      "  --out <path>       결과 CSV 저장 경로 (기본 01-collect-specialties/output/specialties.csv)",
      "  --limit <n>        소스별 최대 수집 건수 (샘플 검증용)",
      "  --allow-empty      모든 소스가 실패해도 빈 CSV를 쓰고 성공 처리",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeOutputCsv(outPath, rows) {
  const fields = ["sido", "sigungu", "rawItemName", "source", "collectedAt"];
  const lines = [fields.join(",")];
  for (const row of rows) lines.push(fields.map((f) => csvEscape(row[f])).join(","));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, "﻿" + lines.join("\n") + "\n", "utf8");
}

async function collectGi(adminList, warnings, options = {}) {
  try {
    const client = createGiClient({
      apiKey: process.env.GI_API_KEY,
      baseUrl: process.env.GI_API_BASE_URL,
    });
    const registrations = await client.listRegistrations({ numOfRows: 200, limit: options.limit });
    const { rows, warnings: w } = fromGiRegistrations(registrations, adminList);
    warnings.push(...w);
    return { rows, succeeded: true };
  } catch (err) {
    warnings.push(`gi 소스 건너뜀: ${err.message}`);
    return { rows: [], succeeded: false };
  }
}

async function collectNongsaro(adminList, warnings, options = {}) {
  try {
    const client = createNongsaroClient({
      apiKey: process.env.NONGSARO_API_KEY,
      baseUrl: process.env.NONGSARO_API_BASE_URL,
    });
    const specialties = await client.listSpecialties({ numOfRows: 200, limit: options.limit });
    const { rows, warnings: w } = fromNongsaro(specialties, adminList);
    warnings.push(...w);
    return { rows, succeeded: true };
  } catch (err) {
    warnings.push(`nongsaro 소스 건너뜀: ${err.message}`);
    return { rows: [], succeeded: false };
  }
}

const COLLECTORS = { gi: collectGi, nongsaro: collectNongsaro };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();

  const outPath = path.resolve(args.out || path.join(__dirname, "output", "specialties.csv"));
  const sources = String(args.sources).split(",").map((s) => s.trim()).filter(Boolean);
  const sourceRegistry = loadSourceRegistry();
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    printUsageAndExit("--limit 는 1 이상의 정수여야 합니다.");
  }

  const adminList = loadAdminCodes();
  console.error(`[collectSpecialties] 법정동코드 마스터 ${adminList.length.toLocaleString()}건 로드`);

  const warnings = [];
  let rows = [];
  let succeededSources = 0;
  for (const source of sources) {
    const definition = getSourceDefinition(source, sourceRegistry);
    const collector = COLLECTORS[source];
    if (!definition || definition.role !== "collector" || !collector) {
      warnings.push(`알 수 없는 소스: ${source}`);
      continue;
    }
    const { rows: sourceRows, succeeded } = await collector(adminList, warnings, { limit });
    if (succeeded) succeededSources++;
    console.error(`[collectSpecialties] ${source} (${definition.name}) -> ${sourceRows.length}행`);
    rows = rows.concat(sourceRows);
  }

  if (succeededSources === 0 && !args["allow-empty"]) {
    const details = warnings.length ? ` 원인: ${warnings.slice(0, 5).join("; ")}` : "";
    throw new Error(
      `선택한 수집 소스가 모두 실패했습니다. 빈 결과를 의도했다면 --allow-empty를 사용하세요.${details}`
    );
  }

  writeOutputCsv(outPath, rows);
  console.error(`[collectSpecialties] done. total=${rows.length} -> ${outPath}`);
  if (warnings.length) {
    console.error(`[collectSpecialties] 경고 ${warnings.length}건:`);
    for (const w of warnings.slice(0, 20)) console.error(`  - ${w}`);
    if (warnings.length > 20) console.error(`  ... 외 ${warnings.length - 20}건`);
  }
}

main().catch((err) => {
  console.error(`[collectSpecialties] 실패: ${err.message}`);
  process.exit(1);
});
