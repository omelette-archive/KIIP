#!/usr/bin/env node
"use strict";
/**
 * {지역, 품목} 입력을 받아 KIPRIS 상표 검색(getWordSearch)을 호출하고, 품목(상품류 코드)로
 * 결과를 필터링한다.
 *
 * ⚠️ 지역 매칭은 아직 구현되어 있지 않다 — getWordSearch 응답에 출원인 주소/지역 필드가 없기
 * 때문(docs/kipris-api-notes.md 참고). 지역은 요청값을 그대로 결과에 태그만 해두고
 * "미검증(unverified)"으로 표시한다. 실제 지역 매칭 방식이 정해지면 이 스크립트의
 * TODO 부분을 채운다.
 *
 * 사용법:
 *   node 03-match-trademarks/matchTrademarks.js --region "서울특별시 강남구" --item "커피" [--classCode 30]
 *                                    [--numOfRows 20] [--pageNo 1] [--out 03-match-trademarks/output/result.json]
 *
 * 인증키: .env 의 KIPRIS_API_KEY, 또는 --apiKey 로 직접 전달.
 */

const path = require("path");
const fs = require("fs");
const { loadEnv } = require("./lib/loadEnv");
const { createClient } = require("./lib/kiprisClient");
const { filterByClassCode } = require("./lib/filters");

loadEnv();

function parseArgs(argv) {
  const args = { numOfRows: 20, pageNo: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    const isFlagValue = next !== undefined && !next.startsWith("--");
    args[key] = isFlagValue ? next : true;
    if (isFlagValue) i++;
  }
  return args;
}

function printUsageAndExit(message) {
  if (message) console.error(`오류: ${message}\n`);
  console.error(
    [
      "사용법:",
      "  node 03-match-trademarks/matchTrademarks.js --region <지역명> --item <품목/키워드> [옵션]",
      "",
      "옵션:",
      "  --classCode <1-45>   NICE 상품류 코드로 결과 필터링 (응답의 classificationCode 기준)",
      "  --numOfRows <n>      페이지당 결과 수 (기본 20, 최대 100)",
      "  --pageNo <n>         페이지 번호 (기본 1)",
      "  --out <path>         결과를 JSON 파일로 저장",
      "  --apiKey <key>       KIPRIS_API_KEY 대신 직접 인증키 전달",
    ].join("\n")
  );
  process.exit(message ? 1 : 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) printUsageAndExit();
  if (!args.region || !args.item) {
    printUsageAndExit("--region 과 --item 은 필수입니다.");
  }

  const apiKey = args.apiKey || process.env.KIPRIS_API_KEY;
  const client = createClient({ apiKey });

  console.error(`[matchTrademarks] item="${args.item}" region="${args.region}" (지역은 아직 미검증 태그만 부여)`);

  const result = await client.trademarkSearch({
    searchString: String(args.item),
    numOfRows: Number(args.numOfRows),
    pageNo: Number(args.pageNo),
  });

  const hits = filterByClassCode(result.hits, args.classCode);

  const output = {
    query: {
      region: args.region,
      regionMatch: "unverified", // TODO: 실제 지역 매칭 구현 전까지 항상 unverified
      item: args.item,
      classCode: args.classCode || null,
    },
    totalCount: result.totalCount,
    returnedCount: hits.length,
    fetchedAt: new Date().toISOString(),
    hits,
  };

  const json = JSON.stringify(output, null, 2);
  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, "utf8");
    console.error(`[matchTrademarks] ${hits.length}건(전체 ${result.totalCount}건 중) -> ${outPath}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(`[matchTrademarks] 실패: ${err.message}`);
  process.exit(1);
});
