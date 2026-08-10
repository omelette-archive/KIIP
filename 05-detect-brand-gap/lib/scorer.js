"use strict";
/**
 * ④의 지역×품목 집계만 입력으로 받는 결정론적 브랜드 공백 점수 계산. 생성형 AI를 쓰지
 * 않으며(이슈 #16), 동일 입력에는 항상 동일 점수를 낸다.
 *
 * "대표 특산품" 판정과 가중치는 사용자가 확정한 실제 기준이 아니라 파이프라인 배선을
 * 먼저 완성하기 위한 예시값이다 — 아래 상수에 명시적으로 모아두고 GAP_SCORE_VERSION으로
 * 버전을 남긴다. 실제 기준이 정해지면 이 파일만 바꾸면 되고, 산출물의 scoreVersion을 보면
 * 어떤 기준으로 나온 점수인지 항상 구분할 수 있다.
 */

// 예시 기준 — 추후 사용자가 확정할 실제 "대표 특산품" 판정 기준으로 교체한다.
// 지금은 ①단계에서 지리적표시(GI) 등록으로 수집된 품목만 대표성이 있다고 본다.
const REPRESENTATIVE_SOURCES = ["지리적표시"];

// 예시 기준 — 상표 5건(고유 출원 기준) 이상이면 "활용도 충분"으로 간주해 activityScore가
// 1(포화)에 도달하게 하는 임의 상한. 실측 근거 없는 잠정값이다.
const ACTIVITY_SATURATION_COUNT = 5;

// 예시 기준 — 최종 점수에서 "출원 활동량" 대 "등록 성사율"의 비중. 실제 정책 우선순위가
// 정해지면 조정한다.
const ACTIVITY_WEIGHT = 0.7;
const REGISTRATION_WEIGHT = 0.3;

const GAP_SCORE_VERSION = "gap-score-v0-example";

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isRepresentative(bucket) {
  const sources = Array.isArray(bucket.sources) ? bucket.sources : [];
  return sources.some((s) => REPRESENTATIVE_SOURCES.includes(s));
}

function activityScore(bucket) {
  const count = Number(bucket.uniqueTrademarkCount) || 0;
  return Math.min(1, count / ACTIVITY_SATURATION_COUNT);
}

// registrationRate가 null인 경우(상표가 아예 없어 분모가 0인 경우 등)는 "등록 성사 실적
// 없음"으로 간주해 0으로 채운다 — 공백 방향으로 점수가 기운다.
function registrationScore(bucket) {
  return typeof bucket.registrationRate === "number" ? bucket.registrationRate : 0;
}

/**
 * 지역 내·외 출원 비중(localApplicantShare)은 점수에 쓰지 않는다. ③단계 출원인 주소 매칭이
 * 아직 없어(이슈 #11) 대부분 unverified이기 때문 — 미검증 값을 점수에 섞으면 같은 입력도
 * ③의 검증 진행 상황에 따라 점수가 흔들려 결정론성이 깨진다. 대신 참고용 메타데이터로만
 * 그대로 남긴다.
 */
function scoreBucket(bucket) {
  const representative = isRepresentative(bucket);
  if (!representative) {
    return {
      representative: false,
      gapScore: null,
      gapReason: "대표 특산품 판정 기준(예시: 지리적표시 등록)을 충족하지 않음",
    };
  }
  const activity = activityScore(bucket);
  const registration = registrationScore(bucket);
  const utilization = ACTIVITY_WEIGHT * activity + REGISTRATION_WEIGHT * registration;
  const gapScore = Number((1 - utilization).toFixed(4));
  return {
    representative: true,
    gapScore,
    gapReason: null,
    scoreInputs: {
      uniqueTrademarkCount: bucket.uniqueTrademarkCount,
      registrationRate: bucket.registrationRate,
      activityScore: Number(activity.toFixed(4)),
      registrationScore: Number(registration.toFixed(4)),
    },
  };
}

module.exports = {
  GAP_SCORE_VERSION,
  REPRESENTATIVE_SOURCES,
  ACTIVITY_SATURATION_COUNT,
  ACTIVITY_WEIGHT,
  REGISTRATION_WEIGHT,
  isRepresentative,
  activityScore,
  registrationScore,
  scoreBucket,
  clean,
};
