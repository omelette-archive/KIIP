#!/usr/bin/env node
"use strict";
/**
 * 2026-09-09 — 이미 만들어진 대시보드 스냅샷에 품목 유형을 채워 넣는다.
 *
 * 07-dashboard/lib/snapshot.js의 itemCategory()를 고쳐도 그건 스냅샷을 새로 만들 때 적용된다.
 * 파이프라인 재실행 전까지 라이브 스냅샷은 옛 값을 그대로 들고 있으므로, 같은 규칙을 이미
 * 커밋된 스냅샷에 한 번 입힌다(런북 §"보완 소스의 대시보드 병합은 아직 파이프라인 밖 패치
 * 스크립트" — 라이브 스냅샷이 패치 누적본인 기존 관행과 같다).
 *
 * 규칙은 snapshot.js와 한 곳에서 가져오므로 두 경로가 갈라지지 않는다. category가 이미 있는
 * 행은 건드리지 않는다.
 *
 * 사용법:
 *   node scripts/applyItemCategoryProposals.js [--snapshot <경로>] [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const { itemCategory } = require("../07-dashboard/lib/snapshot");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const snapshotPath = path.resolve(
    args.snapshot || path.join(__dirname, "..", "07-dashboard", "web", "public", "data", "dashboard-snapshot.json")
  );
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8").replace(/^﻿/, ""));

  const counts = { filled: 0, provisional: 0, already: 0, stillNull: 0 };
  for (const region of snapshot.regions || []) {
    for (const item of region.items || []) {
      if (item.category) { counts.already += 1; continue; }
      const category = itemCategory({
        noticeName: item.noticeName,
        itemName: item.itemName,
        matchingBasis: item.matchingBasis,
      });
      if (!category) { counts.stillNull += 1; continue; }
      item.category = category;
      counts.filled += 1;
      if (category.provisional) counts.provisional += 1;
    }
  }

  console.log(
    `유형 채움 ${counts.filled}행(그중 검토 전 제안 ${counts.provisional}) · ` +
      `이미 있음 ${counts.already} · 여전히 미분류 ${counts.stillNull}`
  );
  if (args["dry-run"]) {
    console.log("--dry-run: 파일을 쓰지 않았습니다.");
    return;
  }
  // 빌더(buildDashboardSnapshot.js)와 같은 형식으로 쓴다 — 한 줄로 접으면 29MB 산출물의
  // diff가 통째로 뒤집히고, 다음 파이프라인 실행에서 또 뒤집힌다.
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`스냅샷 갱신 -> ${snapshotPath}`);
}

if (require.main === module) main();
module.exports = { main };
