# ③ 상표 검색·지역브랜드 검증 파이프라인

②단계의 지역·고시명칭·NICE류를 받아 KIPRISPlus 상표 단어검색
(`trademarkInfoSearchService/getWordSearch`)을 호출한다. 농사로 지역브랜드 자료는 ① 특산품
원본과 섞지 않고, 출원번호가 정확히 같은 상표에만 별도 검증 근거로 연결한다.

## 현재 범위와 판단 기준

- KIPRIS 결과는 ②의 `niceClass`로 필터링한다. 류가 없으면 잠정 식품류
  `29·30·31·32·33·40·43`을 사용하며 결과의 `query.classCodeFallbackApplied`에 표시한다.
  이 목록은 업무 확정 기준이 아닌 노이즈 완화용 v1 규칙이다.
- KIPRIS 단어검색에 없는 출원인 주소·지정상품은 등록번호가 있는 hit만 등록원부
  `getMarkHistory`로 별도 보강한다. 주소는 법정동코드로 판정하고, 지정상품은
  `normalized_exact|normalized_contains|class_only|mismatch|unverified` 근거를 남긴다.
- #12의 세부 기준이 확정되기 전에는 `normalized_contains|class_only`를 후보로만 표시하고 기존
  상표 합계에서 자동 제외하지 않는다. 등록번호가 없는 출원중·거절 건은 `not_applicable`이다.
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
# KIPRIS_API_KEY, NONGSARO_LOCAL_BRAND_API_KEY, IP_REGISTRY_API_KEY 입력
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

## 농사로 지역브랜드 3건 검증자료

```bash
node 03-match-trademarks/fetchAreaBrands.js \
  --limit 3 \
  --out 03-match-trademarks/output/area-brand-sample.json

node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/sample-normalized.csv \
  --area-brands 03-match-trademarks/output/area-brand-sample.json \
  --numOfRows 100 --max-pages 1 --max-hits-per-query 100 --max-requests 3 \
  --out 03-match-trademarks/output/specialty-search-with-area-brand.json
```

`--input`은 반드시 ① 특산품을 ② 고시명칭으로 정규화한 CSV다. `areaBrandLst.brandName`을
검색어로 쓰지 않는다. `buildAreaBrandValidationInput.js`는 필요하면 지역브랜드 원문의 지역·주요품목·
브랜드명을 검토하는 `validation_only` 감사표를 만들 뿐, 그 CSV는 분석 검색 입력이 아니다.

2026-08-10 과거 연결 검증 결과: 입력 3건, 요청 성공 3건, 오류 0건, 출원번호 조인 3건,
`regionalBrandMatch=inside` 3건이었다. 쿼리 1건은 첫 페이지 상한 때문에 `partial`이며 데이터
오류가 아니다. 당시 브랜드명 검색 산출물은 연결 가능성 확인용으로만 보존하며 특산품 통계나
대시보드에는 사용하지 않는다.

## 등록원부 3건 보강

```bash
node 03-match-trademarks/enrichIpRegistry.js \
  --input 03-match-trademarks/output/area-brand-validation-result.json \
  --limit 3 --concurrency 1 \
  --cache 03-match-trademarks/output/ip-registry-cache.json \
  --out 03-match-trademarks/output/area-brand-ip-registry-sample.json
```

별도 보강 CLI의 기본 호출 상한은 등록번호 3개다. 2026-08-11 실키 결과는 등록번호 고유
13개 중 3개 요청,
성공 3·오류 0·미수집 10이었다. 출원인 주소 판정은 inside 2·outside 0·unverified 1,
지정상품은 세 건 모두 `class_only` 후보였다. 이는 샘플 기술 검증이며 전체 분포가 아니다.

기본 영속 캐시는 `output/ip-registry-cache.json`이다. 성공한 등록번호의 응답은 다음 실행에서
API를 다시 호출하지 않고 재사용하며, 미수집 등록번호부터 `--limit`만큼 추가 조회한다. 캐시에는
키·출원인 이름·전체 상세주소를 저장하지 않고 주소에서 정규화한 시도·시군구와 지정상품만
보존한다. 등록번호가 아직 없는 출원·심사 중 상표는 이 등록원부 API의 조회 대상이 아니므로
출원번호 기반 공식 주소 소스가 확보되기 전까지 `not_applicable`로 남는다. 캐시를 사용하지 않을
때만 `--no-cache`를 명시한다.

## 출처와 버전 필드

- 수집 JSON: `contractVersion`, `sourceMetadata`, `fetchedAt`
- ③ JSON: `trademarkSourceMetadata`, 입력별 `provenance`, `regionalBrandValidation`,
  `ipRegistryEnrichment`
- 조인된 hit: `regionalBrandMatchVersion`, `regionalBrandMatchSource`,
  `regionalBrandEvidence`
- 등록원부 보강 hit: `applicantRegionMatch*`, `applicantRegionEvidence`, `goodsMatch*`,
  `goodsEvidence`, `registryEvidence`
- 현재 계약: KIPRIS `kipris-trademark-word-search-v1`, 농사로
  `nongsaro-area-brand-v1`, 등록원부 `ip-registry-mark-history-v1`

`regionalBrandEvidence`에는 농사로 콘텐츠 번호, 원본·정규화 지역, 브랜드명, 주요품목명,
출원번호를 보존한다. `designatedGoodsEvidence`에는 등록번호, NICE류·지정상품 목록을 보존한다.
출원인 전체 주소·키 값·인증 URL은 저장하지 않는다.

## 구조와 테스트

```text
03-match-trademarks/
├── matchTrademarks.js               KIPRIS 단건·배치 및 선택적 지역브랜드 조인
├── fetchAreaBrands.js               농사로 지역브랜드 소량 수집
├── buildAreaBrandValidationInput.js 별도 검증자료의 validation_only 감사 CSV 생성
├── enrichIpRegistry.js              등록번호 기반 주소·지정상품 소량 보강
├── lib/areaBrandClient.js           농사로 XML·페이지·계약 메타데이터
├── lib/areaBrandEnricher.js         행정구역 정규화·출원번호 완전일치 조인
├── lib/kiprisClient.js              KIPRIS 호출·계약 메타데이터
├── lib/ipRegistryClient.js          등록원부 JSON 호출·응답 계약
├── lib/ipRegistryEnricher.js        주소 판정·지정상품 근거 분류
└── output/                           로컬 산출물(git-ignored)
```

```bash
node 03-match-trademarks/selftest.js
```
