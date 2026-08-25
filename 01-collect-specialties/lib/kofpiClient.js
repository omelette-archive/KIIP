"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_URL = "https://www.kofpi.or.kr/public";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function requestJson(url, { execFileImpl = execFileAsync } = {}) {
  // KOFPI는 charset=ISO-8859-1이라고 응답하지만 실제 바이트는 EUC-KR이다. Node fetch를
  // 사용하면 서버가 한글을 '?'로 치환하기도 하므로 curl의 원시 바이트를 EUC-KR로 해석한다.
  const result = await execFileImpl("curl.exe", [
    "-sS",
    "--fail-with-body",
    "-A",
    DEFAULT_USER_AGENT,
    url,
  ], { encoding: "buffer", maxBuffer: 5 * 1024 * 1024 });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
  const text = new TextDecoder("euc-kr").decode(stdout).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("kofpi_forest_product: 빈 응답");
  return JSON.parse(text);
}

function createClient({ baseUrl = DEFAULT_BASE_URL, requestImpl = requestJson, onRequest } = {}) {
  async function get(path, params = {}) {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (onRequest) onRequest({ source: "kofpi_forest_product", path, params });
    return requestImpl(url.toString());
  }

  async function listProducts({ limit } = {}) {
    const majors = (await get("selBClass.do")).bClass || [];
    const products = [];
    for (const major of majors) {
      const minors = (await get("selMClass.do", { bc_cd: major.BC_CD })).mClass || [];
      for (const minor of minors) {
        const detail = (await get("selDinfo.do", {
          bc_cd: major.BC_CD,
          mc_cd: minor.MC_CD,
        })).dinfo || {};
        products.push({
          majorCategoryCode: major.BC_CD,
          majorCategoryName: major.BC_NM,
          productCode: minor.MC_CD,
          productName: detail.MC_NM || minor.MC_NM,
          scientificName: detail.HAK_NM || null,
          familyName: detail.GWA_NM || null,
          englishName: detail.ENG_NM || null,
          standardTreeName: detail.DPYO_NM || null,
          imagePath: detail.IMG_PATH || null,
        });
        if (limit && products.length >= limit) return products;
      }
    }
    return products;
  }

  return { listProducts };
}

module.exports = { createClient, requestJson, DEFAULT_BASE_URL };
