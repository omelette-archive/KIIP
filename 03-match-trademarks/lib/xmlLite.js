"use strict";
/**
 * KIPRIS 상표 검색(getWordSearch) 응답은 얕은 평면 XML(<item><title>...</title>...</item>)이라
 * 외부 XML 파서 의존성 없이 정규식만으로 안전하게 파싱 가능하다. 실제 응답에서 CDATA나
 * 중첩 태그가 확인되면 이 파서를 정식 XML 파서(xmldom 등)로 교체할 것.
 */

const TRADEMARK_FIELDS = {
  title: "title",
  applicant: "applicantName",
  applicationNumber: "applicationNumber",
  applicationDate: "applicationDate",
  applicationStatus: "applicationStatus",
  classificationCode: "classificationCode",
  registrationNumber: "registrationNumber",
  registrationDate: "registrationDate",
  publicationNumber: "publicationNumber",
  publicationDate: "publicationDate",
  rightHolder: "regPrivilegeName",
  agent: "agentName",
  drawing: "drawing",
};

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeEntities(m[1].trim()) : "";
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractItemBlocks(xml) {
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  return matches.map((block) => block.replace(/^<item>/, "").replace(/<\/item>$/, ""));
}

/** KIPRIS 공통 헤더: resultCode/resultMsg/totalCount/successYN */
function parseHeader(xml) {
  const resultCode = extractTag(xml, "resultCode");
  const resultMsg = extractTag(xml, "resultMsg");
  const successYN = extractTag(xml, "successYN");
  const totalCountRaw = extractTag(xml, "totalCount");
  const totalCount = totalCountRaw ? parseInt(totalCountRaw, 10) || 0 : 0;
  return { resultCode, resultMsg, successYN, totalCount };
}

// KIPRIS는 resultCode 20을 "검색 결과 없음"과 "SERVICE_ACCESS_DENIED_ERROR"(일일 한도
// 초과·IP 미등록 등)에 모두 쓴다. successYN=N 이거나 resultMsg가 DENIED/ERROR면 접근
// 오류로 봐야 한다 — 안 그러면 접근 거부 상태에서 대량 검색을 돌릴 때 전부 "결과 0건 완료"로
// 조용히 기록돼 산출물이 손상된다(2026-09-08 실측).
function isResultCode20AccessError(header) {
  if (header.resultCode !== "20") return false;
  if (String(header.successYN).toUpperCase() === "N") return true;
  const msg = String(header.resultMsg || "").toUpperCase();
  return (msg.includes("DENIED") || msg.includes("ERROR")) && !msg.includes("NO_RESULT");
}

/** 상표 검색(getWordSearch) 응답 전체를 { resultCode, resultMsg, totalCount, hits } 로 파싱 */
function parseTrademarkResponse(xml) {
  const header = parseHeader(xml);
  const blocks = extractItemBlocks(xml);
  const hits = blocks.map((block) => {
    const hit = {};
    for (const [outKey, tag] of Object.entries(TRADEMARK_FIELDS)) {
      hit[outKey] = extractTag(block, tag);
    }
    return hit;
  });
  return { ...header, hits };
}

// getBibliographyDetailInfoSearch 응답에서 지정상품(asignProductArray)만 뽑는다.
// 성공: <response><header><resultCode>00</resultCode></header><body><item>
//   <asignProductArray><asignProduct><mainCode>30</mainCode><productName>블루베리주스</productName>
//   <productNameEng/><seq>1</seq><subCode>G0503</subCode></asignProduct>...</asignProductArray>
// 실패: <response><header><successYN>N</successYN><resultCode>10</resultCode></header></response>
// (getWordSearch의 <items> 봉투와 다른 구조라 별도 파서.)
function parseBibliographyDesignatedGoods(xml) {
  const resultCode = extractTag(xml, "resultCode");
  const resultMsg = extractTag(xml, "resultMsg");
  const successYN = extractTag(xml, "successYN");
  const productBlocks = xml.match(/<asignProduct>([\s\S]*?)<\/asignProduct>/g) || [];
  const designatedGoods = productBlocks
    .map((block) => ({
      classCode: extractTag(block, "mainCode") || null,
      name: extractTag(block, "productName") || null,
      subCode: extractTag(block, "subCode") || null,
    }))
    .filter((row) => row.name);
  return { resultCode, resultMsg, successYN, designatedGoods };
}

module.exports = {
  parseTrademarkResponse,
  parseBibliographyDesignatedGoods,
  parseHeader,
  isResultCode20AccessError,
  extractItemBlocks,
  extractTag,
};
