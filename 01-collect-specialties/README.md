# ① 지역 특산품 데이터 자동 구축

**상태**: 🟡 진행중 — 법정동코드 마스터 목록은 실제 데이터로 검증 완료. 지리적표시/농사로는
data.go.kr API 클라이언트까지 구현했고 selftest(모킹) 통과, 활용신청 키가 없어 실키 테스트는
보류. 지자체 홈페이지/뉴스 기사 수집은 이번 범위 밖.

전국 17개 광역 및 226개 기초지자체를 대상으로 특산품 목록을 자동 수집한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ① 참고.

## 수집 대상 및 접근성 조사 결과

| 소스 | 접근성 | 상태 |
|---|---|---|
| 법정동코드(시군구 마스터 목록) | 무료, 인증 불필요 — data.go.kr 파일 다운로드 | ✅ 구현+검증 완료 |
| 지리적표시 등록정보(국립농산물품질관리원) | data.go.kr 활용신청 필요 | 🟡 클라이언트 구현, 실키 대기 |
| 농사로 특산물(농촌진흥청) | data.go.kr 활용신청 필요(개발단계 자동승인) | 🟡 클라이언트 구현, 실키 대기 |
| 지자체 홈페이지 / 뉴스 기사 | 226개 사이트마다 제각각 / 별도 인프라 필요 | ⚪ 범위 밖 |

CSV 직접 다운로드가 가능해 보였던 지리적표시관리정보(data.mafra.go.kr)는 실제로 다운로드를
시도해보니 엔드포인트가 "서비스 장애"를 반환해 막혀있었다 — 그래서 같은 데이터의 OpenAPI
경로로 전환했다.

## 구조

```
01-collect-specialties/
├── data/                    법정동코드 원본 (기존, data.go.kr 무료 다운로드)
├── lib/
│   ├── loadEnv.js           .env 로더 (02/03에서 포팅)
│   ├── fetchWithRetry.js    재시도/타임아웃/키마스킹 (02/03에서 포팅)
│   ├── adminCodes.js        법정동코드 CSV 파싱 -> 시군구 레벨 마스터 목록
│   ├── dataGoKrClient.js    data.go.kr OpenAPI 공통 클라이언트 (표준 응답 포맷 파싱)
│   ├── giClient.js          지리적표시 등록정보 클라이언트 (baseUrl은 활용신청 후 확정 필요)
│   ├── nongsaroClient.js    농사로 지역특산물 클라이언트 (baseUrl은 활용신청 후 확정 필요)
│   └── normalize.js         소스별 결과 -> 표준 출력 스키마, 지역명을 adminCodes 마스터와 대조
├── collectSpecialties.js    CLI 진입점
├── selftest.js              fetch 모킹 기반 자체 테스트 (API 키 없이 실행 가능)
└── output/                  --out 결과 저장 위치 (git-ignored)
```

## 사용법

```bash
cp .env.example .env
# .env 에 GI_API_KEY/GI_API_BASE_URL, NONGSARO_API_KEY/NONGSARO_API_BASE_URL 입력
# (data.go.kr 활용신청 승인 후 마이페이지에서 정확한 baseUrl 확인 필요)

node 01-collect-specialties/collectSpecialties.js --sources gi,nongsaro \
  --out 01-collect-specialties/output/specialties.csv
```

키가 없는 소스는 에러로 전체를 죽이지 않고, 경고만 남기고 건너뛴다.

## 테스트

```bash
node 01-collect-specialties/selftest.js
```

## 할 일

- [x] 226개(현재 269건) 기초지자체 목록(시도/시군구 코드) 기준 데이터 확보
- [x] 각 수집 대상별 크롤러/API 연동 설계 — 지리적표시/농사로는 구현, 지자체 홈페이지/뉴스는
      범위 밖
- [ ] 생성형 AI로 "지역 ↔ 특산품" 관계 자동 추출 — 지금은 각 API가 이미 지역+품목을 쌍으로
      제공해서 별도 AI 추출 없이도 동작. 지자체 홈페이지/뉴스처럼 비정형 소스를 붙일 때 필요해짐
- [ ] 통합 DB(지역, 특산품명, 출처, 수집일) 스키마 설계 및 구축 — CSV 출력까지는 됨, DB 저장은
      다음 단계

## 출력 (다음 단계 ②의 입력)

지역별 특산품 원시 목록 — `{ sido, sigungu, rawItemName, source, collectedAt }[]`
