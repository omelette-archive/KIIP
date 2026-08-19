#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIRMED_MATCHING_BASIS = "notice_name_and_nice_class";
const REVIEW_MATCHING_BASIS = "raw_item_name_unclassified";

function parseArgs(argv) {
  const args = {
    input: path.resolve("07-dashboard/web/public/data/dashboard-snapshot.json"),
    json: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--input") {
      if (!argv[i + 1]) throw new Error("--input requires a file path");
      args.input = path.resolve(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function regionIdentity(region) {
  return region.regionCode || region.region || [region.sido, region.sigungu].filter(Boolean).join(" ");
}

function isConfirmedSpecialty(item) {
  return Boolean(
    item &&
      item.matchingBasis === CONFIRMED_MATCHING_BASIS &&
      item.noticeName &&
      item.niceClass
  );
}

function isRegionalMetricAvailable(item) {
  return item?.metrics?.uniqueTrademarkCount?.availability === "available";
}

function compactRow(region, item) {
  return {
    region: region.region || regionIdentity(region),
    regionCode: region.regionCode || null,
    itemName: item.itemName || null,
    noticeName: item.noticeName || null,
    niceClass: item.niceClass || null,
    matchingBasis: item.matchingBasis || null,
    specialtyId: item.specialtyId || null,
  };
}

function topRegionCounts(rows, limit = 10) {
  const counts = new Map();
  for (const { region } of rows) {
    const name = region.region || regionIdentity(region) || "unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([region, count]) => ({ region, count }));
}

function auditSnapshot(snapshot) {
  const errors = [];
  const warnings = [];
  const addError = (code, message, details = {}) => errors.push({ code, message, ...details });
  const addWarning = (code, message, details = {}) => warnings.push({ code, message, ...details });

  if (snapshot?.schemaVersion !== "dashboard-snapshot-v1") {
    addError("invalid_schema", "schemaVersion must be dashboard-snapshot-v1", {
      actual: snapshot?.schemaVersion ?? null,
    });
  }
  if (!Array.isArray(snapshot?.regions)) {
    addError("missing_regions", "regions must be an array");
    return { ok: false, errors, warnings, summary: null };
  }

  const allRows = [];
  const confirmedRows = [];
  const reviewRows = [];
  const unresolvedRegions = [];
  const seenRegionItems = new Set();

  for (const region of snapshot.regions) {
    if (!region.regionCode || region.regionCodeStatus === "unresolved") {
      unresolvedRegions.push(region);
    }
    if (!Array.isArray(region.items)) {
      addError("invalid_region_items", "region.items must be an array", {
        region: region.region || regionIdentity(region) || null,
      });
      continue;
    }

    for (const item of region.items) {
      const row = { region, item };
      allRows.push(row);
      if (isConfirmedSpecialty(item)) confirmedRows.push(row);
      else reviewRows.push(row);

      if (item.matchingBasis === CONFIRMED_MATCHING_BASIS && (!item.noticeName || !item.niceClass)) {
        addError("incomplete_confirmed_specialty", "confirmed matching basis requires noticeName and niceClass", {
          example: compactRow(region, item),
        });
      }
      if (item.matchingBasis === REVIEW_MATCHING_BASIS && item.niceClass) {
        addError("review_row_has_nice_class", "raw review rows must not carry a confirmed NICE class", {
          example: compactRow(region, item),
        });
      }

      const metric = item?.metrics?.uniqueTrademarkCount;
      if (!metric || typeof metric.availability !== "string") {
        addError("missing_regional_metric", "uniqueTrademarkCount metric and availability are required", {
          example: compactRow(region, item),
        });
      } else if (metric.availability === "available" && !Number.isFinite(metric.value)) {
        addError("available_metric_without_value", "available uniqueTrademarkCount must be numeric", {
          example: compactRow(region, item),
          value: metric.value ?? null,
        });
      } else if (metric.availability === "blocked" && metric.value !== null) {
        addError("blocked_metric_has_value", "blocked uniqueTrademarkCount must remain null", {
          example: compactRow(region, item),
          value: metric.value,
        });
      }

      const itemIdentity = item.specialtyId || `${item.matchingBasis || "unknown"}:${item.itemName || item.noticeName || ""}`;
      const compoundKey = `${regionIdentity(region)}|${itemIdentity}`;
      if (seenRegionItems.has(compoundKey)) {
        addError("duplicate_region_specialty", "region and specialty identity must be unique", {
          example: compactRow(region, item),
        });
      }
      seenRegionItems.add(compoundKey);
    }
  }

  const confirmedAvailableRows = confirmedRows.filter(({ item }) => isRegionalMetricAvailable(item));
  const confirmedBlockedRows = confirmedRows.filter(({ item }) => !isRegionalMetricAvailable(item));
  const reviewAvailableRows = reviewRows.filter(({ item }) => isRegionalMetricAvailable(item));
  const reviewWithExamples = reviewRows.filter(({ item }) => (item.trademarkExamples || []).length > 0);
  const allAvailableCount = allRows.filter(({ item }) => isRegionalMetricAvailable(item)).length;

  if (snapshot.coverage?.regionItemCount !== undefined && snapshot.coverage.regionItemCount !== allRows.length) {
    addError("region_item_count_mismatch", "coverage.regionItemCount does not match snapshot rows", {
      reported: snapshot.coverage.regionItemCount,
      actual: allRows.length,
    });
  }
  if (
    snapshot.pipelineStatus?.regionalMetricGate?.availableRegionItemCount !== undefined &&
    snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount !== allAvailableCount
  ) {
    addError("available_gate_count_mismatch", "regionalMetricGate available count does not match item metrics", {
      reported: snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount,
      actual: allAvailableCount,
    });
  }

  if (reviewAvailableRows.length > 0) {
    addWarning(
      "review_rows_have_regional_metrics",
      "review-pending rows have available regional metrics; confirmed-specialty UI and aggregates must filter them out",
      {
        count: reviewAvailableRows.length,
        topRegions: topRegionCounts(reviewAvailableRows),
        examples: reviewAvailableRows.slice(0, 12).map(({ region, item }) => compactRow(region, item)),
      }
    );
  }
  if (reviewWithExamples.length > 0) {
    addWarning(
      "review_rows_have_trademark_examples",
      "review-pending rows contain trademark examples; keep them out of confirmed specialty labels",
      {
        count: reviewWithExamples.length,
        examples: reviewWithExamples.slice(0, 12).map(({ region, item }) => compactRow(region, item)),
      }
    );
  }
  if (unresolvedRegions.length > 0) {
    addWarning("unresolved_region_codes", "some regions do not have a resolved administrative code", {
      count: unresolvedRegions.length,
      examples: unresolvedRegions.slice(0, 12).map((region) => ({
        region: region.region || regionIdentity(region) || null,
        regionCode: region.regionCode || null,
        regionCodeStatus: region.regionCodeStatus || null,
      })),
    });
  }

  const summary = {
    snapshotId: snapshot.snapshotId || null,
    generatedAt: snapshot.generatedAt || null,
    regionCount: snapshot.regions.length,
    regionItemCount: allRows.length,
    confirmedSpecialtyRows: confirmedRows.length,
    reviewPendingRows: reviewRows.length,
    confirmedRegionalMetricAvailableRows: confirmedAvailableRows.length,
    confirmedRegionalMetricBlockedRows: confirmedBlockedRows.length,
    reviewRowsWithAvailableRegionalMetrics: reviewAvailableRows.length,
    unresolvedRegionCount: unresolvedRegions.length,
    presentationRule:
      "Confirmed specialty counts, rates, maps, rankings, and item lists must use only notice_name_and_nice_class rows with noticeName and niceClass.",
  };

  return { ok: errors.length === 0, errors, warnings, summary };
}

function printHuman(report, input) {
  console.log(`[dashboard-audit] ${input}`);
  if (report.summary) {
    const s = report.summary;
    console.log(
      `[dashboard-audit] regions=${s.regionCount} rows=${s.regionItemCount} confirmed=${s.confirmedSpecialtyRows} review=${s.reviewPendingRows}`
    );
    console.log(
      `[dashboard-audit] confirmed available=${s.confirmedRegionalMetricAvailableRows} blocked=${s.confirmedRegionalMetricBlockedRows} review-available=${s.reviewRowsWithAvailableRegionalMetrics}`
    );
  }
  for (const error of report.errors) console.error(`[error:${error.code}] ${error.message}`);
  for (const warning of report.warnings) console.warn(`[warning:${warning.code}] ${warning.message}`);
  console.log(`[dashboard-audit] ${report.ok ? "contract OK" : "contract FAILED"}; warnings=${report.warnings.length}`);
}

function usage() {
  console.log(
    [
      "Usage: node scripts/auditDashboardSnapshot.js [options]",
      "",
      "Options:",
      "  --input <path>  Snapshot to audit (default: dashboard public snapshot)",
      "  --json          Print the complete machine-readable report",
      "  --strict        Treat warnings as a non-zero result",
    ].join("\n")
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const snapshot = JSON.parse(fs.readFileSync(args.input, "utf8"));
  const report = auditSnapshot(snapshot);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report, args.input);
  if (!report.ok) process.exitCode = 1;
  else if (args.strict && report.warnings.length > 0) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[dashboard-audit] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  auditSnapshot,
  isConfirmedSpecialty,
  isRegionalMetricAvailable,
};
