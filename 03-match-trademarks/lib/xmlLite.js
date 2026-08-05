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

/** KIPRIS 공통 헤더: resultCode/resultMsg/totalCount */
function parseHeader(xml) {
  const resultCode = extractTag(xml, "resultCode");
  const resultMsg = extractTag(xml, "resultMsg");
  const totalCountRaw = extractTag(xml, "totalCount");
  const totalCount = totalCountRaw ? parseInt(totalCountRaw, 10) || 0 : 0;
  return { resultCode, resultMsg, totalCount };
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

module.exports = { parseTrademarkResponse, parseHeader, extractItemBlocks, extractTag };
