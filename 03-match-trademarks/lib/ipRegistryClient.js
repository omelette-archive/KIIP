"use strict";

const { fetchWithRetry } = require("./fetchWithRetry");

const DEFAULT_BASE_URL = "https://apis.data.go.kr/1430000/PttRgstRtInfoInqSvc";
const IP_REGISTRY_CONTRACT_VERSION = "ip-registry-mark-history-v1";
const IP_REGISTRY_SOURCE_METADATA = Object.freeze({
  sourceId: "ip_registry",
  provider: "지식재산처",
  dataset: "등록원부 실시간 정보 조회 서비스",
  catalogUrl: "https://www.data.go.kr/data/15124946/openapi.do",
  endpoint: `${DEFAULT_BASE_URL}/getMarkHistory`,
  operation: "PttRgstRtInfoInqSvc/getMarkHistory",
  contractVersion: IP_REGISTRY_CONTRACT_VERSION,
  lastContractVerifiedAt: "2026-08-11",
});

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function normalizeRegistrationNumber(value) {
  return clean(value).replace(/\D/g, "");
}

function withCompatibilityFields(record, item = {}) {
  const firstApplicant = record.applicants?.[0] || {};
  const firstOwner = asArray(item.owner)[0] || {};
  return {
    ...record,
    title: clean(item.title) || null,
    applicantAddr: firstApplicant.address || null,
    applicantName: clean(asArray(item.applicant)[0]?.applicantName) || null,
    ownerAddr: clean(firstOwner.ownerAddr) || null,
    ownerName: clean(firstOwner.ownerName) || null,
    productList: (record.products || []).map((row) => ({
      productClsCd: row.classCode,
      desProduct: row.designatedProductName,
    })),
  };
}

function parseMarkHistoryResponse(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("등록원부 응답이 JSON 객체가 아닙니다.");
  }
  const resultCode = clean(parsed.resultCode);
  const resultMsg = clean(parsed.resultMsg);
  if (!new Set(["0", "00", "000"]).has(resultCode)) {
    const error = new Error(`등록원부 API 오류 [${resultCode || "UNKNOWN"}] ${resultMsg || "메시지 없음"}`);
    error.resultCode = resultCode || null;
    throw error;
  }
  const item = parsed.items && typeof parsed.items === "object" ? parsed.items : null;
  if (!item || Number(parsed.totalCount) === 0) {
    return { found: false, resultCode, resultMsg, totalCount: Number(parsed.totalCount) || 0 };
  }
  const applicants = asArray(item.applicant)
    .map((row) => ({
      address: clean(row?.applicantAddr) || null,
      nationality: clean(row?.applicantNatl) || null,
      representative: clean(row?.rpstrYn) || null,
    }))
    .filter((row) => row.address || row.nationality);
  const products = asArray(item.productList)
    .map((row) => ({
      classCode: clean(row?.productClsCd) || null,
      designatedProductName: clean(row?.desProduct) || null,
    }))
    .filter((row) => row.classCode || row.designatedProductName);
  // #81: right[](설정등록·존속기간갱신등록·소멸등록·이전등록 등 공식 처분 이력)와
  // cndrtExptnDate(권리존속기간만료예정일)는 개인정보 없이(사유·일자만) 등록 상태 변경을
  // 감지할 수 있는 공식 신호다 — 2026-08-31 실키로 필드 존재를 확인했다. 이전에는
  // 파싱하지 않고 버려졌다.
  const rightHistory = asArray(item.right)
    .map((row) => ({
      name: clean(row?.rgstCsName) || null,
      date: clean(row?.rgstCsDate) || null,
      reason: clean(row?.rgstCsReason) || null,
    }))
    .filter((row) => row.name || row.date);
  return withCompatibilityFields({
    found: true,
    resultCode,
    resultMsg,
    totalCount: Number(parsed.totalCount) || 1,
    applicationNumber: clean(item.applNo) || null,
    registrationNumber: clean(item.rgstNo) || null,
    registrationDate: clean(item.rgstDate) || null,
    expectedRightExpiryDate: clean(item.cndrtExptnDate) || null,
    rightHistory,
    applicants,
    products,
  }, item);
}

function summarizeMarkHistory(items) {
  return parseMarkHistoryResponse({
    resultCode: "000",
    resultMsg: "REQUEST_SUCCESS",
    totalCount: items ? 1 : 0,
    items,
  });
}

function createClient({
  apiKey = process.env.IP_REGISTRY_API_KEY,
  baseUrl = process.env.IP_REGISTRY_API_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl,
  onRequest,
} = {}) {
  if (!apiKey) {
    throw new Error("등록원부 API 인증키가 필요합니다. .env 의 IP_REGISTRY_API_KEY를 설정하세요.");
  }

  async function getMarkHistory(input) {
    const registrationNumber =
      input && typeof input === "object" ? input.registrationNumber : input;
    const normalized = normalizeRegistrationNumber(registrationNumber);
    if (!normalized) throw new Error("getMarkHistory에는 registrationNumber가 필요합니다.");
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/getMarkHistory`);
    url.searchParams.set("serviceKey", apiKey);
    url.searchParams.set("type", "json");
    url.searchParams.set("rgstNo", normalized);
    if (onRequest) onRequest({ source: "ip_registry", registrationNumber: normalized });
    const response = await fetchWithRetry(
      url.toString(),
      { headers: { Accept: "application/json" } },
      fetchImpl
    );
    if (!response.ok) throw new Error(`getMarkHistory: API 오류 (${response.status})`);
    let parsed;
    if (typeof response.text === "function") {
      const text = await response.text();
      if (!text.trim()) throw new Error("getMarkHistory: 빈 응답");
      try {
        parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
      } catch {
        throw new Error("getMarkHistory: JSON이 아닌 응답");
      }
    } else if (typeof response.json === "function") {
      parsed = await response.json();
    } else {
      throw new Error("getMarkHistory: JSON 응답을 읽을 수 없습니다.");
    }
    return parseMarkHistoryResponse(parsed);
  }

  return { getMarkHistory };
}

module.exports = {
  DEFAULT_BASE_URL,
  IP_REGISTRY_CONTRACT_VERSION,
  IP_REGISTRY_SOURCE_METADATA,
  asArray,
  createClient,
  normalizeRegistrationNumber,
  parseMarkHistoryResponse,
  summarizeMarkHistory,
};
