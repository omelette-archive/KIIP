# ⑥ AI 비즈니스 확장 전략 제안 자동 생성

**상태**: 🟡 진행중 — ⑥-1(고정 템플릿 초안, AI 미사용) 구현 완료. ⑥-2(개별 AI 검토)는
2026-08-11 선정·제안·결정·반영 파이프라인 배선 완료(이슈 #16) — 단, "언제 개별 AI 검토가
필요한가"의 선정 조건은 확정됐지만 실제 AI 호출/모델 선택은 사람이 수동으로 수행한다(아래
"⑥-2 개별 검토" 참고).

분석 결과를 브랜드 담당자용 비즈니스 확장 전략 문장/보고서로 자동 요약한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑥ 참고.

## 왜 두 단계(⑥-1/⑥-2)로 나눴나

생성형 AI가 점수·사실·최종 결정을 직접 만들지 않도록 순서를 고정했다(이슈 #16).

1. **⑥-1 (구현됨)**: ⑤의 점수·근거만으로 고정 템플릿 문장을 만든다. AI 키가 없어도
   완주되고, 동일 입력은 항상 동일 문장을 낸다.
2. **⑥-2 (구현됨, 2026-08-11)**: ⑥-1 초안 중 근거가 약한 건만 골라 사람이(또는 사람이
   감수하는 AI 세션이) 개별 검토해서 제안하고, 그 제안은 원본 점수·문장과 분리된
   append-only 파일에 감사 가능하게(모델·시각·검토대상·제안 기록) 저장한다. 사람이
   승인하기 전에는 `strategy.json` 원본에 아무것도 반영하지 않는다. 파이프라인이 생성형
   AI를 자동으로 호출하지 않는다 — 실제 제안 문장은 사람이 CLI로 직접 제출한다. 이는
   [ADR 0001](../docs/decisions/0001-deterministic-normalization-manual-review.md)과
   같은 원칙(결정론적 자동화 + 사람 검토)을 ⑥ 단계에 적용한 것이다.

## ⑥-1 문장 생성 방식

`lib/templates.js`가 project-plan.md의 예시 문장 두 개를 고정 템플릿화한다.

- **공백 문장** ("○○군은 대표 특산품 대비 상표 출원이 부족하여..."): ⑤의 `gapScore`가
  `GAP_ALERT_THRESHOLD`(예시값 `0.5`) 이상이면 공백 문장, 아니면 "양호함" 문장.
- **지역외 비중 문장** ("△△시는 지역 출원인 비중이 낮아..."): ⑤의
  `regionMatchVerified`가 `true`이고 지역 외 비중(`1 - localApplicantShare`)이
  `OUTSIDE_SHARE_ALERT_THRESHOLD`(예시값 `0.5`) 이상일 때만 만든다. **미검증이면 이 문장
  자체를 만들지 않고** 대신 "검증되지 않아 판단하지 않음" 문구를 남긴다 — 이슈
  #11(출원인 주소 조인)이 완료되기 전까지는 대부분 이 경로를 탄다. 문장에 인용하는
  퍼센트는 `localApplicantShare`를 그대로 쓴다(같은 카드의 "지역 출원인 비중" 통계와
  동일 값) — 판정 조건(임계값 비교)에만 역수(`1 - localApplicantShare`)를 쓰고, 문장에
  별도로 계산한 값을 새로 노출하지 않는다(UI 검토 #136 06번, 서로 다른 지표처럼 보이는
  문제 방지).

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

`evidence.collectionPartial`은 ⑤의 `partialQueryCount > 0`을 그대로 옮긴 값으로, ⑥-2 선정
조건에 쓴다.

## ⑥-2 개별 검토

`lib/review.js`가 선정·제안·결정·반영 4단계를 각각 함수로 제공하고, `reviewStrategy.js`가
같은 이름의 하위 명령으로 감싼다. **입력은 `strategy.json`(⑥-1 산출물)뿐이다** — 원본은
어떤 단계에서도 수정되지 않는다.

**선정 조건(`review-selection-v1`, 2026-08-11 확정)**: `evidence.collectionPartial === true`
이거나 `evidence.regionMatchVerified === false`인 briefing만(OR) 검토 대상으로 좁힌다.
근거가 이미 검증된 briefing까지 사람이 다시 볼 필요는 없다는 판단이다. `--limit`(기본 20)을
넘는 후보는 `gapScore` 내림차순으로 잘라 재실행해도 항상 같은 후보 집합이 나온다.

```bash
# 1. ⑥-1 산출물에서 검토 대상만 뽑는다 (부분 수집 또는 지역매칭 미검증, 최대 20건)
node 06-generate-business-strategy/reviewStrategy.js select \
  --input 06-generate-business-strategy/output/strategy.json \
  --out 06-generate-business-strategy/output/review-queue.json

# 2. 사람(또는 사람이 감수하는 AI 세션)이 후보를 검토하고 제안을 append-only로 제출한다.
#    모델이 실패했다면 --proposedSentences 대신 --error로 기록한다 — 예외 없이 저장되고
#    strategy.json에는 아무 영향이 없다.
node 06-generate-business-strategy/reviewStrategy.js propose \
  --candidateId <review-queue.json의 candidateId> \
  --queue 06-generate-business-strategy/output/review-queue.json \
  --provider Anthropic --model claude-sonnet-5 --promptVersion review-prompt-v1 \
  --proposedSentences '["재검토된 문장."]' \
  --submittedBy "검토자 이름" \
  --proposals 06-generate-business-strategy/output/review-proposals.jsonl

# 3. 사람이 승인/반려/보류를 append-only로 기록한다.
node 06-generate-business-strategy/reviewStrategy.js decide \
  --candidateId <candidateId> --proposalVersion 1 \
  --decision approved --reviewer "검토자 이름" \
  --decisions 06-generate-business-strategy/output/review-decisions.jsonl

# 4. 승인된 것만 반영한 별도 산출물을 만든다 (strategy.json 원본은 그대로 남는다)
node 06-generate-business-strategy/reviewStrategy.js apply \
  --strategy 06-generate-business-strategy/output/strategy.json \
  --proposals 06-generate-business-strategy/output/review-proposals.jsonl \
  --decisions 06-generate-business-strategy/output/review-decisions.jsonl \
  --out 06-generate-business-strategy/output/strategy-reviewed.json
```

`apply` 결과의 각 briefing에는 `review.status`(`approved`/`rejected`/`keep_pending`/
`not_reviewed`/`approved_but_missing_proposal`/`not_applicable`)가 붙는다. `approved`인
briefing만 `sentences`가 제안 문장으로 교체되고, 원본 문장은 `originalSentences`에 항상
함께 남는다. 승인이 참조한 제안이 오류였거나 없다면(`approved_but_missing_proposal`)
원본을 그대로 지킨다 — 모델 오류가 ⑥-1 결과를 훼손하지 않는다.

`review-proposals.jsonl`/`review-decisions.jsonl`은 append-only다. 같은 `candidateId`를
다시 제출해도 `proposalVersion`이 올라간 새 줄이 추가될 뿐, 이전 제안·결정은 지워지지 않는다.

## 테스트

```bash
node 06-generate-business-strategy/selftest.js
```

임계값에 따른 문장 분기, 지역매칭 미검증 시 문장을 만들지 않는 것, ⑥-1의 결정론성,
⑥-2 선정 조건·append-only 저장·원본 불변성·모델 오류 흡수를 네트워크·AI 키 없이 검증한다
(⑥-2 세부는 `reviewSelftest.js`).

## 할 일

- [x] ⑥-1: 고정 템플릿으로 수치·근거가 명시된 전략 초안 생성
- [x] ⑥-2: 선정 조건 확정(부분 수집 또는 지역매칭 미검증) + 선정·제안·결정·반영 파이프라인
      배선(#16, 2026-08-11). 실제 AI 호출은 사람이 CLI로 수동 제출
- [ ] 리포트 포맷 정의 (지역별 1페이지 브리핑 등 — 지금은 JSON만 생성)
- [ ] ⑤·⑥ 임계값의 실제 기준 확정

## 입력 → 출력

`05-detect-brand-gap/`의 브랜드 공백 랭킹 → 지역별 비즈니스 확장 전략 브리핑 JSON
(⑦의 입력)
