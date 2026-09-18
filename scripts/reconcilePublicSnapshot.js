#!/usr/bin/env node
"use strict";

/**
 * #70(2026-09-04): 배포 직전 단계. 이번 실행 스냅샷을 직전 공개 스냅샷과 대조해
 * "이전 ∪ 신규(플러스 알파)"를 강제한다 — 지역 상표 수치는 절대 감소하지 않고, 이번
 * 실행에서 빠진 지역×품목은 tombstone이 없으면 last-known-good로 되살린다. 대량 실종은
 * 재수집이 깨진 신호이므로 배포를 막는다.
 *
 * 사용법:
 *   node scripts/reconcilePublicSnapshot.js --input <이번 스냅샷> --out <경로> \
 *     [--previous <직전 공개 스냅샷>] [--tombstones <json>] [--report <경로>] \
 *     [--mass-revival-limit <n>] [--allow-mass-revival]
 */

const fs = require("fs");
const path = require("path");
const { reconcilePublicSnapshot } = require("./lib/snapshotReconcile");
// 2026-09-18(#195): item-exclusions-v1.json(회사명·총칭 등)에 걸린 이름은 07-dashboard/
// lib/snapshot.js가 매 실행 걸러내도 tombstone이 없으면 여기서 계속 되살아났다(74건
// 전부 매 배포마다 부활). 같은 판정 함수를 그대로 재사용해 되살리지 않게 한다.
const { isExcludedItemName } = require("../07-dashboard/lib/snapshot");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PREVIOUS = path.join(ROOT, "07-dashboard", "web", "public", "data", "dashboard-snapshot.json");
const DEFAULT_TOMBSTONES = path.join(ROOT, "04-analyze-brand", "data", "specialty-tombstones.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { args[key] = next; i++; }
    else args[key] = true;
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || !args.input || !args.out) {
    console.error("사용법: node scripts/reconcilePublicSnapshot.js --input <스냅샷> --out <경로> [--previous <json>] [--tombstones <json>] [--report <경로>] [--allow-mass-revival]");
    process.exit(args.help || args.h ? 0 : 1);
  }

  const nextSnapshot = readJson(path.resolve(args.input));
  const previousPath = path.resolve(args.previous || DEFAULT_PREVIOUS);
  const previousSnapshot = fs.existsSync(previousPath) ? readJson(previousPath) : null;

  const tombstonesPath = path.resolve(args.tombstones || DEFAULT_TOMBSTONES);
  let tombstones = [];
  if (fs.existsSync(tombstonesPath)) {
    const doc = readJson(tombstonesPath);
    tombstones = Array.isArray(doc) ? doc : Array.isArray(doc.tombstones) ? doc.tombstones : [];
  }

  const { report, blocked } = reconcilePublicSnapshot(nextSnapshot, previousSnapshot, tombstones, {
    massRevivalLimit: args["mass-revival-limit"] ? Number(args["mass-revival-limit"]) : undefined,
    isExcludedItem: isExcludedItemName,
  });

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(nextSnapshot, null, 2)}\n`, "utf8");

  if (args.report) {
    const reportPath = path.resolve(args.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const c = report.counts || {};
  console.error(
    `[reconcilePublicSnapshot] ${report.firstPublication ? "첫 배포" : `이전 ${report.previousSnapshotId}`} -> ` +
      `added=${c.added ?? "-"} retained=${c.retained ?? "-"} metricFloorRetained=${c.metricFloorRetained ?? 0} ` +
      `revived=${c.revivedLastKnownGood ?? 0} tombstoned=${c.removedWithTombstone ?? 0} -> ${outPath}`
  );

  if (blocked && !args["allow-mass-revival"]) {
    console.error(`[reconcilePublicSnapshot] 배포 차단: ${report.blockReason}`);
    console.error(`  되살린 키(앞 20개): ${(report.revivedLastKnownGood || []).slice(0, 20).map((r) => r.key).join(", ")}`);
    process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[reconcilePublicSnapshot] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, main };
