"use strict";

const fs = require("fs");
const path = require("path");

// 제공기관의 실제 계정 상한·초기화 시각은 확정되지 않았다(#52).
// 이 모듈은 프로젝트의 보수적 운영 기준으로 KST 달력일 단위 예산을 관리한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const BUDGET_SCHEMA_VERSION = "ip-registry-daily-budget-v1";

function kstDateString(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function nextKstMidnightIso(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const nextMidnightKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1);
  return new Date(nextMidnightKst - KST_OFFSET_MS).toISOString();
}

function emptyState(today = kstDateString()) {
  return {
    schemaVersion: BUDGET_SCHEMA_VERSION,
    date: today,
    callsUsed: 0,
    rateLimitedAt: null,
    resumeNotBefore: null,
  };
}

function loadBudgetState(filePath, now = new Date()) {
  const today = kstDateString(now);
  if (!filePath || !fs.existsSync(filePath)) return emptyState(today);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  // 날짜가 바뀌면 전날 사용량·제한 기록은 버리고 새로 시작한다.
  if (parsed.date !== today) return emptyState(today);
  return {
    schemaVersion: BUDGET_SCHEMA_VERSION,
    date: parsed.date,
    callsUsed: Number(parsed.callsUsed) || 0,
    rateLimitedAt: parsed.rateLimitedAt || null,
    resumeNotBefore: parsed.resumeNotBefore || null,
  };
}

function saveBudgetState(filePath, state) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, filePath);
}

function isResumeBlocked(state, now = new Date()) {
  if (!state?.resumeNotBefore) return false;
  return now.getTime() < new Date(state.resumeNotBefore).getTime();
}

// 초당 제한(per_second)은 몇 초면 풀리므로 짧게(기본 90초)만 재개를 미루고, 일일 제한
// (daily)이나 종류 미상이면 예전처럼 KST 자정까지 미룬다(#52). 예전엔 전부 자정 처리라
// 초당 제한 한 번에 등록원부 수집이 하루 종일 멈췄다.
function recordRateLimit(state, now = new Date(), kind = "daily") {
  const resumeNotBefore =
    kind === "per_second"
      ? new Date(now.getTime() + 90 * 1000).toISOString()
      : nextKstMidnightIso(now);
  return { ...state, rateLimitedAt: now.toISOString(), rateLimitKind: kind, resumeNotBefore };
}

function remainingBudget(state, dailyBudget) {
  if (!Number.isFinite(dailyBudget)) return Infinity;
  return Math.max(0, dailyBudget - state.callsUsed);
}

module.exports = {
  BUDGET_SCHEMA_VERSION,
  kstDateString,
  nextKstMidnightIso,
  emptyState,
  loadBudgetState,
  saveBudgetState,
  isResumeBlocked,
  recordRateLimit,
  remainingBudget,
};
