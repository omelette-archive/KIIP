#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../03-match-trademarks/lib/loadEnv");
loadEnv();
const { createClient: createKiprisClient } = require("../03-match-trademarks/lib/kiprisClient");
const { createClient: createApplicantClient } = require("../03-match-trademarks/lib/trademarkApplicantClient");
const { loadAdminCodes } = require("../01-collect-specialties/lib/adminCodes");
const { normalizeApplicantAddress } = require("../03-match-trademarks/lib/ipRegistryEnricher");
const { loadCache, saveCache } = require("../03-match-trademarks/lib/trademarkApplicantCache");
const {
  aggregateHits,
  topApplicantsByStage,
  stageExamples,
  designatedGoodsExamples,
  collectStageDesignatedGoods,
  stageClassDistribution,
  stageTopRegions,
  collectNationwideHits,
  resolveApplicantRegion,
  deriveAgriCoreItems,
  rawSignalConfidence,
} = require("./lib/nationwideFlow");

const SCHEMA_VERSION = "nationwide-business-flow-v1-pilot";

function parseArgs(argv) {
  const args = {
    maxPages: 30,
    numOfRows: 100,
    maxHits: 3000,
    topApplicants: 5,
    out: path.join(__dirname, "output", "nationwide-flow.json"),
    cache: path.join(__dirname, "output", "nationwide-flow-applicant-cache.json"),
    "goods-cache": path.join(__dirname, "output", "nationwide-flow-goods-cache.json"),
    "goods-per-stage": 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith("--");
    args[key] = hasValue ? next : true;
    if (hasValue) i++;
  }
  return args;
}

function usage(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 04-analyze-brand/analyzeNationwideFlow.js --input <07단계 dashboard-snapshot.json> [옵션]",
      "",
      "옵션:",
      "  --out <path>            출력 경로 (기본: 04-analyze-brand/output/nationwide-flow.json)",
      "  --cache <path>          출원인 주소 캐시 (기본: 04-analyze-brand/output/nationwide-flow-applicant-cache.json)",
      "  --limit <n>             처음 n개 품목만 처리(파일럿/테스트용)",
      "  --terms <a,b,c>         자동 추출 대신 지정한 검색어만 처리(쉼표 구분)",
      "  --maxPages <n>          검색어당 최대 페이지 수 (기본 30)",
      "  --numOfRows <n>         페이지당 건수 (기본 100)",
      "  --maxHits <n>           검색어당 최대 수집 건수 (기본 3000)",
      "  --topApplicants <n>     단계별 주소를 조회할 상위 출원인 수 (기본 5)",
      "  --goods-per-stage <n>   단계별 상위 n개 출원의 지정상품명을 조회해 대표·이색 예시를",
      "                          상표명 대신 지정상품명에서 뽑는다(#136). 0=끔(기본, 상표명 예시)",
      "  --goods-cache <path>    지정상품 조회 캐시 (기본: output/nationwide-flow-goods-cache.json)",
      "  --dry-run               API 호출 없이 추출된 검색어 목록만 출력",
      "  --force                 --out에 이미 있는 품목도 다시 수집(기본은 이어서 처리)",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

function loadExistingOutput(outPath) {
  if (!fs.existsSync(outPath)) return { schemaVersion: SCHEMA_VERSION, generatedAt: null, items: {} };
  const parsed = JSON.parse(fs.readFileSync(outPath, "utf8").replace(/^﻿/, ""));
  if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error("기존 출력의 schemaVersion이 다릅니다 — --force로 덮어쓰거나 --out을 바꾸세요.");
  return parsed;
}

function writeOutput(outPath, document) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, outPath);
}

// 지정상품 조회 캐시(출원번호 → { status, designatedGoods }). Map 인터페이스로 감싼다.
const GOODS_CACHE_SCHEMA = "nationwide-flow-goods-cache-v1";
function loadGoodsCache(cachePath) {
  const map = new Map();
  if (cachePath && fs.existsSync(cachePath)) {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8").replace(/^﻿/, ""));
    if (parsed.schemaVersion === GOODS_CACHE_SCHEMA) {
      for (const [key, value] of Object.entries(parsed.entries || {})) map.set(key, value);
    }
  }
  return map;
}
function saveGoodsCache(cachePath, map) {
  if (!cachePath) return;
  const entries = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const document = { schemaVersion: GOODS_CACHE_SCHEMA, updatedAt: new Date().toISOString(), entries };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  fs.renameSync(tempPath, cachePath);
}

async function processTerm(term, mode, { kiprisClient, applicantClient, adminList, applicantCache, goodsCache, options }) {
  const goodsPerStage = Number(options["goods-per-stage"]) || 0;
  const collected = await collectNationwideHits(kiprisClient, term, {
    maxPages: Number(options.maxPages),
    numOfRows: Number(options.numOfRows),
    maxHits: Number(options.maxHits),
  });
  const stages = aggregateHits(collected.hits, term, mode);
  const stageSummary = {};
  for (const key of Object.keys(stages)) {
    const topApplicants = topApplicantsByStage(stages[key], Number(options.topApplicants));
    const withRegion = [];
    for (const applicant of topApplicants) {
      let region = { status: "unmatched" };
      try {
        region = await resolveApplicantRegion(
          applicantClient,
          applicant.sampleApplicationNumber,
          adminList,
          normalizeApplicantAddress,
          applicantCache
        );
      } catch (error) {
        console.error(`    출원인 주소 조회 실패(${applicant.applicant}): ${error.message}`);
      }
      withRegion.push({ ...applicant, region: region.status === "matched" ? region.normalizedRegion : null });
    }
    // 이슈 #136: goods-per-stage가 켜지면 지정상품명 풀에서 대표·이색을 뽑고, 풀이 비면
    // 기존 상표명 예시로 폴백한다. exampleSource로 소비 측이 라벨을 분기한다.
    let examples = { ...stageExamples(stages[key], term), source: "trademark_title" };
    if (goodsPerStage > 0 && stages[key].length) {
      const goodsPool = await collectStageDesignatedGoods(stages[key], kiprisClient, {
        perStage: goodsPerStage,
        goodsCache,
      });
      const fromGoods = designatedGoodsExamples(goodsPool, term);
      if (fromGoods.representative.length || fromGoods.unusual.length) {
        examples = { ...fromGoods, source: "designated_goods" };
      }
    }
    stageSummary[key] = {
      count: stages[key].length,
      topApplicants: withRegion,
      examples,
      // 이슈 #119(2026-09-02): 단계별 주요 상품류(NICE), 상위 지역·점유율.
      classes: stageClassDistribution(stages[key]),
      topRegions: stageTopRegions(withRegion),
    };
  }
  return {
    term,
    mode,
    totalCount: collected.totalCount,
    fetchedCount: collected.fetchedCount,
    collectionStatus: collected.collectionStatus,
    stopReason: collected.stopReason,
    fetchedAt: new Date().toISOString(),
    // 176개 파일럿 실측(2026-08-27, #110) 결과 23%만 상위 출원인이 실제 생산자형이었다.
    // "uncertain"인 품목은 소비 측(대시보드 등)에서 클러스터 서술을 노출하면 안 된다.
    rawSignalConfidence: mode === "craft" ? "not_applicable" : rawSignalConfidence(stageSummary.raw?.topApplicants),
    stages: stageSummary,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) usage();

  let terms;
  if (args.terms) {
    terms = String(args.terms).split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    if (!args.input) usage("--input 또는 --terms 중 하나는 필수입니다.");
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8").replace(/^﻿/, ""));
    terms = deriveAgriCoreItems(snapshot);
  }
  if (args.limit) terms = terms.slice(0, Number(args.limit));

  if (args["dry-run"]) {
    console.log(`검색어 ${terms.length}개:`);
    console.log(terms.join(", "));
    return;
  }

  const outPath = path.resolve(args.out);
  const cachePath = path.resolve(args.cache);
  const goodsPerStage = Number(args["goods-per-stage"]) || 0;
  const goodsCachePath = goodsPerStage > 0 ? path.resolve(args["goods-cache"]) : null;
  const output = loadExistingOutput(outPath);
  const applicantCache = loadCache(cachePath);
  const goodsCache = goodsCachePath ? loadGoodsCache(goodsCachePath) : new Map();

  const apiKey = args.apiKey || process.env.KIPRIS_API_KEY;
  if (!apiKey) throw new Error("KIPRIS_API_KEY가 필요합니다 (.env 또는 --apiKey).");
  const kiprisClient = createKiprisClient({ apiKey });
  const applicantClient = createApplicantClient({ apiKey });
  const adminList = loadAdminCodes();

  const pending = terms.filter((term) => args.force || !output.items[term]);
  console.error(`전체 ${terms.length}개 중 처리 대상 ${pending.length}개 (이미 완료 ${terms.length - pending.length}개)`);

  for (const [index, term] of pending.entries()) {
    console.error(`[${index + 1}/${pending.length}] ${term} 검색 중...`);
    try {
      const result = await processTerm(term, "agri", { kiprisClient, applicantClient, adminList, applicantCache, goodsCache, options: args });
      output.items[term] = result;
      output.generatedAt = new Date().toISOString();
      writeOutput(outPath, output);
      saveCache(cachePath, applicantCache);
      if (goodsCachePath) saveGoodsCache(goodsCachePath, goodsCache);
      console.error(`  -> totalCount=${result.totalCount} fetched=${result.fetchedCount} 원물=${result.stages.raw.count} 가공품=${result.stages.processed.count} 서비스=${result.stages.service.count}`);
    } catch (error) {
      console.error(`  -> 오류: ${error.message} (건너뜀, 다음 실행에서 재시도)`);
    }
  }
  console.error(`완료. 출력: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
