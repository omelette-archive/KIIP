# 운영 파이프라인 러너 설정 (#70)

`operational-pipeline.yml`이 주 1회 실데이터 수집→게시를 돌리려면 자체 호스트 러너와
저장소 시크릿·변수가 필요하다. GitHub 설정은 저장소 관리자만 할 수 있다. 이 문서는
그 절차와 첫 실행·복구 방법을 정리한다.

## 1. 자체 호스트 러너 등록

GitHub 호스티드 러너는 매 실행 워크스페이스를 비워 KIPRIS 검색 체크포인트·등록원부
캐시·일별 호출 예산 상태를 이어갈 수 없다. **영구 디스크와 고정 IP**를 가진 머신이
필요하다(KIPRIS·공공데이터포털은 허용 IP 등록제).

1. 대상 머신에서 저장소 **Settings → Actions → Runners → New self-hosted runner**의
   안내대로 러너를 설치한다(Linux 권장).
2. 러너에 라벨 **`kiip-operational`** 을 추가한다(워크플로 `runs-on: [self-hosted, kiip-operational]`).
3. 러너 서비스로 등록해 상시 대기시킨다(`./svc.sh install && ./svc.sh start`).
4. Node 20 이상을 러너 PATH에 둔다(`node --version`).

## 2. 영구 디스크 경로

러너가 실행마다 상태를 이어갈 디렉터리를 하나 정한다(예: `/var/lib/kiip-operational`).
이 경로는 **워크스페이스 밖**이어야 하며 러너 재부팅·업데이트에도 남아야 한다.

저장소 **Settings → Secrets and variables → Actions → Variables** 에서:

| 변수 | 값(예) |
|---|---|
| `KIIP_OPERATIONAL_ROOT` | `/var/lib/kiip-operational` |

지정하지 않으면 `runner.temp` 아래로 떨어져 **상태가 유지되지 않는다**(매 실행 전체 재수집).

그 아래 구조는 실행기가 자동으로 만든다:

```
$KIIP_OPERATIONAL_ROOT/
  state/                       # 영구 — 러너에서 백업 대상
    specialties.sqlite
    kipris-search-checkpoint.json
    trademark-applicant-region-cache.json
    ip-registry-cache.json
    ip-registry-daily-budget.json
    operational-heartbeat.json # 프리플라이트가 매 실행 갱신(디스크 유지 신호)
  runs/<run-id>/               # 실행별 산출물·로그·manifest
```

## 3. 시크릿

**Settings → Secrets and variables → Actions → Secrets** 에 5종을 등록한다(값은 로그에
남지 않는다). 새 발급은 필요 없고 기존 `.env`의 값을 그대로 넣는다.

| 시크릿 | 용도 |
|---|---|
| `GI_API_KEY` | ① 지리적표시 수집 |
| `NONGSARO_API_KEY` | ① 농사로 지역특산물 |
| `NONGSARO_LOCAL_BRAND_API_KEY` | ① 농사로 지역브랜드(출원번호 조인) |
| `KIPRIS_API_KEY` | ③ 상표 검색 · ③b 출원인 주소 |
| `IP_REGISTRY_API_KEY` | ③c 등록원부 보강 |

`ARTIFACT_PUBLISH_KEY_B64`(공개 저장소 배포)는 이미 설정돼 있다. NFQS·KOFPI·RDA는
현재 이 실행기 범위 밖이라 그 키는 필요 없다(01_collect 소스가 명시 고정됨).

## 4. 프리플라이트 확인

러너에서 직접 한 번 실행해 환경을 확인한다(외부 API 미호출):

```bash
node scripts/checkOperationalEnv.js --state-dir "$KIIP_OPERATIONAL_ROOT/state"
```

`required_env` FAIL이면 시크릿이 러너 프로세스에 전달되지 않는 것이다. `state_dir` FAIL이면
경로 권한 문제다. 워크플로도 첫 단계에서 같은 검사를 한다.

## 5. 첫 실행

1. **Actions → Operational data pipeline → Run workflow**(수동 `workflow_dispatch`)로 한 번 돌린다.
2. 성공하면 검증 통과 후 `07-dashboard/dashboard.html`·웹 스냅샷이 교체·커밋·푸시되고,
   기존 `publish-artifacts.yml`이 공개 페이지를 갱신한다.
3. 실패하면 `operational-pipeline-failure` 라벨 이슈가 열린다. 원인을 고친 뒤 같은
   워크플로를 재실행하면 `state/`의 체크포인트 덕분에 미완료 지점부터 이어간다.
4. 이후 매주 월요일 02:00 KST에 자동 실행된다(`concurrency: operational-pipeline`로
   중복 실행 차단).

## 6. 완료 조건(#70) 대응

| 조건 | 방법 |
|---|---|
| 수동 전체 실행 1회 성공 | 5번 1단계 |
| 예약 실행 1회 성공 | cron 대기 또는 임시로 cron 간격 단축 후 원복 |
| 중간 실패 후 체크포인트 재개 | 실행 중 러너 중단 → 재실행이 `--resume`으로 이어감 |
| 실행 ID·기준일 추적 | `runs/<run-id>/run-manifest.json`, 스냅샷 `snapshotId`·`generatedAt` |
| 실패 알림·복구 검증 | 일부러 잘못된 시크릿으로 1회 → 이슈 생성 확인 → 원복 후 재실행 |
| 성공 실행만 게시 | 단계 실패 시 promote 단계 건너뜀(executePlan) + 워크플로 `if: success()` |
| 비밀값 미포함 | 프리플라이트·실행기 모두 값 미출력, `--dry-run`에 키 없음(회귀 테스트 고정) |

## 7. 백업·보존

- `state/` 디렉터리를 러너 밖으로 주기 백업한다(스냅샷 재현의 유일한 기준).
- `runs/`는 실행기의 `00_cleanup_outputs`가 저장소 `output/`만 정리하므로 러너에서
  별도로 보존 기간(예: 90일)을 정해 오래된 `runs/<run-id>/`를 지운다.
- 캐시 계약 버전이 바뀌면 백업에서 복원하고, 복원 불가한 키만 새 캐시에 재수집한다
  (`docs/applicant-region-recovery-runbook.md` 5절).
