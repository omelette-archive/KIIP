#!/usr/bin/env node
"use strict";

/**
 * #137(2026-09-07): 원자료 archive와 파생 current view의 경계를 파이프라인이 강제한다.
 *
 * archive = 검색 체크포인트(kipris-search-checkpoint.json) + 수집 SQLite(specialties.sqlite)
 * + 영속 캐시. 이들은 append-only여야 한다 — 규칙/상태 변경으로 파생 스냅샷 통계가 줄 수는
 * 있어도, archive 자체가 사유 없이 줄면 재수집이 깨졌거나 영구 디스크가 유실된 신호다.
 *
 * high-water mark(<state-dir>/archive-highwater.json)에 지금까지 관측한 최대치를 남기고,
 * 매 실행마다 현재값이 그보다 줄지 않았는지 확인한다. 줄었는데 tombstone으로 설명되지
 * 않으면 exit 2로 파이프라인을 멈춘다.
 *
 * 사용법:
 *   node scripts/verifyArchiveIntegrity.js --state-dir <경로> [--phase before|after]
 *     [--tombstones <json>] [--highwater <json>] [--update] [--json]
 *
 * --phase before : 01_collect 앞. archive가 직전 성공 실행 이후 줄지 않았는지 확인.
 * --phase after  : 07d_reconcile 뒤. 확인 후 --update면 high-water를 현재값으로 올림.
 */

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TOMBSTONES = path.join(
  ROOT,
  "01-collect-specialties",
  "data",
  "source-record-tombstones.json"
);

// complete → partial 후퇴 허용 폭. overlap refresh(--refresh-complete-limit)로 totalCount가
// 늘어 재수집이 cap에 걸리면 소수의 complete가 partial로 바뀔 수 있다(정상). 이 수를 넘는
// 후퇴는 재수집 이상으로 본다.
const DEFAULT_COMPLETE_SHRINK_TOLERANCE = 25;
const SCHEMA_VERSION = "archive-highwater-v1";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

function countJsonEntries(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const doc = readJson(file);
    if (doc && doc.entries && typeof doc.entries === "object") return Object.keys(doc.entries).length;
  } catch {
    return null;
  }
  return null;
}

function loadTombstoneCount(file) {
  if (!fs.existsSync(file)) return 0;
  try {
    const doc = readJson(file);
    const list = Array.isArray(doc) ? doc : Array.isArray(doc?.tombstones) ? doc.tombstones : [];
    return list.length;
  } catch {
    return 0;
  }
}

// state 디렉터리에서 현재 archive 지표를 읽는다. 파일이 없으면 해당 지표는 null(비교 제외).
function readCurrentMetrics(stateDir) {
  const metrics = {
    specialtyRawRecords: null,
    checkpointQueryCount: null,
    checkpointCompleteCount: null,
    checkpointPartialCount: null,
    applicantCacheEntries: countJsonEntries(path.join(stateDir, "trademark-applicant-region-cache.json")),
    ipRegistryCacheEntries: countJsonEntries(path.join(stateDir, "ip-registry-cache.json")),
  };

  const dbPath = path.join(stateDir, "specialties.sqlite");
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      metrics.specialtyRawRecords = Number(
        db.prepare("SELECT COUNT(*) AS c FROM specialty_raw_records").get().c
      );
    } finally {
      db.close();
    }
  }

  const checkpointPath = path.join(stateDir, "kipris-search-checkpoint.json");
  if (fs.existsSync(checkpointPath)) {
    const checkpoint = readJson(checkpointPath);
    const queries = checkpoint.queries || {};
    const keys = Object.keys(queries);
    metrics.checkpointQueryCount = keys.length;
    metrics.checkpointCompleteCount = keys.filter((k) => queries[k]?.collectionStatus === "complete").length;
    metrics.checkpointPartialCount = keys.filter((k) => queries[k]?.collectionStatus === "partial").length;
  }

  return metrics;
}

/**
 * 현재값과 high-water를 대조한다.
 * @returns {{ ok:boolean, violations:string[], warnings:string[], nextHighwater:object }}
 */
function evaluateArchiveIntegrity(current, highwater, options = {}) {
  const tombstoneCount = Number(options.tombstoneCount) || 0;
  const completeShrinkTolerance = Number.isInteger(options.completeShrinkTolerance)
    ? options.completeShrinkTolerance
    : DEFAULT_COMPLETE_SHRINK_TOLERANCE;
  const violations = [];
  const warnings = [];
  const prev = highwater || {};

  const check = (key, label, { allowedShortfall = 0, hard = true } = {}) => {
    const now = current[key];
    const mark = prev[key];
    if (now === null || now === undefined || mark === null || mark === undefined) return;
    const shortfall = mark - now;
    if (shortfall > allowedShortfall) {
      const msg = `${label}: 현재 ${now} < 최고치 ${mark} (부족분 ${shortfall}, 허용 ${allowedShortfall})`;
      if (hard) violations.push(msg);
      else warnings.push(msg);
    }
  };

  check("specialtyRawRecords", "수집 SQLite 원본레코드 수", { allowedShortfall: tombstoneCount });
  check("checkpointQueryCount", "검색 체크포인트 쿼리 수", { allowedShortfall: 0 });
  check("checkpointCompleteCount", "검색 체크포인트 complete 쿼리 수", {
    allowedShortfall: completeShrinkTolerance,
  });
  // 캐시는 TTL/정리 정책이 생길 수 있어 경고만 한다.
  check("applicantCacheEntries", "출원인 주소 캐시 엔트리 수", { hard: false });
  check("ipRegistryCacheEntries", "등록원부 캐시 엔트리 수", { hard: false });

  const nextHighwater = { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
  for (const key of [
    "specialtyRawRecords",
    "checkpointQueryCount",
    "checkpointCompleteCount",
    "checkpointPartialCount",
    "applicantCacheEntries",
    "ipRegistryCacheEntries",
  ]) {
    const now = current[key];
    const mark = prev[key];
    nextHighwater[key] = Math.max(
      Number.isFinite(now) ? now : -Infinity,
      Number.isFinite(mark) ? mark : -Infinity
    );
    if (!Number.isFinite(nextHighwater[key])) nextHighwater[key] = null;
  }

  return { ok: violations.length === 0, violations, warnings, nextHighwater };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h || !args["state-dir"]) {
    console.error(
      "사용법: node scripts/verifyArchiveIntegrity.js --state-dir <경로> [--phase before|after] [--tombstones <json>] [--highwater <json>] [--update] [--json]"
    );
    process.exit(args.help || args.h ? 0 : 1);
  }

  const stateDir = path.resolve(args["state-dir"]);
  if (!fs.existsSync(stateDir)) {
    console.error(`[verifyArchiveIntegrity] state 디렉터리가 없습니다: ${stateDir}`);
    process.exit(2);
  }
  const phase = args.phase === "after" ? "after" : "before";
  const highwaterPath = path.resolve(args.highwater || path.join(stateDir, "archive-highwater.json"));
  const tombstonesPath = path.resolve(args.tombstones || DEFAULT_TOMBSTONES);

  const current = readCurrentMetrics(stateDir);
  const highwater = fs.existsSync(highwaterPath) ? readJson(highwaterPath) : null;
  const tombstoneCount = loadTombstoneCount(tombstonesPath);

  const result = evaluateArchiveIntegrity(current, highwater, {
    tombstoneCount,
    completeShrinkTolerance: args["complete-shrink-tolerance"]
      ? Number(args["complete-shrink-tolerance"])
      : undefined,
  });

  const firstRun = !highwater;
  // after 단계는 통과 시 high-water를 올린다. before 단계는 기준이 아직 없을 때만
  // (최초 실행) 기준을 수립하고, 이후로는 읽기 전용으로 대조만 한다.
  const shouldUpdate =
    Boolean(args.update) ||
    (phase === "after" && !args["no-update"]) ||
    (phase === "before" && firstRun);

  if (args.json) {
    console.log(JSON.stringify({ phase, current, highwater, tombstoneCount, firstRun, ...result }, null, 2));
  } else {
    console.error(
      `[verifyArchiveIntegrity] phase=${phase} ${firstRun ? "(최초 — 기준 수립)" : ""} ` +
        `records=${current.specialtyRawRecords} queries=${current.checkpointQueryCount} ` +
        `complete=${current.checkpointCompleteCount} partial=${current.checkpointPartialCount}`
    );
    for (const w of result.warnings) console.error(`  경고 - ${w}`);
    for (const v of result.violations) console.error(`  위반 - ${v}`);
  }

  if (!result.ok) {
    console.error(
      "[verifyArchiveIntegrity] archive가 사유 없이 축소됐습니다. 재수집 이상·영구 디스크 유실 여부를 확인하고,\n" +
        `  의도된 제거라면 ${path.relative(ROOT, tombstonesPath)} 에 사유를 남기세요.`
    );
    process.exit(2);
  }

  if (shouldUpdate) {
    fs.mkdirSync(path.dirname(highwaterPath), { recursive: true });
    fs.writeFileSync(highwaterPath, `${JSON.stringify(result.nextHighwater, null, 2)}\n`, "utf8");
    if (!args.json) console.error(`[verifyArchiveIntegrity] high-water 갱신 -> ${highwaterPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[verifyArchiveIntegrity] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, evaluateArchiveIntegrity, readCurrentMetrics, SCHEMA_VERSION };
