"use strict";

// ①~⑦ 각 단계 output/ 폴더는 전부 .gitignore 처리된 실행 산출물 스크래치 공간이다(git
// 추적 없음, 테스트·selftest도 참조하지 않음 — 코드에서 하드코딩된 참조가 없음을 확인함).
// 반복 실행마다 날짜가 박힌 파일(batch/analysis/snapshot 등)이 계속 쌓여 03-match-trademarks
// 만 1.2GB를 넘게 차지한 상태라, 오래된 산출물을 안전하게 정리하는 CLI다.
//
// 절대 지우지 않는 것: 여러 날에 걸쳐 이어지는 재개형 수집 상태 파일(등록원부 캐시·일일
// 호출 예산, 출원인 주소 캐시)과 .gitkeep. 이 파일들은 오래됐다고 지우면 진행 중인 다일
// 수집 작업이 캐시 없이 처음부터 다시 돌아야 한다.
//
// 사용법:
//   node scripts/cleanupPipelineOutputs.js --days 3          # 미리보기(기본, 삭제 안 함)
//   node scripts/cleanupPipelineOutputs.js --days 3 --apply  # 실제 삭제

const fs = require("fs");
const path = require("path");

const STAGE_OUTPUT_DIRS = [
  "01-collect-specialties/output",
  "02-normalize-items/output",
  "03-match-trademarks/output",
  "04-analyze-brand/output",
  "05-detect-brand-gap/output",
  "06-generate-business-strategy/output",
  "07-dashboard/output",
];

const NEVER_DELETE_PATTERNS = [
  /^ip-registry-cache-/,
  /^ip-registry-daily-budget-/,
  /^trademark-applicant-region-cache-/,
  /^\.gitkeep$/,
];

function parseArgs(argv) {
  const args = { days: 3, apply: false, dirs: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--days") args.days = Number(argv[++i]);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dirs") args.dirs = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!Number.isFinite(args.days) || args.days < 0) {
    throw new Error("--days는 0 이상의 숫자여야 합니다.");
  }
  return args;
}

function isNeverDelete(fileName) {
  return NEVER_DELETE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)}${units[unitIndex]}`;
}

function collectCandidates(rootDir, dirs, thresholdMs, now) {
  const kept = [];
  const candidates = [];
  for (const relDir of dirs) {
    const absDir = path.join(rootDir, relDir);
    if (!fs.existsSync(absDir)) continue;
    for (const fileName of fs.readdirSync(absDir)) {
      const absPath = path.join(absDir, fileName);
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) continue;
      if (isNeverDelete(fileName)) {
        kept.push({ dir: relDir, fileName, size: stat.size, reason: "보존 대상(캐시·예산 상태 파일)" });
        continue;
      }
      const ageMs = now - stat.mtimeMs;
      if (ageMs > thresholdMs) {
        candidates.push({ dir: relDir, fileName, size: stat.size, absPath, ageDays: Math.floor(ageMs / 86400000) });
      }
    }
  }
  return { candidates, kept };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(__dirname, "..");
  const dirs = args.dirs || STAGE_OUTPUT_DIRS;
  const thresholdMs = args.days * 86400000;
  const now = Date.now();

  const { candidates, kept } = collectCandidates(rootDir, dirs, thresholdMs, now);
  const totalSize = candidates.reduce((sum, row) => sum + row.size, 0);

  console.log(`[cleanupPipelineOutputs] 기준: ${args.days}일 이상 경과 (${args.apply ? "실제 삭제" : "미리보기, --apply 없이 실행됨"})`);
  console.log(`[cleanupPipelineOutputs] 보존 대상(캐시·예산 상태 파일) ${kept.length}개는 나이와 무관하게 건너뜁니다.`);
  console.log("");

  if (candidates.length === 0) {
    console.log("삭제 대상 없음.");
    return;
  }

  candidates.sort((a, b) => b.size - a.size);
  for (const row of candidates) {
    console.log(`${args.apply ? "삭제" : "삭제 예정"}  ${row.dir}/${row.fileName}  (${formatBytes(row.size)}, ${row.ageDays}일 경과)`);
  }
  console.log("");
  console.log(`대상 ${candidates.length}개, 합계 ${formatBytes(totalSize)}`);

  if (args.apply) {
    // 운영 파이프라인의 한 단계로 실행되므로(scripts/runOperationalPipeline.js), 파일
    // 하나가 다른 프로세스에 잠겨 있어도 정리 자체가 본 파이프라인을 막아서는 안 된다 —
    // 실패한 파일만 건너뛰고 계속 진행한다.
    let deletedCount = 0;
    let deletedSize = 0;
    for (const row of candidates) {
      try {
        fs.unlinkSync(row.absPath);
        deletedCount++;
        deletedSize += row.size;
      } catch (error) {
        console.warn(`삭제 실패(건너뜀): ${row.dir}/${row.fileName} — ${error.message}`);
      }
    }
    console.log(`\n${deletedCount}/${candidates.length}개 파일 삭제 완료, ${formatBytes(deletedSize)} 확보.`);
  } else {
    console.log("\n실제로 지우려면 --apply를 붙여 다시 실행하세요.");
  }
}

main();
