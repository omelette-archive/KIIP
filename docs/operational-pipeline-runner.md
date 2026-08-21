# 운영 파이프라인 실행기

`scripts/runOperationalPipeline.js`는 ① 수집부터 ⑦ 스냅샷·후보 HTML까지 기존 CLI를 한 번에
순서대로 실행하는 #70의 첫 구현 단위다. 외부 API를 새로 감싸지 않고, 각 단계가 이미 사용하는
환경 변수와 `.env` 로더를 그대로 사용한다. 키 값은 실행 계획·manifest·명령행에 기록하지 않는다.

## 먼저 계획만 확인

```bash
node scripts/runOperationalPipeline.js --dry-run --run-id 20260818-manual
```

`--dry-run`은 API를 호출하지 않고 디렉터리나 파일도 만들지 않는다. 출력 JSON에서 단계 순서,
실행별 산출물 경로, 영구 상태 경로, 현재 한계를 검토할 수 있다.

실행 계획은 다음 순서다.

1. GI·농사로 수집과 누적 SQLite 갱신
2. 결정론적 품목 정규화
3. KIPRIS 검색과 영구 체크포인트 재개
4. 분석과 승인된 원물명 지정상품 검토 결과 재적용
5. 브랜드 공백 탐지
6. 결정론적 전략 초안 생성
7. `mode=full`, `stage=alpha` 스냅샷 생성
8. 외부 호출 없는 전체 회귀 검증
9. 게시 전 후보 HTML 생성

## 실제 실행

```bash
node scripts/runOperationalPipeline.js \
  --run-id 20260818-manual \
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

## 게시 안전장치와 현재 한계

성공 실행도 저장소의 `07-dashboard/dashboard.html`을 직접 덮어쓰거나 공개하지 않는다. 전체
회귀 검증이 통과한 뒤 실행 디렉터리에 `dashboard.candidate.html`만 만든다. 실제 반영/게시 정책은
#70에서 별도로 결정한다.

이번 단위는 #73 및 현재 별도 worktree의 출원인 주소 보강 작업과 겹치지 않도록 출원인 주소·
등록원부 재조회 단계를 연결하지 않았다. 따라서 주소 캐시·등록원부 예산 상태의 운영 연결,
스케줄, 동시 실행 잠금, 알림, 승인 게시는 아직 남아 있다.

## 검증

```bash
node scripts/runOperationalPipeline.selftest.js
node scripts/validatePipeline.js
```

자체 테스트는 dry-run 무변경, 키 비노출, 단계 순서, 실패 시 후속 중단, run-id 경로 이탈 거부를
고정한다.
