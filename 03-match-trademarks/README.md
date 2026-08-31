# ③ 상표 검색·지역브랜드 검증 파이프라인

②단계의 지역·고시명칭·NICE류를 받아 KIPRISPlus 상표 단어검색
(`trademarkInfoSearchService/getWordSearch`)을 호출한다. 농사로 지역브랜드 자료는 ① 특산품
원본과 섞지 않고, 출원번호가 정확히 같은 상표에만 별도 검증 근거로 연결한다.

## 현재 범위와 판단 기준

- KIPRIS 결과는 ②의 `niceClass`로 필터링한다. 류가 없으면 잠정 식품류
  `29·30·31·32·33·40·43`을 사용하며 결과의 `query.classCodeFallbackApplied`에 표시한다.
  이 목록은 업무 확정 기준이 아닌 노이즈 완화용 v1 규칙이다.
- 고시명칭·NICE류가 확정된 품목은 **그 품목에 매핑된 NICE류만** 현재 집계 범위로
  사용한다. 예를 들어 `굴비`가 29류로 매핑되어 있으면 29류 결과를 집계하며,
  음식점업 43류·도소매업 35류처럼 실제 활용과 연관될 수 있는 서비스류는 현재 수치에
  포함하지 않는다. 서비스류 확장은 현행 원물 중심 지표와 섞지 않고 후속 분석에서
  포함 범위와 중복 집계 기준을 별도로 검토한다.
- KIPRIS 단어검색에 없는 출원인 주소는 출원번호 기반 `trademarkApplicantInfo`로 기본 보강하고,
  등록번호가 있는 hit는 등록원부 `getMarkHistory`로 주소·지정상품을 보조 보강한다. 주소는 법정동코드로 판정하고, 지정상품은
  `normalized_exact|normalized_contains|class_only|mismatch|unverified` 근거를 남긴다.
- `normalized_contains`는 지정상품명에 고시상품명칭이 포함된 경우로, 특산품 활용 출원으로
  인정한다. `class_only`는 NICE류만 확인된 경우이므로 사람 검토 후보로 유지한다. 등록번호가
  없는 출원중·거절 건은 `not_applicable`이다.
- 농사로 지역브랜드의 `aplcnoInfo`와 KIPRIS `applicationNumber`는 숫자 외 문자를 제거한 뒤
  완전일치할 때만 연결한다. 이름·유사문자열 조인은 하지 않는다
  (`area-brand-application-region-join-v2-aliases`).
- 지역명은 법정동코드 마스터를 최종 기준으로 하고, `서울시→서울특별시`,
  `강원도→강원특별자치도` 같은 축약·개칭명과 명시적으로 등록된 통합 전 시군구명을
  공통 정규화한다. `시/군/구` 접미사 복원도 후보가 하나일 때만 하며,
  `고성`처럼 복수 후보이면 `unverified`로 둔다.
- 지역브랜드의 지역은 브랜드 연관 지역이지 출원인 주소가 아니다. ④단계에서 두 지표를 분리한다.

## 원물명 검색 대상과 최소 품질 기준(2026-08-19)

- ②에서 고시명칭·NICE류가 확정되지 않은(`status=review_required`) 행도 GI·원물 여부와
  무관하게 `--include-review-required`로 검색 대상에 포함한다. 특산품 후보가 KIPRIS
  고시상품명칭 사전에 없다는 이유만으로 검색 자체를 건너뛰지 않는다. 이 결과는
  `matchingBasis=raw_item_name_unclassified`로 표시해 고시명칭 확정 결과와 분리하고,
  대시보드 집계(`officialItemLabel` 게이트)에는 포함하지 않는다 — 지역·상표 근거 탐색
  용도로만 쓴다.
- 다만 원물명 검색어가 **한글 기준 2글자 미만**(한 글자)이면 검색하지 않는다. NICE류가
  없어 식품 전 카테고리(29·30·31·32·33·40·43류) fallback이 걸리면, "포"·"마"·"콩"처럼
  흔한 한 글자 검색어는 전국 상표 결과가 수십만~백만 건대까지 치솟아 특산품과 무관한
  노이즈만 커지고 페이지네이션으로 완결시킬 수도 없다(2026-08-19 재수집 작업 중 실측:
  "포" 125만8천건, "마" 102만건). 이 기준 미달 항목은 삭제하지 않고 검색만 보류하며,
  더 긴 대표 검색어를 찾을 수 있을 때 별도로 재시도한다.
- 지정상품(designated goods) 텍스트와 원물명이 `normalized_exact`/`normalized_contains`로
  일치하는 근거는 등록원부 보강(`--enrich-registry`)이 끝난 건에만 생긴다. 현재는 이
  근거가 있어도 원물명 행을 자동으로 확정 특산품(`officialItemLabel`)으로 승격하지
  않고, 사람이 검토할 수 있는 별도 근거로만 남긴다 — 등록원부 보강 자체가 아직 API
  호출 상한 때문에 전체를 다 돌지 못한 진행 중 상태이기 때문이다(경로 B, 아래 런북 참고).
- 쿼리당 페이지 상한(`--max-pages`)에 걸려 `collectionStatus=partial`이어도, 상한을
  의도적으로 크게(예: 150페이지) 설정하고 실제로 그 상한까지 다 수집했다면 이를
  "판정 불가"가 아니라 **"범위가 명시된 제한적 완료"**로 본다. 다만 표시할 때는 100%
  전수조사와 구분해 수집 범위(페이지 수·건수)를 함께 밝힌다. "사과"처럼 전국 결과가
  1만 건을 넘는 흔한 품목은 완전한 전수조사(수만 페이지)가 비현실적이므로, 이 절충이
  필요하다.

## 2026-08-19~20 재수집 결과와 남은 항목

246개 partial 쿼리(861개 고유 검색어 중)를 실측 후 두 라운드로 재수집했다.

- **1라운드**(사과 등 183개, PR #103): 150페이지 이내로 전수조사 가능한 항목을
  `--max-pages 150`으로 재수집, 전량 `collectionStatus=complete`(진짜 전수조사) 확보.
- **2라운드**(포도·오리 등 49개, PR #104): 전국 결과가 5~7만 건대라 전수조사에
  750페이지 넘게 필요한 항목을, 쿼리당 hit 상한 3,000건(위 "범위가 명시된 제한적
  완료" 기준)으로 재수집. 1개(징장)만 자연 소진, 48개는 상한 도달로 판정하되
  `boundedCollection` 메타데이터(원래 상태·상한값)를 남겨 100% 전수조사와 구분했다.

결과: 공식 특산품 803개 중 판정 완료가 28개 → 744개, 지역×품목 표시 가능이
671개(전체 1,692개 중) → 1,615개로 늘었다.

**남은 14개(한 글자 원물명: 포·마·쌀·꽃·감·옻·굴·콩·술·米·엿·난·닭)는 이번엔 보류한다.**
①원본(농사로) 단계에서부터 대부분 이미 한 글자였고(16개 지역×품목 행 중 richer한
원본명이 있는 건 5건뿐, 그마저도 "안동포"·"영동감"처럼 지역명+품목명을 그대로 붙인
것뿐이라 실제 상표 검색어로서의 특이성은 별로 없다), ②NICE류를 사람이 임의로
추정해 붙이면 이번에 공들여 지킨 "확정 근거 없는 값은 넣지 않는다"는 원칙을 스스로
어기게 된다. 페이지를 더 늘려도 해결되지 않는(검색어 자체가 너무 흔함) 문제이므로,
자동 재시도 대상에서 계속 제외한다. 재시도하려면 ① 원본 데이터에 더 구체적인
설명(예: "안동포"의 "포"가 삼베인지, "찐쌀"의 "쌀"인지)이 있는지부터 사람이 확인해야
한다.

## 경로 B(등록원부·지정상품 매칭) 반영 정책 — 병합 전에 별도 비교(2026-08-20)

경로 B(`--enrich-registry`, 지정상품 `normalized_exact`/`normalized_contains` 근거)는
아직 API 호출 상한 때문에 전체 모집단을 다 돌지 못한 진행 중 상태다(2026-08-12 기준
등록번호 약 3만3천 건 중 754건만 완료). 이 상태에서 완료분만이라도 기존 확정 특산품
집계(`officialItemLabel`, 고시명칭 매칭 기준)에 조용히 섞어 넣지 않는다.

향후 경로 B를 대시보드에 반영할 때는:

1. 고시명칭(경로 A/③ 기본) 매칭 결과와 등록원부(경로 B) 매칭 결과를 **같은 화면에서
   나란히 비교할 수 있는 별도 뷰**(예: 별도 지도 레이어 또는 탭)로 먼저 노출한다.
2. 두 근거가 같은 지역×품목에서 어긋나는 사례가 있는지 데이터 품질을 검증한다.
3. 검증이 끝난 뒤에만 병합 방식(우선순위·가중 평균·완전 대체 등)을 정한다.

즉 "병합 후 필터링"이 아니라 "분리해서 비교 → 검증 → 병합 결정" 순서로 진행한다.
이 문서와 [`출원인 주소 지역 매칭·재분석·복구 런북`](../docs/applicant-region-recovery-runbook.md)의
"현재 한계와 후속 구현" 절이 이 결정의 배경이다.

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

농촌진흥청 `rda_regional_specialty_crops`는 정책 원문의 복합 작목명을 그대로
검색하며 NICE류는 식품 관련류 fallback을 쓴다. 지역 귀속은 공식 지정 범위인
도 단위로만 판정하고, 원문에 없는 시군구를 추정하지 않는다(#117).

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
`--cache-only`를 명시하면 신규 등록원부 API 호출 없이 현재 캐시만 새 ③ 결과에
재적용한다. 주소 정규화·분석 규칙 변경 후 재현 검증에 사용한다.

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
다음 실행에서 다시 배정하지 않는다. `blockedReason`은 `cache_only`, `rate_limit_cooldown` 또는
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

두 주소 보강 경로의 권장 실행 순서, 캐시 기반 무호출 재분석, 중단·429·규칙 변경
복구 방법은 [`출원인 주소 지역 매칭·재분석·복구 런북`](../docs/applicant-region-recovery-runbook.md)을
기준으로 한다.

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
출원인 지역 근거에는 정규화 방법·실패 사유를 남기되, 전체 주소·키 값·인증 URL은
저장하지 않는다.

## 구조와 테스트

```text
03-match-trademarks/
├── matchTrademarks.js               KIPRIS 단건·배치 및 선택적 지역브랜드 조인
├── fetchAreaBrands.js               농사로 지역브랜드 소량 수집
├── buildAreaBrandValidationInput.js 별도 검증자료의 validation_only 감사 CSV 생성
├── enrichIpRegistry.js              등록번호 기반 주소·지정상품 소량 보강
├── enrichApplicantRegions.js        출원번호 기반 주소 지역 누적 보강
├── refreshUnverifiedApplicantRegions.js  미확인(unmatched/ambiguous) 건만 선별 재조회(#73)
├── lib/areaBrandClient.js           농사로 XML·페이지·계약 메타데이터
├── lib/areaBrandEnricher.js         행정구역 정규화·출원번호 완전일치 조인
├── lib/kiprisClient.js              KIPRIS 호출·계약 메타데이터
├── lib/ipRegistryClient.js          등록원부 JSON 호출·응답 계약
├── lib/ipRegistryEnricher.js        주소 판정·지정상품 근거 분류
├── lib/ipRegistryBudget.js          KST 기준 일별 호출 예산·429 재개 시점 기록
├── lib/trademarkApplicantClient.js  출원 속보 출원인 주소 응답 계약
├── lib/trademarkApplicantEnricher.js 출원번호 조회·지역 판정
├── lib/trademarkApplicantCache.js   상세주소 비저장 영속 캐시
├── lib/applicantRegionRefresh.js    미확인 캐시 항목 분류·재조회 후보 manifest(#73)
└── output/                           로컬 산출물(git-ignored)
```

```bash
node 03-match-trademarks/selftest.js
```
