# ① 지역 특산품 데이터 자동 구축

**상태**: 🟡 진행중 — 법정동코드 마스터와 소스 레지스트리/데이터 계약 구현 완료. 지리적표시는
농식품 공공데이터포털 발급키·허용 IP로 실호출을 검증하고 실제 MAFRA 계약으로 교정했다. 농사로도 공식 매뉴얼의
`localSpcprd/localSpcprdLst` XML 계약과 발급키로 2페이지·빈 결과·인증 오류 실호출을 검증했다.
세종·제주의 농사로 공백은 공식 홈페이지/농관원 지리적표시의 검증 스냅샷으로 우선 보완했다.
전국 지자체 홈페이지의 일반 크롤링과 뉴스 기사 수집은 아직 이번 범위 밖이다.

전국 17개 광역 및 226개 기초지자체를 대상으로 특산품 목록을 자동 수집한다.
전체 기획은 [`docs/project-plan.md`](../docs/project-plan.md)의 ① 참고.

## 수집 대상 및 접근성 조사 결과

| 소스 | 접근성 | 상태 |
|---|---|---|
| 법정동코드(시군구 마스터 목록) | 무료, 인증 불필요 — data.go.kr 파일 다운로드 | ✅ 구현+검증 완료 |
| 지리적표시 등록정보(국립농산물품질관리원) | 농식품 공공데이터포털 신청·허용 IP 필요 | ✅ 실키·실응답 검증, 일자별 자동수집 구현 |
| 농사로 특산물(농촌진흥청) | 개발단계 자동승인, 운영단계 심의승인, XML | ✅ 실키·2페이지·빈 결과·인증 오류 검증 |
| 세종시 공식 특산품 | 인증 불필요, 읍면동 공식 `특산품` 페이지 | ✅ 7품목 검증 스냅샷 |
| 농관원 제주 지리적표시 | 인증 불필요, 농관원 공식 등록 목록 | ✅ 제주도 일원 3품목 검증 스냅샷 |
| 전국 지자체 홈페이지 / 뉴스 기사 | 226개 사이트마다 제각각 / 별도 인프라 필요 | ⚪ 범위 밖 |

GI API는 `REGIST_NO_REGIST_DE`(등록일자)의 완전일치 검색이 필수다. 전체 무필터 목록은 받을 수
없으므로 기본 실행은 한국시간 오늘을 조회하고, 누락 복구는 명시한 짧은 날짜 범위만 순회한다.

## 시도별 수집 공백(#60)

농사로 `localSpcprd/localSpcprdLst`를 전국 재실행(1,721건, 9페이지)한 결과 제주특별자치도·
서울특별시·세종특별자치시는 등록 건수가 0건이었다(`sAreaNm=제주` 라이브 직접 질의로도 재확인).
이 결과가 파이프라인 후반부(②검토대기·③미검색 등)에서 "0건"으로 잘못 읽히면 실제로는 해당
지역에 특산물이 없다고 오인할 수 있다 — 특히 제주는 감귤·흑돼지 등 전국적으로 알려진 특산품이
많아 이례적이다. API 실측으로 확인된 공백만 `config/sourceCoverageGaps.json`에 기록하고, ⑦
대시보드가 해당 시도가 지역 목록에 없을 때 "출처 미확보"(0건 확정 아님) 경고를 노출한다.
2026-08-21 현재 세종 7품목과 제주 지리적표시 3품목을 공식 대체 출처에서 확보했다. 다만 농사로
소스 자체의 0건은 계속 사실이므로 `sourceCoverageGaps.json`에는 소스별 공백으로 남긴다. 감사
방법과 행정구역 승계표는 [`docs/administrative-region-history-and-coverage.md`](../docs/administrative-region-history-and-coverage.md)에 정리했다.

## 구조

```
01-collect-specialties/
├── config/sources.json      공식 URL·인증·포맷·할당량 확인 상태 레지스트리
├── config/sourceCoverageGaps.json  API 실측으로 확인된 시도별 수집 공백(#60)
├── data/                    법정동코드 원본 + 세종·제주 공식 보완 스냅샷
├── lib/
│   ├── loadEnv.js           .env 로더 (02/03에서 포팅)
│   ├── fetchWithRetry.js    재시도/타임아웃/키마스킹 (02/03에서 포팅)
│   ├── adminCodes.js        법정동코드 CSV 파싱 -> 시군구 레벨 마스터 목록
│   ├── giClient.js          MAFRA 지리적표시 등록정보 클라이언트 (URL 경로 키 + Grid JSON)
│   ├── nongsaroClient.js    농사로 지역특산물 클라이언트 (공식 localSpcprd XML 계약)
│   ├── sourceRegistry.js    소스 레지스트리 로더/검증기
│   ├── sourceCoverageGaps.js 시도별 수집 공백 로더/검증기(⑦ 대시보드 경고에 사용)
│   ├── collectionStore.js   SQLite 실행 이력·원문 레코드·append-only 버전 저장
│   ├── officialSupplement.js 공식 보완 스냅샷 로더/검증기
│   ├── regionAliases.js     시도 축약·개칭명과 시군구 승계 별칭 관리
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
  --out 01-collect-specialties/output/specialties.csv \
  --db 01-collect-specialties/output/specialties.sqlite
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

`--db`를 생략하면 CSV와 같은 폴더·이름의 `.sqlite`가 생성된다. SQLite에는 다음을 누적한다.

- `collection_runs`: 조회 범위, 소스별 성공/실패, 논리 API 요청 수, 경고, 저장 건수
- `specialty_raw_records`: 소스 원본의 안정 키, 최초/최근 확인 실행, 현재 버전
- `specialty_raw_versions`: 원문 payload와 정규화 결과의 append-only 버전

같은 source record key와 같은 내용으로 재실행하면 버전을 추가하지 않고 최근 확인 시각만
갱신한다. 원문 또는 정규화 내용이 달라졌을 때만 새 버전을 추가한다. `collectedAt`만 달라진 것은
내용 변경으로 보지 않는다. CSV는 ②단계 전달·스모크 확인용이고 SQLite가 누적 원본의 기준이다.
요청 수는 재시도를 포함한 물리 HTTP 횟수가 아니라 페이지 단위 논리 API 요청 수다.

공식 URL과 접근 조건은 [`config/sources.json`](config/sources.json), 계정·호출 제한은
[`docs/open-api-limits.md`](../docs/open-api-limits.md)를 기준으로 관리한다.

## 테스트

```bash
node 01-collect-specialties/selftest.js
```

## 할 일

- [x] 226개(현재 269건) 기초지자체 목록(시도/시군구 코드) 기준 데이터 확보
- [x] 각 수집 대상별 크롤러/API 연동 설계 — 지리적표시/농사로와 세종·제주 한정 공식 보완은
      구현, 전국 지자체 홈페이지/뉴스 일반 수집은 범위 밖
- [ ] 비정형 소스의 "지역 ↔ 특산품" 관계 추출 — 현재 API는 이미 지역+품목을 쌍으로 제공하므로
      AI 추출이 필요하지 않다. 현재 세종·제주 보완은 검증 스냅샷이며, 전국 지자체 홈페이지/
      뉴스를 실제 범위에 넣을 때 별도 이슈로 설계한다.
- [x] 수집/정규화 데이터 계약과 DB 후보 구조 설계 — [`docs/data-pipeline-contracts.md`](../docs/data-pipeline-contracts.md)
- [x] 원문 payload·실행 이력을 보존하는 SQLite 저장 — 동일 원본 멱등 저장·변경 버전 보존

## 출력 (다음 단계 ②의 입력)

지역별 특산품 원시 목록 — `{ sido, sigungu, regionCode, regionMatchMethod,
sourceRegionName, sourceRegionCode, sourceItemName, sourceRecordUrl, rawItemName, source, sourceId,
sourceContractVersion, sourceUrl, sourceLastVerifiedAt, collectedAt }[]`. 현재 집계 지역과 원천의
지역명·코드·품목명을 함께 보존하므로 과거 행정구역 승계 결과를 역추적할 수 있다.
상세 기준은 [`docs/data-pipeline-contracts.md`](../docs/data-pipeline-contracts.md) 참고.
