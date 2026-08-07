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
   * data.go.kr 목록형 API를 totalCount까지 페이지 순회해 모두 가져온다.
   * @param {{baseUrl:string, operation:string, params?:object, pageNo?:number, numOfRows?:number, maxItems?:number}} p
   */
  async function callAllPages({
    baseUrl,
    operation,
    params = {},
    pageNo = 1,
    numOfRows = 100,
    maxItems,
  }) {
    let currentPage = Number(pageNo);
    const pageSize = Number(numOfRows);
    if (!Number.isInteger(currentPage) || currentPage < 1) {
      throw new Error("callAllPages: pageNo는 1 이상의 정수여야 합니다.");
    }
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new Error("callAllPages: numOfRows는 1 이상의 정수여야 합니다.");
    }
    const itemLimit = maxItems === undefined ? null : Number(maxItems);
    if (itemLimit !== null && (!Number.isInteger(itemLimit) || itemLimit < 1)) {
      throw new Error("callAllPages: maxItems는 1 이상의 정수여야 합니다.");
    }

    const items = [];
    let totalCount = 0;
    let resultMsg = "";

    while (true) {
      const requestSize = itemLimit === null ? pageSize : Math.min(pageSize, itemLimit - items.length);
      const result = await callOperation({
        baseUrl,
        operation,
        params: { ...params, pageNo: currentPage, numOfRows: requestSize },
      });
      items.push(...result.items);
      totalCount = Math.max(totalCount, result.totalCount);
      resultMsg = result.resultMsg;

      // 서버가 요청한 numOfRows보다 작은 자체 상한을 적용할 수 있으므로 페이지 번호가
      // 아니라 실제 누적 건수로 완료 여부를 판단한다.
      const reachedReportedTotal = totalCount > 0 && items.length >= totalCount;
      const reachedUnreportedEnd = totalCount <= 0 && result.items.length < requestSize;
      const reachedLimit = itemLimit !== null && items.length >= itemLimit;
      if (result.items.length === 0 || reachedReportedTotal || reachedUnreportedEnd || reachedLimit) break;
      currentPage++;
    }

    return {
      resultCode: "00",
      resultMsg,
      totalCount,
      items: itemLimit === null ? items : items.slice(0, itemLimit),
    };
  }

  /**
   * totalCount까지 모든 페이지를 순회해서 items를 모아 반환한다. callAllPages와 달리
   * maxPages(페이지 수) 기준으로 상한을 둔다 — 호출부가 항목 수가 아니라 페이지 수로
   * 제한하고 싶을 때 사용.
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

  return { callOperation, callAllPages, fetchAllPages };
}

module.exports = { createClient, buildQuery };
