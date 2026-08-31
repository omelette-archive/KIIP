"use strict";
// 품목별 원물→가공품→서비스 전국 상표 흐름(04-analyze-brand/output/nationwide-flow.json)을
// 대시보드 품목에 참고 정보로 붙인다(#116 #74 #110). 지역 통계 분모·분자에는 섞지 않는다.
// 원물 단계 상위 출원인이 생산자형으로 확인된 품목(rawSignalConfidence=producer_confirmed)만
// 붙인다 — 나머지는 상표 브로커·대기업 방어출원·우연한 이름 일치가 섞여 있어 화면에
// 노출하면 사실과 다른 정보가 된다(2026-08-27 176개 파일럿 실측, #110 참고).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "07-dashboard", "web", "public", "data", "dashboard-snapshot.json");
const FLOW_PATH = path.join(ROOT, "04-analyze-brand", "output", "nationwide-flow.json");

const DISPLAY_PREFIXES = ["신선한 ", "미가공 "];
function officialItemLabel(item) {
  const basis = item.matchingBasis;
  if (basis !== "notice_name_and_nice_class" && basis !== "raw_item_goods_matched") return null;
  let name = (item.noticeName || "").trim();
  if (!name) return null;
  const prefix = DISPLAY_PREFIXES.find((candidate) => name.startsWith(candidate));
  if (prefix) name = name.slice(prefix.length);
  return name;
}

function stageSummary(stage) {
  const top = stage.topApplicants?.[0];
  return { count: stage.count, topRegion: top?.region || null, topApplicant: top?.applicant || null };
}

function attachNationwideBusinessFlow(snap, flow) {
  const confirmedByTerm = new Map();
  for (const [term, item] of Object.entries(flow.items)) {
    if (item.rawSignalConfidence !== "producer_confirmed") continue;
    confirmedByTerm.set(term, item);
  }

  let matched = 0;
  for (const region of snap.regions) {
    for (const item of region.items) {
      const name = officialItemLabel(item);
      if (!name) continue;
      const flowItem = confirmedByTerm.get(name);
      if (!flowItem) continue;
      item.businessFlow = {
        totalCount: flowItem.totalCount,
        stages: {
          raw: stageSummary(flowItem.stages.raw),
          processed: stageSummary(flowItem.stages.processed),
          service: stageSummary(flowItem.stages.service),
        },
      };
      matched++;
    }
  }

  const sourceIds = new Set(snap.sources.map((s) => s.sourceId));
  if (!sourceIds.has("nationwide_business_flow")) {
    snap.sources.push({
      sourceId: "nationwide_business_flow",
      sourceLabel: "품목별 전국 상표 흐름 분석(참고 지표)",
      sourceContractVersion: "nationwide-business-flow-v1-pilot",
      sourceFetchedAt: flow.generatedAt,
      sourceUrl: null,
      sourceLastVerifiedAt: "2026-08-27",
      idOrigin: "derived",
    });
  }
  snap.warnings = [...new Set([
    ...snap.warnings,
    `품목별 전국 상표 흐름(원물·가공품·서비스) 참고 지표를 ${matched}개 품목에 연결했습니다 — 지역 통계와는 분리된 전국 단위 참고 정보입니다.`,
  ])];

  return { matched, confirmedCount: confirmedByTerm.size };
}

function main() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  const flow = JSON.parse(fs.readFileSync(FLOW_PATH, "utf8"));
  const result = attachNationwideBusinessFlow(snap, flow);
  console.log("matched:", result.matched, "/ producer_confirmed 품목:", result.confirmedCount);
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + "\n", "utf8");
  console.log("saved.");
}

if (require.main === module) main();

module.exports = { attachNationwideBusinessFlow, officialItemLabel };
