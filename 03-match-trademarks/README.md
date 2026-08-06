# 상표 검색 파이프라인 (v1)

{지역, 품목} 입력을 받아 KIPRIS 상표 검색(`trademarkInfoSearchService/getWordSearch`)을 호출하고
품목(NICE 상품류 코드)으로 결과를 필터링하는 CLI. 상세 배경은 `../docs/kipris-api-notes.md` 참고.

## ⚠️ 현재 범위

- **품목**: `--classCode`로 응답의 `classificationCode`를 필터링 — 실동작.
- **지역**: KIPRIS 상표 검색 응답에 출원인 주소/지역 필드가 없어서 **아직 매칭 미구현**.
  `--region` 값은 결과에 `regionMatch: "unverified"`로만 태그된다. 실제 지역 매칭 방식(별도
  출원인 데이터셋 조인 등)이 정해지면 `matchTrademarks.js`의 TODO를 채운다.
- 의존성 없는(zero-dependency) 순수 Node 스크립트. XML도 정규식 기반 경량 파서(`lib/xmlLite.js`)로
  처리한다 — 실제 응답에서 CDATA/중첩 구조가 확인되면 정식 XML 파서로 교체 필요.

## 설정

```bash
cp .env.example .env
# .env 에 KIPRIS_API_KEY=발급받은키 입력 (plus.kipris.or.kr, "상표" 서비스 활용신청 필요)
```

## 사용법

```bash
node 03-match-trademarks/matchTrademarks.js --region "서울특별시 강남구" --item "커피" --classCode 30
node 03-match-trademarks/matchTrademarks.js --region "경기도 성남시 분당구" --item "코리아" --out 03-match-trademarks/output/result.json
```

옵션: `--numOfRows`(기본 20, 최대 100), `--pageNo`(기본 1), `--apiKey`(환경변수 대신 직접 전달).

### 배치 실행 (02단계 출력 연결)

`matchTrademarks.js`는 {지역,품목} 한 쌍만 처리해서, 02단계 출력(수십~수백 행)을 실제로
흘려보내려면 매번 수동으로 반복 호출해야 했다. `matchTrademarksBatch.js`가 그 공백을 메운다 —
02의 출력 CSV를 그대로 입력으로 받아 행마다 상표 검색을 돌린다.

```bash
node 03-match-trademarks/matchTrademarksBatch.js \
  --input 02-normalize-items/output/normalized.csv \
  --out 03-match-trademarks/output/batch-result.json
```

- 검색어는 `noticeName`(고시명칭)이 있으면 우선 쓰고, 없으면 `itemName`을 쓴다.
- `niceClass`가 있으면 그 값으로 결과를 필터링한다.
- `excluded`가 true인 행(묘목/나무 등)은 건너뛴다.
- 동시 요청 수는 기본 3(`--concurrency`) — 실제 정부 API라 보수적으로 잡았다.
- 실제 KIPRIS 키로 검증 완료: `noticeName` 우선 검색과 `niceClass` 필터가 함께 정확히
  동작함(예: "기장미역 지리적표시품" 정확 매칭, "무주머루와인" 정확 매칭).

## 구조

```
03-match-trademarks/
├── matchTrademarks.js       CLI 진입점 (단건: {지역,품목} 한 쌍)
├── matchTrademarksBatch.js  배치 CLI (02단계 출력 CSV -> 행마다 검색)
├── selftest.js            fetch 모킹 기반 자체 테스트 (API 키 없이 실행 가능)
├── lib/
│   ├── kiprisClient.js     trademarkSearch() — ServiceKey 쿼리 빌드, resultCode 처리
│   ├── xmlLite.js          정규식 기반 경량 XML 파서
│   ├── fetchWithRetry.js   타임아웃·재시도(지수 백오프)·키 마스킹
│   ├── errors.js           KiprisApiError, resultCode 표준화
│   ├── filters.js          filterByClassCode()
│   └── loadEnv.js          의존성 없는 .env 로더
└── output/                 --out 결과 저장 위치 (git-ignored)
```

## 테스트

실제 API 키 없이 파이프라인 전체(XML 파싱 → 클라이언트 → 품목 필터 → 에러/재시도 처리)를
검증한다:

```bash
node 03-match-trademarks/selftest.js
```
