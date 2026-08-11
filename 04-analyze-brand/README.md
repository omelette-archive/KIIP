# ④ 지역 브랜드 결정론적 분석

③단계 JSON을 읽어 지역×품목·지역·품목별 상표 현황을 집계한다. 이 단계는 생성형 AI를 쓰지
않으며 같은 입력과 버전에서 같은 결과를 내는 규칙 기반 분석이다.

## 구현 범위

- 출원번호(없으면 등록번호) 기준 중복 제거
- 출원 상태 `registered|pending|inactive|unknown` 표준화
- 연도별 건수와 최근/직전 동일 기간 증감, 최근 브랜드 예시
- 오류·부분 수집·날짜 누락·지역 미검증 데이터 품질 지표
- 출원인 주소 근거와 농사로 지역브랜드 근거의 분리 집계
- 등록원부 지정상품의 확정·검토후보·불일치·미검증 집계
- ③의 출처 계보를 버킷과 ④ 산출물에 전달

## 사용법

```bash
node 04-analyze-brand/analyzeBrands.js \
  --input 03-match-trademarks/output/batch-result.json \
  --out 04-analyze-brand/output/analysis.json \
  --asOfYear 2026
```

현재 연도는 불완전하므로 시계열 비교에서 제외한다. `--asOfYear 2026 --recentYears 3`은
2023~2025년과 2020~2022년을 비교한다.

## 출력 계약

현재 `schemaVersion`은 `1.3`, 분석 규칙은
`brand-analysis-v3-ip-registry-evidence`다.

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
  등록번호가 있는 hit는 등록원부 주소로 보강하며 나머지는 `unverified`로 유지한다.
- `regionalBrandCounts`: 농사로 출원번호 근거를 `inside|outside|unverified|notReferenced`로 집계한다.
- `regionalBrandReferenceHitCount`, `regionalBrandVerifiedHitCount`,
  `regionalBrandReferenceRate`, `regionalBrandInsideShare`: 지역브랜드 연관성만 나타낸다.

농사로 지역브랜드를 출원인 주소로 간주하지 않는다. 이 구분의 근거와 규칙 버전은
[`docs/data-source-provenance.md`](../docs/data-source-provenance.md)에 기록한다.

지정상품은 `goodsMatchCounts`, `goodsConfirmedHitCount`, `goodsReviewRequiredHitCount`,
`goodsMismatchHitCount`, `goodsVerificationRate`로 제공한다. #12 기준 확정 전에는 후보를 기존 상표
합계에서 자동 제외하지 않는다.

## 3건 E2E 확인 결과

2026-08-10에 농사로 지역브랜드 3건을 ③에서 KIPRIS와 조인한 뒤 ④까지 실행했다.

- KIPRIS 고유 hit 21건
- 농사로 출원번호가 연결된 hit 3건
- `regionalBrandCounts.inside=3`, outside/error 0건
- 출원인 주소가 없으므로 세 행의 `localApplicantShare=null`
- 상위 출처 2종(KIPRIS, 농사로)과 각 계약 버전을 `provenance`에 보존

소량 연결 검증이므로 모집단 통계나 정책 결론으로 사용하지 않는다. 쿼리 1건은
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
