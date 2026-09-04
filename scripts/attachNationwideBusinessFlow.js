"use strict";
// 품목별 원물→가공품→서비스 전국 상표 흐름(04-analyze-brand/output/nationwide-flow.json)을
// 대시보드 품목에 참고 정보로 붙인다(#116 #74 #110). 지역 통계 분모·분자에는 섞지 않는다.
//
// 2026-08-31(#110 확대): 단계별 "건수"는 NICE류+상표명 텍스트 판정만으로 나오는 값이라
// 176개 품목 전부에 붙여도 된다 — 신뢰도 문제는 "이 지역이 산지다"라는 지역 클러스터
// 주장에만 있다(원물 단계 상위 출원인이 상표 브로커·대기업 방어출원·우연한 이름 일치일 수
// 있음, 2026-08-27 실측). 그래서 rawSignalConfidence=producer_confirmed(현재 39/176)인
// 품목만 topRegion/topApplicant(지역 관련 필드)를 붙이고, 나머지(uncertain)는 단계별
// 건수만 보여주고 지역 필드는 아예 넣지 않는다 — 화면에 "AI 판정"류 표시 없이도 조용히
// 안전한 부분만 노출하는 방식.
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

function stageSummary(stage, includeRegion) {
  const top = stage.topApplicants?.[0];
  // 이슈 #116(2026-09-01): 단계별 상표명 예시(대표/이색)는 지역 귀속과 무관하므로
  // includeRegion 여부와 상관없이 항상 통과시킨다. 예시 수집 전 실행분(examples 없음)은
  // null로 둬서 대시보드가 조용히 건너뛴다.
  const examples = stage.examples && (stage.examples.representative?.length || stage.examples.unusual?.length)
    ? { representative: stage.examples.representative || [], unusual: stage.examples.unusual || [] }
    : null;
  return {
    count: stage.count,
    topRegion: includeRegion ? top?.region || null : null,
    topApplicant: includeRegion ? top?.applicant || null : null,
    examples,
    // 이슈 #119(2026-09-02): 단계별 주요 상품류·상위 지역. 상품류는 지역 귀속과 무관.
    // 상위 지역은 상위 출원인 주소 기준 근사치라 rawSignalConfidence와 상관없이 통과시키되,
    // "특산품 관리 지역 고려 X"라는 성격이므로 그대로 노출한다.
    classes: Array.isArray(stage.classes) && stage.classes.length ? stage.classes : null,
    topRegions: Array.isArray(stage.topRegions) && stage.topRegions.length ? stage.topRegions : null,
  };
}

function attachNationwideBusinessFlow(snap, flow) {
  const flowByTerm = new Map();
  for (const [term, item] of Object.entries(flow.items)) {
    if (item.mode === "craft") continue; // 공예품 등은 원물/가공품 구분 자체가 안 맞음
    flowByTerm.set(term, item);
  }

  let matched = 0;
  let confirmedCount = 0;
  for (const region of snap.regions) {
    for (const item of region.items) {
      const name = officialItemLabel(item);
      if (!name) continue;
      const flowItem = flowByTerm.get(name);
      if (!flowItem) continue;
      const includeRegion = flowItem.rawSignalConfidence === "producer_confirmed";
      if (includeRegion) confirmedCount++;
      item.businessFlow = {
        totalCount: flowItem.totalCount,
        hasRegionalSignal: includeRegion,
        stages: {
          raw: stageSummary(flowItem.stages.raw, includeRegion),
          processed: stageSummary(flowItem.stages.processed, includeRegion),
          service: stageSummary(flowItem.stages.service, includeRegion),
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
    `품목별 전국 상표 흐름(원물·가공품·서비스) 참고 지표를 ${matched}개 품목에 연결했습니다(그중 ${confirmedCount}개는 지역 신호까지 포함) — 지역 통계와는 분리된 전국 단위 참고 정보입니다.`,
  ])];

  return { matched, confirmedCount };
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotPath = path.resolve(args.input || SNAPSHOT_PATH);
  const outPath = path.resolve(args.out || args.input || SNAPSHOT_PATH);
  const flowPath = path.resolve(args.flow || FLOW_PATH);
  const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  if (!fs.existsSync(flowPath)) {
    // 운영 파이프라인은 04-analyze-brand/output/nationwide-flow.json이 아직 없을 수 있다
    // (전국 흐름 배치는 별도 실행). 그 경우 스냅샷을 그대로 통과시킨다.
    console.log(`[attachNationwideBusinessFlow] flow 파일 없음(${flowPath}) — 스냅샷 그대로 통과`);
    if (outPath !== snapshotPath) fs.writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n", "utf8");
    return;
  }
  const flow = JSON.parse(fs.readFileSync(flowPath, "utf8"));
  const result = attachNationwideBusinessFlow(snap, flow);
  console.log("matched:", result.matched, "/ producer_confirmed 품목:", result.confirmedCount);
  fs.writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n", "utf8");
  console.log("saved.");
}

if (require.main === module) main();

module.exports = { attachNationwideBusinessFlow, officialItemLabel };
