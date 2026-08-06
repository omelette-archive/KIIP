"use strict";
/**
 * 규칙 기반(ruleBasedMatch)으로 이미 확정된 매칭 결과를 검토하는 전용 Anthropic API
 * 클라이언트. llmClient.js와 달리 매칭을 직접 결정하지 않고, 이미 나온 결과가 맞는지
 * ok/flag로 판정하고 필요하면 대안 후보를 제안하는 "검수자" 역할만 한다.
 */

const { fetchWithRetry } = require("./fetchWithRetry");

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `당신은 지역 특산품 품목명을 규칙 기반 코드로 자동 매칭한 결과를 검수하는
전문가입니다. 매칭은 이미 코드가 확정했고, 당신의 역할은 그 결과가 맞는지 검토하는
것뿐입니다 — 스스로 새 매칭을 만들지 마세요.

1. 자동 매칭 결과(itemName/noticeName/niceClass/excluded)가 원시 품목명과 합리적으로
   일치하면 verdict를 "ok"로 응답하세요.
2. 명백히 틀렸거나(엉뚱한 품목에 매칭됨) 애매하면(고시명칭 없음으로 남았지만 후보 목록에
   더 나은 항목이 있어 보임) verdict를 "flag"로 응답하고 note에 이유를 한 문장으로
   남기세요.
3. flag인 경우, 후보 목록 중 더 적절한 항목이 있으면 suggestedCandidateIndex로 그
   인덱스를 제안하세요(후보 목록에 없는 이름을 새로 만들지 마세요). 없으면 -1.
4. excluded 판정이 틀렸다고 판단되면 suggestedExcluded로 올바른 값을 제안하세요. 그대로
   맞다면 자동 매칭 결과와 동일한 값을 넣으세요.`;

const TOOL = {
  name: "submit_review",
  description: "규칙 기반 매칭 결과에 대한 검토 판정과(필요 시) 대안 후보를 제출한다.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["ok", "flag"],
        description: "자동 매칭 결과가 맞으면 ok, 틀렸거나 애매하면 flag",
      },
      note: { type: "string", description: "판정 이유 한 문장 (ok인 경우 빈 문자열 가능)" },
      suggestedCandidateIndex: {
        type: "integer",
        description: "candidates 배열의 인덱스(0부터 시작). 제안할 대안이 없으면 -1.",
      },
      suggestedExcluded: { type: "boolean", description: "excluded로 판단되는 올바른 값" },
    },
    required: ["verdict", "note", "suggestedCandidateIndex", "suggestedExcluded"],
    additionalProperties: false,
  },
};

function buildUserContent(row, candidates) {
  const lines = candidates.map(
    (c, i) => `${i}. ${c.item} (NICE ${c.niceClass}, 유사군 ${c.similarGroupCode})`
  );
  return [
    `원시 품목명: ${row.rawItemName}`,
    "",
    "자동 매칭 결과:",
    `- itemName: ${row.itemName}`,
    `- noticeName: ${row.noticeName || "(없음)"}`,
    `- niceClass: ${row.niceClass || "(없음)"}`,
    `- excluded: ${row.excluded}`,
    "",
    "후보 목록(사전 검색 결과):",
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
   * @param {{rawItemName:string, itemName:string, noticeName:string, niceClass:string, excluded:boolean}} row
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

    const { verdict, note, suggestedCandidateIndex, suggestedExcluded } = toolUse.input;
    const validIndex =
      Number.isInteger(suggestedCandidateIndex) &&
      suggestedCandidateIndex >= 0 &&
      suggestedCandidateIndex < candidates.length
        ? suggestedCandidateIndex
        : -1;
    const suggested = validIndex === -1 ? null : candidates[validIndex];

    return {
      verdict: verdict === "flag" ? "flag" : "ok",
      note: note || "",
      suggestedNoticeName: suggested ? suggested.item : null,
      suggestedNiceClass: suggested ? suggested.niceClass : null,
      suggestedSimilarGroupCode: suggested ? suggested.similarGroupCode : null,
      suggestedExcluded: Boolean(suggestedExcluded),
    };
  }

  return { reviewItem };
}

module.exports = { createClient, SYSTEM_PROMPT, TOOL, buildUserContent, MESSAGES_URL, DEFAULT_MODEL };
