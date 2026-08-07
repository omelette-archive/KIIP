# ② 규칙 기반 특산품 표준화 및 별도 AI 검토

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
- AI는 전체 행 자동 처리에 쓰지 않고 `review-required.csv`의 애매한 행을 개별 검토할 때만 사용

## 할 일

- [x] NICE 상품분류 13판 코드표 확보 — [`data/`](data/) 참고, 고시명칭 데이터에 NICE분류
      컬럼이 이미 포함되어 있어 별도 코드표 없이 해결됨
- [x] 고시명칭 매핑 데이터셋 확보/구축 (특허청 상표 고시명칭 목록) — 지식재산처 13판(2026)
      공개 파일 다운로드 완료, API 키/가입 불필요. [`data/README.md`](data/README.md) 참고
- [x] 규칙 기반 1차 정규화 — 지역명/부연 설명 제거 후 고시명칭 정확 일치만 자동 확정
- [x] 별도 검토 대기열 — 미확정 행에 상위 후보와 사유를 보존해 AI 또는 사람이 개별 검토
- [x] 검토 대기열 AI 개별 검토 — [`reviewWithAi.js`](reviewWithAi.js). 규칙 기반 결과는
      건드리지 않고 `ai*` 컬럼에 제안만 추가
- [ ] 검토 결과를 원본 CSV에 병합하는 승인 워크플로 — 지금은 사람이 `ai*` 컬럼을 보고
      수작업으로 반영. 반영 방식(자동 병합 기준 등)이 정해지면 추가
- [x] 35류 이상 필터링 규칙 구현 — `lib/filters.js`의 `isServiceClass()`로 후보 검색
      단계에서 기본 제외. 원본 xlsx의 35류 파생 시트 6개까지 별도 로드하는 건 v1 범위 밖으로
      뺌(메인 시트의 NICE분류 값만으로 충분)

## 구조

```
02-normalize-items/
├── data/                   지식재산처 고시상품명칭 13판(2026) 사전 (기존)
├── lib/
│   ├── loadEnv.js          .env 로더 (03에서 포팅)
│   ├── fetchWithRetry.js   재시도/타임아웃/키마스킹 (03에서 포팅)
│   ├── noticeDictionary.js 사전 CSV 로더 (quote-aware 파서, bigram 사전계산)
│   ├── candidateSearch.js  문자 bigram Jaccard 기반 후보 검색 (지역명 제거, 35류 기본 제외,
│   │                       bigram 역색인 캐싱으로 대량 처리 시 57k건 전체 스캔 회피)
│   ├── ruleNormalizer.js   보수적 규칙 매칭과 검토 대상 분리
│   └── filters.js          isServiceClass()
├── normalizeItems.js       ① 규칙 기반 정제 CLI (API 키 불필요)
├── reviewWithAi.js         ② 검토 대기열만 개별 AI 검토하는 CLI (ANTHROPIC_API_KEY 필요)
├── selftest.js             fetch 모킹 기반 자체 테스트 (API 키 없이 실행 가능)
└── output/                 --out 결과 저장 위치 (git-ignored)
```

## 사용법

### 1) 규칙 기반 정제 (API 키 불필요)

```bash
node 02-normalize-items/normalizeItems.js --input path/to/raw.csv \
  --out 02-normalize-items/output/normalized.csv \
  --review-out 02-normalize-items/output/review-required.csv
```

입력 CSV 컬럼: `sido, sigungu, rawItemName[, source]` — 01단계 출력을 그대로 넣을 수 있다.

`status=ok`는 규칙으로 확정된 행, `status=review_required`는 개별 검토가 필요한 행이다.
검토 파일에는 `reviewReason`과 `reviewCandidates`가 함께 기록된다. 처리 오류는
`status=error`로 보존하며 하나라도 있으면 부분 결과를 쓴 뒤 종료 코드 2를 반환한다.
① 단계의 `source`도 출력까지 유지한다.

### 2) 검토 대기열 AI 개별 검토 (선택, ANTHROPIC_API_KEY 필요)

```bash
cp .env.example .env
# .env 에 ANTHROPIC_API_KEY=발급받은키 입력 (console.anthropic.com)

node 02-normalize-items/reviewWithAi.js --input 02-normalize-items/output/review-required.csv \
  --out 02-normalize-items/output/review-required-ai.csv
```

`review-required.csv`의 각 행에 대해서만 AI가 `reviewCandidates` 중 하나를 고르거나
"해당 없음"으로 확정한다 — 전체 데이터를 다시 처리하지 않고, 규칙 기반이 이미 걸러낸
소수의 애매한 행만 개별 검토하는 구조다. 원본 규칙 기반 컬럼은 그대로 두고 `aiNoticeName`
등 `ai` 접두 컬럼에 제안만 추가하므로, 최종 반영 여부는 사람이 확인 후 결정한다.

## 테스트

실제 API 키 없이 규칙 기반 파이프라인과 AI 검토 클라이언트의 요청/응답 파싱을 모두
검증한다:

```bash
node 02-normalize-items/selftest.js
```

## 입력 → 출력

`01-collect-specialties/`의 원시 목록 → `{ sido, sigungu, rawItemName, source,
itemName, noticeName, niceClass, similarGroupCode, excluded, status, matchMethod,
confidence, reviewReason, reviewCandidates, error }[]`
(다음 단계 ③의 입력)
