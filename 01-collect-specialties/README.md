# ① 지역 특산품 데이터 자동 구축

**상태**: 🟡 진행중 — 법정동코드 마스터와 소스 레지스트리/데이터 계약 구현 완료. 지리적표시는
농식품 공공데이터포털 발급키·허용 IP로 실호출을 검증하고 실제 MAFRA 계약으로 교정했다. 농사로는 공식 매뉴얼의
`localSpcprd/localSpcprdLst` XML 계약으로 샘플 검증을 마쳤고 실키 스모크 테스트가 필요하다.
지자체 홈페이지/뉴스 기사 수집은 이번 범위 밖.

전국 17개 광역 및 226개 기초지자체를 대상으로 특산품 목록을 자동 수집한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ① 참고.

## 수집 대상 및 접근성 조사 결과

| 소스 | 접근성 | 상태 |
|---|---|---|
| 법정동코드(시군구 마스터 목록) | 무료, 인증 불필요 — data.go.kr 파일 다운로드 | ✅ 구현+검증 완료 |
| 지리적표시 등록정보(국립농산물품질관리원) | 농식품 공공데이터포털 신청·허용 IP 필요 | ✅ 실키·실응답 검증, 일자별 자동수집 구현 |
| 농사로 특산물(농촌진흥청) | 개발단계 자동승인, 운영단계 심의승인, XML | 🟡 공식 XML 계약 샘플 검증, 실키 검증 필요 |
| 지자체 홈페이지 / 뉴스 기사 | 226개 사이트마다 제각각 / 별도 인프라 필요 | ⚪ 범위 밖 |

GI API는 `REGIST_NO_REGIST_DE`(등록일자)의 완전일치 검색이 필수다. 전체 무필터 목록은 받을 수
없으므로 기본 실행은 한국시간 오늘을 조회하고, 누락 복구는 명시한 짧은 날짜 범위만 순회한다.

## 구조

```
01-collect-specialties/
├── config/sources.json      공식 URL·인증·포맷·할당량 확인 상태 레지스트리
├── data/                    법정동코드 원본 (기존, data.go.kr 무료 다운로드)
├── lib/
│   ├── loadEnv.js           .env 로더 (02/03에서 포팅)
│   ├── fetchWithRetry.js    재시도/타임아웃/키마스킹 (02/03에서 포팅)
│   ├── adminCodes.js        법정동코드 CSV 파싱 -> 시군구 레벨 마스터 목록
│   ├── dataGoKrClient.js    data.go.kr OpenAPI 공통 클라이언트 (표준 응답 포맷 파싱)
│   ├── giClient.js          MAFRA 지리적표시 등록정보 클라이언트 (URL 경로 키 + Grid JSON)
│   ├── nongsaroClient.js    농사로 지역특산물 클라이언트 (baseUrl은 활용신청 후 확정 필요)
│   ├── sourceRegistry.js    소스 레지스트리 로더/검증기
│   └── normalize.js         소스별 결과 -> 표준 출력 스키마, 지역명을 adminCodes 마스터와 대조
├── collectSpecialties.js    CLI 진입점
├── selftest.js              fetch 모킹 기반 자체 테스트 (API 키 없이 실행 가능)
└── output/                  --out 결과 저장 위치 (git-ignored)
```

## 사용법

```bash
cp .env.example .env
# .env 에 GI_API_KEY, NONGSARO_API_KEY 입력
# 두 base URL 환경변수는 공식 기본값 변경/테스트 대응 때만 사용

node 01-collect-specialties/collectSpecialties.js --sources gi \
  --gi-date 20130207 \
  --limit 3 \
  --out 01-collect-specialties/output/specialties.csv
```

`--limit`은 소스별 최대 건수를 제한한다. 샘플 검증에서는 반드시 작은 값으로 지정한다.

GI 날짜 옵션:

- 옵션 없음: 한국시간 오늘의 신규 등록분 1회 조회(일일 자동수집용)
- `--gi-date 20130207,20240115`: 확인할 등록일을 명시
- `--gi-from 20260801 --gi-to 20260810`: 양끝을 포함한 누락 복구. 기본 31일을 넘으면 중단
- 전체 과거 일자를 무작정 순회하지 않는다. 초기 적재는 공식 파일 또는 별도 데이터 제공을 우선한다.

각 조회 결과는 `totalCnt`까지 자동으로 페이지를 순회한다. 키가 없는 소스는 경고를 남기고
건너뛰되, 선택한 소스가 모두 실패하면 빈 수집 결과를 성공으로 오인하지 않도록 종료 코드 1로
끝난다. 빈 CSV가 의도된 경우에만 `--allow-empty`를 명시한다.

공식 URL과 접근 조건은 [`config/sources.json`](config/sources.json), 계정·호출 제한은
[`docs/open-api-limits.md`](../docs/open-api-limits.md)를 기준으로 관리한다.

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
- [x] 수집/정규화 데이터 계약과 DB 후보 구조 설계 — [`docs/data-pipeline-contracts.md`](../docs/data-pipeline-contracts.md)
- [ ] 원문 payload·실행 이력을 보존하는 실제 DB 저장 — GI 실응답 필드는 확정, 저장소 선택 후 진행

## 출력 (다음 단계 ②의 입력)

지역별 특산품 원시 목록 — `{ sido, sigungu, rawItemName, source, collectedAt }[]`
상세 기준은 [`docs/data-pipeline-contracts.md`](../docs/data-pipeline-contracts.md) 참고.
