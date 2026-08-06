# ④ AI 기반 지역 브랜드 분석

**상태**: 🟡 진행중 — 지역·품목·지역×품목 집계와 시계열 분석 구현 완료. 출원인 주소 기반
지역 내·외 판별은 ③단계 데이터 확보 후 자동 반영됨.

③단계 상표 검색 JSON을 읽어 ⑤ 브랜드 공백 탐지와 ⑦ 대시보드가 공통으로 사용할 분석 JSON을
생성한다. 외부 패키지 없이 Node.js만으로 실행된다.

## 구현된 분석

- 지역×품목, 지역별, 품목별 상표 집계
- 출원번호(없으면 등록번호) 기준 중복 제거
- 출원 상태를 `registered`, `pending`, `inactive`, `unknown`으로 표준화
- 연도별 출원 건수와 최근/직전 동일 기간 증감 비교
- 최근 출원 브랜드 예시 자동 추출
- 출원인 지역이 검증된 데이터가 들어오면 지역 내 출원 비중 자동 계산
- 검색 오류, 날짜 누락, 지역 미검증률 등 데이터 품질 지표 제공

## 사용법

```bash
node 04-analyze-brand/analyzeBrands.js \
  --input 03-match-trademarks/output/batch-result.json \
  --out 04-analyze-brand/output/analysis.json
```

옵션:

- `--asOfYear`: 분석 기준 연도. 기본값은 현재 UTC 연도다.
- `--recentYears`: 최근 기간과 직전 기간의 길이. 기본값은 각각 3년이다.
- `--maxRecentBrands`: 집계 단위마다 담을 최근 브랜드 예시의 최대 개수. 기본값은 10개다.

현재 연도는 진행 중인 불완전한 기간이므로 시계열 비교에서 제외한다. 예를 들어
`--asOfYear 2026 --recentYears 3`이면 2023~2025년과 2020~2022년을 비교한다.

## 출력 스키마

```text
{
  schemaVersion,
  generatedAt,
  parameters,
  warnings,
  summary,       // 전체 고유 상표·오류·상태·시계열·지역 검증 현황
  regionItems,   // 지역×품목 집계 (0건과 오류 검색도 유지)
  regions,       // 지역별 집계
  items          // 품목별 집계
}
```

각 집계에는 다음 핵심 값이 포함된다.

- `uniqueTrademarkCount`, `duplicateHitCount`
- `statusCounts`, `registrationRate`
- `applicationYearCounts`
- `recentPeriod`, `previousPeriod`, `recentChange`, `recentChangeRate`, `recentTrend`
- `recentBrands`
- `regionCounts`, `regionVerificationRate`, `localApplicantShare`
- `queryCount`, `erroredQueryCount`, `sourceTotalCount`, `returnedHitCount`

`recentTrend`는 `new`, `increase`, `flat`, `decrease`, `no_activity` 중 하나다.
`localApplicantShare`는 `inside / (inside + outside)`로 계산하며, 지역 검증 건이 없으면 `null`이다.

## 중요한 데이터 해석 주의사항

- 분석 건수는 ③단계 JSON의 `hits`에 실제 저장된 결과 기준이다. KIPRIS의 `totalCount`는
  키워드 전체 검색 건수이며 상품류 필터 적용 전 값이므로 상표 수로 대신 사용하지 않는다.
- 현재 ③단계는 출원인 주소를 제공하지 않아 대부분 `regionMatch: unverified`다. 따라서 지금은
  `localApplicantShare`가 `null`인 것이 정상이다. 추후 각 hit에 `applicantRegionMatch`를
  `true`/`false` 또는 `inside`/`outside`로 넣으면 코드 변경 없이 계산된다.
- 같은 출원번호가 여러 품목이나 지역에 걸쳐 검색되면 각 세부 집계에서는 관계별로 포함되지만,
  전체 `summary`에서는 한 번만 센다.

## 테스트

```bash
node 04-analyze-brand/selftest.js
```

날짜·상태·지역 정규화, 중복 제거, 오류/0건 유지, 시계열 증감, 지역 검증률을 네트워크 없이
검증한다.

## 입력 → 출력

`03-match-trademarks/`의 상표 매칭 JSON → 지역·품목별 분석 JSON
(`05-detect-brand-gap/`, `07-dashboard/`의 입력)
