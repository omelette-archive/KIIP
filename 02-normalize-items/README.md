# ② 특산품 표준화 및 상품류 자동 매핑 (규칙 기반 매칭 + 별도 AI 검토)

**상태**: 🟡 진행중 — 규칙 기반 매칭(normalizeItems.js)은 API 키 없이 전체 동작·검증
완료. AI 검토(reviewWithAi.js)는 파이프라인/자체 테스트는 완료했지만
`ANTHROPIC_API_KEY`가 아직 없어 실제 호출 스모크 테스트는 키 확보 후로 남아있음.

①에서 수집한 특산품 원시 목록을 정제하고 NICE 상품분류(13판)로 매핑한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ② 참고.

## 아키텍처: 왜 두 단계로 나눴나

처음에는 매 행마다 LLM이 후보 중 하나를 직접 고르는 구조였다. 이 방식은 결과가
비결정적이고(같은 입력도 재실행 시 다르게 나올 수 있음), 매 행 API 호출 비용이 들고,
틀렸을 때 원인 추적이 어렵다는 문제가 있었다. 그래서 다음 순서로 바꿨다.

1. **`normalizeItems.js` (규칙 기반, LLM 미사용)** — bigram 유사도 + substring 매칭으로
   확실한 것만 결정론적으로 확정한다. API 키 없이 동작하고, 같은 입력은 항상 같은
   결과를 낸다.
2. **`reviewWithAi.js` (별도 AI 검토 단계)** — 1번 결과 중 애매한 행(기본: 미확정 행)만
   골라 AI에게 검수를 맡긴다. AI는 새로 매칭을 만들지 않고, 이미 나온 결과에 대해
   ok/flag 판정과 대안만 제안한다 — 최종 반영 여부는 사람이 `reviewed.csv`를 보고
   결정한다.

두 스크립트는 완전히 독립적이라, API 키가 없어도 1번 결과만으로 ③ 단계를 진행할 수
있다.

### 규칙 기반 매칭의 안전 기준

`lib/ruleBasedMatch.js`는 사전 표제어가 정제된 원문 안에 그대로 포함되는 방향
(예: "안동하회탈" ⊃ "탈")만 자동 확정한다. 반대 방향(정제된 원문이 더 구체적인 사전
표제어 안에 포함, 예: "사과" ⊂ "사과주")은 접미사 하나로 NICE류가 완전히 달라질 수
있어(사과→사과주/사과묘목/사과나무 등) 자동 확정하지 않는다.

**알려진 제약**: 지식재산처 고시상품명칭 사전에는 "사과", "배", "한우"처럼 흔히 쓰는
바른 명사가 표제어로 없고 "신선한 사과", "가공된 사과" 같은 파생 표기만 있는 경우가
꽤 있다. 이런 행은 규칙 기반 단계에서 미확정(noticeName 빈 값)으로 남고
`reviewWithAi.js` 대상이 된다 — 특이 케이스를 모두 규칙으로 잡으려 하지 않고,
그런 행을 안전하게 골라내 AI/사람 검토로 넘기는 것 자체가 이 설계의 목적이다. 실행
후 미확정 비율이 높으면 사전 매칭 규칙을 더 다듬기보다는, 자주 반복되는 미확정 패턴을
모아 사전 쪽(`data/`) 보완이 필요한지 먼저 판단한다.

## 규칙 (기획 문서 기준)

- 특산품 명칭 자동 정제 — 예: "안동사과, 부사" → "사과" (사과나무·사과묘목 등은 자동 제외)
- 고시명칭과 품목 자동 매핑 — 예: "안동하회탈" → 품목: "탈"
- NICE 상품분류(13판) 자동 매핑, **35류 이상은 별도 관리** (가급적 분석 대상에서 제외)
- 고시명칭에 없는 경우 비고시명칭으로 검색하도록 단순화

## 구조

```
02-normalize-items/
├── data/                   지식재산처 고시상품명칭 13판(2026) 사전 (기존)
├── lib/
│   ├── loadEnv.js          .env 로더
│   ├── fetchWithRetry.js   재시도/타임아웃/키마스킹
│   ├── noticeDictionary.js 사전 CSV 로더 (quote-aware 파서, bigram 사전계산)
│   ├── candidateSearch.js  문자 bigram Jaccard 기반 후보 검색 (지역명 제거, 35류 기본 제외)
│   ├── filters.js          isServiceClass()
│   ├── ruleBasedMatch.js   규칙 기반 매칭 확정 로직 (LLM 미사용, normalizeItems.js가 사용)
│   └── reviewClient.js     Anthropic API 클라이언트 — 매칭을 검수만 함 (reviewWithAi.js가 사용)
├── normalizeItems.js       ① 규칙 기반 정제 CLI (LLM 미사용)
├── reviewWithAi.js         ② 별도 AI 검토 CLI (①의 출력을 입력으로 받음)
├── selftest.js             네트워크 없이 실행 가능한 자체 테스트
└── output/                 --out 결과 저장 위치 (git-ignored)
```

## 사용법

### 1) 규칙 기반 정제 (API 키 불필요)

```bash
node 02-normalize-items/normalizeItems.js --input path/to/raw.csv \
  --out 02-normalize-items/output/normalized.csv
```

입력 CSV 컬럼: `sido, sigungu, rawItemName[, source]` — 01단계 출력을 그대로 넣을 수 있다.

### 2) AI 검토 (선택, ANTHROPIC_API_KEY 필요)

```bash
cp .env.example .env
# .env 에 ANTHROPIC_API_KEY=발급받은키 입력 (console.anthropic.com)

node 02-normalize-items/reviewWithAi.js --input 02-normalize-items/output/normalized.csv \
  --out 02-normalize-items/output/reviewed.csv
```

기본 `--scope unmatched`는 1번에서 noticeName이 비어있는 행만 검토한다.
`--scope excluded|matched|all`로 범위를 넓힐 수 있다. AI는 판정(`verdict`: ok/flag)과
대안만 제안하며, `normalized.csv`의 원래 값을 덮어쓰지 않는다 — 반영 여부는
`reviewed.csv`를 보고 사람이 결정한다.

## 테스트

실제 API 키 없이 규칙 기반 매칭 로직 + AI 검토 클라이언트의 요청/응답 파싱을
검증한다:

```bash
node 02-normalize-items/selftest.js
```

## 입력 → 출력

`01-collect-specialties/`의 원시 목록 → (`normalizeItems.js`) →
`{ sido, sigungu, rawItemName, itemName(정제됨), noticeName(고시명칭|null),
niceClass(|null), similarGroupCode(|null), excluded }[]` (다음 단계 ③의 입력)

`normalized.csv` → (`reviewWithAi.js`, 선택) →
위 컬럼 + `{ reviewed, verdict(ok|flag), note, suggestedNoticeName, suggestedNiceClass,
suggestedSimilarGroupCode, suggestedExcluded }[]`
