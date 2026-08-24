#!/usr/bin/env node
"use strict";
// 2026-08-24: 로컬 보안 소프트웨어가 데스크탑의 orca 폴더 안 파일을 주기적으로 스캔하면서
// 일부 데이터 파일(예: 법정동코드·고시상품명칭 원본)을 잠그고 같은 이름에 .sLDH 확장자를
// 붙여 격리하는 일이 반복된다. 그때마다 사람이 수동으로 풀어줘야 했는데(사용자 보고), 이
// 파일들은 전부 git에 커밋된 정적 참고 데이터라 git이 이미 원본을 갖고 있다. 이 스크립트는
// *.sLDH 잔여물을 찾아 원본 경로를 git에서 복구하고 잔여물을 지워서, 사람이 보안 소프트웨어를
// 상대할 필요 없이 한 번에 정리되게 한다.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

function findLockedFiles(dir, results = []) {
  const skipDirs = new Set(["node_modules", ".git", "dist", "output"]);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findLockedFiles(full, results);
    } else if (entry.isFile() && entry.name.endsWith(".sLDH")) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const locked = findLockedFiles(REPO_ROOT);
  if (locked.length === 0) {
    console.log("[restoreLockedDataFiles] .sLDH 잔여물 없음 — 정리할 게 없습니다.");
    return;
  }
  console.log(`[restoreLockedDataFiles] .sLDH 파일 ${locked.length}개 발견`);
  let restored = 0;
  let skipped = 0;
  for (const lockedPath of locked) {
    const originalPath = lockedPath.slice(0, -".sLDH".length);
    const relOriginal = path.relative(REPO_ROOT, originalPath);
    let tracked = true;
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", relOriginal], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      tracked = false;
    }
    if (!tracked) {
      console.log(`[restoreLockedDataFiles] 건너뜀(git 미추적, 수동 확인 필요): ${relOriginal}`);
      skipped++;
      continue;
    }
    try {
      execFileSync("git", ["checkout", "--", relOriginal], { cwd: REPO_ROOT, stdio: "inherit" });
      fs.unlinkSync(lockedPath);
      console.log(`[restoreLockedDataFiles] 복구 완료: ${relOriginal} (git에서 복원, .sLDH 삭제)`);
      restored++;
    } catch (error) {
      console.error(`[restoreLockedDataFiles] 복구 실패: ${relOriginal} - ${error.message}`);
      skipped++;
    }
  }
  console.log(`[restoreLockedDataFiles] 완료 — 복구 ${restored}건, 건너뜀 ${skipped}건`);
  if (skipped > 0) process.exitCode = 1;
}

main();
