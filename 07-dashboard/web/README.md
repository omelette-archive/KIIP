# 지역 브랜드 인사이트 웹

`dashboard-snapshot-v1`을 직접 읽는 ⑦단계 웹 대시보드다. 현재 입력은 전체 범위에서 실행한
부분 수집 스냅샷이며 화면에서는 `알파 테스트 · 부분 수집`으로 상태를 한 번만 표시한다. 전국 검색 후보와
지역 귀속 완료 수치를 섞지 않고, 입력행·고유 검색 조합·주소 검증·지역 지표 게이트를 별도 단위로
보여준다.

레퍼런스의 `요약 / 지자체별 조회 / 품목별 조회 / 특화작목 비교` 구조에 파이프라인의 규모와
매칭 결과를 설명하는 `데이터 개요`를 더했다. 요약 지도는
시도→시군구 드릴다운을 제공하며, 참고용 2013 KOSTAT 경계와 현재 데이터 상태를 구분해 표시한다.
샘플이 없는 회색 지역은 상표 0건이 아니라 `데이터 없음`이다.

## 로컬 실행

```powershell
npm ci
npm run dev
```

## 데이터 갱신

상위 파이프라인이 새 스냅샷을 생성한 뒤 다음 명령으로 웹 입력을 교체한다.

```powershell
npm run sync:snapshot -- ../output/dashboard-snapshot.json
npm run sync:map
```

입력은 `dashboard-snapshot-v1`이고 `mode=sample|full`이어야 한다. `mode=full`은 전체 입력 범위,
`pipelineStatus.stage=alpha`는 부분 수집 알파 실행을 뜻한다. 스냅샷 파일에는 출처·계약 버전·생성
시각·부분수집·주소 검증률·단위별 진행률·차단 이슈가 포함된다.

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
