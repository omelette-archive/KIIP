# ② AI 기반 특산품 표준화 및 상품류 자동 매핑

**상태**: 🟡 진행중 — 파이프라인 코드/자체 테스트 완료. `ANTHROPIC_API_KEY`가 아직 없어
실제 LLM 호출 스모크 테스트는 키 확보 후로 남아있음 (03단계가 KIPRIS 키로 겪은 것과 동일한
제약).

①에서 수집한 특산품 원시 목록을 정제하고 NICE 상품분류(13판)로 자동 매핑한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ② 참고.

## 규칙 (기획 문서 기준)

- 생성형 AI로 특산품 명칭 자동 정제 — 예: "안동사과, 부사" → "사과" (사과나무·사과묘목 등은 자동 제외)
- 고시명칭과 품목 자동 매핑 — 예: "안동하회탈" → 품목: "탈"
- NICE 상품분류(13판) 자동 매핑, **35류 이상은 별도 관리** (가급적 분석 대상에서 제외)
- 고시명칭에 없는 경우 비고시명칭으로 검색하도록 단순화

## 할 일

- [x] NICE 상품분류 13판 코드표 확보 — [`data/`](data/) 참고, 고시명칭 데이터에 NICE분류
      컬럼이 이미 포함되어 있어 별도 코드표 없이 해결됨
- [x] 고시명칭 매핑 데이터셋 확보/구축 (특허청 상표 고시명칭 목록) — 지식재산처 13판(2026)
      공개 파일 다운로드 완료, API 키/가입 불필요. [`data/README.md`](data/README.md) 참고
- [x] LLM 기반 정제 프롬프트/파이프라인 설계 — [`normalizeItems.js`](normalizeItems.js) +
      [`lib/`](lib/) 참고. 후보 검색(bigram)과 LLM 확정(forced tool_choice) 2단계 구조.
      실제 API 키로 검증한 건 아니라 selftest(모킹)까지만 확인됨
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
│   ├── candidateSearch.js  문자 bigram Jaccard 기반 후보 검색 (지역명 제거, 35류 기본 제외)
│   ├── llmClient.js        Anthropic API 클라이언트 (claude-haiku-4-5, forced tool_choice)
│   └── filters.js          isServiceClass()
├── normalizeItems.js       CLI 진입점
├── selftest.js             fetch 모킹 기반 자체 테스트 (API 키 없이 실행 가능)
└── output/                 --out 결과 저장 위치 (git-ignored)
```

## 사용법

```bash
cp .env.example .env
# .env 에 ANTHROPIC_API_KEY=발급받은키 입력 (console.anthropic.com)

node 02-normalize-items/normalizeItems.js --input path/to/raw.csv \
  --out 02-normalize-items/output/normalized.csv
```

입력 CSV 컬럼: `sido, sigungu, rawItemName[, source]`.

## 테스트

실제 API 키 없이 파이프라인 전체(사전 CSV 파싱 → 후보 검색 → LLM 요청/응답 파싱)를
검증한다:

```bash
node 02-normalize-items/selftest.js
```

## 입력 → 출력

`01-collect-specialties/`의 원시 목록 → `{ sido, sigungu, rawItemName, itemName(정제됨),
noticeName(고시명칭|null), niceClass(|null), similarGroupCode(|null), excluded }[]`
(다음 단계 ③의 입력)
