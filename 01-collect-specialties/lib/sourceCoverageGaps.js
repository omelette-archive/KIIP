"use strict";

const fs = require("fs");
const path = require("path");

// 특정 시도가 활성 수집 소스에서 실제로 0건인지(공식 API 실측 확인) 아니면 파이프라인
// 처리 단계(②검토대기·③미검색 등)에서 아직 나타나지 않은 것뿐인지는 구분해야 한다.
// 이 목록은 후자를 걸러내고, 실제 API 실측으로 확인된 공백만 담는다(#60).
const DEFAULT_PATH = path.join(__dirname, "..", "config", "sourceCoverageGaps.json");

function validate(doc) {
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.gaps)) {
    throw new Error("소스 커버리지 공백 목록 형식이 올바르지 않습니다.");
  }
  for (const gap of doc.gaps) {
    for (const field of ["sido", "sourceId", "verifiedAt", "verificationMethod", "note", "issue"]) {
      if (!gap[field]) {
        throw new Error(`소스 커버리지 공백 항목에 ${field} 필드가 필요합니다: ${gap.sido || "(sido 없음)"}`);
      }
    }
  }
  return doc;
}

function loadSourceCoverageGaps(filePath = DEFAULT_PATH) {
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  return validate(doc).gaps;
}

module.exports = {
  DEFAULT_PATH,
  loadSourceCoverageGaps,
  validate,
};
