"use strict";

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(xml, tag) {
  const name = escapeRegExp(tag);
  const pattern = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}>`,
    "i"
  );
  const match = String(xml || "").match(pattern);
  return match ? decodeEntities(match[1].trim()) : "";
}

function extractItemBlocks(xml) {
  const blocks = [];
  const pattern = /<(?:[A-Za-z_][\w.-]*:)?item(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?item>/gi;
  let match;
  while ((match = pattern.exec(String(xml || ""))) !== null) blocks.push(match[1]);
  return blocks;
}

function parseNongsaroResponse(xml) {
  const resultCode = extractTag(xml, "resultCode");
  const resultMsg = extractTag(xml, "resultMsg");
  const totalCountRaw = extractTag(xml, "totalCount");
  const totalCount = totalCountRaw ? Number.parseInt(totalCountRaw, 10) || 0 : 0;
  const items = extractItemBlocks(xml).map((block) => ({
    areaCode: extractTag(block, "areaCode"),
    title: extractTag(block, "cntntsSj"),
    region: extractTag(block, "areaNm"),
    imageUrl: extractTag(block, "imgUrl"),
    registrationDate: extractTag(block, "svcDt"),
    linkUrl: extractTag(block, "linkUrl"),
    rawXml: block,
  }));
  return { resultCode, resultMsg, totalCount, items };
}

// 국립수산물품질관리원 품질인증수산물 API(#114). resultCode 스키마는 농사로와 같은
// header/resultCode/resultMsg 형태를 쓰지만, item 필드명은 이 API 고유의 축약형이다.
function parseNfqsResponse(xml) {
  const resultCode = extractTag(xml, "resultCode");
  const resultMsg = extractTag(xml, "resultMsg");
  const items = extractItemBlocks(xml).map((block) => ({
    officeName: extractTag(block, "jisoknm"),
    categoryName: extractTag(block, "codeknm"),
    productName: extractTag(block, "goodknm"),
    certificationNumber: extractTag(block, "certno"),
    companyName: extractTag(block, "custkfirm"),
    representativeName: extractTag(block, "headknm"),
    businessRegistrationNumber: extractTag(block, "resino"),
    phone: extractTag(block, "tel"),
    companyAddress: extractTag(block, "jisokaddr"),
    validFrom: extractTag(block, "vdatefrom"),
    validTo: extractTag(block, "vdateto"),
    rawXml: block,
  }));
  return { resultCode, resultMsg, items };
}

module.exports = { decodeEntities, extractTag, extractItemBlocks, parseNongsaroResponse, parseNfqsResponse };
