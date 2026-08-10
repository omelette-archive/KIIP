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
│   └── filters.js          isServiceClass()
├── normalizeItems.js       CLI 진입점 (API 키 불필요)
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

입력 CSV 필수 컬럼은 `sido, sigungu, rawItemName`이다. ① 출력의 `source`, `sourceId`,
`sourceContractVersion`, `sourceUrl`, `sourceLastVerifiedAt`, `collectedAt`도 읽어 다음 단계까지
그대로 전달한다.

`status=ok`는 규칙으로 확정된 행, `status=review_required`는 사람이 개별 검토해야 하는
행이다. 검토 파일에는 `reviewReason`과 `reviewCandidates`가 함께 기록되어, 검토자가
사전 후보를 다시 찾을 필요 없이 바로 판단할 수 있다. 처리 오류는 `status=error`로
보존하며 하나라도 있으면 부분 결과를 쓴 뒤 종료 코드 2를 반환한다. ① 단계의 `source`도
출력까지 유지한다.

모든 출력 행에는 재현을 위한 다음 메타데이터를 함께 기록한다.

- `normalizationVersion`: 현재 규칙 `specialty-normalization-rules-v1`
- `dictionaryVersion`: 현재 사전 `kipo-notice-goods-13-2026`
- `dictionarySourceUrl`: 지식재산처 고시상품명칭 공식 페이지
- `dictionaryDownloadedAt`: 현재 원본 다운로드일 `2026-08-05`

공식 출처와 규칙의 채택 근거는
[`docs/data-source-provenance.md`](../docs/data-source-provenance.md)에 중앙 관리한다.

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
