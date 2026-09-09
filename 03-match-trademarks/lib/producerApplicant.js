"use strict";
/**
 * 출원인·권리자 이름이 "지역 생산 주체형"(생산자단체·영농조합·협동조합·지자체 등)인지
 * 이름 문자열만으로 판정한다. 개인정보(이름) 자체는 저장하지 않고, 이 판정 결과(불리언)만
 * 근거 필드에 남긴다.
 *
 * 원래 04-analyze-brand/lib/nationwideFlow.js 안에만 있던 휴리스틱을 여기로 옮겨 두
 * 경로(출원번호 기반 출원인정보, 등록번호 기반 등록원부)가 같은 기준을 쓰게 한다.
 * #118(hyojeonglim-blip, 2026-09-02): 공동출원이라도 출원인 중 이 유형이 해당 지역이면
 * 지역 출원으로 인정하고 제외하지 않는다.
 */

// 파일럿 176개 품목 실측(2026-08-27, #110) 기반. "~연구소"·"~기술센터"는 지역 연계
// 공공 농업기관(고양시농업기술센터, 남해마늘연구소 등)이라 인정하되, "~진흥원"처럼
// 전국 단위 기관은 넣지 않는다(서울 본사 주소가 실제 산지가 아님).
//
// 2026-09-09(사용자): 목록이 농업 쪽으로만 채워져 있어 수산 특산품에 같은 구멍이 있었다.
// 「영농조합법인」은 인정하는데 그 수산 대응인 「영어조합법인」이 없어, 어촌 산지 주체가
// 공동출원인이면 지역 출원으로 인정받지 못했다. 법정 생산자 조직으로 농업 쪽과 정확히
// 대응하는 세 가지를 넣는다 — 영어조합(영어조합법인)·어업회사법인·어촌계. 셋 다 특정
// 복합어라 일반 회사명과 겹칠 여지가 거의 없다.
const PRODUCER_HINTS = ["영농조합", "농업회사법인", "협동조합", "생산자", "작목반", "축협", "수협", "산림조합", "농협", "연구소", "기술센터", "농업기술원", "영어조합", "어업회사법인", "어촌계"];
const ADMIN_BODY_SUFFIX_RE = /(시|군|구|도)$/;
const CORP_HINTS = ["주식회사", "(주)", "㈜", "컴퍼니", "코퍼레이션", "Inc", "Corp"];

function isProducerLikeApplicant(name) {
  if (!name) return false;
  const value = String(name).trim();
  if (!value) return false;
  if (PRODUCER_HINTS.some((hint) => value.includes(hint))) return true;
  // 지자체 단독 표기(예: "강화군", "청송군", "경기도 여주시") — 회사명과 헷갈리지 않게
  // 길이를 짧게 제한하고 "주식회사" 류 표기가 섞이면 제외한다.
  if (ADMIN_BODY_SUFFIX_RE.test(value) && value.length <= 10 && !CORP_HINTS.some((hint) => value.includes(hint))) return true;
  return false;
}

module.exports = { isProducerLikeApplicant, PRODUCER_HINTS };
