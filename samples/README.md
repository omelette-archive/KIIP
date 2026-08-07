# 샘플 검증 데이터

외부 API 전체 호출 없이 ①→②→③ 계약을 점검하기 위한 소량의 고정 입력이다.

- `specialties.csv`: 자동 매핑, 제외, 검토 대기열 분기를 포함한 5개 특산품
- 운영 데이터나 실제 API 응답을 대신하지 않는다.

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
