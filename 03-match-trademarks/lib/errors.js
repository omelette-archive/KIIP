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
    // KIPRIS는 resultCode 20을 "결과 없음"과 "SERVICE_ACCESS_DENIED_ERROR"(일일 한도·IP
    // 미등록 등)에 모두 쓴다 — 후자로 던져진 오류를 "검색 결과 없음"으로 표기하면 오해를 부른다.
    const accessDenied = resultCode === "20" && /DENIED|ERROR/i.test(String(resultMsg || ""));
    const desc = accessDenied
      ? "서비스 접근 거부(일일 한도 초과·IP 미등록 등)"
      : KIPRIS_RESULT_CODES[resultCode] || "알 수 없는 오류";
    super(`[${resultCode}] ${desc}${resultMsg ? ` (${resultMsg})` : ""}`);
    this.name = "KiprisApiError";
    this.resultCode = resultCode;
    if (resultCode === "30") this.code = "ACCESS_KEY_NOT_REGISTERED";
    else if (resultCode === "31") this.code = "DEADLINE_EXPIRED";
    else if (resultCode === "10" || resultCode === "11") this.code = "INVALID_PARAMETER";
    else if (accessDenied) this.code = "SERVICE_ACCESS_DENIED";
    else this.code = "KIPRIS_API_ERROR";
  }
}

module.exports = { KIPRIS_RESULT_CODES, KiprisApiError };
