"use strict";
/**
 * 국토교통부_전국 법정동 코드(data.go.kr) 로더. 로그인/API 키 없이 다운로드 가능한
 * 공개 파일 — 다운로드 URL: https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=...
 * (data.go.kr 파일형 데이터셋의 공통 다운로드 패턴).
 *
 * 원본은 법정동코드/시도명/시군구명/읍면동명/리명/순위/생성일자 컬럼을 가진 리(里) 단위까지
 * 세분화된 전체 이력 데이터(2만행 이상, 폐지된 코드 포함)라, 여기서는 "시군구명은 있고
 * 읍면동명·리명은 비어있는" 행만 걸러서 시군구 레벨 마스터 목록을 만든다.
 *
 * 주의: 결과 건수는 기획 문서의 "226개 기초지자체"와 정확히 일치하지 않을 수 있다 —
 * 원본에 폐지/변경 이력이 섞여 있고(생성일자만 있고 폐지일자 컬럼은 없음), 행정구역 개편으로
 * 실제 숫자도 계속 바뀐다. 현재 공식 데이터 기준 시군구 레벨 목록으로 이해하면 된다.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_CSV_PATH = path.join(__dirname, "..", "data", "법정동코드_전국_20260703.csv");

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
 * @returns {{code:string, sido:string, sigungu:string, level:"sido"|"sigungu"}[]}
 */
function loadAdminRegionCodes(csvPath = DEFAULT_CSV_PATH) {
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
    // 읍면동/리가 비어 있으면 시도 또는 시군구 레벨이다. 대시보드 집계는 두 레벨을 모두
    // 쓰지만 기존 수집 정규화는 아래 loadAdminCodes()에서 시군구만 계속 사용한다.
    if (sido && !eupmyeondong && !ri) {
      result.push({
        code: (fields[idx.code] || "").trim(),
        sido,
        sigungu,
        level: sigungu ? "sigungu" : "sido",
      });
    }
  }
  return result;
}

function loadAdminCodes(csvPath = DEFAULT_CSV_PATH) {
  return loadAdminRegionCodes(csvPath)
    .filter((row) => row.level === "sigungu")
    .map(({ code, sido, sigungu }) => ({ code, sido, sigungu }));
}

module.exports = { loadAdminCodes, loadAdminRegionCodes, parseCsvLine, DEFAULT_CSV_PATH };
