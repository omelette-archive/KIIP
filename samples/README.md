# 샘플 검증 데이터

외부 API 전체 호출 없이 ①→②→③ 계약을 점검하기 위한 소량의 고정 입력이다.

- `specialties.csv`: 자동 매핑, 제외, 검토 대기열 분기를 포함한 5개 특산품
- `dashboard-specialties.csv`: 영양군·천안시의 대표 특산품 4건을 실제 KIPRIS 검색까지 연결해
  대시보드의 `지역 / 품목`, 고시명칭·NICE류 집계, 관련 출원 상표명·지정상품 근거 표시를 검증하는 입력
- 운영 데이터나 실제 API 응답을 대신하지 않는다.

`dashboard-specialties.csv`의 조회 결과는 API 연결과 화면 계약을 확인하기 위한 부분 수집이다.
현재 품목당 최대 5건만 저장하므로 전체 출원 건수나 지역 대표성을 해석하는 데 사용하지 않는다.

```bash
node 02-normalize-items/normalizeItems.js \
  --input samples/specialties.csv \
  --out 02-normalize-items/output/sample-normalized.csv \
  --review-out 02-normalize-items/output/sample-review-required.csv

node 03-match-trademarks/matchTrademarks.js \
  --input 02-normalize-items/output/sample-normalized.csv \
  --dry-run \
  --out 03-match-trademarks/output/sample-plan.json
```
