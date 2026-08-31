"use strict";
// 지역특화작목(농촌진흥청, 2025) 등급·공식명칭을 대시보드 품목에 붙인다.
// #117 후속부터 69개는 도 단위 공식 특산품 수집원으로도 사용한다.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "07-dashboard", "web", "public", "data", "dashboard-snapshot.json");
const REF_PATH = path.join(ROOT, "02-normalize-items", "data", "regional-specialty-crops-2025.json");

// "전남광주통합특별시"는 병합 소스 특성상 별도 표기가 붙은 것일 뿐 전라남도와 같은 도다.
const SIDO_ALIASES = { "전남광주통합특별시": "전라남도" };

function baseNames(itemName) {
  const withoutParens = itemName.replace(/\([^)]*\)/g, "").trim();
  const parenMatch = itemName.match(/\(([^)]*)\)/);
  const parts = new Set();
  if (withoutParens) parts.add(withoutParens);
  for (const chunk of [withoutParens, parenMatch ? parenMatch[1] : ""]) {
    for (const piece of chunk.split(/[·ㆍ,\/]/)) {
      const trimmed = piece.trim();
      if (trimmed) parts.add(trimmed);
    }
  }
  return [...parts];
}

function stripDisplayPrefix(name) {
  for (const prefix of ["신선한 ", "미가공 "]) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

function attachRegionalSpecialtyCropBadges(snap, ref) {
  const provinceLookup = new Map();
  for (const [province, entries] of Object.entries(ref.provinces)) {
    const table = new Map();
    for (const entry of entries) {
      for (const name of baseNames(entry.itemName)) {
        if (!table.has(name)) table.set(name, []);
        table.get(name).push({ tier: entry.tier, itemName: entry.itemName });
      }
    }
    provinceLookup.set(province, table);
  }

  let matched = 0;
  const matchedByTier = { 대표작목: 0, 집중육성작목: 0, 자체육성작목: 0 };
  for (const region of snap.regions) {
    if (region.sido === "전국") continue;
    const province = SIDO_ALIASES[region.sido] || region.sido;
    const table = provinceLookup.get(province);
    if (!table) continue;
    for (const item of region.items) {
      const candidate = stripDisplayPrefix((item.noticeName || item.itemName || "").trim());
      const rows = table.get(candidate);
      if (!rows || rows.length === 0) continue;
      item.regionalSpecialtyCropBadge = {
        tier: rows[0].tier,
        officialItemName: rows[0].itemName,
        referenceYear: ref.referenceYear,
      };
      matched++;
      matchedByTier[rows[0].tier] = (matchedByTier[rows[0].tier] || 0) + 1;
    }
  }

  const sourceIds = new Set(snap.sources.map((s) => s.sourceId));
  if (!sourceIds.has("rda_regional_specialty_crops")) {
    snap.sources.push({
      sourceId: "rda_regional_specialty_crops",
      sourceLabel: ref.sourceName,
      sourceContractVersion: ref.schemaVersion,
      sourceFetchedAt: ref.generatedAt,
      sourceUrl: ref.sourceUrl,
      sourceLastVerifiedAt: "2026-08-26",
      idOrigin: "upstream",
    });
  }
  snap.warnings = [...new Set([
    ...snap.warnings,
    `농촌진흥청 지역특화작목 69개를 도 단위 공식 특산품으로 수집하고 ${matched}개 대시보드 품목에 정책 배지를 연결했습니다. 시군구로는 추정 귀속하지 않습니다.`,
  ])];

  return { matched, matchedByTier };
}

function main() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  const ref = JSON.parse(fs.readFileSync(REF_PATH, "utf8"));
  const result = attachRegionalSpecialtyCropBadges(snap, ref);
  console.log("matched:", result.matched, JSON.stringify(result.matchedByTier));
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + "\n", "utf8");
  console.log("saved.");
}

if (require.main === module) main();

module.exports = { attachRegionalSpecialtyCropBadges, baseNames };
