# ⑤ 브랜드 공백(Brand Gap) 자동 발굴

**상태**: 🟡 진행중 — 결정론적 점수 계산 파이프라인 배선 완료. **판정 기준·가중치는 예시값**이며
실제 기준 확정 후 교체 예정(이슈 #16).

지역 대표 특산품인데도 상표 활용이 저조한 곳을 찾아낸다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑤ 참고.

## 목표 (기획 문서 기준)

- 지역 대표 특산품임에도 상표 출원이 부족한 품목 자동 탐색
- 품목별 상표 활용도가 낮은 지역 자동 식별
- 지역 브랜드 육성 우선순위 후보 도출 (생성형 AI는 이 단계에서 쓰지 않는다 — ⑥으로 분리)

## ⚠️ 지금 기준은 예시값이다

`lib/scorer.js` 상단에 다음 상수로 모아뒀다. 실제 업무 기준이 정해지면 이 파일만 바꾸면 되고,
산출물의 `scoreVersion`으로 어떤 기준으로 나온 점수인지 항상 구분할 수 있다.

| 상수 | 지금 값(예시) | 의미 |
|---|---|---|
| `REPRESENTATIVE_SOURCES` | `["지리적표시"]` | "대표 특산품" 판정 — ①단계 수집 출처가 지리적표시(GI) 등록인 것만 인정 |
| `ACTIVITY_SATURATION_COUNT` | `5` | 고유 상표 건수가 이 값 이상이면 "활용도 충분(1.0)"으로 간주 |
| `ACTIVITY_WEIGHT` / `REGISTRATION_WEIGHT` | `0.7` / `0.3` | 최종 점수에서 출원 활동량 대 등록 성사율의 비중 |

**지역 내·외 출원 비중(`localApplicantShare`)은 점수에 쓰지 않는다.** ③단계 출원인 주소
매칭이 아직 없어(이슈 #11) 대부분 검증되지 않은 값이라, 점수에 섞으면 ③의 진행 상황에 따라
같은 입력의 점수가 달라져 결정론성이 깨진다. `regionMatchVerified`로 참고만 할 수 있게 남긴다.

## 계산 방식

1. ④의 `regionItems` 각 버킷에 대해 `sources`에 `지리적표시`가 있으면 "대표 특산품"으로 판정
2. 대표 특산품이 아니면 `gapScore: null` + 사유만 남기고 랭킹에서 제외
3. 대표 특산품이면 `activityScore`(고유 상표 건수 기준)와 `registrationScore`(등록률, 결측은
   0) 를 0~1로 정규화해 가중합하고, `gapScore = 1 - 가중합`으로 계산 — 상표가 적을수록 1에
   가까움
4. `ranking`은 대표 특산품 중 `gapScore` 내림차순

## 사용법

```bash
node 05-detect-brand-gap/detectBrandGap.js \
  --input 04-analyze-brand/output/analysis.json \
  --out 05-detect-brand-gap/output/gap.json
```

## 출력 스키마

```text
{
  schemaVersion,
  scoreVersion,       // "gap-score-v0-example" — 기준 변경 시 문자열도 함께 바뀜
  generatedAt,
  sourceGeneratedAt,  // 입력으로 쓴 ④ 산출물의 generatedAt
  warnings,
  rows,               // ④의 모든 지역×품목 행 + representative/gapScore/gapReason/regionMatchVerified
  ranking             // rows 중 representative=true만 gapScore 내림차순
}
```

## 테스트

```bash
node 05-detect-brand-gap/selftest.js
```

동일 입력이 항상 동일 출력(`generatedAt` 제외)을 내는지, 비대표 품목이 랭킹에서 빠지는지,
활용 전무/포화 상태의 점수 방향성이 맞는지를 네트워크·AI 키 없이 검증한다.

## 할 일

- [x] 파이프라인 배선(④ 출력 → 결정론적 점수 → 랭킹) — 판정 기준은 예시값으로 우선 완주
- [ ] "대표 특산품"의 실제 판정 기준 확정 (예: 지리적표시 등록 여부, 언급 빈도 등) — 확정 후
      `lib/scorer.js`의 `REPRESENTATIVE_SOURCES`만 교체
- [ ] "상표 활용도" 지표·가중치 실제 기준 확정
- [ ] 지역 내·외 비중을 점수에 포함할지는 이슈 #11(출원인 주소 조인) 완료 후 재검토

## 입력 → 출력

`04-analyze-brand/`의 집계 통계 → 브랜드 공백 지역·품목 랭킹 (⑥의 입력)
