"use strict";
/**
 * korean-patent-mcp (src/lib/errors.js) 포팅 — resultCode 표준화.
 * 참고: docs/kipris-api-notes.md
 */

const KIPRIS_RESULT_CODES = {
  "00": "정상",
  "10": "잘못된 요청 파라미터",
  "11": "필수 파라미터 누락",
  "20": "검색 결과 없음",
  "30": "등록되지 않은 인증키(해당 서비스 미신청)",
  "31": "인증키 사용기한 만료",
  "99": "서버 오류",
};

class KiprisApiError extends Error {
  constructor(resultCode, resultMsg) {
    const desc = KIPRIS_RESULT_CODES[resultCode] || "알 수 없는 오류";
    super(`[${resultCode}] ${desc}${resultMsg ? ` (${resultMsg})` : ""}`);
    this.name = "KiprisApiError";
    this.resultCode = resultCode;
    if (resultCode === "30") this.code = "ACCESS_KEY_NOT_REGISTERED";
    else if (resultCode === "31") this.code = "DEADLINE_EXPIRED";
    else if (resultCode === "10" || resultCode === "11") this.code = "INVALID_PARAMETER";
    else this.code = "KIPRIS_API_ERROR";
  }
}

module.exports = { KIPRIS_RESULT_CODES, KiprisApiError };
