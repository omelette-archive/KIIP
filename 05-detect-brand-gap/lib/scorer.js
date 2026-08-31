"use strict";
/**
 * ④의 지역×품목 집계만 입력으로 받는 결정론적 브랜드 공백 점수 계산. 생성형 AI를 쓰지
 * 않으며(이슈 #16), 동일 입력에는 항상 동일 점수를 낸다.
 *
 * "대표 특산품" 판정 기준은 2026-08-11 #29에서 GI 출처 등록 또는 상표 출원 3건 이상(OR)으로
 * 처음 확정됐고, 2026-08-26 `compareRepresentativeThresholds.js` 실측(전체 카탈로그 1,868개
 * 지역×품목 기준: 3건 639개 vs 1건 1,027개, 신규 388개 중 237개가 단발 1건 표본)을 근거로
 * 2026-08-31 **1건 이상으로 완화 확정**했다 — 대표성 조건을 낮춰 공백 후보를 더 넓게 잡는
 * 쪽을 택함(단발 표본이 늘어나는 트레이드오프는 감수). 활용도 포화 건수·가중치는 아직 업무
 * 확정 전 예시값이며, 실제 기준이 정해지면 이 파일만 바꾸면 된다. 산출물의 scoreVersion을
 * 보면 어떤 기준으로 나온 점수인지 항상 구분할 수 있다.
 */

// 2026-08-31 #29에서 1건으로 완화 확정: ①단계 수집 출처가 지리적표시(GI) 등록이거나(OR),
// REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD 이상의 상표 출원이 있으면 대표 특산품으로 본다.
const REPRESENTATIVE_SOURCES = ["지리적표시"];
const REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD = 1;

// 예시 기준 — 상표 5건(고유 출원 기준) 이상이면 "활용도 충분"으로 간주해 activityScore가
// 1(포화)에 도달하게 하는 임의 상한. 실측 근거 없는 잠정값이다.
const ACTIVITY_SATURATION_COUNT = 5;

// 예시 기준 — 최종 점수에서 "출원 활동량" 대 "등록 성사율"의 비중. 실제 정책 우선순위가
// 정해지면 조정한다.
const ACTIVITY_WEIGHT = 0.7;
const REGISTRATION_WEIGHT = 0.3;

const GAP_SCORE_VERSION = "gap-score-v3-representative-count1";

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function regionalMetricAvailable(bucket) {
  if (bucket.regionalMetricAvailability === "available") return true;
  if (bucket.regionalMetricAvailability === "blocked") return false;
  if (typeof bucket.regionVerificationRate === "number") {
    return bucket.regionVerificationRate === 1;
  }
  // 구 fixture와 독립 scorer 호출은 이미 지역 집계값을 전달한 것으로 간주한다.
  return true;
}

function regionalTrademarkCount(bucket) {
  return Number(bucket.regionalUniqueTrademarkCount ?? bucket.uniqueTrademarkCount) || 0;
}

function regionalRegistrationRate(bucket) {
  const value = bucket.regionalRegistrationRate ?? bucket.registrationRate;
  return typeof value === "number" ? value : null;
}

function hasRepresentativeSource(bucket) {
  const sources = Array.isArray(bucket.sources) ? bucket.sources : [];
  return sources.some((source) => REPRESENTATIVE_SOURCES.includes(source));
}

// 이슈 #29 후속 비교 실험: 기준값(3건)은 그대로 두고, 1건/3건/단계형 안을 같은 스냅샷에서
// 비교할 수 있도록 threshold를 옵션으로 받는다. 넘기지 않으면 확정 기준(3건) 그대로다.
function isRepresentative(bucket, threshold = REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD) {
  const sourceRepresentative = hasRepresentativeSource(bucket);
  const hasEnoughTrademarks =
    regionalMetricAvailable(bucket) && regionalTrademarkCount(bucket) >= threshold;
  return sourceRepresentative || hasEnoughTrademarks;
}

function activityScore(bucket) {
  const count = regionalTrademarkCount(bucket);
  return Math.min(1, count / ACTIVITY_SATURATION_COUNT);
}

// registrationRate가 null인 경우(상표가 아예 없어 분모가 0인 경우 등)는 "등록 성사 실적
// 없음"으로 간주해 0으로 채운다 — 공백 방향으로 점수가 기운다.
function registrationScore(bucket) {
  return regionalRegistrationRate(bucket) ?? 0;
}

/**
 * localApplicantShare 비율 자체는 점수에 쓰지 않지만, 활동량·등록률은 주소가 inside로
 * 검증된 지역 출원만 사용한다. 검색 수집이나 주소 귀속이 불완전하면 값을 0으로 채우지 않고
 * 점수 전체를 차단한다(#50).
 */
function scoreBucket(bucket, options = {}) {
  const threshold = options.representativeThreshold ?? REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD;
  if (!regionalMetricAvailable(bucket)) {
    return {
      representative: hasRepresentativeSource(bucket) ? true : null,
      gapScore: null,
      gapReason:
        "전국 검색 hit의 출원인 주소 귀속 또는 검색 수집이 불완전해 지역 상표 건수·공백 점수를 차단함(#50)",
      scoreAvailability: "blocked",
      blockingIssue: "#50",
    };
  }
  const representative = isRepresentative(bucket, threshold);
  if (!representative) {
    return {
      representative: false,
      gapScore: null,
      gapReason: `대표 특산품 판정 기준(지리적표시 등록 또는 상표 출원 ${threshold}건 이상)을 충족하지 않음`,
      scoreAvailability: "not_applicable",
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
    scoreAvailability: "preview",
    scoreInputs: {
      regionalUniqueTrademarkCount: regionalTrademarkCount(bucket),
      regionalRegistrationRate: regionalRegistrationRate(bucket),
      activityScore: Number(activity.toFixed(4)),
      registrationScore: Number(registration.toFixed(4)),
    },
  };
}

module.exports = {
  GAP_SCORE_VERSION,
  REPRESENTATIVE_SOURCES,
  REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD,
  ACTIVITY_SATURATION_COUNT,
  ACTIVITY_WEIGHT,
  REGISTRATION_WEIGHT,
  regionalMetricAvailable,
  regionalTrademarkCount,
  regionalRegistrationRate,
  isRepresentative,
  activityScore,
  registrationScore,
  scoreBucket,
  clean,
};
