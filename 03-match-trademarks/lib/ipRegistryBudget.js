"use strict";

const fs = require("fs");
const path = require("path");

// 제공기관 잔여량은 계정 단위로 매일(KST) 초기화되는 것으로 관측됐다(#52, 2026-08-11 429 실측).
// 달력일 경계를 KST로 고정해 예산을 관리한다.
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

function recordRateLimit(state, now = new Date()) {
  return { ...state, rateLimitedAt: now.toISOString(), resumeNotBefore: nextKstMidnightIso(now) };
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
