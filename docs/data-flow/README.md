# 알파 데이터 흐름 현황판

수집부터 대시보드까지 각 단계의 입력·출력 구조와 현재 알파 건수를 한 문서에서 확인하기 위한 현황판이다.
시각화는 [`index.html`](index.html)이며, 현재 `07-dashboard/web/public/data/dashboard-snapshot.json`을 기준으로
2026-08-12 알파 산출물을 정리했다.

## 현재 알파 건수

| 단계 | 기준 단위 | 건수 | 의미 |
| --- | --- | ---: | --- |
| 특산품 입력 | 지역×품목 행 | 1,721 | 수집·정규화 대상 행 |
| 검색 가능 입력 | 지역×품목 행 | 1,717 | 오류·제외·지역 누락 등을 제외한 행 |
| 고유 검색 조합 | 고시명칭+NICE류 | 861 | 중복 입력을 합친 실제 KIPRIS 검색 단위 |
| 전국 상표 후보 | 출원번호 | 67,323 | KIPRIS hit의 출원번호 중복 제거 |
| 출원인 주소 확인 | 고유 상표 | 43,384 (64.44%) | 주소 inside/outside 판정 가능한 건 |
| 지역 inside | 고유 상표 | 3,901 | 출원인 주소가 조회 지역과 일치한 건 |
| 지역 지표 공개 | 지역×품목 행 | 671 / 1,692 | 수집 완료 기준. 주소 확보율은 차단 기준이 아님 |
| 지정상품 포함 확정 | 등록원부 보강 | 0 | 현재 스냅샷에 등록원부 보강 결과가 없어 후속 실행 필요 |

## 데이터 계약 요약

- ① 특산품 원천: `sido`, `sigungu`, `rawItemName`, `itemName`, `noticeName`, `niceClass`, `status`, `source`
- ③ 검색 query: `region`, `item`, `classCode`; hit: `title`, `applicationNumber`, `applicationDate`, `applicationStatus`, `applicant`
- 출원인 주소 보강: `applicantRegionMatch`, `applicantRegionEvidence`, 정규화 `sido/sigungu`
- 등록원부 지정상품 보강: `goodsMatchMethod`, `goodsEvidence[].classCode`, `goodsEvidence[].designatedProductName`
- ④ 분석: `regionCounts`, `goodsMatchCounts`, `regionalMetricAvailability`, `regionalMetricBlockingReasons`
- ⑦ 대시보드: `pipelineStatus`, `regions[].items[].metrics`, `sources`, `warnings`

## 판정 기준

1. 지역 특산품명은 고시상품명칭과 NICE류로 검색 키를 만든다.
2. KIPRIS 후보는 출원번호로 중복 제거한다.
3. 출원인 주소가 조회 지역이면 `inside`로 지역 귀속한다. 류정보가 없어도 주소 판정은 유지한다.
4. 지정상품명이 고시상품명칭과 정확히 일치하거나 포함되면 `특산품 활용 출원`으로 확정한다.
5. NICE류만 일치하는 `class_only`는 사람 검토 대상으로 남긴다.
6. 부분 수집은 지역 지표를 확정하지 않지만, 주소 확보율 60% 미만만으로 결과를 차단하지 않는다.

## 재생성 순서

등록원부 보강 후 ④ 분석과 ⑦ 스냅샷을 다시 생성하고 이 현황판의 숫자를 갱신한다. 현재 HTML은 정적 알파 기록이며,
실시간 API 호출 화면이 아니다.

보강 결과를 먼저 빠르게 점검하려면 다음 명령을 사용한다.

```powershell
node scripts/review-enrichment-output.mjs `
  03-match-trademarks/output/alpha-full-20260812-v4-ip-registry.json
```

이 명령은 `query_facts` 압축 구조 인식 여부, 등록원부 `complete` 건수, 출원인 주소
`inside/outside/unverified`, 지정상품 `normalized_exact/normalized_contains/class_only` 분포와
누락 경고를 출력한다.

관련 구현: [`03-match-trademarks`](../../03-match-trademarks), [`04-analyze-brand`](../../04-analyze-brand),
[`07-dashboard`](../../07-dashboard), [스냅샷](../../07-dashboard/web/public/data/dashboard-snapshot.json)
