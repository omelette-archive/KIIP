# 데이터 출처·기준·버전 관리

최종 갱신: 2026-08-10
목적: 산출물의 숫자와 판정이 어떤 원본·규칙·시점에서 나왔는지 다른 작업자가 역추적할 수 있게 한다.

## 1. 원칙

- 원본 제공기관, 공식 URL, 데이터/계약 버전, 조회·다운로드 시각을 가능한 한 산출물에 보존한다.
- 공식 원본과 내부 판단 기준을 구분한다. 제공기관 데이터가 존재한다고 해서 내부 점수 기준이
  공식 기준이 되는 것은 아니다.
- 규칙·가중치·임계값이 바뀌면 결과 버전도 함께 바꾼다.
- 출처가 없는 값이나 모호한 지역은 추정하지 않고 `unverified` 또는 검토 대상으로 남긴다.
- 농사로 지역브랜드의 지역은 브랜드 연관 지역이며 출원인 주소가 아니다. 두 지표를 합치지 않는다.

## 2. 원본 데이터 출처

| sourceId | 자료·제공기관 | 공식 출처 | 데이터/계약 버전·기준일 | 현재 용도 |
|---|---|---|---|---|
| `admin_codes` | 국토교통부 전국 법정동 코드 | <https://www.data.go.kr/data/15063424/fileData.do> | 파일 `법정동코드_전국_20260703.csv`, 다운로드 2026-08-06 | 지역 문자열을 시도·시군구로 정규화 |
| `gi` | 국립농산물품질관리원 지리적표시 등록정보 | <https://www.data.go.kr/data/15080629/openapi.do> | MAFRA Grid 실계약 검증 2026-08-10 | 대표 특산품 후보와 등록 지역 수집 |
| `nongsaro` | 농촌진흥청 농사로 지역특산물 | <https://www.data.go.kr/data/15101361/openapi.do> | `localSpcprd/localSpcprdLst`, 실계약 검증 2026-08-10 | 지역특산물 원본 수집 |
| `nongsaro_area_brand` | 농촌진흥청 농사로 지역브랜드 | <https://www.nongsaro.go.kr/portal/ps/psz/psza/contentMain.ps?menuId=PS03344> | `nongsaro-area-brand-v1`, `areaBrandLst`, 실계약 검증 2026-08-10 | KIPRIS 출원번호·지역 연관성 검증자료 |
| `kipris_trademark` | 지식재산처 KIPRISPlus 상표 단어검색 | <https://plus.kipris.or.kr> | `kipris-trademark-word-search-v1`, 실키 검증 2026-08-10 | 상표 후보·출원번호·상태·NICE류 수집 |
| `kipo_notice_goods` | 지식재산처 고시상품명칭 | <https://kipo.go.kr/ko/kpoContentView.do?menuCd=SCD0201120> | NICE 13판(2026), 다운로드 2026-08-05 | 품목→고시명칭·NICE류·유사군 후보 사전 |
| `ip_registry` | 지식재산처 등록원부 실시간 정보 조회 (`getMarkHistory`) | <https://www.data.go.kr/data/15124946/openapi.do> | `apis.data.go.kr/1430000/PttRgstRtInfoInqSvc`, 실키 검증 2026-08-11 | 등록번호 기준 출원인 주소(#11)·지정상품(#12) 보강 — 파이프라인 미연결 |

기계 판독 가능한 API 출처 목록은
[`01-collect-specialties/config/sources.json`](../01-collect-specialties/config/sources.json)이 기준이다.
고시상품명칭과 법정동코드 원본 파일의 세부 정보는 각 `data/README.md`에 기록한다.

## 3. 현재 판단 기준과 근거

| 기준 버전 | 기준 | 근거와 보수적 처리 |
|---|---|---|
| `specialty-normalization-rules-v1` | 정제명→`신선한`→`미가공` 순서의 고시명칭 정확 일치만 자동 확정 | 의미 추정에 의한 오분류를 막기 위해 부분·복수 일치는 사람 검토로 분리. 사전은 `kipo-notice-goods-13-2026` |
| `area-brand-region-normalization-v1` | 법정동코드의 시도·시군구 완전일치, 고유한 경우에만 시/군/구 접미사 복원 | `구미`→`구미시`처럼 후보가 하나일 때만 복원. `고성`처럼 복수 시도 후보면 `unverified` |
| `area-brand-application-region-join-v1` | 농사로 `aplcnoInfo`와 KIPRIS `applicationNumber`에서 숫자 외 문자를 제거한 뒤 완전일치 | 하이픈 표시 차이만 제거하며 이름·유사 문자열 조인은 하지 않음 |
| `brand-analysis-v2-regional-brand-separated` | 출원인 주소와 지역브랜드 연관성을 별도 집계 | `localApplicantShare`에는 출원인 주소만 사용. 농사로 근거는 `regionalBrand*` 지표로만 제공 |
| `gap-score-v0-example` | GI 출처를 대표 특산품으로 보고 활동량 0.7·등록률 0.3 | 업무 확정 전 파이프라인 검증용 예시. 정책 근거로 사용하지 않으며 #29에서 확정 예정 |
| `strategy-template-v0-example` | ⑤ 근거 수치만 고정 템플릿으로 문장화 | AI가 사실·점수를 만들지 않게 재현 가능한 초안을 먼저 생성. 개별 AI 검토는 #16의 별도 기록 |

## 4. 산출물 계보

- ① CSV/SQLite 정규화 payload: `sourceId`, `sourceContractVersion`, `sourceUrl`,
  `sourceLastVerifiedAt`, `collectedAt`을 원본 행마다 기록한다.
- ② CSV: `normalizationVersion`, `dictionaryVersion`, `dictionarySourceUrl`,
  `dictionaryDownloadedAt`을 행마다 기록하고 ① 출처 필드를 전달한다.
- ③ JSON: `trademarkSourceMetadata`, 입력 행 `provenance`, `regionalBrandValidation`을 기록한다.
- 지역브랜드가 출원번호로 조인된 hit: `regionalBrandMatchVersion`,
  `regionalBrandMatchSource`, `regionalBrandEvidence`를 기록한다.
- ④ JSON: `analysisVersion`, `provenance`, `methodology`, 버킷별 `sourceProvenance`를 기록한다.
- ⑤·⑥ JSON: 상위 단계 `provenance`와 현재 `scoreVersion`/`templateVersion`, 방법론을 이어받는다.

파일 경로는 로컬 재현에 유용하므로 산출물의 `inputFile`/`sourceFile`에 남길 수 있다. API 키와
인증 URL은 출처가 아니므로 어떤 산출물에도 기록하지 않는다.

## 5. 갱신 절차

1. 원본 파일 또는 API 계약이 바뀌면 공식 URL과 확인일을 갱신한다.
2. 파싱 필드가 바뀌면 계약 버전과 fixture/selftest를 함께 변경한다.
3. 판단 기준이 바뀌면 규칙/점수/템플릿 버전을 올리고 변경 근거 이슈를 연결한다.
4. 변경 전후 동일 샘플 결과를 비교하고 PR에 건수 차이를 기록한다.
5. 제공기관 사실, 내부 기준, 예시값을 문서에서 명시적으로 구분한다.

## 6. 2026-08-10 소량 E2E 검증 기록

농사로 `areaBrandLst`에서 `--limit 3`으로 받은 자료만 사용해 ③→④를 실행했다. 입력 3건과
KIPRIS 요청 3건이 모두 성공했고, 출원번호 완전일치 근거가 있는 hit 3건을 확인했다.
지역브랜드 판정은 inside 3건, outside·unverified 0건이었다. KIPRIS 고유 hit는 총 21건이며
출원인 주소가 없으므로 `localApplicantShare`는 세 행 모두 `null`이었다.

쿼리 1건은 검증 실행의 `--max-pages=1` 보호 상한 때문에 `partial`이다. 이는 오류가 아니며,
위 숫자는 602건 전체의 분포나 정책 효과를 설명하는 통계가 아니라 연결 계약과 지표 분리를
확인한 소량 기술 검증 결과다.
