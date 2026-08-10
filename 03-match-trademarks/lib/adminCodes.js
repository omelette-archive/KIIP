"use strict";
/**
 * 01-collect-specialties/lib/adminCodes.js에서 포팅(loadEnv.js/fetchWithRetry.js와 동일 관례) —
 * 국토교통부 전국 법정동 코드 CSV를 시군구 레벨 마스터 목록으로 로드한다. 데이터 원본은
 * 01단계가 보관하는 같은 파일을 그대로 가리킨다(사본을 따로 두지 않음).
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_CSV_PATH = path.join(
  __dirname, "..", "..", "01-collect-specialties", "data", "법정동코드_전국_20260703.csv"
);

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

/**
 * @param {string} [csvPath]
 * @returns {{code:string, sido:string, sigungu:string}[]}
 */
function loadAdminCodes(csvPath = DEFAULT_CSV_PATH) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]);
  const idx = {
    code: header.indexOf("법정동코드"),
    sido: header.indexOf("시도명"),
    sigungu: header.indexOf("시군구명"),
    eupmyeondong: header.indexOf("읍면동명"),
    ri: header.indexOf("리명"),
  };
  if (idx.code === -1 || idx.sido === -1 || idx.sigungu === -1) {
    throw new Error(`법정동코드 CSV 헤더가 예상과 다릅니다: ${header.join(",")}`);
  }

  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const sido = (fields[idx.sido] || "").trim();
    const sigungu = (fields[idx.sigungu] || "").trim();
    const eupmyeondong = (fields[idx.eupmyeondong] || "").trim();
    const ri = (fields[idx.ri] || "").trim();
    if (sido && sigungu && !eupmyeondong && !ri) {
      result.push({ code: (fields[idx.code] || "").trim(), sido, sigungu });
    }
  }
  return result;
}

module.exports = { loadAdminCodes, parseCsvLine, DEFAULT_CSV_PATH };
