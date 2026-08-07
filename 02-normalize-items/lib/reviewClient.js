"use strict";
/**
 * review-required.csv(규칙 기반 매칭이 확정하지 못한 소수의 행)만 개별 검토하는 전용
 * Anthropic 클라이언트. ruleNormalizer.js가 전체 행을 이미 처리했으므로, 이 클라이언트는
 * 애매하다고 남겨진 행에 한해 reviewCandidates 중 하나를 고르거나 "해당 없음"으로
 * 확정한다 — 목록에 없는 이름을 새로 만들어내지 않는다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `당신은 지역 특산품 품목명을 고시상품명칭 사전과 매칭하는 검토자입니다.
규칙 기반 코드가 이미 애매하다고 판단해 넘긴 행만 검토합니다.

1. candidates 목록은 사전에서 이미 검색된 후보입니다. 이 중 원시 품목명과 가장 정확히
   일치하는 항목이 있으면 그 인덱스를 candidateIndex로 고르세요.
2. 목록에 적절한 항목이 없으면 candidateIndex를 -1로 응답하세요. 목록에 없는 이름을
   새로 만들어내지 마세요.
3. note에 판단 근거를 한 문장으로 남기세요.`;

const TOOL = {
  name: "submit_item_review",
  description: "검토 대기 행에 대해 candidates 중 확정할 항목의 인덱스(또는 -1)를 제출한다.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      candidateIndex: {
        type: "integer",
        description: "candidates 배열의 인덱스(0부터 시작). 적절한 후보가 없으면 -1.",
      },
      note: { type: "string", description: "판단 근거 한 문장" },
    },
    required: ["candidateIndex", "note"],
    additionalProperties: false,
  },
};

function buildUserContent(row, candidates) {
  const lines = candidates.map(
    (c, i) => `${i}. ${c.item} (NICE ${c.niceClass}, 유사군 ${c.similarGroupCode})`
  );
  return [
    `지역: ${[row.sido, row.sigungu].filter(Boolean).join(" ") || "(미상)"}`,
    `원시 품목명: ${row.rawItemName}`,
    `규칙 기반 정제명: ${row.itemName}`,
    `검토 사유: ${row.reviewReason || "(없음)"}`,
    "",
    "후보 목록:",
    lines.length ? lines.join("\n") : "(후보 없음)",
  ].join("\n");
}

function createClient({ apiKey, model = DEFAULT_MODEL, fetchImpl } = {}) {
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY가 필요합니다. .env에 설정하거나 --apiKey로 전달하세요."
    );
  }

  /**
   * @param {{sido:string, sigungu:string, rawItemName:string, itemName:string, reviewReason:string}} row
   * @param {{item:string, niceClass:string, similarGroupCode:string}[]} candidates
   */
  async function reviewItem(row, candidates) {
    const body = {
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: buildUserContent(row, candidates) }],
    };

    const res = await fetchWithRetry(
      MESSAGES_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      },
      fetchImpl
    );

    const json = await res.json();
    if (!res.ok) {
      const message = (json && json.error && json.error.message) || `HTTP ${res.status}`;
      throw new Error(`reviewItem: API 오류 - ${message}`);
    }

    const toolUse = (json.content || []).find((block) => block.type === "tool_use");
    if (!toolUse) {
      throw new Error("reviewItem: 응답에 tool_use 블록이 없습니다");
    }

    const { candidateIndex, note } = toolUse.input;
    const validIndex =
      Number.isInteger(candidateIndex) && candidateIndex >= 0 && candidateIndex < candidates.length
        ? candidateIndex
        : -1;
    const matched = validIndex === -1 ? null : candidates[validIndex];

    return {
      noticeName: matched ? matched.item : null,
      niceClass: matched ? matched.niceClass : null,
      similarGroupCode: matched ? matched.similarGroupCode : null,
      note: note || "",
    };
  }

  return { reviewItem };
}

module.exports = { createClient, SYSTEM_PROMPT, TOOL, buildUserContent, MESSAGES_URL, DEFAULT_MODEL };
