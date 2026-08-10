# ⑥ AI 비즈니스 확장 전략 제안 자동 생성

**상태**: 🟡 진행중 — ⑥-1(고정 템플릿 초안, AI 미사용)까지 구현. ⑥-2(개별 AI 검토)는
별도 범위로 남겨둠(이슈 #16).

분석 결과를 브랜드 담당자용 비즈니스 확장 전략 문장/보고서로 자동 요약한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑥ 참고.

## 왜 두 단계(⑥-1/⑥-2)로 나눴나

생성형 AI가 점수·사실·최종 결정을 직접 만들지 않도록 순서를 고정했다(이슈 #16).

1. **⑥-1 (구현됨, 이 문서가 설명하는 범위)**: ⑤의 점수·근거만으로 고정 템플릿 문장을
   만든다. AI 키가 없어도 완주되고, 동일 입력은 항상 동일 문장을 낸다.
2. **⑥-2 (미착수, 별도 범위)**: ⑥-1 초안 중 필요한 건만 생성형 AI가 개별 검토해서 제안하고,
   그 제안은 원본 점수·문장과 분리된 필드/파일에 감사 가능하게(모델·시각·검토대상·제안 기록)
   저장한다. 사람이 승인하기 전에는 원본에 자동 반영하지 않는다. 이 AI 사용 여부는
   [ADR 0001](../docs/decisions/0001-deterministic-normalization-manual-review.md)의
   범위 밖이라 별도로 결정한다.

## ⑥-1 문장 생성 방식

`lib/templates.js`가 project-plan.md의 예시 문장 두 개를 고정 템플릿화한다.

- **공백 문장** ("○○군은 대표 특산품 대비 상표 출원이 부족하여..."): ⑤의 `gapScore`가
  `GAP_ALERT_THRESHOLD`(예시값 `0.5`) 이상이면 공백 문장, 아니면 "양호함" 문장.
- **지역외 비중 문장** ("△△시는 지역 외 기업의 출원 비중이 높아..."): ⑤의
  `regionMatchVerified`가 `true`이고 지역 외 비중이 `OUTSIDE_SHARE_ALERT_THRESHOLD`(예시값
  `0.5`) 이상일 때만 만든다. **미검증이면 이 문장 자체를 만들지 않고** 대신 "검증되지 않아
  판단하지 않음" 문구를 남긴다 — 이슈 #11(출원인 주소 조인)이 완료되기 전까지는 대부분
  이 경로를 탄다.

임계값도 ⑤의 가중치처럼 예시값이다. 실제 기준이 정해지면 `lib/templates.js`만 바꾸면 되고,
산출물의 `templateVersion`으로 어떤 기준의 문장인지 항상 구분할 수 있다.

문장은 `evidence` 필드에 담긴 ⑤의 수치(고유 상표 건수, 등록률, 지역 내·외 비중)에서만
만들어지며, 그 밖의 사실을 추가하지 않는다 — ⑥-2 없이도 환각 걱정 없이 쓸 수 있는 이유다.

## 사용법

```bash
node 06-generate-business-strategy/generateStrategy.js \
  --input 05-detect-brand-gap/output/gap.json \
  --out 06-generate-business-strategy/output/strategy.json
```

## 출력 스키마

```text
{
  schemaVersion,
  templateVersion,      // "strategy-template-v0-example" — 기준 변경 시 문자열도 함께 바뀜
  generatedAt,
  sourceScoreVersion,    // 입력으로 쓴 ⑤ 산출물의 scoreVersion
  sourceGeneratedAt,
  warnings,
  summary,               // { briefingCount, alertCount }
  briefings              // ⑤ ranking의 각 행 -> { region, itemName, gapScore, isGapAlert, sentences, evidence }
}
```

## 테스트

```bash
node 06-generate-business-strategy/selftest.js
```

임계값에 따른 문장 분기, 지역매칭 미검증 시 문장을 만들지 않는 것, 동일 입력의 결정론성을
네트워크·AI 키 없이 검증한다.

## 할 일

- [x] ⑥-1: 고정 템플릿으로 수치·근거가 명시된 전략 초안 생성
- [ ] ⑥-2: 필요한 건만 개별 AI 검토, 원본과 분리된 감사 가능 필드에 저장 (AI 사용 여부
      별도 결정 필요)
- [ ] 리포트 포맷 정의 (지역별 1페이지 브리핑 등 — 지금은 JSON만 생성)
- [ ] ⑤·⑥ 임계값의 실제 기준 확정

## 입력 → 출력

`05-detect-brand-gap/`의 브랜드 공백 랭킹 → 지역별 비즈니스 확장 전략 브리핑 JSON
(⑦의 입력)
