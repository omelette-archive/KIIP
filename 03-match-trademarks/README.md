# 상표 검색 파이프라인 (v1)

{지역, 품목} 입력을 받아 KIPRIS 상표 검색(`trademarkInfoSearchService/getWordSearch`)을 호출하고
품목(NICE 상품류 코드)으로 결과를 필터링하는 CLI. 상세 배경은 `../docs/kipris-api-notes.md` 참고.

## ⚠️ 현재 범위

- **품목**: `--classCode`로 응답의 `classificationCode`를 필터링 — 실동작. NICE류를 모르면
  (②단계가 못 정한 경우) 무필터 대신 잠정 기본 류 집합(`lib/filters.js`의
  `FOOD_RELATED_CLASSES` = 29·30·31·32·33·40·43)으로 좁힌다 — 무필터로 두면 실측으로 확인된
  대로("포도" 검색 시 무관 상표가 다수 섞여 페이지 노출 10건 중 7건이 식품과 무관) 노이즈가
  크다는 문제를 일단 줄인 것뿐이다. **이 류 목록은 핵심 규칙이 아니라 튜닝 대상** — 특산품
  대부분이 식품이라 우선 채택했지만 공예품 등(예: 이천도자기=21류)은 이 목록 밖이라 못 걸러진다.
  실제로 어떤 류가 적용됐는지는 결과의 `query.classCodeFallbackApplied`로 구분한다
  (`query.classCode` 자체는 요청 시점에 실제로 알던 류만 남겨 메타데이터 정확성을 유지).
  더 정확한 필터는 **지정상품**(류보다 세분화된 상표 등록 상품 목록) 기준 대조인데,
  `getWordSearch` 응답에는 이 필드가 없어 이번 범위에서는 못 붙였다 — 이슈 #12 참고.
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
# 단일 검색
node 03-match-trademarks/matchTrademarks.js --region "서울특별시 강남구" --item "커피" --classCode 30
node 03-match-trademarks/matchTrademarks.js --region "경기도 성남시 분당구" --item "코리아" --out 03-match-trademarks/output/result.json

# ② 단계 출력 전체를 배치 검색
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/normalized.csv \
  --out 03-match-trademarks/output/result.json

# 샘플 입력의 호출 계획만 검증(API 키·호출량 사용 없음)
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/sample-normalized.csv \
  --dry-run \
  --out 03-match-trademarks/output/sample-plan.json
```

옵션: `--numOfRows`(기본 20, 최대 100), `--pageNo`(기본 1),
`--concurrency`(배치 기본 2), `--max-requests`(배치 1회 기본 100),
`--dry-run`(배치 계약/호출 계획만 검증), `--apiKey`(환경변수 대신 직접 전달).

배치 모드는 `noticeName || itemName || rawItemName`을 검색어로, `niceClass`를 필터로 사용한다.
① 원시 CSV가 정규화를 건너뛰고 호출량을 쓰지 않도록 ② 출력 필드를 필수로 검증한다.
② 단계의 `status=review_required|error` 또는 `excluded=true` 행은 `skipped`로 보존하며, 검색 오류도 행별
`status=error`로 남긴다. 검색 오류가 하나라도 있으면 결과 JSON을 저장한 뒤 종료 코드 2를
반환한다.

## 건수 필드의 의미

- `keywordTotalCount`: KIPRIS 키워드 검색 전체 건수. NICE류 필터 전이며 모든 페이지 합계다.
- `page.unfilteredCount`: 현재 받아온 페이지의 필터 전 건수.
- `page.filteredCount`: 현재 페이지에서 NICE류까지 맞는 건수.
- `page.hasMore`: 키워드 검색의 다음 페이지 존재 여부.

범용 품목은 결과가 수만~수백만 건이므로 v1에서 무조건 전 페이지를 다운로드하지 않는다.
따라서 `page.filteredCount`를 전체 상표 건수로 사용하면 안 되며, ④ 집계 전에 지정상품 기반
검색 조건과 전체 수집 상한/증분 갱신 정책을 확정해야 한다.

KIPRISPlus 무료 호출은 전체 상품 합산 월 1,000회이므로 배치 실행 전 잔여량을 확인한다.
`--max-requests` 기본값은 한 번의 실수로 월간 한도를 소진하지 않게 하는 실행 단위 보호선이며,
상세 근거는 [`docs/open-api-limits.md`](../docs/open-api-limits.md)에 정리했다.

> 과거 `matchTrademarksBatch.js`라는 별도 배치 스크립트가 있었으나, ②단계의 신 계약
> (`status`)을 읽지 않고 `excluded`/`noticeName || itemName`만 봐서 `review_required`
> 행까지 검색 대상에 넣는 문제가 있었다(이슈 #9). 위 "② 단계 출력 전체를 배치 검색"이
> 그 자리를 완전히 대체하므로 삭제했다 — `noticeName` 우선 검색 + `niceClass` 필터
> 조합은 실제 KIPRIS 키로 검증된 바 있다(예: "기장미역 지리적표시품", "무주머루와인" 정확
> 매칭).

## 구조

```
03-match-trademarks/
├── matchTrademarks.js       CLI 진입점 (단건: {지역,품목} 한 쌍 / --input: ②단계 출력 배치)
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
