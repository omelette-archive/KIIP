# 지역 브랜드 인사이트 웹

`dashboard-snapshot-v1`을 직접 읽는 ⑦단계 웹 대시보드다. 현재 배포 데이터는 소규모 E2E
샘플이며 화면에서도 `샘플 데이터`로 표시한다.

## 로컬 실행

```powershell
npm ci
npm run dev
```

## 데이터 갱신

상위 파이프라인이 새 스냅샷을 생성한 뒤 다음 명령으로 웹 입력을 교체한다.

```powershell
npm run sync:snapshot -- ../output/dashboard-snapshot.json
```

입력은 `dashboard-snapshot-v1`이고 `mode=sample|full`이어야 한다. 전국 수집이 완료되기 전에는
`sample`을 유지한다. 스냅샷 파일에는 출처·계약 버전·생성 시각·부분수집·차단 이슈가 포함된다.

## 검증과 배포

```powershell
npm test
npm run lint
```

서버 없이 파일 하나만 배포하려면 다음 명령으로 [`../dashboard.html`](../dashboard.html)을
재생성한다. 생성 파일 안에 현재 스냅샷·스타일·동작 코드가 모두 포함된다.

```powershell
npm run build:html
```

GitHub Actions는 파이프라인 검증과 별도로 웹 빌드·스냅샷 계약 테스트를 실행한다. 운영 데이터
갱신은 상위 수집 작업 완료 → 스냅샷 생성 → `sync:snapshot` → 새 사이트 버전 배포 순서다.
현재 실키 자동 수집 주기와 무인 배포 권한 연결은 #42의 잔여 범위다.
