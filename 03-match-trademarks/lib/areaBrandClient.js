"use strict";

const { fetchWithRetry } = require("./fetchWithRetry");
const { extractItemBlocks, extractTag } = require("./xmlLite");

const DEFAULT_BASE_URL = "https://api.nongsaro.go.kr/service/areaBrand";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

function normalizeApplicationNumber(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function parseAreaBrandResponse(xml) {
  const resultCode = extractTag(xml, "resultCode");
  const resultMsg = extractTag(xml, "resultMsg");
  const totalCountRaw = extractTag(xml, "totalCount");
  const totalCount = totalCountRaw ? Number.parseInt(totalCountRaw, 10) || 0 : 0;
  const brands = extractItemBlocks(xml).map((block) => ({
    applicationNumber: extractTag(block, "aplcnoInfo"),
    registrationNumber: extractTag(block, "rgnoInfo"),
    brandRegistrationDate: extractTag(block, "brandRgsde"),
    contentId: extractTag(block, "cntntsNo"),
    brandName: extractTag(block, "cntntsSj"),
    imageUrl: extractTag(block, "imgUrl"),
    primaryProductName: extractTag(block, "mainPrdlstNm"),
    regionName: extractTag(block, "signguNm"),
  }));
  return { resultCode, resultMsg, totalCount, brands };
}

function createClient({
  apiKey = process.env.NONGSARO_LOCAL_BRAND_API_KEY,
  baseUrl = process.env.NONGSARO_AREA_BRAND_API_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch,
  onRequest,
} = {}) {
  if (!apiKey) {
    throw new Error("농사로 지역 브랜드 API 인증키(NONGSARO_LOCAL_BRAND_API_KEY)가 필요합니다.");
  }

  async function fetchPage({ pageNo = 1, numOfRows = DEFAULT_PAGE_SIZE } = {}) {
    if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error("pageNo는 1 이상의 정수여야 합니다.");
    if (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > MAX_PAGE_SIZE) {
      throw new Error(`numOfRows는 1~${MAX_PAGE_SIZE} 정수여야 합니다.`);
    }

    const url = new URL(`${String(baseUrl).replace(/\/$/, "")}/areaBrandLst`);
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", String(numOfRows));
    if (onRequest) onRequest({ source: "nongsaro_area_brand", pageNo, numOfRows });

    const response = await fetchWithRetry(url.toString(), {}, fetchImpl);
    if (!response.ok) throw new Error(`areaBrandLst: HTTP 오류 (${response.status})`);
    const parsed = parseAreaBrandResponse(await response.text());
    if (parsed.resultCode !== "00") {
      throw new Error(
        `areaBrandLst: [${parsed.resultCode || "unknown"}] ${parsed.resultMsg || "알 수 없는 오류"}`
      );
    }
    return parsed;
  }

  async function listAreaBrands({ limit = 3, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit은 1 이상의 정수여야 합니다.");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`pageSize는 1~${MAX_PAGE_SIZE} 정수여야 합니다.`);
    }

    const brands = [];
    let pageNo = 1;
    let totalCount = null;
    const requestPageSize = Math.min(pageSize, limit);
    while (brands.length < limit && (totalCount === null || brands.length < totalCount)) {
      // pageNo의 offset은 numOfRows에 의존하므로 마지막 페이지에서도 크기를 바꾸지 않는다.
      const page = await fetchPage({ pageNo, numOfRows: requestPageSize });
      totalCount = page.totalCount;
      brands.push(...page.brands);
      if (page.brands.length === 0 || brands.length >= totalCount) break;
      pageNo++;
    }
    return {
      totalCount: totalCount || 0,
      brands: brands.slice(0, limit),
    };
  }

  return { fetchPage, listAreaBrands };
}

function indexByApplicationNumber(brands) {
  const index = new Map();
  for (const brand of brands || []) {
    const key = normalizeApplicationNumber(brand.applicationNumber);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(brand);
  }
  return index;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createClient,
  indexByApplicationNumber,
  normalizeApplicationNumber,
  parseAreaBrandResponse,
};
