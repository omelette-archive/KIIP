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

## 구조

```
03-match-trademarks/
├── matchTrademarks.js     CLI 진입점
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
