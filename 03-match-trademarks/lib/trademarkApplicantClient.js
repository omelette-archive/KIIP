"use strict";

const { fetchWithRetry } = require("./fetchWithRetry");

const DEFAULT_ENDPOINT =
  "https://plus.kipris.or.kr/openapi/rest/trademarkInfoSearchService/trademarkApplicantInfo";
const CONTRACT_VERSION = "kipris-trademark-applicant-address-v1";
const SOURCE_METADATA = Object.freeze({
  sourceId: "kipris_trademark_applicant",
  provider: "지식재산처 KIPRISPlus",
  dataset: "상표 출원 속보 출원인",
  catalogUrl:
    "https://plus.kipris.or.kr/portal/data/service/DBII_000000000000012/view.do?menuNo=200122&subTab=SC001",
  endpoint: DEFAULT_ENDPOINT,
  operation: "trademarkInfoSearchService/trademarkApplicantInfo",
  contractVersion: CONTRACT_VERSION,
  lastContractVerifiedAt: "2026-08-12",
});

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function decodeXml(value) {
  return clean(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagValue(xml, name) {
  const match = String(xml || "").match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function normalizeApplicationNumber(value) {
  return clean(value).replace(/\D/g, "");
}

function parseApplicantResponse(xml) {
  const resultCode = tagValue(xml, "resultCode");
  const resultMsg = tagValue(xml, "resultMsg");
  if (resultCode !== "00" && resultCode !== "20") {
    throw new Error(
      `KIPRIS 상표 출원인 API 오류 [${resultCode || "UNKNOWN"}] ${resultMsg || "메시지 없음"}`
    );
  }
  const applicants = [...String(xml || "").matchAll(
    /<trademarkApplicantInfo>([\s\S]*?)<\/trademarkApplicantInfo>/gi
  )]
    .map((match) => ({
      address: tagValue(match[1], "applicantAddress") || null,
      nationality: tagValue(match[1], "nationalCode") || null,
      applicantCode: tagValue(match[1], "applicantCode") || null,
      sequence: tagValue(match[1], "seq") || null,
    }))
    .filter((row) => row.address || row.nationality || row.applicantCode);
  return {
    found: resultCode === "00" && applicants.length > 0,
    resultCode,
    resultMsg,
    applicants,
  };
}

function createClient({
  apiKey = process.env.KIPRIS_API_KEY,
  endpoint = process.env.KIPRIS_APPLICANT_API_BASE_URL || DEFAULT_ENDPOINT,
  fetchImpl,
  emptyRetries = 3,
  emptyRetryDelay = 250,
} = {}) {
  if (!apiKey) throw new Error("KIPRIS_API_KEY가 필요합니다.");
  async function getApplicants(applicationNumber) {
    const normalized = normalizeApplicationNumber(applicationNumber);
    if (!normalized) throw new Error("trademarkApplicantInfo에는 applicationNumber가 필요합니다.");
    for (let attempt = 0; attempt <= emptyRetries; attempt++) {
      const url = new URL(endpoint);
      url.searchParams.set("applicationNumber", normalized);
      url.searchParams.set("accessKey", apiKey);
      const response = await fetchWithRetry(url.toString(), {}, fetchImpl);
      if (!response.ok) throw new Error(`trademarkApplicantInfo: API 오류 (${response.status})`);
      const xml = await response.text();
      if (!xml.trim()) throw new Error("trademarkApplicantInfo: 빈 응답");
      const parsed = parseApplicantResponse(xml);
      if (parsed.found || parsed.resultCode === "20") {
        return { applicationNumber: normalized, ...parsed };
      }
      if (attempt < emptyRetries) {
        await new Promise((resolve) => setTimeout(resolve, emptyRetryDelay * (attempt + 1)));
      }
    }
    return {
      applicationNumber: normalized,
      found: false,
      resultCode: "00",
      resultMsg: "success_without_applicant_after_retries",
      applicants: [],
      retryExhausted: true,
    };
  }
  return { getApplicants };
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULT_ENDPOINT,
  SOURCE_METADATA,
  createClient,
  normalizeApplicationNumber,
  parseApplicantResponse,
};
