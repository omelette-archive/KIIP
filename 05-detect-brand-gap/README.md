# ⑤ 브랜드 공백(Brand Gap) 자동 발굴

**상태**: 🟡 진행중 — 결정론적 점수 계산 파이프라인 배선 완료. **"대표 특산품" 판정 기준은
2026-08-11 #29에서 GI 출처 또는 상표 출원 3건 이상(OR)으로 처음 확정됐고, 2026-08-26
`scripts/compareRepresentativeThresholds.js` 실측(전체 카탈로그 1,868개 지역×품목: 3건
639개 vs 1건 1,027개, 신규 388개 중 237개가 단발 1건 표본) 근거로 2026-08-31 1건 이상으로
완화 확정됐다**. **활용도 포화 건수·가중치는 아직 예시값**이며 실제 기준 확정 후 교체
예정(이슈 #29 잔여 범위). 생성형 AI와 고정 계산의 분리는 이슈 #16을 따른다.

지역 대표 특산품인데도 상표 활용이 저조한 곳을 찾아낸다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑤ 참고.

## 목표 (기획 문서 기준)

- 지역 대표 특산품임에도 상표 출원이 부족한 품목 자동 탐색
- 품목별 상표 활용도가 낮은 지역 자동 식별
- 지역 브랜드 육성 우선순위 후보 도출 (생성형 AI는 이 단계에서 쓰지 않는다 — ⑥으로 분리)

## 판정 기준과 확정 상태

`lib/scorer.js` 상단에 다음 상수로 모아뒀다. 산출물의 `scoreVersion`으로 어떤 기준으로 나온
점수인지 항상 구분할 수 있다.

| 상수 | 값 | 의미 | 확정 상태 |
|---|---|---|---|
| `REPRESENTATIVE_SOURCES` | `["지리적표시"]` | "대표 특산품" 판정 조건 1 — ①단계 수집 출처가 지리적표시(GI) 등록 | ✅ 확정(#29, 2026-08-11) |
| `REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD` | `1` | "대표 특산품" 판정 조건 2 — 고유 상표 출원 1건 이상(조건 1과 OR) | ✅ 확정(#29, 2026-08-31 — 3건에서 완화) |
| `ACTIVITY_SATURATION_COUNT` | `5` | 고유 상표 건수가 이 값 이상이면 "활용도 충분(1.0)"으로 간주 | 🟡 예시값, 미확정 |
| `ACTIVITY_WEIGHT` / `REGISTRATION_WEIGHT` | `0.7` / `0.3` | 최종 점수에서 출원 활동량 대 등록 성사율의 비중 | 🟡 예시값, 미확정 |

GI 미등록이어도 상표 출원 활동이 활발한 품목을 놓치지 않기 위해 조건 1·2는 OR로 결합한다
(둘 중 하나만 충족해도 대표). `gapReason`과 `methodology.representativeBasis`에 판정 근거를
그대로 남긴다.

**지역 내·외 출원 비중(`localApplicantShare`)은 아직 점수에 쓰지 않는다.** ③단계
`--enrich-registry`(이슈 #11, 2026-08-11 연결)로 검증된 값만 신뢰할 수 있고, 미실행 입력은
여전히 대부분 `unverified`다. 파이프라인 전체에 `--enrich-registry`가 기본 적용되기 전까지는
점수에 섞으면 실행 시점에 따라 같은 입력의 점수가 달라져 결정론성이 깨진다.
`regionMatchVerified`로 참고만 할 수 있게 남긴다.

## 계산 방식

1. ④의 `regionItems` 각 버킷에 대해 `sources`에 `지리적표시`가 있거나(OR) 고유 상표 출원이
   `REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD`(1건) 이상이면 "대표 특산품"으로 판정
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
  scoreVersion,       // "gap-score-v1-representative-gi-or-count3" — 기준 변경 시 문자열도 함께 바뀜
  generatedAt,
  sourceGeneratedAt,  // 입력으로 쓴 ④ 산출물의 generatedAt
  warnings,
  rows,               // ④의 모든 지역×품목 행 + representative/gapScore/gapReason/regionMatchVerified/partialQueryCount
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
- [x] "대표 특산품"의 실제 판정 기준 확정(#29, 2026-08-31 최종) — GI 출처 또는 상표 출원 1건 이상(OR)
- [ ] "상표 활용도" 지표(포화 건수)·가중치 실제 기준 확정(#29 잔여 범위)
- [ ] `collectionStatus=partial` 데이터를 점수에 포함할지 결정(#29 잔여 범위)
- [ ] 지역 내·외 비중(`localApplicantShare`)을 점수에 포함할지 — #11은 연결됐지만
      `--enrich-registry`가 파이프라인 기본 실행에 포함되기 전까지는 대부분 unverified라 보류

## 입력 → 출력

`04-analyze-brand/`의 집계 통계 → 브랜드 공백 지역·품목 랭킹 (⑥의 입력)
