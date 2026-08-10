#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadAreaBrandDocument,
  normalizeAreaBrandRegion,
} = require("./lib/areaBrandEnricher");

function parseArgs(argv) {
  const args = { limit: 3 };
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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.out) {
    throw new Error("--input <area-brand.json>과 --out <validation.csv>가 필요합니다.");
  }
  const limit = Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit은 1~100 정수여야 합니다. 기본값은 3입니다.");
  }
  const inputPath = path.resolve(args.input);
  const outPath = path.resolve(args.out);
  const document = loadAreaBrandDocument(inputPath);
  const rows = document.brands.slice(0, limit).map((brand) => {
    const region = normalizeAreaBrandRegion(brand.regionName);
    const matched = region.status === "matched";
    return {
      sido: matched ? region.sido : "",
      sigungu: matched ? region.sigungu : brand.regionName,
      rawItemName: brand.primaryProductName,
      itemName: brand.brandName,
      noticeName: "",
      niceClass: "",
      excluded: "false",
      status: matched ? "ok" : "review_required",
      source: "농사로 지역브랜드검증",
      sourceId: document.metadata.sourceId,
      sourceContractVersion: document.metadata.contractVersion,
      sourceFetchedAt: document.metadata.fetchedAt,
      sourceUrl: document.metadata.officialPageUrl,
      sourceContentId: brand.contentId,
      sourceApplicationNumber: brand.applicationNumber,
      normalizationVersion: "area-brand-region-normalization-v1",
      matchPurpose: "regional_brand_application_join_validation",
      reviewReason: matched ? "" : `지역 정규화 ${region.status}: ${region.reason}`,
    };
  });
  const fields = [
    "sido", "sigungu", "rawItemName", "itemName", "noticeName", "niceClass", "excluded", "status",
    "source", "sourceId", "sourceContractVersion", "sourceFetchedAt", "sourceUrl", "sourceContentId",
    "sourceApplicationNumber", "normalizationVersion", "matchPurpose", "reviewReason",
  ];
  const lines = [fields.join(","), ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(","))];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, "﻿" + lines.join("\n") + "\n", "utf8");
  console.error(
    `[buildAreaBrandValidationInput] rows=${rows.length}, ok=${rows.filter((row) => row.status === "ok").length}, review=${rows.filter((row) => row.status !== "ok").length} -> ${outPath}`
  );
}

try {
  main();
} catch (error) {
  console.error(`[buildAreaBrandValidationInput] 실패: ${error.message}`);
  process.exit(1);
}
