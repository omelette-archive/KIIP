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

module.exports = { decodeEntities, extractTag, extractItemBlocks, parseNongsaroResponse };
