"use strict";
/**
 * 지식재산처 고시상품명칭 13판(2026) 사전(data/*.csv) 로더.
 *
 * 실제 파일에 `"G3402,G3404"`처럼 따옴표로 감싼 콤마가 존재하는 행이 있어
 * (예: "35MM 카메라" 행) 단순 String.split(",")로는 컬럼이 깨진다. RFC4180
 * 준수 quote-aware 파서를 직접 구현한다 — 값에 개행이 포함된 행은 없다고 가정한다
 * (사전 항목이 전부 짧은 상품명/영문 번역이라 실제로 그렇다).
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_CSV_PATH = path.join(__dirname, "..", "data", "고시상품명칭_13판_2026.csv");

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** 문자 bigram 집합. 1글자 항목은 그 글자 자체를 하나의 토큰으로 취급. */
function bigrams(text) {
  const set = new Set();
  if (text.length === 1) {
    set.add(text);
    return set;
  }
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

/**
 * 사전 CSV를 로드한다.
 * @param {string} [csvPath]
 * @returns {{item:string, niceClass:string, similarGroupCode:string, itemEn:string, bigrams:Set<string>}[]}
 *   niceClass는 원본의 2자리 zero-padding("01"~"45")을 그대로 보존한 문자열.
 */
function loadDictionary(csvPath = DEFAULT_CSV_PATH) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  if (lines[0].charCodeAt(0) === 0xfeff) lines[0] = lines[0].slice(1);

  const header = parseCsvLine(lines[0]);
  const idx = {
    item: header.indexOf("지정상품(국문)"),
    niceClass: header.indexOf("NICE분류"),
    similarGroupCode: header.indexOf("유사군코드"),
    itemEn: header.indexOf("지정상품(영문)"),
  };
  if (idx.item === -1 || idx.niceClass === -1 || idx.similarGroupCode === -1) {
    throw new Error(`고시상품명칭 CSV 헤더가 예상과 다릅니다: ${header.join(",")}`);
  }

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    // 원본 CSV에 지정상품명이 공백 하나뿐인 빈 행이 섞여있어 trim 후 걸러낸다.
    const item = (fields[idx.item] || "").normalize("NFC").trim();
    const niceClass = (fields[idx.niceClass] || "").trim();
    if (!item || !niceClass) continue;
    entries.push({
      item,
      niceClass,
      similarGroupCode: (fields[idx.similarGroupCode] || "").trim(),
      itemEn: (fields[idx.itemEn] || "").trim(),
      bigrams: bigrams(item),
    });
  }
  return entries;
}

module.exports = { loadDictionary, parseCsvLine, bigrams, DEFAULT_CSV_PATH };
