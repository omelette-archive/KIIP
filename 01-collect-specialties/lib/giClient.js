"use strict";

/**
 * 농림축산식품 공공데이터포털의 국립농산물품질관리원 지리적표시 등록정보 클라이언트.
 *
 * 실제 계약은 data.go.kr 공통 serviceKey 형식이 아니라 다음 MAFRA LINK API 형식이다.
 *   /openapi/{API_KEY}/{TYPE}/{API_URL}/{START_INDEX}/{END_INDEX}
 * 응답 본문은 Grid_20141225000000000157_1.row 배열이며 REGIST_NO_REGIST_DE가 필수다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");

const DEFAULT_BASE_URL = "http://211.237.50.150:7080/openapi";
const DEFAULT_DATASET = "Grid_20141225000000000157_1";
const MAX_PAGE_SIZE = 1000;

function normalizeDate(value) {
  const date = String(value || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`GI 등록일은 YYYYMMDD 형식이어야 합니다: ${value || "(빈 값)"}`);
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`GI 등록일이 유효하지 않습니다: ${value}`);
  }
  return date;
}

function buildRequestUrl({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  dataset = DEFAULT_DATASET,
  startIndex = 1,
  endIndex = 1000,
  registrationDate,
  registeredName,
}) {
  if (!apiKey) throw new Error("농식품 공공데이터포털 API 인증키(GI_API_KEY)가 필요합니다.");
  const date = normalizeDate(registrationDate);
  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new Error("GI START_INDEX는 1 이상의 정수여야 합니다.");
  }
  if (!Number.isInteger(endIndex) || endIndex < startIndex || endIndex - startIndex + 1 > MAX_PAGE_SIZE) {
    throw new Error(`GI END_INDEX는 START_INDEX 이상이고 한 번에 ${MAX_PAGE_SIZE}건 이하여야 합니다.`);
  }

  const root = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(
    `${root}/${encodeURIComponent(apiKey)}/json/${encodeURIComponent(dataset)}/${startIndex}/${endIndex}`
  );
  url.searchParams.set("REGIST_NO_REGIST_DE", date);
  if (registeredName) url.searchParams.set("GGRPH_INDICT_KOREAN_NM", String(registeredName));
  return url.toString();
}

function parseResponse(json, dataset = DEFAULT_DATASET) {
  const payload = json && (json[dataset] || json);
  const result = (payload && payload.result) || {};
  const code = result.code || "";
  const message = result.message || "응답 메시지 없음";
  if (code !== "INFO-000") {
    throw new Error(`MAFRA GI API 오류 [${code || "UNKNOWN"}] ${message}`);
  }
  const rawRows = payload && payload.row;
  const rows = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : [];
  return { totalCount: Number(payload.totalCnt) || 0, rows };
}

function mapRegistration(row) {
  return {
    registrationNumber: row.REGIST_REQST_PBLANC_NO || "",
    registeredName: row.GGRPH_INDICT_KOREAN_NM || "",
    registeredNameEnglish: row.GGRPH_INDICT_ENG_NM || "",
    registrationDate: row.REGIST_NO_REGIST_DE || "",
    organizationName: row.GRP_NM || "",
    region: row.TRGET_AREA || "",
    plannedQuantity: row.PRDCTN_PLAN_QY || "",
    description: row.GGRPH_INDICT_SFE || "",
    imageFileNumber: row.HMPG_IMAGE_FILE_NO || "",
    raw: row,
  };
}

function createClient({ apiKey, baseUrl = DEFAULT_BASE_URL, dataset = DEFAULT_DATASET, fetchImpl } = {}) {
  if (!apiKey) throw new Error("농식품 공공데이터포털 API 인증키(GI_API_KEY)가 필요합니다.");

  async function fetchPage({ registrationDate, startIndex, endIndex, registeredName }) {
    const url = buildRequestUrl({
      apiKey,
      baseUrl,
      dataset,
      startIndex,
      endIndex,
      registrationDate,
      registeredName,
    });
    const response = await fetchWithRetry(url, {}, fetchImpl);
    if (!response.ok) throw new Error(`MAFRA GI API HTTP 오류 (${response.status})`);
    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error("MAFRA GI API 응답이 JSON 형식이 아닙니다.");
    }
    return parseResponse(json, dataset);
  }

  /**
   * 지정한 등록일 목록을 순서대로 조회한다. API가 REGIST_NO_REGIST_DE 완전일치를 필수로
   * 요구하므로 전체 목록 무필터 호출은 지원하지 않는다.
   * @param {{registrationDates:string[], limit?:number, pageSize?:number, registeredName?:string}} options
   */
  async function listRegistrations({ registrationDates, limit, pageSize = MAX_PAGE_SIZE, registeredName } = {}) {
    const dates = [...new Set((registrationDates || []).map(normalizeDate))];
    if (dates.length === 0) throw new Error("GI 조회 등록일(registrationDates)이 최소 1개 필요합니다.");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`GI pageSize는 1~${MAX_PAGE_SIZE} 정수여야 합니다.`);
    }
    const itemLimit = limit === undefined ? null : Number(limit);
    if (itemLimit !== null && (!Number.isInteger(itemLimit) || itemLimit < 1)) {
      throw new Error("GI limit은 1 이상의 정수여야 합니다.");
    }

    const registrations = [];
    for (const registrationDate of dates) {
      let startIndex = 1;
      while (true) {
        const remaining = itemLimit === null ? pageSize : Math.min(pageSize, itemLimit - registrations.length);
        if (remaining <= 0) return registrations;
        const endIndex = startIndex + remaining - 1;
        const page = await fetchPage({ registrationDate, startIndex, endIndex, registeredName });
        registrations.push(...page.rows.map(mapRegistration));
        if (
          page.rows.length === 0 ||
          startIndex + page.rows.length - 1 >= page.totalCount ||
          page.rows.length < remaining ||
          (itemLimit !== null && registrations.length >= itemLimit)
        ) {
          break;
        }
        startIndex = endIndex + 1;
      }
      if (itemLimit !== null && registrations.length >= itemLimit) break;
    }
    return itemLimit === null ? registrations : registrations.slice(0, itemLimit);
  }

  return { fetchPage, listRegistrations };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_DATASET,
  MAX_PAGE_SIZE,
  buildRequestUrl,
  createClient,
  mapRegistration,
  normalizeDate,
  parseResponse,
};
