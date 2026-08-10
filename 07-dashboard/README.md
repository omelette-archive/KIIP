# ⑦ 대시보드 서비스

**상태**: 📋 예정 (미착수, 실제 구현 기준) · [`prototypes/`](prototypes/)에 레이아웃 검토용
정적 HTML 목업 2개 있음(①~④ 실제 샘플 데이터 사용, 코드는 아님)

> 참고: 초기에 샘플(합성) 데이터로 시군구 통계 대시보드 v1을 만들었다가, 실데이터 파이프라인
> 방향으로 전환하며 제거했다. `prototypes/`의 목업은 그 실수를 반복하지 않으려고 합성 데이터가
> 아니라 ①~④를 실제로 돌린 샘플 결과만 쓴다. 그래도 이 목업 자체가 ⑦단계 구현은 아니다 —
> 레이아웃/지도 드릴다운 인터랙션 방향을 검토한 베이스 자료일 뿐이다.

전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ⑦ 참고.
지표 의미·준비도·통합 스냅샷·출처 표시 계약은
[`docs/dashboard-data-contract.md`](../docs/dashboard-data-contract.md)를 기준으로 한다.
UI 아이디에이션 참고 사이트는 <https://local-k-tm.pages.dev/>이며, 화면 참고일 뿐 데이터 출처나
업무 기준으로 사용하지 않는다.

## 기능 (기획 문서 기준)

- 지역별 브랜드 현황
- 특산품별 상표 출원현황
- 실시간 신규 출원 모니터링
- 브랜드 공백 지도(Brand Gap Map)
- 지역 간 비교 분석
- AI 비즈니스 확장 전략 브리핑 자동 제공

## 할 일

- [ ] 개발 방법(기획 문서: Python + Streamlit) 확정 또는 재검토
- [x] 지표 정의·데이터 상태·출처·버전·통합 스냅샷 초안 설계 —
      [`docs/dashboard-data-contract.md`](../docs/dashboard-data-contract.md)
- [ ] `04-analyze-brand/` · `05-detect-brand-gap/` · `06-generate-business-strategy/` 출력을 합치는
      `dashboard-snapshot` 어댑터 구현
- [ ] 안정적인 `regionCode`·`specialtyId`와 현재 기준 지도 경계 확보
- [x] 브랜드 공백 지도 시각화 방식 검토 — [`prototypes/brand-map.html`](prototypes/brand-map.html)에서
      지도 기반(시도→시군구 드릴다운) 방향으로 목업 완료. 실제 구현 프레임워크(Streamlit 등)로
      이 인터랙션을 어떻게 옮길지는 아직 미정
- [ ] 실시간 신규 출원 모니터링 갱신 주기/알림 방식 결정

## 입력

`04-analyze-brand/`, `05-detect-brand-gap/`, `06-generate-business-strategy/`의 모든 출력

실제 UI는 이 파일들을 직접 각각 읽지 않고 `dashboard-snapshot-v1`로 결합한 읽기 전용 산출물을
입력으로 사용한다. 샘플·부분 수집·오류·미수집 상태를 0건과 구분해야 한다.
