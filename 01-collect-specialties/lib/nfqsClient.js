"use strict";
/**
 * 해양수산부 국립수산물품질관리원 품질인증수산물 API 클라이언트(#114).
 * data.go.kr 15058693(LINK형)로 등록된 서비스지만, 표준 serviceKey 파라미터가 아니라
 * 이 API 고유의 cert_key 파라미터를 쓴다(2026-08-25 실키 호출로 확인). 페이지네이션
 * 파라미터는 응답에 영향이 없어 한 번에 전체 목록(수백 건)이 돌아온다.
 * 일반 User-Agent 헤더 없이 호출하면 응답 자체가 비정상(빈 결과)일 수 있어 항상 지정한다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");
const { parseNfqsResponse } = require("./xmlLite");

const DEFAULT_BASE_URL = "https://www.nfqs.go.kr/hpmg/front/api/quality_api.do";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function createClient({ certKey, baseUrl, userAgent, fetchImpl, onRequest } = {}) {
  if (!certKey) {
    throw new Error("국립수산물품질관리원 품질인증수산물 API 인증키(cert_key)가 필요합니다.");
  }
  const serviceBaseUrl = baseUrl || DEFAULT_BASE_URL;

  /**
   * @param {{limit?:number}} [p] limit은 서버 파라미터가 아니라 클라이언트에서 자르는 값이다
   *   (이 API는 페이지네이션 파라미터를 지원하지 않아 항상 전체 목록이 온다).
   * @returns {Promise<{officeName:string, categoryName:string, productName:string, certificationNumber:string, companyName:string, representativeName:string, businessRegistrationNumber:string, phone:string, companyAddress:string, validFrom:string, validTo:string, rawXml:string}[]>}
   */
  async function listCertifications(p = {}) {
    const limit = p.limit === undefined ? null : Number(p.limit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error("limit은 1 이상의 정수여야 합니다.");
    }
    const query = new URLSearchParams({ cert_key: certKey });
    const url = `${serviceBaseUrl}?${query}`;
    if (onRequest) onRequest({ source: "nfqs_quality_cert" });
    const response = await fetchWithRetry(
      url,
      { headers: { "User-Agent": userAgent || DEFAULT_USER_AGENT } },
      fetchImpl
    );
    if (!response.ok) throw new Error(`nfqs_quality_cert: API 오류 (${response.status})`);
    const parsed = parseNfqsResponse(await response.text());
    if (parsed.resultCode !== "00") {
      throw new Error(
        `nfqs_quality_cert: [${parsed.resultCode || "unknown"}] ${parsed.resultMsg || "알 수 없는 오류"}`
      );
    }
    return limit === null ? parsed.items : parsed.items.slice(0, limit);
  }

  return { listCertifications };
}

module.exports = { createClient, DEFAULT_BASE_URL };
