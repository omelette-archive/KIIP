"use strict";
/**
 * 지식재산처 등록원부 실시간 정보 조회 서비스(`getMarkHistory`) 클라이언트. 등록번호
 * 기준으로 출원인 주소(#11)와 지정상품(#12)을 함께 제공한다 — 실키 검증 2026-08-11.
 *
 * 출처: https://www.data.go.kr/data/15124946/openapi.do
 * 엔드포인트: https://apis.data.go.kr/1430000/PttRgstRtInfoInqSvc/getMarkHistory
 *
 * ⚠️ 이 서비스의 resultCode 규약은 KIPRIS(00)나 MAFRA(INFO-000)와 다르다 — 성공은 "000"이다.
 * 조회 키는 applicationNumber(출원번호)가 아니라 registrationNumber(등록번호)다. 등록이
 * 완료되지 않은 상표(출원중/거절/포기 등)는 등록번호 자체가 없어 이 API로 보강할 수 없다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");

const DEFAULT_BASE_URL = "https://apis.data.go.kr/1430000/PttRgstRtInfoInqSvc";
const IP_REGISTRY_CONTRACT_VERSION = "ip-registry-mark-history-v1";
const IP_REGISTRY_SOURCE_METADATA = Object.freeze({
  sourceId: "ip_registry",
  provider: "지식재산처(특허로)",
  dataset: "등록원부 실시간 정보 조회 서비스",
  officialPageUrl: "https://www.data.go.kr/data/15124946/openapi.do",
  apiBaseUrl: DEFAULT_BASE_URL,
  operation: "getMarkHistory",
  lastContractVerifiedAt: "2026-08-11",
});
const SUCCESS_RESULT_CODE = "000";

function normalizeRegistrationNumber(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

/**
 * 서버 응답을 그대로 두지 않고, 파이프라인이 실제로 쓰는 형태로만 축약한다. 원문은
 * `raw`에 보존해 나중에 다른 필드가 필요해져도 재조회 없이 쓸 수 있게 한다.
 */
function summarizeMarkHistory(items) {
  const applicants = asArray(items?.applicant);
  const owners = asArray(items?.owner);
  const productList = asArray(items?.productList)
    .filter((row) => row && (row.desProduct || row.productClsCd))
    .map((row) => ({
      productClsCd: row.productClsCd || null,
      desProduct: row.desProduct || null,
    }));
  return {
    title: items?.title || null,
    registrationNumber: items?.rgstNo || null,
    registrationDate: items?.rgstDate || null,
    applicationNumber: items?.applNo || null,
    applicantAddr: applicants[0]?.applicantAddr || null,
    applicantName: applicants[0]?.applicantName || null,
    ownerAddr: owners[0]?.ownerAddr || null,
    ownerName: owners[0]?.ownerName || null,
    productList,
    raw: items || null,
  };
}

function createClient({
  apiKey = process.env.IP_REGISTRY_API_KEY,
  baseUrl = process.env.IP_REGISTRY_API_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch,
  onRequest,
} = {}) {
  if (!apiKey) {
    throw new Error("등록원부 조회 API 인증키(IP_REGISTRY_API_KEY)가 필요합니다.");
  }

  /**
   * @param {string} registrationNumber 등록번호(하이픈 등은 자동으로 제거됨)
   */
  async function getMarkHistory(registrationNumber) {
    const rgstNo = normalizeRegistrationNumber(registrationNumber);
    if (!rgstNo) throw new Error("getMarkHistory: registrationNumber가 필요합니다.");

    const url = new URL(`${String(baseUrl).replace(/\/$/, "")}/getMarkHistory`);
    url.searchParams.set("serviceKey", apiKey);
    url.searchParams.set("type", "json");
    url.searchParams.set("rgstNo", rgstNo);
    if (onRequest) onRequest({ source: "ip_registry", registrationNumber: rgstNo });

    const response = await fetchWithRetry(url.toString(), {}, fetchImpl);
    if (!response.ok) throw new Error(`getMarkHistory: HTTP 오류 (${response.status})`);
    const json = await response.json();
    if (json.resultCode !== SUCCESS_RESULT_CODE) {
      throw new Error(
        `getMarkHistory: [${json.resultCode || "unknown"}] ${json.resultMsg || "알 수 없는 오류"}`
      );
    }
    return summarizeMarkHistory(json.items);
  }

  return { getMarkHistory };
}

module.exports = {
  DEFAULT_BASE_URL,
  IP_REGISTRY_CONTRACT_VERSION,
  IP_REGISTRY_SOURCE_METADATA,
  SUCCESS_RESULT_CODE,
  createClient,
  normalizeRegistrationNumber,
  summarizeMarkHistory,
};
