# ⑦ 대시보드 서비스

**상태**: 📋 예정 (미착수, 실제 구현 기준) · [`prototypes/`](prototypes/)에 레이아웃 검토용
정적 HTML 목업 2개 있음(①~④ 실제 샘플 데이터 사용, 코드는 아님)

> 참고: 초기에 샘플(합성) 데이터로 시군구 통계 대시보드 v1을 만들었다가, 실데이터 파이프라인
> 방향으로 전환하며 제거했다. `prototypes/`의 목업은 그 실수를 반복하지 않으려고 합성 데이터가
> 아니라 ①~④를 실제로 돌린 샘플 결과만 쓴다. 그래도 이 목업 자체가 ⑦단계 구현은 아니다 —
> 레이아웃/지도 드릴다운 인터랙션 방향을 검토한 베이스 자료일 뿐이다.

전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑦ 참고.

## 기능 (기획 문서 기준)

- 지역별 브랜드 현황
- 특산품별 상표 출원현황
- 실시간 신규 출원 모니터링
- 브랜드 공백 지도(Brand Gap Map)
- 지역 간 비교 분석
- AI 비즈니스 확장 전략 브리핑 자동 제공

## 할 일

- [ ] 개발 방법(기획 문서: Python + Streamlit) 확정 또는 재검토
- [ ] `04-analyze-brand/` · `05-detect-brand-gap/` · `06-generate-business-strategy/` 출력을 읽어오는 데이터 계층 설계
- [x] 브랜드 공백 지도 시각화 방식 검토 — [`prototypes/brand-map.html`](prototypes/brand-map.html)에서
      지도 기반(시도→시군구 드릴다운) 방향으로 목업 완료. 실제 구현 프레임워크(Streamlit 등)로
      이 인터랙션을 어떻게 옮길지는 아직 미정
- [ ] 실시간 신규 출원 모니터링 갱신 주기/알림 방식 결정

## 입력

`04-analyze-brand/`, `05-detect-brand-gap/`, `06-generate-business-strategy/`의 모든 출력
