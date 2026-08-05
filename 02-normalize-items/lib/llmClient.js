"use strict";
/**
 * Anthropic Messages API 클라이언트. claude-haiku-4-5 사용 — 분류형 작업에 적합한
 * 저비용 모델. 주의: Haiku 4.5는 output_config.effort를 지원하지 않는다(400 에러) —
 * 이 클라이언트는 effort/thinking 파라미터를 보내지 않는다.
 *
 * 환각 방지: 고시명칭을 자유 텍스트로 받지 않고, candidateSearch가 뽑은 후보 목록의
 * 인덱스(정수)만 강제 tool_choice + strict schema로 받는다 — 모델이 사전에 없는
 * 이름을 지어낼 수 없다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `당신은 지역 특산품 품목명을 정제하는 전문가입니다. 다음 규칙을 따르세요.

1. 원시 품목명에서 지역명·생산지·품종 접두어를 제거하고 핵심 품목명만 남기세요.
   예: "안동사과, 부사" -> "사과"
2. 후보 목록(candidates)은 실제 고시상품명칭 사전에서 이미 검색된 항목입니다. 이 목록에
   있는 것 중 정제된 품목명과 가장 정확히 일치하는 하나만 candidateIndex로 고르세요.
   목록에 없는 이름을 새로 만들어내지 마세요.
3. 후보 중 적절히 일치하는 것이 없으면 candidateIndex를 -1로 응답하세요 (고시명칭 없음 ->
   비고시명칭으로 단순화된 itemName만 사용).
4. excluded는 원본 품목명이 실제 특산품이 아니라 재배용 묘목/나무 등 파생 형태로 판단되어
   분석 대상에서 제외해야 하면 true로 설정하세요. 보통은 false입니다.`;

const TOOL = {
  name: "submit_normalization",
  description: "정제된 품목명과, 후보 목록 중 고시명칭으로 확정할 항목의 인덱스를 제출한다.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      itemName: { type: "string", description: "정제된 품목명 (지역명/품종 접두어 제거)" },
      candidateIndex: {
        type: "integer",
        description: "candidates 배열의 인덱스(0부터 시작). 일치하는 후보가 없으면 -1.",
      },
      excluded: {
        type: "boolean",
        description: "묘목/나무 등 분석 대상이 아니라고 판단되면 true",
      },
    },
    required: ["itemName", "candidateIndex", "excluded"],
    additionalProperties: false,
  },
};

function buildUserContent(rawItemName, candidates) {
  const lines = candidates.map(
    (c, i) => `${i}. ${c.item} (NICE ${c.niceClass}, 유사군 ${c.similarGroupCode})`
  );
  return [
    `원시 품목명: ${rawItemName}`,
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
   * @param {{rawItemName:string, candidates:{item:string, niceClass:string, similarGroupCode:string}[]}} p
   */
  async function normalizeItem(p) {
    const body = {
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: buildUserContent(p.rawItemName, p.candidates) }],
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
      throw new Error(`normalizeItem: API 오류 - ${message}`);
    }

    const toolUse = (json.content || []).find((block) => block.type === "tool_use");
    if (!toolUse) {
      throw new Error("normalizeItem: 응답에 tool_use 블록이 없습니다");
    }

    const { itemName, candidateIndex, excluded } = toolUse.input;
    const validIndex =
      Number.isInteger(candidateIndex) && candidateIndex >= 0 && candidateIndex < p.candidates.length
        ? candidateIndex
        : -1;
    const matched = validIndex === -1 ? null : p.candidates[validIndex];

    return {
      itemName,
      noticeName: matched ? matched.item : null,
      niceClass: matched ? matched.niceClass : null,
      similarGroupCode: matched ? matched.similarGroupCode : null,
      excluded: Boolean(excluded),
    };
  }

  return { normalizeItem };
}

module.exports = { createClient, SYSTEM_PROMPT, TOOL, buildUserContent, MESSAGES_URL, DEFAULT_MODEL };
