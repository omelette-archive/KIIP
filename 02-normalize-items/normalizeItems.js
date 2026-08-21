#!/usr/bin/env node
"use strict";
/**
 * 원시 특산품 목록(sido, sigungu, rawItemName[, source, sourceId, ...])을 받아 규칙 기반으로 먼저
 * 정규화한다. 정확히 확정할 수 없는 행은 후보와 함께 별도 검토 CSV로 분리한다.
 *
 * 사용법:
 *   node 02-normalize-items/normalizeItems.js --input path/to/raw.csv --out 02-normalize-items/output/result.csv
 *
 * 기본 실행에는 외부 API 키가 필요하지 않다.
 */

const fs = require("fs");
const path = require("path");
const { loadDictionary, parseCsvLine } = require("./lib/noticeDictionary");
const { normalizeByRules } = require("./lib/ruleNormalizer");

const NORMALIZATION_VERSION = "specialty-normalization-rules-v2-approved-aliases";
const DICTIONARY_VERSION = "kipo-notice-goods-13-2026";
const DICTIONARY_SOURCE_URL = "https://kipo.go.kr/ko/kpoContentView.do?menuCd=SCD0201120";
const DICTIONARY_DOWNLOADED_AT = "2026-08-05";

function parseArgs(argv) {
  const args = { topK: 5 };
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
      "  node 02-normalize-items/normalizeItems.js --input <csv> [옵션]",
      "",
      "입력 CSV 컬럼: sido, sigungu, rawItemName[, source]",
      "",
      "옵션:",
      "  --out <path>          결과 CSV 저장 경로 (기본: 02-normalize-items/output/normalized.csv)",
      "  --review-out <path>   별도 검토 CSV 경로 (기본: output/review-required.csv)",
      "  --topK <n>            검토용 후보 개수 (기본 5)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function readInputCsv(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const idx = {
    sido: header.indexOf("sido"),
    sigungu: header.indexOf("sigungu"),
    rawItemName: header.indexOf("rawItemName"),
    source: header.indexOf("source"),
    sourceId: header.indexOf("sourceId"),
    sourceContractVersion: header.indexOf("sourceContractVersion"),
    sourceUrl: header.indexOf("sourceUrl"),
    sourceLastVerifiedAt: header.indexOf("sourceLastVerifiedAt"),
    collectedAt: header.indexOf("collectedAt"),
    regionCode: header.indexOf("regionCode"),
    regionMatchMethod: header.indexOf("regionMatchMethod"),
    sourceRegionName: header.indexOf("sourceRegionName"),
    sourceRegionCode: header.indexOf("sourceRegionCode"),
    sourceItemName: header.indexOf("sourceItemName"),
    sourceRecordUrl: header.indexOf("sourceRecordUrl"),
  };
  if (idx.sido === -1 || idx.sigungu === -1 || idx.rawItemName === -1) {
    throw new Error(`입력 CSV에 sido/sigungu/rawItemName 컬럼이 필요합니다: ${header.join(",")}`);
  }
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    let sido = fields[idx.sido] || "";
    let sigungu = fields[idx.sigungu] || "";

    // 일부 재실행 산출물에서 지역 두 컬럼이 한 칸 밀려
    // `sido="", sigungu="경기도 > 남양주시"` 형태로 들어온다.
    // 원천 계약은 sido/sigungu를 별도 컬럼으로 보장하므로 여기서 복원해
    // 후속 지역 집계가 해당 행을 유실하지 않도록 한다.
    if (!sido && sigungu.includes(">")) {
      const parts = sigungu.split(">").map((value) => value.trim()).filter(Boolean);
      if (parts.length >= 2) {
        [sido, sigungu] = [parts[0], parts[parts.length - 1]];
      }
    } else if (!sido && sigungu) {
      // 시도 단위 원천행은 sigungu가 비어 있어야 하지만, 같은 밀림으로
      // 시도명이 sigungu에 들어온 경우에는 시도 단위로 복원한다.
      const provincePattern = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원(?:도|특별자치도)|충청북도|충청남도|전라북도|전북특별자치도|전라남도|전남광주통합특별시|경상북도|경상남도|제주특별자치도)$/;
      if (provincePattern.test(sigungu)) {
        sido = sigungu;
        sigungu = "";
      }
    }
    return {
      sido,
      sigungu,
      rawItemName: fields[idx.rawItemName] || "",
      source: idx.source === -1 ? "" : fields[idx.source] || "",
      sourceId: idx.sourceId === -1 ? "" : fields[idx.sourceId] || "",
      sourceContractVersion: idx.sourceContractVersion === -1 ? "" : fields[idx.sourceContractVersion] || "",
      sourceUrl: idx.sourceUrl === -1 ? "" : fields[idx.sourceUrl] || "",
      sourceLastVerifiedAt: idx.sourceLastVerifiedAt === -1 ? "" : fields[idx.sourceLastVerifiedAt] || "",
      sourceFetchedAt: idx.collectedAt === -1 ? "" : fields[idx.collectedAt] || "",
      regionCode: idx.regionCode === -1 ? "" : fields[idx.regionCode] || "",
      regionMatchMethod: idx.regionMatchMethod === -1 ? "" : fields[idx.regionMatchMethod] || "",
      sourceRegionName: idx.sourceRegionName === -1 ? "" : fields[idx.sourceRegionName] || "",
      sourceRegionCode: idx.sourceRegionCode === -1 ? "" : fields[idx.sourceRegionCode] || "",
      sourceItemName: idx.sourceItemName === -1 ? "" : fields[idx.sourceItemName] || "",
      sourceRecordUrl: idx.sourceRecordUrl === -1 ? "" : fields[idx.sourceRecordUrl] || "",
    };
  });
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const OUTPUT_FIELDS = [
  "inputIndex",
  "sido",
  "sigungu",
  "rawItemName",
  "source",
  "sourceId",
  "sourceContractVersion",
  "sourceUrl",
  "sourceLastVerifiedAt",
  "sourceFetchedAt",
  "regionCode",
  "regionMatchMethod",
  "sourceRegionName",
  "sourceRegionCode",
  "sourceItemName",
  "sourceRecordUrl",
  "itemName",
  "noticeName",
  "niceClass",
  "similarGroupCode",
  "excluded",
  "status",
  "matchMethod",
  "confidence",
  "verdictSource",
  "reviewReason",
  "reviewCandidates",
  "normalizationVersion",
  "dictionaryVersion",
  "dictionarySourceUrl",
  "dictionaryDownloadedAt",
  "reviewDecision",
  "selectedCandidateIndex",
  "reviewNote",
  "reviewedBy",
  "reviewedAt",
  "error",
];

function writeOutputCsv(outPath, rows) {
  const lines = [OUTPUT_FIELDS.join(",")];
  for (const row of rows) {
    lines.push(OUTPUT_FIELDS.map((field) => csvEscape(row[field])).join(","));
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, "﻿" + lines.join("\n") + "\n", "utf8");
}

function normalizeRow(row, { dictionary, topK }) {
  const base = {
    sido: row.sido,
    sigungu: row.sigungu,
    rawItemName: row.rawItemName,
    source: row.source || "",
  };

  try {
    return normalizeByRules(row, dictionary, { topK });
  } catch (err) {
    return {
      ...base,
      itemName: "",
      noticeName: "",
      niceClass: "",
      similarGroupCode: "",
      excluded: "",
      status: "error",
      matchMethod: "rule_error",
      confidence: "",
      verdictSource: "error",
      reviewReason: "",
      reviewCandidates: "[]",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.input) printUsageAndExit("--input 은 필수입니다.");

  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out || path.join(__dirname, "output", "normalized.csv"));
  const reviewOutPath = path.resolve(
    args["review-out"] || path.join(path.dirname(outPath), "review-required.csv")
  );
  const topK = Number(args.topK);
  if (!Number.isInteger(topK) || topK < 1) {
    printUsageAndExit("--topK 는 1 이상의 정수여야 합니다.");
  }

  const rawRows = readInputCsv(inputPath);
  console.error(`[normalizeItems] input=${rawRows.length}행`);

  const dictionary = loadDictionary();
  console.error(`[normalizeItems] 고시상품명칭 사전 ${dictionary.length.toLocaleString()}건 로드`);

  const results = rawRows.map((row, inputIndex) => ({
    inputIndex,
    ...normalizeRow(row, { dictionary, topK }),
    sourceId: row.sourceId,
    sourceContractVersion: row.sourceContractVersion,
    sourceUrl: row.sourceUrl,
    sourceLastVerifiedAt: row.sourceLastVerifiedAt,
    sourceFetchedAt: row.sourceFetchedAt,
    regionCode: row.regionCode,
    regionMatchMethod: row.regionMatchMethod,
    sourceRegionName: row.sourceRegionName,
    sourceRegionCode: row.sourceRegionCode,
    sourceItemName: row.sourceItemName,
    sourceRecordUrl: row.sourceRecordUrl,
    normalizationVersion: NORMALIZATION_VERSION,
    dictionaryVersion: DICTIONARY_VERSION,
    dictionarySourceUrl: DICTIONARY_SOURCE_URL,
    dictionaryDownloadedAt: DICTIONARY_DOWNLOADED_AT,
    reviewDecision: "",
    selectedCandidateIndex: "",
    reviewNote: "",
    reviewedBy: "",
    reviewedAt: "",
  }));
  const reviewRows = results.filter((row) => row.status === "review_required");

  writeOutputCsv(outPath, results);
  writeOutputCsv(reviewOutPath, reviewRows);
  const matched = results.filter((row) => row.status === "ok" && row.noticeName).length;
  const excluded = results.filter((row) => row.status === "ok" && row.excluded).length;
  const failed = results.filter((row) => row.status === "error").length;
  console.error(
    `[normalizeItems] done. matched=${matched}, excluded=${excluded}, review=${reviewRows.length}, error=${failed} -> ${outPath}`
  );
  console.error(`[normalizeItems] review queue -> ${reviewOutPath}`);
  if (failed > 0) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[normalizeItems] 실패: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  normalizeRow,
  readInputCsv,
  writeOutputCsv,
  OUTPUT_FIELDS,
  NORMALIZATION_VERSION,
  DICTIONARY_VERSION,
  DICTIONARY_SOURCE_URL,
  DICTIONARY_DOWNLOADED_AT,
};
