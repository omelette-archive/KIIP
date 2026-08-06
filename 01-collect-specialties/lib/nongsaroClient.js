"use strict";
/**
 * 농촌진흥청 농사로 지역특산물 OpenAPI 클라이언트.
 * 공식 매뉴얼의 localSpcprd/localSpcprdLst 계약(apiKey + XML)을 따른다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");
const { parseNongsaroResponse } = require("./xmlLite");

const DEFAULT_BASE_URL = "https://api.nongsaro.go.kr/service/localSpcprd";

function createClient({
  apiKey,
  baseUrl,
  operation = "localSpcprdLst",
  fetchImpl,
} = {}) {
  if (!apiKey) {
    throw new Error("농사로 Open API 인증키(apiKey)가 필요합니다.");
  }
  const serviceBaseUrl = baseUrl || DEFAULT_BASE_URL;

  /**
   * @param {{pageNo?:number, numOfRows?:number, limit?:number, sText?:string, sAreaNm?:string, sAreaCode?:string}} [p]
   * @returns {Promise<{title:string, region:string, registrationDate:string, raw:object}[]>}
   */
  async function listSpecialties(p = {}) {
    let pageNo = Number(p.pageNo || 1);
    const numOfRows = Number(p.numOfRows || 100);
    const limit = p.limit === undefined ? null : Number(p.limit);
    if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error("pageNo는 1 이상의 정수여야 합니다.");
    if (!Number.isInteger(numOfRows) || numOfRows < 1) throw new Error("numOfRows는 1 이상의 정수여야 합니다.");
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error("limit은 1 이상의 정수여야 합니다.");
    }

    const items = [];
    let totalCount = 0;
    while (true) {
      const remaining = limit === null ? numOfRows : Math.min(numOfRows, limit - items.length);
      const query = new URLSearchParams({
        apiKey,
        pageNo: String(pageNo),
        numOfRows: String(remaining),
      });
      for (const key of ["sText", "sAreaNm", "sAreaCode"]) {
        if (p[key]) query.set(key, String(p[key]));
      }
      const url = `${String(serviceBaseUrl).replace(/\/$/, "")}/${operation}?${query}`;
      const response = await fetchWithRetry(url, {}, fetchImpl);
      if (!response.ok) throw new Error(`nongsaro(${operation}): API 오류 (${response.status})`);
      const parsed = parseNongsaroResponse(await response.text());
      if (parsed.resultCode !== "00" && parsed.resultCode !== "0") {
        throw new Error(
          `nongsaro(${operation}): [${parsed.resultCode || "unknown"}] ${parsed.resultMsg || "알 수 없는 오류"}`
        );
      }
      items.push(...parsed.items);
      totalCount = Math.max(totalCount, parsed.totalCount);
      if (
        parsed.items.length === 0 ||
        (limit !== null && items.length >= limit) ||
        (totalCount > 0 && items.length >= totalCount) ||
        (totalCount <= 0 && parsed.items.length < remaining)
      ) break;
      pageNo++;
    }

    return items.slice(0, limit || items.length).map((item) => ({
      title: item.title,
      region: item.region,
      registrationDate: item.registrationDate,
      raw: item,
    }));
  }

  return { listSpecialties };
}

module.exports = { createClient, DEFAULT_BASE_URL };
