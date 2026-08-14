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
- `normalized_contains`는 지정상품명에 고시상품명칭이 포함된 경우로, 특산품 활용 출원으로
  인정한다. `class_only`는 NICE류만 확인된 경우이므로 사람 검토 후보로 유지한다. 등록번호가
  없는 출원중·거절 건은 `not_applicable`이다.
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
미확정 원물명의 상표 존재 여부를 별도로 탐색할 때만 `--include-review-required`를 명시한다.
이 결과는 `matchingBasis=raw_item_name_unclassified`로 표시해 고시명칭 확정 결과와 구분한다.
같은 `(검색어, NICE류)`는 한 번만 호출하며 `--resume`으로 완료 쿼리는 재사용하고 부분·오류
쿼리만 이어서 수집한다. `collectionStatus=partial`은 오류가 아니라 실행 상한에 도달한 결과이며
완전 모집단으로 해석하면 안 된다.

주요 옵션은 `--numOfRows`, `--concurrency`, `--max-requests`, `--max-pages`,
`--max-hits-per-query`, `--checkpoint`, `--resume`, `--dry-run`, `--area-brands`,
`--enrich-registry`, `--max-registry-requests`, `--registry-concurrency`다.

배치 출력은 기본적으로 `storageMode=query_facts`를 사용한다. KIPRIS hit 배열은 고유
`noticeName + NICE류` 검색 조합별 `queryFacts`에 한 번만 저장하고, `results`의 지역×품목 행은
`queryKey`로 참조한다. ④ 분석은 참조를 메모리에서 연결한 뒤 출원인 주소 근거를 각 지역에 다시
대조한다. 과거 도구 호환이 꼭 필요할 때만 `--storage-mode expanded`를 명시한다.

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
보존한다. 캐시를 사용하지 않을 때만 `--no-cache`를 명시한다. `--checkpoint-every`(기본 50)
성공 건마다 캐시를 저장해 대량 실행 중 중단돼도 그때까지 성공분은 남는다.

### 일별 호출 예산과 429 재개 시점(#52)

제공기관의 실제 계정 상한과 초기화 시각은 아직 확정되지 않았다. 프로젝트 운영 기준으로
KST 달력일 단위의 보수적 예산을 두며, `--daily-budget <n>`을 지정하면
`output/ip-registry-daily-budget.json`(또는
`--budget-state` 경로)에 그날(KST) 누적 호출 수를 기록하고, 남은 예산만큼만 `--limit`을 줄여
호출한다. 429가 감지되면 같은 상태 파일에 `resumeNotBefore`(다음날 KST 00:00)를 남기고, 그
시점 전에 다시 실행하면 새 API 호출 없이 캐시만 적용한다(`limit=0`으로 자동 전환). 매일 같은
명령을 반복 실행하면(예: Windows 작업 스케줄러로 1일 1회) 날짜가 바뀔 때마다 예산이 초기화되며
캐시에 없는 등록번호부터 이어서 수집된다 — 별도의 시작 위치 지정은 필요 없다.

```bash
node 03-match-trademarks/enrichIpRegistry.js \
  --input 03-match-trademarks/output/area-brand-validation-result.json \
  --daily-budget 100 --limit 100 --concurrency 2 \
  --cache 03-match-trademarks/output/ip-registry-cache.json \
  --budget-state 03-match-trademarks/output/ip-registry-daily-budget.json \
  --out 03-match-trademarks/output/ip-registry-enriched.json
```

출력 JSON의 `ipRegistryEnrichment.dailyBudget`에
`limit/usedToday/remainingToday/resumeNotBefore/executionRequestLimit/blockedReason`이 남는다.
호출 시작 전에 사용량을 상태 파일에 예약하므로 프로세스가 중간 종료돼도 이미 사용한 호출을
다음 실행에서 다시 배정하지 않는다. `blockedReason`은 `rate_limit_cooldown` 또는
`daily_budget_exhausted`로 성공·오류·미수집 집계와 함께 운영 리포트에서 확인할 수 있다.

## 출원번호 기반 출원인 주소 보강

```bash
node 03-match-trademarks/enrichApplicantRegions.js \
  --input 03-match-trademarks/output/search-result.json \
  --limit 10 --concurrency 1 \
  --cache 03-match-trademarks/output/trademark-applicant-region-cache.json \
  --out 03-match-trademarks/output/applicant-regions.json
```

이미 수집한 주소 캐시만 새 query fact 결과에 적용할 때는 `--cache-only`를 사용한다. 이 모드는
신규 API 요청을 보내지 않고, 캐시에 없는 출원번호를 `not_collected`로 유지한다.

KIPRISPlus 상표 출원 속보의 `trademarkApplicantInfo` 오퍼레이션은 출원번호를 입력받고
`applicantAddress`를 반환한다. 따라서 등록번호가 아직 없는 출원·심사 중 상표도 조회할 수 있다.
2026-08-12 전체 알파의 고유 출원번호 23,912건을 조회했다. 정상 출원인 응답 22,994건,
제공기관 정상 무결과(`resultCode=20`) 916건, 성공 코드지만 반복 빈 항목인 미검증 종료 2건이며
최종 오류·미수집·429는 0건이다. 빠른 병렬 호출에서 `00` 빈 항목이 일시 반환될 수 있어
빈 항목은 재시도하고, 연속 오류 회로 차단과 성공 100건 단위 체크포인트를 적용한다.
기본 캐시는 출원인 이름·고객번호·전체 상세주소를 저장하지 않고 정규화한 시도·시군구만 누적한다.
기본적으로 1출원번호당 1조회이며 빈 항목·전송 오류 재시도는 추가 호출이 될 수 있다. 공개 안내의 무료 호출량과 현재 승인 계정에 실제 적용되는 호출량이 같다고
확인되지 않았으므로 고정 월 한도를 가정하지 않고, 캐시 체크포인트를 남기며 실제 제한 응답이
발생할 때 중단한다. 이번 전체 수집은 1,000회를 넘었지만 제한 응답이 없었으므로 계정 상한은
계속 미확인으로 기록한다.
부분 캐시 상태에서는 지역 지표를 확정하지 않는다.

지역 귀속 판정은 `applicantRegionMatch`와 출원인 주소 정규화 결과를 우선한다. KIPRIS hit의
NICE류·지정상품 등 부가 코드가 누락되거나 `goodsMatchMethod=unverified`여도 주소가 해당
지역(`inside`)이면 지역 출원 건수에 포함한다. 다만 지정상품·류 판정은 별도 검토 지표로
남기며, 출원인 주소 자체가 없거나 행정구역 정규화가 실패한 경우에는 `unverified`로 보류한다.

## 출처와 버전 필드

- 수집 JSON: `contractVersion`, `sourceMetadata`, `fetchedAt`
- ③ JSON: `trademarkSourceMetadata`, 입력별 `provenance`, `regionalBrandValidation`,
  `ipRegistryEnrichment`, `applicationApplicantEnrichment`
- 조인된 hit: `regionalBrandMatchVersion`, `regionalBrandMatchSource`,
  `regionalBrandEvidence`
- 등록원부 보강 hit: `applicantRegionMatch*`, `applicantRegionEvidence`, `goodsMatch*`,
  `goodsEvidence`, `registryEvidence`
- 출원번호 주소 보강 hit: `applicantRegionMatch*`, `applicantRegionEvidence`,
  `applicationApplicantLookup`
- 현재 계약: KIPRIS `kipris-trademark-word-search-v1`, 농사로
  `nongsaro-area-brand-v1`, 등록원부 `ip-registry-mark-history-v1`, 출원인 주소
  `kipris-trademark-applicant-address-v1`

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
├── enrichApplicantRegions.js        출원번호 기반 주소 지역 누적 보강
├── lib/areaBrandClient.js           농사로 XML·페이지·계약 메타데이터
├── lib/areaBrandEnricher.js         행정구역 정규화·출원번호 완전일치 조인
├── lib/kiprisClient.js              KIPRIS 호출·계약 메타데이터
├── lib/ipRegistryClient.js          등록원부 JSON 호출·응답 계약
├── lib/ipRegistryEnricher.js        주소 판정·지정상품 근거 분류
├── lib/ipRegistryBudget.js          KST 기준 일별 호출 예산·429 재개 시점 기록
├── lib/trademarkApplicantClient.js  출원 속보 출원인 주소 응답 계약
├── lib/trademarkApplicantEnricher.js 출원번호 조회·지역 판정
├── lib/trademarkApplicantCache.js   상세주소 비저장 영속 캐시
└── output/                           로컬 산출물(git-ignored)
```

```bash
node 03-match-trademarks/selftest.js
```
