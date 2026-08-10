"use strict";
/**
 * ⑤ 브랜드 공백 점수를 고정 템플릿 문장으로 바꾼다. 생성형 AI를 쓰지 않는다(이슈 #16의
 * ⑥-1 단계) — 동일 입력은 항상 동일 문장이 나온다. ⑥-2(개별 AI 검토)는 별도 범위이며
 * 이 파일에서 다루지 않는다.
 *
 * 임계값도 ⑤의 가중치처럼 예시값이다 — 실제 기준이 정해지면 이 파일만 바꾸면 된다.
 */

const TEMPLATE_VERSION = "strategy-template-v0-example";

// 예시 기준 — gapScore가 이 값 이상이면 "공백 지역" 문장을 쓴다.
const GAP_ALERT_THRESHOLD = 0.5;

// 예시 기준 — 지역 외 출원 비중이 이 값 이상이면 지역 브랜드 보호 전략 문장을 추가한다.
const OUTSIDE_SHARE_ALERT_THRESHOLD = 0.5;

function formatPercent(rate) {
  return typeof rate === "number" ? `${Math.round(rate * 100)}%` : "확인불가";
}

function displayItemName(row) {
  return row.noticeName || row.itemName || "미지정 품목";
}

// 한글 음절의 받침(종성) 유무로 은/는 조사를 고른다. 한글 완성형 음절이 아니면(영문·숫자
// 등으로 끝나는 지역명 등) 무난한 "는"으로 대체한다 — project-plan.md 예시 문장("○○군은",
// "△△시는")처럼 자연스럽게 읽히려면 "은(는)"을 그대로 노출하면 안 된다.
function attachTopicMarker(word) {
  const text = String(word || "");
  const lastChar = text.slice(-1);
  const code = lastChar.codePointAt(0);
  const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;
  const hasBatchim = isHangulSyllable && (code - 0xac00) % 28 !== 0;
  return `${text}${hasBatchim ? "은" : "는"}`;
}

// project-plan.md ⑥ 예시 문장("○○군은 대표 특산품 대비 상표 출원이 부족하여 공동브랜드
// 육성이 필요한 지역으로 분석됨")의 고정 템플릿화.
function gapSentence(row) {
  const item = displayItemName(row);
  const evidence = `고유 상표 ${row.uniqueTrademarkCount}건, 등록률 ${formatPercent(row.registrationRate)}`;
  const subject = attachTopicMarker(row.region);
  if (row.gapScore >= GAP_ALERT_THRESHOLD) {
    return `${subject} 대표 특산품(${item}) 대비 상표 출원이 부족하여(${evidence}) 공동브랜드 육성이 필요한 지역으로 분석됨.`;
  }
  return `${subject} 대표 특산품(${item})의 상표 활용도가 비교적 양호함(${evidence}).`;
}

// project-plan.md ⑥ 예시 문장("△△시는 지역 외 기업의 출원 비중이 높아 지역 브랜드 보호
// 전략 검토 필요")의 고정 템플릿화. 지역 매칭이 검증된 행에서만 만든다(이슈 #11 의존).
function outsideShareSentence(row) {
  if (!row.regionMatchVerified || typeof row.localApplicantShare !== "number") return null;
  const outsideShare = 1 - row.localApplicantShare;
  if (outsideShare < OUTSIDE_SHARE_ALERT_THRESHOLD) return null;
  return `${attachTopicMarker(row.region)} 지역 외 기업의 출원 비중이 높아(${formatPercent(outsideShare)}) 지역 브랜드 보호 전략 검토 필요.`;
}

function unverifiedRegionNote(row) {
  if (row.regionMatchVerified) return null;
  return `${row.region}의 지역 내·외 출원 비중은 출원인 주소 매칭이 검증되지 않아 이번 초안에서는 판단하지 않음.`;
}

/**
 * @param {object} row ⑤ detectGaps() 출력의 rows[i] (representative=true, gapScore!=null)
 */
function buildBriefing(row) {
  const sentences = [gapSentence(row)];
  const outside = outsideShareSentence(row);
  if (outside) sentences.push(outside);
  else {
    const note = unverifiedRegionNote(row);
    if (note) sentences.push(note);
  }

  return {
    region: row.region,
    itemName: displayItemName(row),
    niceClass: row.niceClass,
    gapScore: row.gapScore,
    isGapAlert: row.gapScore >= GAP_ALERT_THRESHOLD,
    sentences,
    evidence: {
      uniqueTrademarkCount: row.uniqueTrademarkCount,
      registrationRate: row.registrationRate,
      localApplicantShare: row.regionMatchVerified ? row.localApplicantShare : null,
      regionMatchVerified: row.regionMatchVerified,
      scoreInputs: row.scoreInputs || null,
    },
  };
}

module.exports = {
  TEMPLATE_VERSION,
  GAP_ALERT_THRESHOLD,
  OUTSIDE_SHARE_ALERT_THRESHOLD,
  formatPercent,
  attachTopicMarker,
  gapSentence,
  outsideShareSentence,
  unverifiedRegionNote,
  buildBriefing,
};
