# KIIP — AI 기반 지역 특산품 브랜드 비즈니스 전략 플랫폼

지식재산처 상표 빅데이터와 생성형 AI를 결합해, 지역 특산품의 브랜드(상표) 활용 수준을 자동으로
분석하고 브랜드 공백지역을 발굴해 비즈니스 확장 전략을 제안하는 파이프라인. 전체 기획은
[`docs/project-plan.md`](docs/project-plan.md) 참고.

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
| ① | 지역 특산품 데이터 자동 구축 | [`01-collect-specialties/`](01-collect-specialties/) | 🟡 진행중 | GI 실키·일자별 자동수집 검증, 농사로 실키 대기 |
| ② | 특산품 표준화 및 상품류 매핑 | [`02-normalize-items/`](02-normalize-items/) | 🟡 진행중 | 규칙 기반 정규화 + 감사 이력이 남는 수동 검토 대기열 구현 |
| ③ | 상표정보 자동 수집 | [`03-match-trademarks/`](03-match-trademarks/) | 🟡 진행중 | ② CSV 배치 검색·품목 매칭 동작, **지역 매칭은 TODO** |
| ④ | 지역 브랜드 분석 | [`04-analyze-brand/`](04-analyze-brand/) | 🟡 진행중 | 지역·품목별 집계와 시계열 분석 동작, 지역 내·외 비중은 주소 데이터 대기 |
| ⑤ | 브랜드 공백 자동 발굴 | [`05-detect-brand-gap/`](05-detect-brand-gap/) | 🟡 진행중 | 결정론적 점수 계산 배선 완료, **대표성·가중치 기준은 예시값** |
| ⑥ | AI 비즈니스 확장 전략 제안 생성 | [`06-generate-business-strategy/`](06-generate-business-strategy/) | 🟡 진행중 | ⑥-1 고정 템플릿 초안 생성(AI 미사용) 완료, ⑥-2 개별 AI 검토는 별도 범위 |
| ⑦ | 대시보드 서비스 | [`07-dashboard/`](07-dashboard/) | ⚪ 예정 | 지역별 현황 + 브랜드 공백 지도 |

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

- [`docs/project-plan.md`](docs/project-plan.md) — 전체 기획 원문 정리 (프로젝트명·목표·7단계 상세·기대효과)
- [`docs/kipris-api-notes.md`](docs/kipris-api-notes.md) — KIPRIS 상표 Open API 연동 메모 (인증, 엔드포인트, 응답 필드, 지역 매칭 미해결 이슈)
- [`docs/data-pipeline-contracts.md`](docs/data-pipeline-contracts.md) — 수집 구조·데이터 스키마·정제 기준
- [`docs/open-api-limits.md`](docs/open-api-limits.md) — 계정 승인·호출 제한과 운영 체크리스트
- [`docs/open-api-onboarding-checklist.md`](docs/open-api-onboarding-checklist.md) — 신규 Open API 소스 연동 시 반복되는 시행착오를 줄이는 체크리스트 (KIPRIS/GI/농사로 실사례 기준)
- [`docs/decisions/0001-deterministic-normalization-manual-review.md`](docs/decisions/0001-deterministic-normalization-manual-review.md) — ②단계 외부 AI 제거와 수동 검토 결정

## 개발 방법 (기획 기준)

Claude Code 기반 AI 개발 · Python + Streamlit 웹 서비스 · 상표 Open API 및 공공데이터 연계
