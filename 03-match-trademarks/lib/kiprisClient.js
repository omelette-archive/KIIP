"use strict";
/**
 * KIPRIS Plus 상표 검색(trademarkInfoSearchService/getWordSearch) 클라이언트.
 * korean-patent-mcp 의 api-client.ts 호출 방식을 포팅 (참고: docs/kipris-api-notes.md).
 *
 * 알려진 제약: getWordSearch 응답에는 출원인 주소/지역 필드가 없다. 전체 지역 조인은 #11,
 * 농사로 지역브랜드 subset 검증은 #24에서 관리한다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");
const { parseTrademarkResponse } = require("./xmlLite");
const { KiprisApiError } = require("./errors");

const PROTO = process.env.KIPRIS_API_PROTOCOL === "http" ? "http" : "https";
const TRADEMARK_BASE = `${PROTO}://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService`;
const KIPRIS_CONTRACT_VERSION = "kipris-trademark-word-search-v1";
const KIPRIS_SOURCE_METADATA = Object.freeze({
  sourceId: "kipris_trademark",
  provider: "지식재산처 KIPRISPlus",
  dataset: "상표 단어검색",
  portalUrl: "https://plus.kipris.or.kr",
  endpoint: `${TRADEMARK_BASE}/getWordSearch`,
  operation: "trademarkInfoSearchService/getWordSearch",
  contractVersion: KIPRIS_CONTRACT_VERSION,
  lastContractVerifiedAt: "2026-08-10",
});

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

function createClient({ apiKey, fetchImpl } = {}) {
  if (!apiKey) {
    throw new Error(
      "KIPRIS 인증키가 필요합니다. .env 의 KIPRIS_API_KEY 를 설정하거나 --apiKey 로 전달하세요."
    );
  }

  /**
   * 상표명 키워드로 검색.
   * @param {{ searchString: string, numOfRows?: number, pageNo?: number }} p
   * @returns {Promise<{ resultCode: string, resultMsg: string, totalCount: number, hits: object[] }>}
   */
  async function trademarkSearch(p) {
    const numOfRows = p.numOfRows ?? 10;
    const pageNo = p.pageNo ?? 1;
    const query = buildQuery({
      searchString: p.searchString,
      numOfRows,
      docsCount: numOfRows,
      pageNo,
      ServiceKey: apiKey,
    });

    const res = await fetchWithRetry(`${TRADEMARK_BASE}/getWordSearch?${query}`, {}, fetchImpl);
    if (!res.ok) {
      throw new Error(`trademarkSearch: API 오류 (${res.status})`);
    }
    const xml = await res.text();
    const trimmed = xml.trim();
    if (!trimmed) throw new Error("trademarkSearch: 빈 응답 (일시적 장애일 수 있음)");
    const head = trimmed.slice(0, 200).toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
      throw new Error("trademarkSearch: KIPRIS 서비스 오류 응답(HTML) — 일시적 장애일 수 있습니다.");
    }

    const parsed = parseTrademarkResponse(trimmed);
    if (!parsed.resultCode) {
      throw new KiprisApiError("99", "응답에 resultCode 가 없습니다(빈 응답일 수 있음)");
    }
    if (parsed.resultCode !== "00" && parsed.resultCode !== "20") {
      throw new KiprisApiError(parsed.resultCode, parsed.resultMsg);
    }
    return parsed; // resultCode 20(결과없음)은 hits=[] 로 정상 반환
  }

  return { trademarkSearch };
}

module.exports = {
  createClient,
  KIPRIS_CONTRACT_VERSION,
  KIPRIS_SOURCE_METADATA,
  TRADEMARK_BASE,
};
