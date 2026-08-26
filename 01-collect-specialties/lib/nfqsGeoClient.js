"use strict";

const { fetchWithRetry } = require("./fetchWithRetry");
const { decodeEntities, parseNfqsGeoResponse } = require("./xmlLite");

const DEFAULT_BASE_URL = "https://www.nfqs.go.kr/hpmg/front/api/geocert_api.do";
const DEFAULT_CATALOG_URL =
  "https://www.nfqs.go.kr/hpmg/data/actionMarineGeographicForm.do?menuId=M0000230";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function cleanHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseCatalogPage(html) {
  const tables = [...String(html || "").matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((candidate) => candidate.includes("등록명칭") && candidate.includes("등록번호"));
  if (!table) return { items: [], totalCount: 0, maxPage: 0 };

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|<\/tr>|$)/gi)]
      .map((cell) => cleanHtml(cell[1])))
    .filter((cells) => cells.length > 0);

  const items = [];
  for (let index = 0; index + 1 < rows.length; index += 2) {
    const first = rows[index];
    const second = rows[index + 1];
    if (first.length < 5 || second.length < 3) continue;
    items.push({
      officeName: first[0],
      productName: first[1],
      registeredName: first[2],
      organizationName: first[3],
      phone: first[4],
      registrationDate: first[5] || "",
      registrationNumber: second[0],
      registeredNameEnglish: second[1],
      organizationAddress: second[2],
    });
  }

  const totalMatch = String(html || "").match(/총\s*([\d,]+)건\s*검색/);
  const pages = [...String(html || "").matchAll(/postUrl\(['"]M0000230['"],\s*['"](\d+)['"]\)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return {
    items,
    totalCount: totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : items.length,
    maxPage: pages.length ? Math.max(...pages) : items.length ? 1 : 0,
  };
}

function cookieHeader(response) {
  const values = typeof response.headers?.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers?.get?.("set-cookie")].filter(Boolean);
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function mergeCatalogItems(apiItems, catalogItems) {
  const catalogByNumber = new Map(catalogItems.map((item) => [item.registrationNumber, item]));
  return apiItems.map((item) => {
    const catalog = catalogByNumber.get(item.registrationNumber);
    if (!catalog) return { ...item, catalogEnriched: false };
    return {
      ...item,
      registeredName: item.registeredName || catalog.registeredName,
      registeredNameEnglish: item.registeredNameEnglish || catalog.registeredNameEnglish,
      organizationAddress: item.organizationAddress || catalog.organizationAddress,
      registrationDate: item.registrationDate || catalog.registrationDate,
      catalogEnriched: true,
    };
  });
}

function createClient({ certKey, baseUrl, catalogUrl, userAgent, fetchImpl, onRequest } = {}) {
  if (!certKey) throw new Error("NFQS 지리적표시수산물 API 인증키(NFQS_GEO_API_KEY)가 필요합니다.");
  const serviceBaseUrl = baseUrl || DEFAULT_BASE_URL;
  const officialCatalogUrl = catalogUrl || DEFAULT_CATALOG_URL;
  const request = fetchImpl || globalThis.fetch;
  const headers = { "User-Agent": userAgent || DEFAULT_USER_AGENT };

  async function fetchCatalog() {
    if (onRequest) onRequest({ source: "nfqs_geographical_indication_catalog", page: 1 });
    const firstResponse = await fetchWithRetry(officialCatalogUrl, { headers }, request);
    if (!firstResponse.ok) throw new Error(`nfqs_geographical_indication catalog: HTTP 오류 (${firstResponse.status})`);
    const cookies = cookieHeader(firstResponse);
    const first = parseCatalogPage(await firstResponse.text());
    const items = [...first.items];
    for (let page = 2; page <= first.maxPage; page++) {
      if (onRequest) onRequest({ source: "nfqs_geographical_indication_catalog", page });
      const body = new URLSearchParams({
        MENU_ID: "M0000230",
        page: String(page),
        CERT_SEARCH_TYPE: "3",
        CERT_SEARCH: "",
      });
      const response = await fetchWithRetry(officialCatalogUrl, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body,
      }, request);
      if (!response.ok) throw new Error(`nfqs_geographical_indication catalog page ${page}: HTTP 오류 (${response.status})`);
      items.push(...parseCatalogPage(await response.text()).items);
    }
    const unique = [...new Map(items.map((item) => [item.registrationNumber, item])).values()];
    if (first.totalCount && unique.length !== first.totalCount) {
      throw new Error(`nfqs_geographical_indication catalog: ${first.totalCount}건 중 ${unique.length}건만 읽음`);
    }
    return unique;
  }

  async function listRegistrations({ limit } = {}) {
    const itemLimit = limit === undefined ? null : Number(limit);
    if (itemLimit !== null && (!Number.isInteger(itemLimit) || itemLimit < 1)) {
      throw new Error("limit는 1 이상의 정수여야 합니다.");
    }
    const query = new URLSearchParams({ cert_key: certKey });
    if (onRequest) onRequest({ source: "nfqs_geographical_indication" });
    const response = await fetchWithRetry(`${serviceBaseUrl}?${query}`, { headers }, request);
    if (!response.ok) throw new Error(`nfqs_geographical_indication: API 오류 (${response.status})`);
    const parsed = parseNfqsGeoResponse(await response.text());
    if (parsed.resultCode !== "00") {
      throw new Error(
        `nfqs_geographical_indication: [${parsed.resultCode || "unknown"}] ${parsed.resultMsg || "알 수 없는 오류"}`
      );
    }

    // 2026-08-26 현재 API는 reg_title_kor/reg_title_eng/kaddr 태그를 보내지만 값을
    // 비워 둔다. 같은 기관의 공식 등록현황 화면을 등록번호로 대조해 누락값만 보강한다.
    const needsCatalog = parsed.items.some((item) => !item.registeredName || !item.organizationAddress);
    const merged = needsCatalog ? mergeCatalogItems(parsed.items, await fetchCatalog()) : parsed.items;
    return itemLimit === null ? merged : merged.slice(0, itemLimit);
  }

  return { fetchCatalog, listRegistrations };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_CATALOG_URL,
  cleanHtml,
  createClient,
  mergeCatalogItems,
  parseCatalogPage,
};
