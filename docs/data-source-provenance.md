# 데이터 출처·기준·버전 관리

최종 갱신: 2026-08-21
목적: 산출물의 숫자와 판정이 어떤 원본·규칙·시점에서 나왔는지 다른 작업자가 역추적할 수 있게 한다.

## 1. 원칙

- 원본 제공기관, 공식 URL, 데이터/계약 버전, 조회·다운로드 시각을 가능한 한 산출물에 보존한다.
- 공식 원본과 내부 판단 기준을 구분한다. 제공기관 데이터가 존재한다고 해서 내부 점수 기준이
  공식 기준이 되는 것은 아니다.
- 규칙·가중치·임계값이 바뀌면 결과 버전도 함께 바꾼다.
- 출처가 없는 값이나 모호한 지역은 추정하지 않고 `unverified` 또는 검토 대상으로 남긴다.
- 농사로 지역브랜드의 지역은 브랜드 연관 지역이며 출원인 주소가 아니다. 두 지표를 합치지 않는다.
- 화면의 "품목"은 정규화된 대표 특산품명(②의 `itemName`, 예: "사과")을 쓴다. 검색·집계 키는
  고시명칭과 NICE류(`noticeName + niceClass`, 예: "신선한 사과 + 31류")를 쓴다. 상표명·브랜드명은
  품목을 대체하지 않고 관련 출원 근거에서 별도로 보여준다(2026-08-11 실사례,
  `docs/dashboard-data-contract.md` §3.1 참고).

## 2. 원본 데이터 출처

| sourceId | 자료·제공기관 | 공식 출처 | 데이터/계약 버전·기준일 | 현재 용도 |
|---|---|---|---|---|
| `admin_codes` | 국토교통부 전국 법정동 코드 | <https://www.data.go.kr/data/15063424/fileData.do> | 파일 `법정동코드_전국_20260703.csv`, 다운로드 2026-08-06 | 지역 문자열을 시도·시군구로 정규화 |
| `gi` | 국립농산물품질관리원 지리적표시 등록정보 | <https://www.data.go.kr/data/15080629/openapi.do> | MAFRA Grid 실계약 검증 2026-08-10 | 대표 특산품 후보와 등록 지역 수집 |
| `nongsaro` | 농촌진흥청 농사로 지역특산물 | <https://www.data.go.kr/data/15101361/openapi.do> | `localSpcprd/localSpcprdLst`, 실계약 검증 2026-08-10 | 지역특산물 원본 수집 |
| `sejong_official_specialties` | 세종특별자치시 읍면동 공식 특산품 | <https://www.sejong.go.kr/dong/sub05_0105.do> | 공식 페이지 검증 스냅샷 2026-08-21 | 농사로 세종 0건 보완(7품목) |
| `jeju_naqs_gi_specialties` | 국립농산물품질관리원 제주 지리적표시 특산품 | <https://www.naqs.go.kr/hp/contents/relicList.do?menuId=MN40246> | 대상지역 제주도 일원 등록품 검증 2026-08-21 | 농사로 제주 0건 보완(3품목) |
| `nongsaro_area_brand` | 농촌진흥청 농사로 지역브랜드 | <https://www.nongsaro.go.kr/portal/ps/psz/psza/contentMain.ps?menuId=PS03344> | `nongsaro-area-brand-v1`, `areaBrandLst`, 실계약 검증 2026-08-10 | KIPRIS 출원번호·지역 연관성 검증자료 |
| `kipris_trademark` | 지식재산처 KIPRISPlus 상표 단어검색 | <https://plus.kipris.or.kr> | `kipris-trademark-word-search-v1`, 실키 검증 2026-08-10 | 상표 후보·출원번호·상태·NICE류 수집 |
| `kipris_trademark_applicant` | 지식재산처 KIPRISPlus 상표 출원 속보 출원인 | <https://plus.kipris.or.kr/portal/data/service/DBII_000000000000012/view.do?menuNo=200122&subTab=SC001> | `kipris-trademark-applicant-address-v1`, `trademarkApplicantInfo`, 고유 출원 23,912건 전체 알파 검증 2026-08-12 | 출원번호 기준 출원인 주소 지역 귀속(#50) |
| `kipo_notice_goods` | 지식재산처 고시상품명칭 | <https://kipo.go.kr/ko/kpoContentView.do?menuCd=SCD0201120> | NICE 13판(2026), 다운로드 2026-08-05 | 품목→고시명칭·NICE류·유사군 후보 사전 |
| `ip_registry` | 지식재산처 등록원부 실시간 정보 조회 (`getMarkHistory`) | <https://www.data.go.kr/data/15124946/openapi.do> | `ip-registry-mark-history-v1`, 실키·3건 보강 검증 2026-08-11 | 등록번호 기준 출원인 주소(#11)·지정상품(#12) 보강 |

기계 판독 가능한 API 출처 목록은
[`01-collect-specialties/config/sources.json`](../01-collect-specialties/config/sources.json)이 기준이다.
고시상품명칭과 법정동코드 원본 파일의 세부 정보는 각 `data/README.md`에 기록한다.

## 3. 현재 판단 기준과 근거

| 기준 버전 | 기준 | 근거와 보수적 처리 |
|---|---|---|
| `specialty-normalization-rules-v1` | 정제명→`신선한`→`미가공` 순서의 고시명칭 정확 일치만 자동 확정 | 의미 추정에 의한 오분류를 막기 위해 부분·복수 일치는 사람 검토로 분리. 사전은 `kipo-notice-goods-13-2026` |
| `specialty-normalization-rules-v2-approved-aliases` | v1 규칙 + `approved-aliases.json`의 사용자 승인 표현만 자동 확정 | 승인 2026-08-11, #51. 대상 고시명칭·NICE류·유사군코드가 `kipo-notice-goods-13-2026`과 일치하지 않으면 차단 |
| `area-brand-region-normalization-v1` | 법정동코드의 시도·시군구 완전일치, 고유한 경우에만 시/군/구 접미사 복원 | `구미`→`구미시`처럼 후보가 하나일 때만 복원. `고성`처럼 복수 시도 후보면 `unverified` |
| `area-brand-application-region-join-v2-aliases` | 농사로 `aplcnoInfo`와 KIPRIS `applicationNumber`에서 숫자 외 문자를 제거한 뒤 완전일치하고, 지역은 공통 행정구역 정규화를 적용 | 하이픈 표시 차이만 제거하며 이름·유사 문자열 조인은 하지 않음. 법정동코드 마스터와 승인된 축약·개칭·통합 전 지명만 사용하고 모호하면 `unverified` |
| `ip-registry-applicant-region-v2-aliases` | 등록원부 `applicantAddr`를 법정동코드 마스터와 승인된 행정구역 별칭으로 정규화 | 복수·미매칭 주소는 추정하지 않고 `unverified`; 등록번호 없는 hit는 `not_applicable`; 전체 주소는 저장하지 않음 |
| `kipris-trademark-applicant-region-v2-aliases` | 출원 속보 `applicantAddress`를 법정동코드 마스터와 승인된 행정구역 별칭으로 정규화 | 등록번호가 없는 출원도 출원번호로 조회. 복수·미매칭은 `unverified`; 캐시에는 전체 주소가 아닌 정규화 지역만 저장 |
| `ip-registry-designated-goods-v0-review` | 지정상품과 검색 품목을 문자 정규화 후 exact/contains/class-only/mismatch로 분리 | exact만 확정 근거. contains/class-only는 #12 확정 전 검토 후보이며 합계에서 자동 제외하지 않음 |
| `brand-analysis-v2-regional-brand-separated` | 출원인 주소와 지역브랜드 연관성을 별도 집계 | `localApplicantShare`에는 출원인 주소만 사용. 농사로 근거는 `regionalBrand*` 지표로만 제공 |
| `gap-score-v1-representative-gi-or-count3` | 대표 특산품: GI 출처 또는 상표 출원 3건 이상(OR). 활동량 0.7·등록률 0.3 | 대표 특산품 판정은 #29에서 확정(2026-08-11). 활동량 포화 건수·가중치는 아직 파이프라인 검증용 예시이며 #29 잔여 범위에서 확정 예정 |
| `strategy-template-v0-example` | ⑤ 근거 수치만 고정 템플릿으로 문장화 | AI가 사실·점수를 만들지 않게 재현 가능한 초안을 먼저 생성. 개별 AI 검토는 #16의 별도 기록 |
| `review-selection-v1` | ⑥-2 검토 대상: `collectionPartial` 또는 `regionMatchVerified=false`(OR), 상한 `limit`(기본 20)건 | #16에서 확정(2026-08-11). 근거가 이미 검증된 briefing은 사람이 다시 볼 필요가 없다는 판단. `gapScore` 내림차순으로 결정론적으로 자름 |

## 4. 산출물 계보

- ① CSV/SQLite 정규화 payload: `sourceId`, `sourceContractVersion`, `sourceUrl`,
  `sourceLastVerifiedAt`, `collectedAt`과 `sourceRegionName`/`sourceRegionCode`,
  `regionCode`/`regionMatchMethod`, `sourceItemName`/`sourceRecordUrl`을 원본 행마다 기록한다.
- ② CSV: `normalizationVersion`, `dictionaryVersion`, `dictionarySourceUrl`,
  `dictionaryDownloadedAt`을 행마다 기록하고 ① 출처 필드를 전달한다.
- ③ JSON: `trademarkSourceMetadata`, 입력 행 `provenance`, `regionalBrandValidation`을 기록한다.
- 지역브랜드가 출원번호로 조인된 hit: `regionalBrandMatchVersion`,
  `regionalBrandMatchSource`, `regionalBrandEvidence`를 기록한다.
- 등록원부로 보강된 hit: `applicantRegionMatch*`, `applicantRegionEvidence`, `goodsMatch*`,
  `goodsEvidence`, `registryEvidence`를 기록하고 원본 전체 주소는 산출물에 복사하지 않는다.
- 출원번호로 보강된 hit: `applicationApplicantLookup`, `applicantRegionMatch*`,
  `applicantRegionEvidence`를 기록하고 출원인 이름·고객번호·원본 전체 주소는 캐시에 저장하지 않는다.
- ④ JSON: `analysisVersion`, `provenance`, `methodology`, 버킷별 `sourceProvenance`를 기록한다.
- ⑤·⑥ JSON: 상위 단계 `provenance`와 현재 `scoreVersion`/`templateVersion`, 방법론을 이어받는다.
- ⑥-2 검토(append-only, `strategy.json`과 분리된 별도 파일): `review-proposals.jsonl`에
  `candidateId`·`proposalVersion`·`modelProvider`/`modelName`/`promptVersion`·`error`를,
  `review-decisions.jsonl`에 `decision`·`reviewer`·`reviewedAt`을 기록한다. 승인 결과를
  반영한 `strategy-reviewed.json`은 원본 `sentences`를 `originalSentences`로 항상 보존한다.
- ⑦ 스냅샷: 상위 출처와 분석·점수·템플릿·지도 경계 버전을 이어받고 `sample|full`,
  `complete|partial|error|not_collected` 상태를 값과 분리해 기록한다. 상세 계약은
  [`dashboard-data-contract.md`](dashboard-data-contract.md)를 따른다.

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

## 7. 2026-08-11 등록원부 3건 E2E 검증 기록

위 KIPRIS 샘플의 고유 등록번호 13개 중 앞의 3개만 `getMarkHistory`로 보강했다. API 요청은
성공 3·오류 0, 미수집 10이었다. 주소 판정은 inside 2·outside 0·unverified 1이고, 지정상품은
세 건 모두 `class_only` 검토 후보였다. ③ 보강→④ 집계→⑤·⑥→⑦ 스냅샷까지 실행했으며
④ 전체 21개 고유 hit 중 주소 검증률은 9.52%, 지정상품 평가율은 14.29%였다.

샘플에서 검증된 두 주소는 구미시 inside였지만 이를 전체 지역 기업 비중으로 해석하지 않는다.
세부 지정상품 기준은 #12, 등록번호가 없는 출원 건의 주소 소스는 #11의 잔여 범위다.

같은 날 통합 CLI의 최초 무제한 동시 호출은 등록번호 25건에서 모두 HTTP 429가 발생했다.
동시성 기본값을 3으로 제한한 뒤 별도 사과 샘플 8건은 요청 8·성공 8·오류 0이었고 주소는
inside 1·outside 7, 지정상품 원문은 7건에서 확인됐다. 이 기록은 호출 제어와 분기 검증
근거이며, 역시 전체 분포를 뜻하지 않는다.

## 8. 2026-08-14 GI 과거 전체 초기 적재 조사 기록(#22)

GI API(`getMarkHistory`류가 아니라 `Grid_20141225000000000157_1`)는 `REGIST_NO_REGIST_DE`
완전일치만 지원해, 과거 전체를 적재하려면 등록일을 추측해 순회하는 대신 공식 파일 데이터가
필요하다(#22 지침). 웹 검색으로 정확히 일치하는 공식 파일을 찾았다.

- **데이터셋**: "농림축산식품부 국립농산물품질관리원_지리적표시 등록현황" (파일명 예:
  `..._20260317.csv`), data.go.kr 등록번호 `3055334`
  (<https://www.data.go.kr/data/3055334/fileData.do>), 원본 호스팅은 농림축산식품
  공공데이터포털 `data_id=20220204000000001691`
  (<https://data.mafra.go.kr/opendata/data/indexOpenDataDetail.do?data_id=20220204000000001691>)
- **필드**: 등록번호·등록명칭·등록일자·대상 지역·생산 계획량·구성 현황 — 현재
  `lib/giClient.js`의 `mapRegistration()` 필드(`registrationNumber`, `registeredName`,
  `registrationDate`, `region`, `plannedQuantity`)와 거의 그대로 대응한다.
- **규모**: 106행, 연 1회 갱신(최근 갱신 2026-03-19). 과거 9개 연도별 파일이 함께 제공돼
  연도별 스냅샷 비교도 가능하다.
- **막힌 지점**: 실제 다운로드가 포털 로그인 후 파일명 클릭으로만 동작하는
  JavaScript(`filedownload()`) 방식이라, 안정적인 무인증 URL로 직접 받을 수 없었다.
  대량(5,000건 이상) 조회는 별도 "데이터 분석신청"이 필요하다고 안내되지만 이 파일은
  106건이라 해당하지 않을 가능성이 높다.
- **다음 단계**: 사람이 포털에 로그인해 CSV를 내려받아 전달하면, `lib/normalize.js`의
  `fromGiRegistrations()`를 재사용해 SQLite 초기 적재로 연결할 수 있다(신규 코드 최소화).
  로그인 없이 받을 수 있는 경로가 있는지는 계속 확인이 필요하다.
