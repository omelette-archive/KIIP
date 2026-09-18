"use strict";
/**
 * ⑤ 브랜드 공백 점수를 고정 템플릿 문장으로 바꾼다. 생성형 AI를 쓰지 않는다(이슈 #16의
 * ⑥-1 단계) — 동일 입력은 항상 동일 문장이 나온다. ⑥-2(개별 AI 검토)는 별도 범위이며
 * 이 파일에서 다루지 않는다.
 *
 * 임계값도 ⑤의 가중치처럼 예시값이다 — 실제 기준이 정해지면 이 파일만 바꾸면 된다.
 */

const TEMPLATE_VERSION = "strategy-template-v1-low-conversion-and-share-crosscheck";

// 예시 기준 — gapScore가 이 값 이상이면 "공백 지역" 문장을 쓴다.
const GAP_ALERT_THRESHOLD = 0.5;

// 2026-09-18 실측(라이브 스냅샷, 지역매칭검증 511건): localApplicantShare만으로 이 임계값을
// 판단하면 71.2%가 발동한다(중앙값이 4.6%라 "지역 외 비중 높음"이 사실상 기본값). 변별력이
// 없어서, producerApplicantShare(생산자단체·지자체 판정)를 교차검증에 추가한다 — 지역 밖
// 주소로 등록됐어도 생산자단체면(93/511, 18%) "외부 상업 선점"이 아니라 조합 본점 소재지
// 문제일 뿐이므로 다른 문장을 쓴다. 두 조건 다 낮은(42.5%) 행만 "보호 전략 검토 필요"로
// 남긴다 — 05-detect-brand-gap/lib/scorer.js의 gapScore 계산 자체는 그대로 둔다(#29 확정
// 기준과 무관한 별도 문장 조건이므로 templates.js만 고치면 됨).
const OUTSIDE_SHARE_ALERT_THRESHOLD = 0.5;
const OUTSIDE_SHARE_PRODUCER_LED_THRESHOLD = 0.5;

// 2026-09-18 실측: localApplicantShare>=0.5인 행은 511건 중 29.7%뿐이라 오히려 드문
// "지역 주도형" 사례다 — 부정적 경고만 내보내던 것에서 긍정 신호도 대칭으로 노출한다.
const LOCAL_DOMINANT_SHARE_THRESHOLD = 0.5;

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
  // 2026-09-18: lowConversionAlert가 켜진 행은 gapScore만 보면 "양호" 구간이라(활동량이
  // 포화돼 gapScore가 구조적으로 낮음) 이 문장이 "비교적 양호함"이라고 먼저 말한 바로 뒤에
  // lowConversionSentence가 "지원 필요"라고 말하는 모순이 생긴다. lowConversionAlert일 땐
  // "양호" 단정을 빼고 중립적으로만 서술한다.
  if (row.lowConversionAlert) {
    return `${subject} 대표 특산품(${item}) 상표 활동량은 충분함(${evidence}).`;
  }
  return `${subject} 대표 특산품(${item})의 상표 활용도가 비교적 양호함(${evidence}).`;
}

// project-plan.md ⑥ 예시 문장("△△시는 지역 외 기업의 출원 비중이 높아 지역 브랜드 보호
// 전략 검토 필요")의 고정 템플릿화. 지역 매칭이 검증된 행에서만 만든다(이슈 #11 의존).
//
// UI 검토(#136) 06번: 같은 카드 안 "지역 출원인 비중" 통계(localApplicantShare를 그대로
// 표시)와 이 문장이 예전엔 서로 다른 지표처럼 보였다 — 문장이 그 값의 역수(1-x)를
// "지역 외 기업 비중"으로 따로 계산해 보여줘서, 예컨대 지역 출원인 비중 0%·지역 외 기업
// 비중 100%가 같은 사실의 두 표현인데도 반대로 말하는 두 수치로 읽혔다. 문장도 같은
// localApplicantShare 값을 그대로 인용하도록 통일한다(별도 계산값을 새로 만들지 않음).
function outsideShareSentence(row) {
  if (!row.regionMatchVerified || typeof row.localApplicantShare !== "number") return null;
  const outsideShare = 1 - row.localApplicantShare;
  if (outsideShare < OUTSIDE_SHARE_ALERT_THRESHOLD) return null;
  const isProducerLed =
    typeof row.producerApplicantShare === "number" &&
    row.producerApplicantShare >= OUTSIDE_SHARE_PRODUCER_LED_THRESHOLD;
  if (isProducerLed) {
    return `${attachTopicMarker(row.region)} 지역 출원인 비중은 낮지만(${formatPercent(row.localApplicantShare)}) ` +
      `출원 다수가 생산자단체·지자체로 확인돼(${formatPercent(row.producerApplicantShare)}) 외부 상업적 선점 위험은 낮습니다 — ` +
      "조합·지자체 본점 소재지가 지역 밖으로 등록된 경우가 흔하니 주소지 등록 실무를 확인해 보십시오.";
  }
  return `${attachTopicMarker(row.region)} 지역 출원인 비중이 낮아(${formatPercent(row.localApplicantShare)}) 지역 브랜드 보호 전략 검토 필요.`;
}

// 2026-09-18: outsideShareSentence가 반대로 판단하는 드문 사례(29.7%)를 긍정 신호로 노출한다.
function localDominantSentence(row) {
  if (!row.regionMatchVerified || typeof row.localApplicantShare !== "number") return null;
  if (row.localApplicantShare < LOCAL_DOMINANT_SHARE_THRESHOLD) return null;
  return `${attachTopicMarker(row.region)} 지역 출원인이 주도하고 있습니다(비중 ${formatPercent(row.localApplicantShare)}) — 다른 지역이 참고할 수 있는 지역 브랜드 운영 사례입니다.`;
}

// 2026-09-18(#12/#29 재검토): gapScore = 1-(0.7*활동+0.3*등록)은 활동이 포화(5건 이상)되면
// 등록률과 무관하게 0.5를 절대 못 넘어(count=4도 최대 0.44), "출원은 활발한데 등록이 안 되는"
// 문제를 구조적으로 못 잡는다. 05-detect-brand-gap/lib/scorer.js의 lowConversionAlert가
// 이 케이스를 판정하고, 여기서는 그 결과를 문장으로만 옮긴다. "미개척"(gapSentence)과
// "저효율"은 처방이 다르다 — 전자는 출원 자체를 권장, 후자는 상표 명세·전략 보완 지원.
function lowConversionSentence(row) {
  if (!row.lowConversionAlert) return null;
  const item = displayItemName(row);
  return `${attachTopicMarker(row.region)} 대표 특산품(${item}) 상표 출원은 활발하지만(${row.uniqueTrademarkCount}건) ` +
    `등록률이 낮아(${formatPercent(row.registrationRate)}) 상표 명세·전략 보완 지원이 필요한 지역으로 분석됨.`;
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
  const lowConversion = lowConversionSentence(row);
  if (lowConversion) sentences.push(lowConversion);
  const outside = outsideShareSentence(row);
  if (outside) sentences.push(outside);
  else {
    const positive = localDominantSentence(row);
    if (positive) sentences.push(positive);
    else {
      const note = unverifiedRegionNote(row);
      if (note) sentences.push(note);
    }
  }

  return {
    region: row.region,
    itemName: displayItemName(row),
    niceClass: row.niceClass,
    gapScore: row.gapScore,
    // 2026-09-18: gapScore 단독 임계값에 lowConversionAlert를 OR로 합친다 — gapScore는
    // count>=5에서 구조적으로 0.5를 못 넘어(scorer.js 주석 참고) "출원은 활발한데 등록이
    // 안 되는" 진짜 문제를 놓쳤었다. gapAlertKind로 어느 신호가 켜졌는지 구분해 문장·처방이
    // 섞이지 않게 한다.
    isGapAlert: row.gapScore >= GAP_ALERT_THRESHOLD || Boolean(row.lowConversionAlert),
    gapAlertKind: row.gapScore >= GAP_ALERT_THRESHOLD ? "unclaimed" : row.lowConversionAlert ? "low_conversion" : null,
    sentences,
    evidence: {
      uniqueTrademarkCount: row.uniqueTrademarkCount,
      registrationRate: row.registrationRate,
      localApplicantShare: row.regionMatchVerified ? row.localApplicantShare : null,
      producerApplicantShare: row.regionMatchVerified ? row.producerApplicantShare ?? null : null,
      regionMatchVerified: row.regionMatchVerified,
      // ⑥-2(#16) 후보 선정 조건: ③단계 상한에 걸려 부분 수집된 행인지 여부.
      collectionPartial: (row.partialQueryCount || 0) > 0,
      scoreInputs: row.scoreInputs || null,
      sourceProvenance: row.sourceProvenance || [],
    },
  };
}

module.exports = {
  TEMPLATE_VERSION,
  GAP_ALERT_THRESHOLD,
  OUTSIDE_SHARE_ALERT_THRESHOLD,
  OUTSIDE_SHARE_PRODUCER_LED_THRESHOLD,
  LOCAL_DOMINANT_SHARE_THRESHOLD,
  formatPercent,
  attachTopicMarker,
  gapSentence,
  outsideShareSentence,
  localDominantSentence,
  lowConversionSentence,
  unverifiedRegionNote,
  buildBriefing,
};
