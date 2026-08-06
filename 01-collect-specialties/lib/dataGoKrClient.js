"use strict";
/**
 * data.go.kr(공공데이터포털) OpenAPI 공통 클라이언트. 대다수 공공데이터포털 서비스가
 * 따르는 표준 응답 포맷(response.header.resultCode/resultMsg,
 * response.body.items.item[], response.body.totalCount)을 기준으로 파싱한다.
 * 서비스마다 실제 baseUrl/오퍼레이션명은 다르므로 각 소스별 클라이언트
 * (giClient.js, nongsaroClient.js)에서 호출 시 지정한다.
 *
 * 인증: 활용신청 승인 후 발급되는 서비스키를 serviceKey 파라미터로 전달.
 */

const { fetchWithRetry } = require("./fetchWithRetry");

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

/**
 * @param {{apiKey:string, fetchImpl?:typeof fetch}} config
 */
function createClient({ apiKey, fetchImpl } = {}) {
  if (!apiKey) {
    throw new Error(
      "data.go.kr 활용신청 후 발급된 서비스키(apiKey)가 필요합니다. .env에 설정하거나 직접 전달하세요."
    );
  }

  /**
   * @param {{baseUrl:string, operation:string, params?:object}} p
   *   baseUrl: 활용신청 승인 후 마이페이지에서 확인한 서비스 엔드포인트(기관코드/서비스명 포함)
   * @returns {Promise<{resultCode:string, resultMsg:string, totalCount:number, items:object[]}>}
   */
  async function callOperation({ baseUrl, operation, params = {} }) {
    if (!baseUrl) throw new Error("callOperation: baseUrl이 필요합니다 (활용신청 승인 후 확인).");
    const query = buildQuery({ ...params, serviceKey: apiKey, type: "json" });
    const url = `${baseUrl}/${operation}?${query}`;

    const res = await fetchWithRetry(url, {}, fetchImpl);
    if (!res.ok) {
      throw new Error(`dataGoKr(${operation}): API 오류 (${res.status})`);
    }
    const json = await res.json();
    const header = (json.response && json.response.header) || {};
    const body = (json.response && json.response.body) || {};
    const resultCode = header.resultCode;
    // data.go.kr 표준 규약: "00"이 정상. 서비스에 따라 숫자 "0"을 쓰는 경우도 있어 함께 허용.
    if (resultCode !== undefined && resultCode !== "00" && resultCode !== "0") {
      throw new Error(`dataGoKr(${operation}): [${resultCode}] ${header.resultMsg || "알 수 없는 오류"}`);
    }
    const rawItems = body.items && body.items.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    return {
      resultCode: resultCode || "00",
      resultMsg: header.resultMsg || "",
      totalCount: Number(body.totalCount) || items.length,
      items,
    };
  }

  /**
   * totalCount까지 모든 페이지를 순회해서 items를 모아 반환한다. 목록형 데이터를 통째로
   * 로컬 데이터셋으로 만드는 게 목적이라, 소스별 클라이언트는 기본적으로 이걸 쓴다.
   * @param {{baseUrl:string, operation:string, params?:object, pageSize?:number, maxPages?:number}} p
   * @returns {Promise<{totalCount:number, items:object[]}>}
   */
  async function fetchAllPages({ baseUrl, operation, params = {}, pageSize = 100, maxPages = 100 }) {
    const first = await callOperation({ baseUrl, operation, params: { ...params, pageNo: 1, numOfRows: pageSize } });
    const items = first.items.slice();
    const totalPages = Math.min(maxPages, Math.max(1, Math.ceil(first.totalCount / pageSize)));
    for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
      const page = await callOperation({ baseUrl, operation, params: { ...params, pageNo, numOfRows: pageSize } });
      if (page.items.length === 0) break; // totalCount를 못 믿을 수도 있으니 빈 페이지 나오면 조기 종료
      items.push(...page.items);
    }
    return { totalCount: first.totalCount, items };
  }

  return { callOperation, fetchAllPages };
}

module.exports = { createClient, buildQuery };
