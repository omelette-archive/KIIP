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

실행 계획은 다음 순서다.

0. 프리플라이트 — 필수 시크릿 5종·영구 상태 디렉터리·Node 버전 확인(외부 호출 전 실패)
0b. 저장소 `output/` 아래 3일 지난 실행 산출물 정리
1. GI·농사로·세종·제주·서귀포 핵심 특산품 수집과 누적 SQLite 갱신(소스 명시 고정)
2. 결정론적 품목 정규화
3. KIPRIS 검색과 영구 체크포인트 재개
3b. 출원번호 기반 출원인 주소 보강(경로 A) — 영구 캐시에 증분
3c. 등록번호 기반 등록원부 보강(경로 B) — 일별 예산·429 재개 상태 영구 보관
4. 분석과 승인된 원물명 지정상품 검토 결과 재적용
5. 브랜드 공백 탐지
6. 결정론적 전략 초안 생성
7. `mode=full`, `stage=alpha` 스냅샷 생성
8. 외부 호출 없는 전체 회귀 검증
9. 게시 전 후보 HTML 생성
10~12. (`--promote` 시) 검증 통과 스냅샷을 저장소 웹 입력·`dashboard.html`로 교체하고 계약 감사

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
`dashboard.candidate.html`만 만든다. `--promote`(주간 워크플로 기본)는 전체 회귀 검증이
통과한 뒤에만 웹 입력 스냅샷과 커밋용 `dashboard.html`을 교체한다 — git add·commit·push와
공개 페이지 배포는 실행기가 아니라 `.github/workflows/operational-pipeline.yml`이 맡는다.
한 단계라도 실패하면 후속 단계(게시 승격 포함)를 건너뛰므로 실패 실행이 정상 공개본을
덮어쓰지 않는다.

### 주간 워크플로 (#70)

러너 등록·시크릿·변수·첫 실행 절차는 [`operational-runner-setup.md`](operational-runner-setup.md)를 따른다.

`operational-pipeline.yml`은 매주 월요일 02:00 KST(+수동 `workflow_dispatch`)에 자체 호스트
러너(`[self-hosted, kiip-operational]`)에서 `runOperationalPipeline.js --promote`를 실행한다.
`concurrency: operational-pipeline`로 동시 실행을 막고, 진행 중 실행은 취소하지 않는다.
실패하면 `operational-pipeline-failure` 라벨 이슈를 새로 열거나 기존 이슈에 코멘트한다.
러너 영구 디스크 경로는 `vars.KIIP_OPERATIONAL_ROOT`로 지정한다.

### 이 실행기에 묶지 않는 증분 작업

- 출원인 주소 **재조회**(미확인 건 선별)와 전후 비율 집계 — `refreshUnverified*` CLI(#73)
- 등록원부 만료예정일 기반 **재검증** — `refreshStaleRegistryEntries.js`(#81)
- 전국 176개 품목의 원물→가공품→서비스 흐름 수집·갱신
- 보완 소스(NFQS·KOFPI·RDA)의 대시보드 병합 — `mergeSupplementalDashboardData.js`
  (아직 파이프라인 밖 패치 스크립트. 이걸 ⑦에 접기 전까지 라이브 스냅샷은 패치 누적본이다)

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
