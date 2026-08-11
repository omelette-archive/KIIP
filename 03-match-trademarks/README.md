# ③ 상표 검색·지역브랜드 검증 파이프라인

②단계의 지역·고시명칭·NICE류를 받아 KIPRISPlus 상표 단어검색
(`trademarkInfoSearchService/getWordSearch`)을 호출한다. 농사로 지역브랜드 자료는 ① 특산품
원본과 섞지 않고, 출원번호가 정확히 같은 상표에만 별도 검증 근거로 연결한다.

## 현재 범위와 판단 기준

- KIPRIS 결과는 ②의 `niceClass`로 필터링한다. 류가 없으면 잠정 식품류
  `29·30·31·32·33·40·43`을 사용하며 결과의 `query.classCodeFallbackApplied`에 표시한다.
  이 목록은 업무 확정 기준이 아닌 노이즈 완화용 v1 규칙이다. 지정상품 상세 대조는 #12다.
- 출원인 주소는 KIPRIS 단어검색 응답에 없다. `--enrich-registry`를 켜면 지식재산처
  등록원부 실시간 정보 조회(`getMarkHistory`)로 등록번호가 있는 hit에 한해 실제 출원인
  주소(#11)와 지정상품(#12)을 보강하고, `applicantRegionMatch`에 직접 반영한다. 켜지 않으면
  이전처럼 미검증 상태로 남는다 (`ip-registry-mark-history-v1`).
- 농사로 지역브랜드의 `aplcnoInfo`와 KIPRIS `applicationNumber`는 숫자 외 문자를 제거한 뒤
  완전일치할 때만 연결한다. 이름·유사문자열 조인은 하지 않는다
  (`area-brand-application-region-join-v1`).
- `signguNm`은 법정동코드 마스터에 완전일치시키고 후보가 하나일 때만 `시/군/구` 접미사를
  복원한다. `고성`처럼 복수 후보이면 `unverified`로 둔다
  (`area-brand-region-normalization-v1`).
- 지역브랜드의 지역은 브랜드 연관 지역이지 출원인 주소가 아니다. ④단계에서 두 지표를 분리한다.

출처·공식 URL·계약 버전·확인일은
[`docs/data-source-provenance.md`](../docs/data-source-provenance.md)를 기준으로 관리한다.

## 설정

```bash
cp .env.example .env
# KIPRIS_API_KEY, NONGSARO_LOCAL_BRAND_API_KEY 입력
```

키는 로컬 `.env`에만 두며, 위치와 worktree 복사 방법은
[`docs/api-key-management.md`](../docs/api-key-management.md)를 따른다.

## 일반 배치 검색

```bash
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/normalized.csv \
  --out 03-match-trademarks/output/result.json

# 호출 없이 계약·요청 계획만 확인
node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/sample-normalized.csv \
  --dry-run \
  --out 03-match-trademarks/output/sample-plan.json
```

`status=review_required|error` 또는 `excluded=true`인 ② 행은 검색하지 않고 `skipped`로 보존한다.
같은 `(검색어, NICE류)`는 한 번만 호출하며 `--resume`으로 완료 쿼리는 재사용하고 부분·오류
쿼리만 이어서 수집한다. `collectionStatus=partial`은 오류가 아니라 실행 상한에 도달한 결과이며
완전 모집단으로 해석하면 안 된다.

주요 옵션은 `--numOfRows`, `--concurrency`, `--max-requests`, `--max-pages`,
`--max-hits-per-query`, `--checkpoint`, `--resume`, `--dry-run`, `--area-brands`,
`--enrich-registry`, `--max-registry-requests`, `--registry-concurrency`다.

## 농사로 지역브랜드 3건 E2E

```bash
node 03-match-trademarks/fetchAreaBrands.js \
  --limit 3 \
  --out 03-match-trademarks/output/area-brand-sample.json

node 03-match-trademarks/buildAreaBrandValidationInput.js \
  --input 03-match-trademarks/output/area-brand-sample.json \
  --limit 3 \
  --out 03-match-trademarks/output/area-brand-validation-input.csv

node 03-match-trademarks/matchTrademarks.js \
  --input 03-match-trademarks/output/area-brand-validation-input.csv \
  --area-brands 03-match-trademarks/output/area-brand-sample.json \
  --numOfRows 100 --max-pages 1 --max-hits-per-query 100 --max-requests 3 \
  --out 03-match-trademarks/output/area-brand-validation-result.json
```

2026-08-10 실키 검증 결과: 입력 3건, 요청 성공 3건, 오류 0건, 출원번호 조인 3건,
`regionalBrandMatch=inside` 3건이었다. 쿼리 1건은 첫 페이지 상한 때문에 `partial`이며 데이터
오류가 아니다. 이 소량 결과는 연결 가능성 검증용이며 농사로 전체 602건 결과를 대표하지 않는다.

## 등록원부 보강(`--enrich-registry`) — 출원인 주소(#11)·지정상품(#12)

```bash
node 03-match-trademarks/matchTrademarks.js \
  --region "강원특별자치도 양양군" --item "사과" --classCode 31 \
  --enrich-registry --max-registry-requests 8 \
  --out 03-match-trademarks/output/ip-registry-sample.json
```

등록번호(`registrationNumber`)가 있는 hit만 지식재산처 등록원부 실시간 정보 조회
(`getMarkHistory`, `ip-registry-mark-history-v1`)로 보강한다. 조회 키는 `applicationNumber`가
아니라 `registrationNumber`이며, 등록이 완료되지 않은 상표(출원중·거절·포기 등)는 대상이
아니다. 얻은 주소는 지역브랜드처럼 "브랜드 연관 지역"이 아니라 진짜 출원인 주소이므로
`regionalBrand*`가 아니라 `applicantRegionMatch`/`applicantRegion` 본류에 직접 반영하고,
지정상품은 `designatedGoodsEvidence`에 담는다.

**동시 호출 상한 필수.** 2026-08-11 실키 검증에서 hit 46건을 무제한 동시 호출(`Promise.all`)로
보강했더니 25건 전부 HTTP 429가 났다 — `fetchWithRetry`의 지수 백오프로도 회복되지 않을 만큼
이 서비스의 초당 허용량이 낮다. `--registry-concurrency`(기본 3)로 동시 호출 수를 좁혀
해결했으며, 같은 조건에서 재검증한 결과 요청 8건 중 오류 0건, `applicantRegionMatch=inside`
1건("양양 해풍 사과", 강원특별자치도 양양군)·`outside` 7건(충청북도 제천시·경상북도 영주시 등
타 지역 출원인)이 정확히 갈렸다. 대량 배치에서는 `--max-registry-requests`로 총 호출 수도
함께 제한해야 한다.

## 출처와 버전 필드

- 수집 JSON: `contractVersion`, `sourceMetadata`, `fetchedAt`
- ③ JSON: `trademarkSourceMetadata`, 입력별 `provenance`, `regionalBrandValidation`,
  `ipRegistryValidation`
- 조인된 hit: `regionalBrandMatchVersion`, `regionalBrandMatchSource`,
  `regionalBrandEvidence`
- 등록원부로 보강된 hit: `applicantRegionMatchVersion`, `applicantRegionMatchSource`,
  `applicantRegion`, `designatedGoodsEvidence`, `ipRegistryLookup.status`
- 현재 계약: KIPRIS `kipris-trademark-word-search-v1`, 농사로
  `nongsaro-area-brand-v1`, 등록원부 `ip-registry-mark-history-v1`
  (출원인 주소 판정은 `ip-registry-applicant-region-v1`)

`regionalBrandEvidence`에는 농사로 콘텐츠 번호, 원본·정규화 지역, 브랜드명, 주요품목명,
출원번호를 보존한다. `designatedGoodsEvidence`에는 등록번호, NICE류·지정상품 목록을
보존한다. 키 값과 인증 URL은 저장하지 않는다.

## 구조와 테스트

```text
03-match-trademarks/
├── matchTrademarks.js               KIPRIS 단건·배치 및 선택적 지역브랜드 조인
├── fetchAreaBrands.js               농사로 지역브랜드 소량 수집
├── buildAreaBrandValidationInput.js 별도 검증자료를 ③ 입력 CSV로 변환
├── lib/areaBrandClient.js           농사로 XML·페이지·계약 메타데이터
├── lib/areaBrandEnricher.js         행정구역 정규화·출원번호 완전일치 조인
├── lib/kiprisClient.js              KIPRIS 호출·계약 메타데이터
├── lib/ipRegistryClient.js          등록원부 getMarkHistory 호출·계약 메타데이터
├── lib/ipRegistryEnricher.js        등록번호 기준 출원인 주소·지정상품 보강(동시성 제한)
└── output/                           로컬 산출물(git-ignored)
```

```bash
node 03-match-trademarks/selftest.js
```
