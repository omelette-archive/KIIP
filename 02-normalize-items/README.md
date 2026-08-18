# ② 규칙 기반 특산품 표준화

**상태**: 🟡 진행중 — API 키 없이 실행되는 규칙 기반 1차 정규화와 별도 검토 대기열 구현 완료.

①에서 수집한 특산품 원시 목록을 정제하고 NICE 상품분류(13판)로 자동 매핑한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ② 참고.
필드와 정제 규칙의 기준 문서는 [`docs/data-pipeline-contracts.md`](../docs/data-pipeline-contracts.md)다.

## 규칙 (기획 문서 기준)

- 정해진 규칙으로 지역명·품종 설명을 먼저 제거 — 예: "안동사과, 부사" → "사과"
- 고시명칭이 `원문`, `신선한 원문`, `미가공 원문` 규칙과 일치할 때만 자동 확정하고,
  부분 일치·복수 분류는 별도 검토
- 사과나무·사과묘목 등 비분석 대상 형태는 명시적 접미사 규칙으로 자동 제외
- NICE 상품분류(13판) 자동 매핑, **35류 이상은 별도 관리** (가급적 분석 대상에서 제외)

**외부 생성형 AI/Claude/Anthropic API는 이 단계에서 전혀 쓰지 않는다.** 규칙으로 확정
못한 행은 `review-required.csv`에 후보·사유와 함께 남긴다. 사람이 후보 승인·제외·보류를
기록하면 `applyManualReviews.js`가 그 명시적 결정만 기계적으로 반영한다. 판단 자체를 자동화하는
클라이언트는 두지 않는다.

## 할 일

- [x] NICE 상품분류 13판 코드표 확보 — [`data/`](data/) 참고, 고시명칭 데이터에 NICE분류
      컬럼이 이미 포함되어 있어 별도 코드표 없이 해결됨
- [x] 고시명칭 매핑 데이터셋 확보/구축 (특허청 상표 고시명칭 목록) — 지식재산처 13판(2026)
      공개 파일 다운로드 완료, API 키/가입 불필요. [`data/README.md`](data/README.md) 참고
- [x] 규칙 기반 1차 정규화 — 지역명/부연 설명 제거 후 고시명칭 정확 일치만 자동 확정
- [x] 별도 검토 대기열 — 미확정 행에 상위 후보와 사유를 보존해 사람이 개별 검토
- [x] 수동 검토 반영 — 기존 후보 승인·제외·보류만 허용하고 검토자·시각을 감사 이력으로 보존
- [ ] 규칙 확정률을 더 끌어올릴 추가 매칭 규칙 — 사전에 표제어 자체가 없는 품목(예: "한우",
      "대게")은 규칙을 아무리 다듬어도 review_required로 남는 게 정상. 반복되는 검토 패턴이
      쌓이면 그때 명시적 규칙/사전으로 승격
- [x] 35류 이상 필터링 규칙 구현 — `lib/filters.js`의 `isServiceClass()`로 후보 검색
      단계에서 기본 제외. 원본 xlsx의 35류 파생 시트 6개까지 별도 로드하는 건 v1 범위 밖으로
      뺌(메인 시트의 NICE분류 값만으로 충분)

## 구조

```
02-normalize-items/
├── data/                   지식재산처 고시상품명칭 13판(2026) 사전 (기존)
├── lib/
│   ├── noticeDictionary.js 사전 CSV 로더 (quote-aware 파서, bigram 사전계산)
│   ├── candidateSearch.js  문자 bigram Jaccard 기반 후보 검색 (지역명 제거, 35류 기본 제외,
│   │                       bigram 역색인 캐싱으로 대량 처리 시 57k건 전체 스캔 회피)
│   ├── ruleNormalizer.js   보수적 규칙 매칭과 검토 대상 분리
│   ├── reviewClusters.js   검토대기 행을 원물명 군집으로 묶는 보고서 생성기
│   ├── decisionReport.js   전체 판정 출처(verdictSource)별 집계와 algorithm 판정 사후 감사 목록
│   └── filters.js          isServiceClass()
├── normalizeItems.js       CLI 진입점 (API 키 불필요)
├── summarizeReviews.js     검토대기 군집 보고서 CLI
├── reportNormalizationDecisions.js  판정 출처별 집계·algorithm 판정 감사 리포트 CLI
├── applyManualReviews.js   사람이 기록한 결정 반영 및 감사 이력 검증
├── selftest.js             자체 테스트 (외부 API 없이 실행)
└── output/                 --out 결과 저장 위치 (git-ignored)
```

## 사용법

```bash
node 02-normalize-items/normalizeItems.js --input path/to/raw.csv \
  --out 02-normalize-items/output/normalized.csv \
  --review-out 02-normalize-items/output/review-required.csv
```

### 검토대기 군집 보고서

검토대기 행이 많을 때 후보 점수 1위를 자동 승인하지 않는다. 대신 같은 원물명 표현을 묶고
빈도·사유·지역 수·후보 출현 비율을 재현 가능한 보고서로 만든다.

```bash
node 02-normalize-items/summarizeReviews.js \
  --input 02-normalize-items/output/review-required.csv \
  --out 02-normalize-items/output/review-summary.json \
  --csv-out 02-normalize-items/output/review-summary.csv
```

모든 군집은 `reviewDisposition=human_review_required`로 남는다. 같은 후보가 모든 행에 나타나도
그 사실은 `candidateState=same_candidate_present_in_all_rows`와 `coverage`로만 기록하며 자동
확정하지 않는다. 승인된 반복 패턴만 `data/approved-aliases.json`에 출처 버전·승인자와 함께
추가한다.

입력 CSV 필수 컬럼은 `sido, sigungu, rawItemName`이다. ① 출력의 `source`, `sourceId`,
`sourceContractVersion`, `sourceUrl`, `sourceLastVerifiedAt`, `collectedAt`도 읽어 다음 단계까지
그대로 전달한다.

`status=ok`는 규칙으로 확정된 행, `status=review_required`는 사람이 개별 검토해야 하는
행이다. 검토 파일에는 `reviewReason`과 `reviewCandidates`가 함께 기록되어, 검토자가
사전 후보를 다시 찾을 필요 없이 바로 판단할 수 있다. 처리 오류는 `status=error`로
보존하며 하나라도 있으면 부분 결과를 쓴 뒤 종료 코드 2를 반환한다. ① 단계의 `source`도
출력까지 유지한다.

모든 출력 행에는 재현을 위한 다음 메타데이터를 함께 기록한다.

- `normalizationVersion`: 현재 규칙 `specialty-normalization-rules-v2-approved-aliases`
- 사용자 승인 별칭: `data/approved-aliases.json`에 버전·승인일·이슈·고시명칭·NICE류·유사군코드를 기록합니다. 실행 시 고시 사전 계약이 일치하지 않으면 자동 확정하지 않고 검토대기로 되돌립니다.
- `dictionaryVersion`: 현재 사전 `kipo-notice-goods-13-2026`
- `dictionarySourceUrl`: 지식재산처 고시상품명칭 공식 페이지
- `dictionaryDownloadedAt`: 현재 원본 다운로드일 `2026-08-05`

공식 출처와 규칙의 채택 근거는
[`docs/data-source-provenance.md`](../docs/data-source-provenance.md)에 중앙 관리한다.

### 판정 출처(verdictSource)와 자동 확정 감사 리포트(#51)

모든 출력 행은 `matchMethod`와 함께 `verdictSource`를 남긴다.

| verdictSource | 의미 | 사람 승인 필요 |
|---|---|---|
| `exact` | 원물명이 고시명칭과 완전히 동일 | 아니오(판단의 여지 없음) |
| `human_approved_alias` | 사람이 승인한 별칭 사전(`data/approved-aliases.json`) 매칭 | 이미 받음(사전 등록 시) |
| `algorithm` | 결정론적 접두어 화이트리스트(신선한/미가공) 자동 매칭 | 아니오 — 즉시 다음 단계로 노출, 사후 표본검사 대상 |
| `excluded` | 나무/묘목/씨앗 등 규칙으로 분석 제외 | 아니오 |
| `unresolved` | 검토대기 | 예 |
| `error` | 정규화 처리 실패 | - |

`algorithm`은 매 건 사람이 개별 승인하지 않고 코드로 버전 관리되는 화이트리스트가 자동
확정한다(ADR 0001과 상충하지 않음 — 금지 대상은 비결정론적 외부 LLM 호출이며, 이 화이트리스트는
결정론적 규칙이다). 대신 자동화가 기본값이라는 사실을 감춰서는 안 되므로, ⑦ 대시보드가 이
항목에 "AI 판정" 배지를 표시하고, 아래 리포트로 사후 표본검사 근거를 남긴다.

```bash
node 02-normalize-items/reportNormalizationDecisions.js \
  --input 02-normalize-items/output/normalized.csv \
  --out 02-normalize-items/output/normalization-decisions.json \
  --md-out 02-normalize-items/output/normalization-decisions.md \
  --csv-out 02-normalize-items/output/normalization-decisions-algorithm.csv
```

Markdown 리포트는 판정 출처별 건수와, `algorithm` 판정 원물명→고시명칭 조합(빈도순)을 표로
보여준다. 사람이 이 목록에서 문제를 발견하면 `lib/ruleNormalizer.js`의 접두어 화이트리스트나
관련 규칙을 수정하고 `selftest.js`에 회귀 테스트를 추가한 뒤 재실행한다 — 코드/사전 변경만이
자동화 범위를 넓히는 유일한 경로다(ADR 0001).

### 중간산출물 수동 검토

`review-required.csv`에서 다음 필드만 작성한다.

- `reviewDecision`: `approve_candidate`, `exclude`, `keep_pending` 중 하나
- `selectedCandidateIndex`: `approve_candidate`일 때 `reviewCandidates` 배열의 0부터 시작하는 번호
- `reviewNote`: 판단 근거(선택)
- `reviewedBy`, `reviewedAt`: 승인/제외 시 필수인 검토자와 ISO-8601 시각

작성한 결정을 전체 결과에 병합한다.

```bash
node 02-normalize-items/applyManualReviews.js \
  --input 02-normalize-items/output/normalized.csv \
  --reviews 02-normalize-items/output/review-required.csv \
  --out 02-normalize-items/output/reviewed.csv
```

임의 고시명칭 입력은 허용하지 않는다. 후보에 없는 매핑이 반복되면 검토 파일에서 우회하지
말고 명시적 규칙이나 사전을 코드 리뷰와 테스트를 거쳐 추가한다. 최종 ③단계에는
`reviewed.csv`를 입력하며, 여전히 `review_required`인 행은 건너뛴다.

## 테스트

외부 API 호출 없이 규칙 기반 파이프라인 전체를 검증한다:

```bash
node 02-normalize-items/selftest.js
```

## 입력 → 출력

`01-collect-specialties/`의 원시 목록 → `{ inputIndex, sido, sigungu, rawItemName, source,
sourceId, sourceContractVersion, sourceUrl, sourceLastVerifiedAt, sourceFetchedAt,
itemName, noticeName, niceClass, similarGroupCode, excluded, status, matchMethod,
confidence, reviewReason, reviewCandidates, reviewDecision, selectedCandidateIndex,
reviewNote, reviewedBy, reviewedAt, normalizationVersion, dictionaryVersion,
dictionarySourceUrl, dictionaryDownloadedAt, error }[]`
(다음 단계 ③의 입력)
