# KIIP — AI 기반 지역 특산품 브랜드 비즈니스 전략 플랫폼

지식재산처 상표 빅데이터와 생성형 AI를 결합해, 지역 특산품의 브랜드(상표) 활용 수준을 자동으로
분석하고 브랜드 공백지역을 발굴해 비즈니스 확장 전략을 제안하는 파이프라인. 전체 기획은
[`docs/project-plan.md`](docs/project-plan.md) 참고.

## 현재 산출물

| 공개 결과 | 용도 | 바로가기 |
|---|---|---|
| 지역 특산품 상표 분석 | 현재 연결된 데이터와 지역별 지표 확인 | [대시보드 보기](https://omelette-archive.github.io/KIIP-artifacts/latest/) |
| 변경 이력 | 과거 공개 화면을 버전별로 재현·비교 | [버전 비교](https://omelette-archive.github.io/KIIP-artifacts/versions/) |
| 검토 의견 | 페이지와 버전을 지정해 피드백 기록 | [의견 남기기](https://github.com/omelette-archive/KIIP/issues/new?template=artifact-feedback.yml) |

> **알파 테스트 기반 검토용** — 수집·검증이 진행 중인 지표가 포함되어 있으며 공식 통계가 아니다.

[공개 산출물 홈](https://omelette-archive.github.io/KIIP-artifacts/) · [원본 HTML](07-dashboard/dashboard.html) · [Git 변경 이력](https://github.com/omelette-archive/KIIP/commits/main/07-dashboard/dashboard.html) · [게시 운영 방법](docs/current-artifact.md)

`main`의 `07-dashboard/dashboard.html`이 변경되면 공개 산출물 저장소
[`KIIP-artifacts`](https://github.com/omelette-archive/KIIP-artifacts)의 최신본과 버전 목록에 자동 반영된다.

## 파이프라인 (7단계)

```mermaid
flowchart LR
    P1["① 특산품 수집"] --> P2["② 품목 표준화"]
    P2 --> P3["③ 상표 매칭"]
    P3 --> P4["④ 브랜드 분석"]
    P4 --> P5["⑤ 브랜드 공백 발굴"]
    P5 --> P6["⑥ 비즈니스 확장 전략"]
    P4 --> P7["⑦ 대시보드"]
    P5 --> P7
    P6 --> P7

    classDef done fill:#1baf7a,stroke:#199e70,color:#fff
    classDef partial fill:#eda100,stroke:#c98500,color:#fff
    classDef todo fill:#e1e0d9,stroke:#c3c2b7,color:#52514e
    class P1 partial
    class P2 partial
    class P3 partial
    class P4 partial
    class P5 partial
    class P6 partial
    class P7 todo
```

🟢 완료 &nbsp;&nbsp; 🟡 진행중(일부 동작) &nbsp;&nbsp; ⚪ 예정

## 단계별 현황

| # | 단계 | 폴더 | 상태 | 한 줄 요약 |
|---|---|---|---|---|
| ① | 지역 특산품 데이터 자동 구축 | [`01-collect-specialties/`](01-collect-specialties/) | 🟡 진행중 | GI·농사로 실키 검증, 일자별 수집·SQLite 멱등 누적 구현 |
| ② | 특산품 표준화 및 상품류 매핑 | [`02-normalize-items/`](02-normalize-items/) | 🟡 진행중 | 규칙 기반 정규화 + 감사 이력이 남는 수동 검토 대기열 구현 |
| ③ | 상표정보 자동 수집 | [`03-match-trademarks/`](03-match-trademarks/) | 🟡 진행중 | KIPRIS 검색 + 출원번호 주소 23,912건 전체 범위 수집 + 등록원부 지정상품 보강 |
| ④ | 지역 브랜드 분석 | [`04-analyze-brand/`](04-analyze-brand/) | 🟡 진행중 | 출원인 주소·지역브랜드·지정상품 근거를 분리 집계, 미보강은 별도 상태 유지 |
| ⑤ | 브랜드 공백 자동 발굴 | [`05-detect-brand-gap/`](05-detect-brand-gap/) | 🟡 진행중 | 결정론적 점수 계산 완료, **대표성·가중치 기준은 예시값**(#29) |
| ⑥ | AI 비즈니스 확장 전략 제안 생성 | [`06-generate-business-strategy/`](06-generate-business-strategy/) | 🟡 진행중 | ⑥-1 고정 템플릿 초안 생성(AI 미사용) 완료, ⑥-2 개별 AI 검토는 별도 범위 |
| ⑦ | 대시보드 서비스 | [`07-dashboard/`](07-dashboard/) | 🟡 데이터 계층 | `dashboard-snapshot-v1` 구현, 현재 지도 경계 연결 대기 |

위 표는 진행 상태 요약일 뿐이다. **각 단계가 실제로 어떤 기준으로 데이터를 뽑고 매칭하고
확정하는지**는 [`docs/data-analysis-guide.md`](docs/data-analysis-guide.md)에 데이터 분석
관점으로 정리되어 있다 — ②의 판정 근거(verdictSource) 비중 실측치, ③의 지역 귀속·지정상품
대조 기준, ④의 지표 게이트, ⑤의 대표성·점수 기준, 그리고 아직 업무 기준이 안 정해진 정책
이슈 목록까지 한 곳에 모았다.

각 폴더의 `README.md`에 해당 단계의 목표·할 일·입출력 스키마가 정리되어 있다.

수집 URL·데이터 구조·정제 기준은 [`docs/data-pipeline-contracts.md`](docs/data-pipeline-contracts.md),
Open API 계정/호출 제한은 [`docs/open-api-limits.md`](docs/open-api-limits.md)를 기준으로 관리한다.
외부 API 전체 호출 전에는 [`samples/`](samples/)의 고정 소량 데이터로 단계 간 계약을 검증한다.

## 지속 검증

외부 API 키 없이 JavaScript 구문, ①~⑥ 자체 테스트, ②→③ 샘플 dry-run, ③→④→⑤→⑥ 계약을
한 번에 검증한다.

```bash
node scripts/validatePipeline.js
```

동일한 검증은 모든 push와 pull request에서 GitHub Actions로 자동 실행된다. 실제 API 호출은
포함하지 않아 키나 호출량을 사용하지 않는다.

## 문서

- [`docs/data-analysis-guide.md`](docs/data-analysis-guide.md) — **데이터 분석 가이드**: 각 단계가 무엇을 어떤 기준으로 뽑고 매칭·확정하는지, 실측 비중과 미해결 정책 이슈 모음
- [`docs/project-plan.md`](docs/project-plan.md) — 전체 기획 원문 정리 (프로젝트명·목표·7단계 상세·기대효과)
- [`docs/kipris-api-notes.md`](docs/kipris-api-notes.md) — KIPRIS 상표 Open API 연동 메모 (인증, 엔드포인트, 응답 필드, 지역 매칭 미해결 이슈)
- [`docs/data-pipeline-contracts.md`](docs/data-pipeline-contracts.md) — 수집 구조·데이터 스키마·정제 기준
- [`docs/data-source-provenance.md`](docs/data-source-provenance.md) — 원본 제공기관·공식 URL·기준 근거·버전·산출물 계보
- [`docs/dashboard-data-contract.md`](docs/dashboard-data-contract.md) — ⑦ 지표 정의·준비도·통합 스냅샷·지도/출처 계약
- [`docs/open-api-limits.md`](docs/open-api-limits.md) — 계정 승인·호출 제한과 운영 체크리스트
- [`docs/open-api-validation-runbook.md`](docs/open-api-validation-runbook.md) — 키 위치·신청 경로·실호출 명령·결과·worktree 인수인계
- [`docs/applicant-region-recovery-runbook.md`](docs/applicant-region-recovery-runbook.md) — 출원번호·등록번호 두 주소 보강 경로와 재분석·복구 절차
- [`docs/api-key-management.md`](docs/api-key-management.md) — 로컬 키 보관 위치와 worktree 복사 방법
- [`docs/open-api-onboarding-checklist.md`](docs/open-api-onboarding-checklist.md) — 신규 Open API 소스 연동 시 반복되는 시행착오를 줄이는 체크리스트 (KIPRIS/GI/농사로 실사례 기준)
- [`docs/decisions/0001-deterministic-normalization-manual-review.md`](docs/decisions/0001-deterministic-normalization-manual-review.md) — ②단계 외부 AI 제거와 수동 검토 결정

## 개발 방법

현재 파이프라인은 의존성 없는 Node.js CLI와 SQLite로 구현한다. 대시보드 기술은 ⑦ 구현 시
확정하며, 초기 기획안의 Python·Streamlit 표기는 [`docs/project-plan.md`](docs/project-plan.md)에
원문과 현재 구현을 구분해 보존한다.
