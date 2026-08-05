# ⑦ 대시보드 서비스

**상태**: 📋 예정 (미착수) · 이전 단계들의 출력에 의존

> 참고: 초기에 샘플(합성) 데이터로 시군구 통계 대시보드 v1을 만들었다가, 실데이터 파이프라인
> 방향으로 전환하며 제거했다. 이 단계에서 실제 파이프라인 출력을 기반으로 다시 만든다.

전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑦ 참고.

## 기능 (기획 문서 기준)

- 지역별 브랜드 현황
- 특산품별 상표 출원현황
- 실시간 신규 출원 모니터링
- 브랜드 공백 지도(Brand Gap Map)
- 지역 간 비교 분석
- AI 정책 브리핑 자동 제공

## 할 일

- [ ] 개발 방법(기획 문서: Python + Streamlit) 확정 또는 재검토
- [ ] `04-analyze-brand/` · `05-detect-brand-gap/` · `06-generate-policy-insight/` 출력을 읽어오는 데이터 계층 설계
- [ ] 브랜드 공백 지도 시각화 방식 결정 (지도 기반 vs 표 기반)
- [ ] 실시간 신규 출원 모니터링 갱신 주기/알림 방식 결정

## 입력

`04-analyze-brand/`, `05-detect-brand-gap/`, `06-generate-policy-insight/`의 모든 출력
