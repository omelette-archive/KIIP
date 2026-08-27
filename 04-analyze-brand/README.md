# ④ 지역 브랜드 결정론적 분석

③단계 JSON을 읽어 지역×고시명칭·NICE류, 지역, 고시명칭·NICE류별 상표 현황을 집계한다.
화면용 품목명은 ② 표준 특산품명으로 별도 보존한다. 이 단계는 생성형 AI를 쓰지
않으며 같은 입력과 버전에서 같은 결과를 내는 규칙 기반 분석이다.

## 구현 범위

- 출원번호(없으면 등록번호) 기준 중복 제거
- 출원 상태 `registered|pending|inactive|unknown` 표준화
- 연도별 건수와 최근/직전 동일 기간 증감, 최근 브랜드 예시
- 오류·부분 수집·날짜 누락·지역 미검증 데이터 품질 지표
- 출원인 주소 근거와 농사로 지역브랜드 근거의 분리 집계
- 등록원부 지정상품의 확정·검토후보·불일치·미검증 집계
- ③의 출처 계보를 버킷과 ④ 산출물에 전달
- 농사로 지역브랜드 `brandName` 검증 전용 행과 고시명칭 미확정 행을 통계 차원에서 제외

## 사용법

```bash
node 04-analyze-brand/analyzeBrands.js \
  --input 03-match-trademarks/output/batch-result.json \
  --out 04-analyze-brand/output/analysis.json \
  --raw-goods-review 04-analyze-brand/data/raw-item-goods-review-v1.json \
  --asOfYear 2026
```

`--raw-goods-review`는 고시명칭 사전에서 분류되지 않았지만 지정상품과 지역 근거를
별도로 검토·승인한 원물명 행을 ④ 집계에 재적용한다. 기본 운영 실행기는 저장소에
고정된 승인 manifest를 이 옵션으로 전달하므로, 대시보드 JSON을 수동 수정하지 않고도
같은 결과를 재생성할 수 있다.

현재 연도는 불완전하므로 시계열 비교에서 제외한다. `--asOfYear 2026 --recentYears 3`은
2023~2025년과 2020~2022년을 비교한다.

## 출력 계약

현재 `schemaVersion`은 `1.4`, 분석 규칙은
`brand-analysis-v4-regional-metric-gate`다.

```text
{
  schemaVersion,
  analysisVersion,
  generatedAt,
  parameters,
  provenance,     // 입력 파일·상위 출처 메타데이터
  methodology,    // 계산 기준과 해석 주의사항
  warnings,
  summary,
  regionItems,
  regions,
  items
}
```

핵심 일반 지표는 `uniqueTrademarkCount`, `statusCounts`, `registrationRate`,
`applicationYearCounts`, `recentTrend`, `partialQueryCount`, `sources`, `sourceProvenance`다.

지역 관련 지표는 다음처럼 엄격히 분리한다.

- `localApplicantShare`: 출원인 주소가 검증된 hit만 `inside / (inside + outside)`로 계산한다.
  모든 hit는 출원번호 기반 주소를 먼저 보강하고, 등록번호가 있는 hit는 완료된 등록원부 근거로
  주소를 보조 보강한다. 두 경로 모두 주소 근거가 없거나 판정할 수 없으면 `unverified`로 유지한다.
- `regionalBrandCounts`: 농사로 출원번호 근거를 `inside|outside|unverified|notReferenced`로 집계한다.
- `regionalBrandReferenceHitCount`, `regionalBrandVerifiedHitCount`,
  `regionalBrandReferenceRate`, `regionalBrandInsideShare`: 지역브랜드 연관성만 나타낸다.

농사로 지역브랜드를 출원인 주소로 간주하지 않는다. 이 구분의 근거와 규칙 버전은
[`docs/data-source-provenance.md`](../docs/data-source-provenance.md)에 기록한다.

지정상품은 `goodsMatchCounts`, `goodsConfirmedHitCount`, `goodsReviewRequiredHitCount`,
`goodsMismatchHitCount`, `goodsVerificationRate`로 제공한다. `normalized_exact`와
`normalized_contains`(고시상품명칭 포함)는 특산품 활용 출원으로 확정 집계하고,
`class_only`만 사람 검토 대상으로 남긴다.

원물명 승인 manifest가 적용된 행은 `matchingBasis=raw_item_goods_matched`와
`rawGoodsReview` 근거를 갖는다. 이 행의 지역 출원 건수는 exact와 contains를 모두
포함하지만, 대시보드의 근거 세부값은 `exact`와 `contains`를 각각 자동 일치와 포함
일치로 분리해 표시한다.

## 과거 3건 연결 확인 결과

2026-08-10에 농사로 지역브랜드 3건을 ③에서 KIPRIS와 조인한 기술 검증을 실행했다.

- KIPRIS 고유 hit 21건
- 농사로 출원번호가 연결된 hit 3건
- `regionalBrandCounts.inside=3`, outside/error 0건
- 출원인 주소가 없으므로 세 행의 `localApplicantShare=null`
- 상위 출처 2종(KIPRIS, 농사로)과 각 계약 버전을 `provenance`에 보존

당시 브랜드명을 검색어로 쓴 산출물은 현재 특산품 분석 계약에 맞지 않아 ④·⑦ 입력에서 제외한다.
수치는 과거 연결 검증 기록일 뿐 모집단 통계나 정책 결론으로 사용하지 않는다. 쿼리 1건은
`--max-pages=1` 상한에 걸려 `partial`이며 경고와 함께 집계된다.

## 해석 주의사항

- 실제 저장된 `hits`만 상표 수로 센다. 필터 전 KIPRIS `totalCount`를 상표 수로 쓰지 않는다.
- `collectionStatus=partial`은 저장 hit를 집계하되 완전 모집단으로 해석하지 않는다.
- 같은 출원번호가 여러 관계에서 검색되면 세부 버킷에는 각각 포함되지만 전체 summary에서는
  한 번만 센다.
- ②에서 검토대기·제외된 `skipped` 행은 성공/오류 검색 건수에 포함하지 않는다.

## 테스트

```bash
node 04-analyze-brand/selftest.js
```

지역 정규화, 중복 제거, 오류·0건 유지, 시계열, 출원인 주소/지역브랜드 지표 분리와 출처 계보를
네트워크 없이 검증한다.

## 품목별 전국 상표 흐름 분석(참고 지표, 이슈 #116/#74/#110)

**상태**: 🟡 파일럿 — 농수임산물 카테고리 품목(176개)만 대상. 지역 통계·분모/분자에는
섞지 않는 순수 참고 지표다.

### 왜 별도 분석인가

③단계는 각 품목에 매핑된 NICE류만 검색해 지역 출원 통계를 만든다(의도적으로 좁힌 범위 —
음식점업 43류 등 서비스류는 현재 지표에서 뺀다). 그런데 "품목 하나가 원물 → 가공품 →
서비스/확장으로 전국에서 어떻게 퍼져 있는가"를 보려면 반대로 NICE류 제한을 풀고 전국을
봐야 한다. 이 둘을 같은 통계에 섞지 않으려고 별도 모듈(`lib/nationwideFlow.js`)로 분리했다.

### 분류 방법과 한계

- **서비스류(35·39·40·41·42·43·44·45류)**: NICE류만으로 확정. 판단 여지 없음.
- **원물류(29~31류) 안에서 원물/가공품 구분**: 상표 단어검색 API에는 지정상품 텍스트가
  없고, 등록원부 대조(경로 B)는 2026-08-26 기준 전체의 2%만 처리돼 있어 지금은 쓸 수
  없다. 대신 상표명 텍스트에 가공 지표 단어(막걸리·잼·분말·가루 등, `PROCESSED_WORDS`)가
  있는지로 판정한다. 1글자 지표(주·차·즙 등)는 무관한 단어와 충돌하므로("청정"의
  "청") **품목명 바로 옆에 합성어로 붙을 때만**("인삼차") 인정한다.
- 이 판정은 **등록원부로 검증된 값이 아닌 근사치**다. 코드/커밋/이슈에는 방법을 남기되,
  화면(대시보드)에는 "AI 판정" 같은 표시를 노출하지 않는다 — 근사치라는 사실은 알고
  있어야 하지만, 공개 화면은 보수적으로 확정된 지표처럼 보이는 문구를 쓰지 않는다는 뜻이지
  이 지표 자체를 확정 지표로 취급해도 된다는 뜻은 아니다.
- 실측 결과 전국 무제한 검색은 품목당 총 5~11만 건까지 나온다(예: "인삼" 112,140건). 이
  중 원물류·서비스류 어디에도 안 걸리는 히트(전자제품 09류의 "사과 APPLE" 등, 완전한
  동음이의어)는 `excluded`로 따로 빼고 통계에 넣지 않는다.
- 공예품 등 농수임산물이 아닌 카테고리는 원물/가공품 구분 자체가 성립하지 않아
  `mode="craft"`로 제품/서비스만 나눈다. 파일럿에서 "도자기"로 확인한 결과 이랜드리테일·
  신세계인터내셔날 등 대형 유통사가 상위를 차지해 생산지역 신호가 거의 없었다 — 이 방식은
  농수임산물에만 적용한다(이번 확장 범위도 농수임산물로 한정한 이유).

### 사용법

```bash
# 검색어만 확인(API 호출 없음)
node 04-analyze-brand/analyzeNationwideFlow.js \
  --input 07-dashboard/web/public/data/dashboard-snapshot.json --dry-run

# 실제 수집(이어서 처리 가능 — 이미 --out에 있는 품목은 건너뜀)
node 04-analyze-brand/analyzeNationwideFlow.js \
  --input 07-dashboard/web/public/data/dashboard-snapshot.json \
  --out 04-analyze-brand/output/nationwide-flow.json \
  --cache 04-analyze-brand/output/nationwide-flow-applicant-cache.json
```

품목명은 대시보드 스냅샷에서 자동 추출한다(`deriveAgriCoreItems`) — 브랜드 수식어가 붙은
이름("마춤 쌀", "치악산 배")은 같은 원물의 변형으로 병합하고, "A / B" 복합 표시명은
개별 품목으로 분리한다. 완전한 별칭 사전은 아니라 붙어있지 않은 변형(예: "가와지쌀")은
그대로 별도 검색어로 남는다.

출원인 주소 조회는 단계별 상위 출원인(`--topApplicants`, 기본 5명)에만 하고, 출원번호
기준 캐시(`03-match-trademarks/lib/trademarkApplicantCache.js`와 같은 포맷)로 여러
품목에서 겹치는 대형 출원인(농협중앙회 등)은 한 번만 조회한다.

### 파일럿 확인 사례(2026-08-27)

"인삼"을 전국·전류 검색해 확인한 결과:

- **원물 단계** 상위 출원인: 금산군·충청남도 금산군·금산인삼농업협동조합(충남 금산),
  풍기인삼협동조합(경북 영주 풍기), 포천인삼영농조합법인(경기 포천) — 실제 인삼 주산지.
- **가공품 단계** 상위 출원인: 주식회사 한국인삼공사(정관장), 하이트진로.
- 주소 조회 결과 한국인삼공사·주식회사 케이티앤지 모두 본사가 **대전광역시 대덕구**로
  확인됨 — 생산지(금산)와 인접한 가공·브랜드 중심지라는 지역 클러스터가 실제로 관측됨.

다만 "가시오가피"처럼 화장품 원료로도 널리 쓰이는 품목은 원물 단계 상위 출원인이
엘지생활건강·스킨79·코리아나화장품 등 대형 화장품사로 나와, 실제 생산지 신호보다
브랜드 다각화 신호가 더 크게 잡히는 사례도 확인했다 — 품목마다 신호 품질이 다르므로
결과를 그대로 확정 사실처럼 쓰지 않고 참고 신호로만 다룬다.

### 테스트

```bash
node 04-analyze-brand/nationwideFlowSelftest.js
```

분류 규칙(서비스류 확정, 원물류 안 가공 지표 판정, 1글자 지표 오탐 방지, craft 모드,
excluded 분리), 페이지네이션 상한, 출원인 주소 캐시 재사용, 품목명 추출·병합 로직을
네트워크 없이 검증한다. `04-analyze-brand/selftest.js`에서 함께 실행된다.
