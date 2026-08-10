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
  출원인 주소 데이터셋 조인은 #11, 농사로 지역브랜드 subset의 출원번호 조인은 #24에서 관리한다.
- 의존성 없는(zero-dependency) 순수 Node 스크립트. XML도 정규식 기반 경량 파서(`lib/xmlLite.js`)로
  처리한다 — 실제 응답에서 CDATA/중첩 구조가 확인되면 정식 XML 파서로 교체 필요.

## 설정

```bash
cp .env.example .env
# .env 에 KIPRIS_API_KEY=발급받은키 입력 (plus.kipris.or.kr, "상표" 서비스 활용신청 필요)
```

KIPRIS 키와 농사로 지역브랜드 키는 모두 실호출 검증됐다. 키 위치와 worktree 복사 방법은
[`docs/api-key-management.md`](../docs/api-key-management.md)를 따른다.

## 농사로 지역브랜드 검증자료

농사로 `areaBrand/areaBrandLst`의 602건은 특산품 원본이 아니라 이미 출원·등록된 지역 브랜드
검증자료다. 기존 ① 수집 결과에 섞지 않고 별도 JSON으로 소량 수집한다.

```bash
node 03-match-trademarks/fetchAreaBrands.js \
  --limit 3 \
  --out 03-match-trademarks/output/area-brand-sample.json
```

`lib/areaBrandClient.js`는 목록 XML 필드 8개를 구조화하고 `aplcnoInfo`를 KIPRIS
`applicationNumber`와 비교할 수 있도록 숫자형 조인 키로 정규화한다. 아직 KIPRIS hit에 지역
판정을 자동 부여하거나 ④ 통계에 반영하지 않는다. `signguNm`의 기초/광역/접미사 혼재를
정규화한 뒤 연결하는 작업은 #24에서 관리한다.

## 사용법

```bash
# 단일 검색
node 03-match-trademarks/matchTrademarks.js --region "서울특별시 강남구" --item "커피" --classCode 30
node 03-match-trademarks/matchTrademarks.js --region "경기도 성남시 분당구" --item "코리아" --out 03-match-trademarks/output/result.json

# ② 단계 출력 전체를 배치 검색
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/normalized.csv \
  --out 03-match-trademarks/output/result.json

# 중단된 배치를 체크포인트에서 재개
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/normalized.csv \
  --out 03-match-trademarks/output/result.json \
  --resume

# 샘플 입력의 호출 계획만 검증(API 키·호출량 사용 없음)
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/sample-normalized.csv \
  --dry-run \
  --out 03-match-trademarks/output/sample-plan.json
```

옵션: `--numOfRows`(기본 20, 최대 100), `--pageNo`(기본 1),
`--concurrency`(배치 기본 2), `--max-requests`(배치 1회 기본 100),
`--max-pages`(고유 쿼리당 기본 5), `--max-hits-per-query`(필터 통과 hit 기본 100),
`--checkpoint`(기본 `<out>.checkpoint.json`), `--resume`(완료 쿼리 재사용·부분 쿼리 재개),
`--dry-run`(배치 계약/호출 계획만 검증), `--apiKey`(환경변수 대신 직접 전달).

배치 모드는 `noticeName || itemName || rawItemName`을 검색어로, `niceClass`를 필터로 사용한다.
① 원시 CSV가 정규화를 건너뛰고 호출량을 쓰지 않도록 ② 출력 필드를 필수로 검증한다.
② 단계의 `status=review_required|error` 또는 `excluded=true` 행은 `skipped`로 보존하며, 검색 오류도 행별
`status=error`로 남긴다. 검색 오류가 하나라도 있으면 결과 JSON을 저장한 뒤 종료 코드 2를
반환한다. `ok`/`error` 행에도 ②의 `source`(지리적표시/농사로/샘플 등 수집 출처)를 그대로
실어보낸다 — ④단계가 "대표 특산품" 판정에 쓴다.

지역만 다르고 검색어와 NICE류가 같은 행은 `(검색어, 정규화 NICE류)` 고유 키로 묶어 API를
한 번만 호출한 뒤 각 원본 행에 결과를 연결한다. 고유 쿼리가 끝날 때마다 체크포인트를 갱신하며,
`--resume`은 `collectionStatus=complete` 쿼리를 재호출하지 않고 `partial|error` 쿼리의 다음
페이지부터 이어간다. 체크포인트의 페이지 크기·페이지 상한·hit 상한이 현재 실행값과 다르면
잘못된 혼합을 막기 위해 재개를 거부한다.

## 건수 필드의 의미

- `keywordTotalCount`: KIPRIS 키워드 검색 전체 건수. NICE류 필터 전이며 모든 페이지 합계다.
- `pages.unfilteredCount`: 수집한 모든 페이지의 필터 전 건수.
- `pages.filteredCount`: 수집한 모든 페이지에서 NICE류까지 맞는 건수.
- `pages.fetchedCount`, `pages.nextPage`: 수집 페이지 수와 재개할 페이지.
- `collectionStatus`: `complete|partial|error`. 부분 수집이면 `stopReason`에
  `max_pages|max_hits_per_query|request_budget` 중단 사유가 남는다.

범용 품목은 결과가 수만~수백만 건이므로 상한 없이 전 페이지를 다운로드하지 않는다.
`collectionStatus=partial`의 hit를 완전한 모집단으로 해석하면 안 되며, ④는 이를 집계에 포함하되
`partialQueryCount`와 경고를 함께 출력한다.

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
├── fetchAreaBrands.js       농사로 지역브랜드 검증자료 소량 수집 CLI (기본 3건)
├── selftest.js            fetch 모킹 기반 자체 테스트 (API 키 없이 실행 가능)
├── lib/
│   ├── kiprisClient.js     trademarkSearch() — ServiceKey 쿼리 빌드, resultCode 처리
│   ├── areaBrandClient.js  areaBrandLst XML·페이지 처리, 출원번호 조인 키 정규화
│   ├── xmlLite.js          정규식 기반 경량 XML 파서
│   ├── fetchWithRetry.js   타임아웃·재시도(지수 백오프)·키 마스킹
│   ├── errors.js           KiprisApiError, resultCode 표준화
│   ├── filters.js          filterByClassCode()
│   └── loadEnv.js          의존성 없는 .env 로더
└── output/                 --out 결과 저장 위치 (git-ignored)
```

## 테스트

실제 API 키 없이 KIPRIS와 농사로 지역브랜드의 XML 파싱 → 클라이언트 → 페이지/오류 처리와
KIPRIS 품목 필터를 검증한다:

```bash
node 03-match-trademarks/selftest.js
```
