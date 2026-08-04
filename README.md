# KIIP

## 상표 출원 지역 통계 대시보드

대한민국 시군구 단위 상표 출원 현황을 보여주는 대시보드. 현재는 실제 KIPRIS 데이터가
연결되기 전까지 통계/시각화 검증용 합성 샘플 데이터로 동작합니다.

- `scripts/generate_sample_data.js` — 샘플(합성) 상표 출원 데이터 생성 → `data/sample_trademark_data.{csv,json}`
- `scripts/build_dashboard.js` — `data/sample_trademark_data.json`을 `dashboard/template.html`에 주입해 `dashboard/index.html`(자체완결형) 생성
- `dashboard/index.html` — 최종 대시보드 (필터, KPI, 지역별/연도별/상태별 통계, 상세 목록 테이블)

### 재생성 방법

```
node scripts/generate_sample_data.js   # 샘플 데이터 재생성
node scripts/build_dashboard.js        # 대시보드 HTML 재빌드
```

실제 데이터로 교체하려면 `data/sample_trademark_data.json`을 동일한 컬럼 구조
(`application_no, trademark_name, applicant_name, sido, sigungu, application_date, year, nice_class, nice_class_label, status`)로
바꾼 뒤 `build_dashboard.js`만 다시 실행하면 됩니다.
