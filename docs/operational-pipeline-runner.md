# 운영 파이프라인 실행기

`scripts/runOperationalPipeline.js`는 ① 수집부터 ⑦ 스냅샷·후보 HTML까지 핵심 CLI를 한 번에
재현하는 운영 실행기다. 외부 API를 새로 감싸지 않고, 각 단계가 이미 사용하는 환경 변수와
`.env` 로더를 그대로 사용한다. 키 값은 실행 계획·manifest·명령행에 기록하지 않는다.

## 먼저 계획만 확인

```bash
node scripts/runOperationalPipeline.js --dry-run --run-id YYYYMMDD-manual
```

`--dry-run`은 API를 호출하지 않고 디렉터리나 파일도 만들지 않는다. 출력 JSON에서 단계 순서,
실행별 산출물 경로, 영구 상태 경로, 현재 한계를 검토할 수 있다.

실행 계획은 다음 순서다(2026-09-21 기준, `--dry-run --promote`로 직접 재확인한 24단계).

| 단계 | 설명 |
|---|---|
| `00_preflight` | 필수 환경변수·영구 상태 디렉터리·Node 버전 확인(외부 호출 전) |
| `00_cleanup_outputs` | `output/` 아래 3일 지난 실행 산출물 정리(등록원부 캐시·일일 예산 상태 파일은 제외) |
| `00c_archive_check` | 원자료 archive(검색 체크포인트·수집 SQLite)가 직전 성공 실행 이후 사유 없이 줄지 않았는지 확인 |
| `01_collect` | 특산품 수집과 누적 SQLite 갱신(GI·농사로·세종·제주·서귀포 + NFQS·KOFPI·RDA 보완) |
| `02_normalize` | 고시상품명칭 기준 결정론적 정규화 |
| `01b_area_brands` | 농사로 지역브랜드(areaBrandLst) 참조 수집(상표 검증용) |
| `03_match` | KIPRIS 상표 검색(기존 체크포인트가 있으면 재개) |
| `03b_applicant_region` | 출원번호 기반 출원인 주소 보강(경로 A, 영구 캐시 증분) |
| `03c_ip_registry` | 등록번호 기반 등록원부 보강(경로 B, 일별 예산·429 재개 상태 영구 보관) |
| `03d_supplemental_scopes` | NFQS·KOFPI 보완 소스 지역 스코프 정규화(인증사업장→전국, 임산물→주산지 확장) |
| `03e_bibliography_goods` | 서지상세(경로 C) 지정상품 대조 — 등록원부가 도달 못 하는 미등록 출원 우선(#12) |
| `04_analyze` | 지역×품목 상표 분석 |
| `05_gap` | 브랜드 공백 탐지 |
| `06_strategy` | 결정론적 전략 초안 생성 |
| `07_snapshot` | `mode=full`, `stage=alpha` 전체 입력 범위 스냅샷 생성 |
| `07b_supplemental_attach` | KOFPI 주산지 근거·특화작목 배지·supplementalCollection 프로비넌스를 스냅샷에 연결 |
| `07c_nationwide_flow` | 품목별 전국 상표 흐름(원물·가공품·서비스) 참고 지표 연결(있으면) |
| `07d_reconcile` | 직전 공개 스냅샷과 대조해 지역 상표 수치 floor 유지·실종 항목 last-known-good 복원 |
| `07e_archive_check` | 이번 실행 뒤 archive 지표를 재확인하고 통과 시 high-water mark 갱신 |
| `validate` | 외부 호출 없는 전체 회귀 검증 |
| `render_candidate` | 검증된 스냅샷으로 게시 전 후보 HTML 생성 |
| `promote_snapshot` | (`--promote` 시) 검증된 스냅샷을 저장소 웹 입력으로 동기화 |
| `promote_html` | (`--promote` 시) 동기화된 스냅샷으로 커밋용 `dashboard.html` 재생성 |
| `promote_audit` | (`--promote` 시) 게시 전 커밋용 스냅샷 계약 감사(errors만 차단) |

`--include-review-required`를 켜면 ③ 검색에 검토대기(고시명칭 미확정) 원물명 행도
포함한다 — 2026-09 확인 결과 이 플래그 없이 실행하면 ③ 검색 배치에서 상당수 쿼리가
통째로 빠지며 출원인 주소 검증 건수가 크게 줄어드는 실질적 완전성 손실이 있었다(#196).
정상적인 전체 재승격에는 이 플래그를 항상 켠다.

`--state-dir`에는 SQLite·검색 체크포인트뿐 아니라 출원인 주소 캐시
(`trademark-applicant-region-cache.json`), 등록원부 캐시(`ip-registry-cache.json`),
일별 호출 예산·429 재개 상태(`ip-registry-daily-budget.json`)가 함께 쌓인다 — 자체
호스트 러너의 영구 디스크를 가리켜야 한다.

## 실제 실행

```bash
node scripts/runOperationalPipeline.js \
  --run-id YYYYMMDD-manual \
  --max-requests 100 \
  --max-pages 5 \
  --max-hits-per-query 100
```

실제 실행은 외부 API를 호출하므로 승인된 운영 환경에서만 사용한다. 기본 경로는 다음과 같다.

- 실행별 산출물·로그: `.kiip-operations/runs/<run-id>/`
- 누적 SQLite·KIPRIS 체크포인트: `.kiip-operations/state/`
- 실행 상태: `<run-id>/run-manifest.json`
- 원물명 지정상품 승인 입력: `04-analyze-brand/data/raw-item-goods-review-v1.json`

동일한 KIPRIS 체크포인트가 있으면 ③단계에 `--resume`을 자동으로 붙인다. 한 단계가 실패하면
후속 단계는 `pending`으로 남기고 실행하지 않는다. 각 단계 stdout/stderr는 실행 디렉터리의
`<stage-id>.log`에 저장한다.

운영 실행기는 저장소의 승인 manifest를 ④ `--raw-goods-review`에 기본 전달한다. 다른 승인본을
시험해야 할 때만 `--raw-goods-review <json>`으로 명시적으로 바꾼다. 따라서 현재 공개본의
`raw_item_goods_matched` 집계를 대시보드 JSON 수동 패치 없이 재현할 수 있다.

## 게시 안전장치와 별도 운영 경로

`--promote` 없이 실행하면 성공해도 저장소의 `07-dashboard/dashboard.html`을 덮어쓰지 않고
`dashboard.candidate.html`만 만든다. `--promote`는 전체 회귀 검증이 통과한 뒤에만 웹 입력
스냅샷과 커밋용 `dashboard.html`을 교체한다 — 실행기 자체는 git add·commit·push나 공개
페이지 배포를 하지 않는다(별도 수동 커밋 또는 워크플로가 맡는다). 한 단계라도 실패하면
후속 단계(게시 승격 포함)를 건너뛰므로 실패 실행이 정상 공개본을 덮어쓰지 않는다.

### GitHub Actions 워크플로 — 수동 트리거만 (2026-09-21)

러너 등록·시크릿·변수 절차는 [`operational-runner-setup.md`](operational-runner-setup.md)를
따른다. `operational-pipeline.yml`에는 **예약(cron) 트리거가 없다** — 이전에 매일 02:00 KST로
걸어뒀지만 전용 러너(`kiip-local-runner`)가 계속 offline이라 10일 넘게 조용히 queued→cancelled만
반복했고, 사용자가 "자동화 강제 기동 없이 내가 말할 때만 진행"을 결정해 cron을 제거했다.
지금은 **Actions → Operational data pipeline → Run workflow**(`workflow_dispatch`)로 수동
트리거하거나, 이 문서대로 데스크탑에서 `node scripts/runOperationalPipeline.js`를 직접
실행하는 것이 정상 경로다(이 세션이 지금까지 돌린 실행은 전부 후자다). `concurrency:
operational-pipeline`로 동시 실행은 막고, 실패하면 `operational-pipeline-failure` 라벨
이슈를 새로 열거나 기존 이슈에 코멘트한다. 러너 영구 디스크 경로는
`vars.KIIP_OPERATIONAL_ROOT`로 지정한다.

### 이 실행기에 묶여있는 것 / 아직 묶이지 않은 것

`03d_supplemental_scopes`·`07b_supplemental_attach`·`07c_nationwide_flow` 단계로 보완
소스(NFQS·KOFPI·RDA) 지역 스코프 정규화와 전국 176개 품목의 원물→가공품→서비스 흐름
연결은 이미 파이프라인에 통합돼 있다(과거엔 `mergeSupplementalDashboardData.js` 같은
파이프라인 밖 패치 스크립트였으나 지금은 아님). 여전히 이 실행기 밖에 있는 것:

- 출원인 주소 **재조회**(미확인 건 선별)와 전후 비율 집계 — `refreshUnverified*` CLI(#73)
- 등록원부 만료예정일 기반 **재검증** — `refreshStaleRegistryEntries.js`(#81)
- 전국 176개 품목 원물→가공품→서비스 흐름의 **최초 수집·심화 재수집** —
  `04-analyze-brand/analyzeNationwideFlow.js`는 별도 CLI로 실행한다(파이프라인은 이미
  수집된 결과를 07c에서 연결만 함)

따라서 운영 실행기는 핵심 파이프라인의 재현·검증 도구이지 모든 증분 수집 작업의 스케줄러는
아니다. 등록원부는 [`applicant-region-recovery-runbook.md`](applicant-region-recovery-runbook.md),
현재 분석 경계는 [`data-analysis-guide.md`](data-analysis-guide.md)를 따른다.

## 검증

```bash
node scripts/runOperationalPipeline.selftest.js
node scripts/validatePipeline.js
```

자체 테스트는 dry-run 무변경, 키 비노출, 단계 순서, 실패 시 후속 중단, run-id 경로 이탈 거부를
고정한다.
