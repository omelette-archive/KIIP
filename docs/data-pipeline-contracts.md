# 수집·정규화 데이터 기준

## 1. 소스 레지스트리

수집 URL과 접근 조건의 기준 파일은
[`01-collect-specialties/config/sources.json`](../01-collect-specialties/config/sources.json)이다.
각 소스는 다음 정보를 가진다.

- 고정 `id`, 이름, 파이프라인 역할
- 공공데이터 카탈로그 URL과 제공기관 URL
- 응답 포맷
- 인증키/base URL 환경변수명과 승인 방식
- 공개 호출 제한 또는 계정 화면에서 확인해야 한다는 상태
- 현재 어댑터와 실키 검증 상태
- 데이터/계약 버전과 마지막 확인일

계정별 API 키와 할당량 숫자는 레지스트리에 저장하지 않는다.

## 2. 수집 구조

`소스 레지스트리 → 소스별 어댑터 → 지역명 검증 → 공통 CSV → ② 규칙 정규화` 순서로 처리한다.
샘플 검증은 ① CLI의 `--limit`으로 소스별 수집 건수를 제한한다.

① 출력 필드:

| 필드 | 의미 | 필수 |
|---|---|---|
| `sido` | 법정동코드 마스터로 확인한 시도 | 예(매칭 실패 시 빈 값) |
| `sigungu` | 법정동코드 마스터로 확인한 시군구 | 예(매칭 실패 시 원문 지역) |
| `regionCode` | 최신 법정동코드 기준 현재 지역코드 | 아니요(도 단위·미매칭은 빈 값) |
| `regionMatchMethod` | 코드 완전일치·과거 코드 승계·이름 별칭 등 매칭 경로 | 예 |
| `sourceRegionName` | 원천에 적힌 지역명 | 아니요 |
| `sourceRegionCode` | 원천에 적힌 지역코드 | 아니요 |
| `rawItemName` | 소스가 제공한 품목명 | 예 |
| `sourceItemName` | 브랜드성 표현을 포함한 원문 표시명 | 아니요 |
| `sourceRecordUrl` | 개별 원문을 다시 확인할 URL | 아니요 |
| `source` | 사람이 읽을 수 있는 출처명 | 예 |
| `sourceId` | 소스 레지스트리의 안정 ID | 예 |
| `sourceContractVersion` | 수집 시점의 API/데이터 계약 버전 | 예 |
| `sourceUrl` | 공개 공식 카탈로그 URL | 예 |
| `sourceLastVerifiedAt` | 해당 계약을 마지막으로 확인한 날짜 | 예 |
| `collectedAt` | UTC ISO-8601 수집 시각 | 예 |

현재 CSV는 교환·스모크 포맷이고, 누적 원본은 Node 내장 SQLite로 아래 테이블에 저장한다.

- `collection_runs`: 실행 시각, 조회 범위, 소스별 성공/실패, 경고, 논리 요청 수, 저장 건수
- `specialty_raw_records`: 소스 레코드 안정 키, 현재 payload hash와 버전, 최초/최근 실행 ID
- `specialty_raw_versions`: 원문 payload, 정규화 payload, hash, append-only 버전과 수집 실행 ID
- `specialty_normalizations`: 규칙 버전, 확정 값, 검토 상태와 결정 이력

GI 키는 `등록신청 공고번호+등록일`, 농사로 키는 `지역코드+링크 URL`(링크가 없으면 제목),
공식 보완자료는 저장된 `sourceRecordId`를 사용한다. 식별 필드가 없으면 canonical raw payload의
SHA-256을 fallback으로 사용한다. 동일 키와
동일 내용은 `last_seen`만 갱신하고, 내용이 달라졌을 때만 `specialty_raw_versions`에 새 버전을
추가한다. 실행마다 바뀌는 `collectedAt`은 변경 hash에서 제외한다.

`data_sources`와 `specialty_normalizations`의 DB 저장은 아직 구현하지 않았다. 전자는 현재
`config/sources.json`이 기준이고, 후자는 ②단계 수동 검토 이력 저장소를 정할 때 추가한다.

### GI 실제 응답 계약(2026-08-10 실키 검증)

GI는 data.go.kr 공통 `serviceKey` 계약이 아니라 농식품 공공데이터포털 LINK API다. 인증키는
URL 경로에 들어가고 JSON 본문은 `Grid_20141225000000000157_1` 객체를 루트로 사용한다.
`REGIST_NO_REGIST_DE` 완전일치 값이 필수이며 연/월만 넣으면 해당 완전일치 값이 없어 0건이다.

| 원본 필드 | 의미 | 현재 사용 |
|---|---|---|
| `REGIST_REQST_PBLANC_NO` | 등록신청 공고번호 | 클라이언트 표준 모델의 `registrationNumber` |
| `GGRPH_INDICT_KOREAN_NM` | 지리적표시 한글명칭 | ① `rawItemName` |
| `GGRPH_INDICT_ENG_NM` | 영문명칭 | raw 보존 후보 |
| `REGIST_NO_REGIST_DE` | 등록일자 | 증분 조회 기준·raw 보존 후보 |
| `GRP_NM` | 등록 단체명 | raw 보존 후보 |
| `TRGET_AREA` | 대상지역 자유문 | 법정동코드 대조 후 ① `sido`/`sigungu` |
| `PRDCTN_PLAN_QY` | 생산계획량 자유문 | raw 보존 후보 |
| `GGRPH_INDICT_SFE` | 특징 설명 | raw 보존 후보 |
| `HMPG_IMAGE_FILE_NO` | 이미지 파일번호 | raw 보존 후보 |

현재 CSV에는 후속 단계가 사용하는 공통 필드와 지역 승계 감사 필드를 기록한다. 설명·생산량 등
나머지 원문은 `specialty_raw_records`·`specialty_raw_versions`에 저장하며, 인증키 값은 어떤
산출물에도 저장하지 않는다.

농사로 `areaBrand/areaBrandLst`는 특산품 수집 원본이 아니라 KIPRIS 결과의 지역·품목 검증자료다.
따라서 ① CSV/SQLite에 섞지 않고 `03-match-trademarks/fetchAreaBrands.js`로 별도 JSON을 만든다.
③의 `--area-brands` 옵션은 농사로 `aplcnoInfo`와 KIPRIS `applicationNumber`의 숫자형 키가
완전히 같을 때만 hit에 근거를 연결한다. 지역은 법정동코드 마스터와 승인된 축약·개칭·통합 전
지명만 정규화하고, 접미사 복원은 후보가 하나일 때만 허용하며 모호하면 `unverified`다. ④는 이를 `regionalBrand*`로 집계하고 출원인
주소 기반 `localApplicantShare`와 섞지 않는다. 규칙 버전과 근거는
[`data-source-provenance.md`](data-source-provenance.md)를 따른다.

## 3. 정제 기준

②단계는 외부 AI 없이 다음 순서로 처리한다.

1. 문자열을 Unicode NFC로 통일한다.
2. 확인된 시도/시군구명과 행정구역 접미사를 제거한다.
3. 쉼표·세미콜론 뒤의 품종/부연 설명과 괄호 설명을 제거한다.
4. `나무`, `묘목`, `모종`, `종묘`, `종자`, `씨앗` 접미사는 분석 제외로 표시한다.
5. 고시상품명칭을 `정제명` → `신선한 정제명` → `미가공 정제명` 순서로 정확 일치 검색한다.
6. 하나만 일치하면 `status=ok`, 부분 일치·복수 분류·미일치는 `status=review_required`로 둔다.
7. 검토 대상에는 `reviewReason`과 상위 `reviewCandidates`를 남긴다.
8. 사람이 개별 검토해 승인하기 전에는 ③ 상표 검색이 해당 행을 건너뛴다 — 이 검토를
   AI로 자동화하지 않는다(의도적 결정).

②의 세 명칭은 용도가 다르다.

- `rawItemName`: 출처 원문(예: `안동사과, 부사`)
- `itemName`: 지역명·부연을 제거한 대표 특산품 표시명(예: `사과`)
- `noticeName`: 특허청 고시상품명칭 검색·집계 기준(예: `신선한 사과`)

상표명·지역브랜드명은 이 셋을 대체할 수 없다. `areaBrandLst.brandName`은 출원번호 검증 근거로만
보존하며 ③의 품목 검색어와 ④의 지역×품목 집계 키로 사용하지 않는다.

### 수동 검토 중간산출물 계약

`normalizeItems.js`는 모든 행에 원본 순서를 나타내는 `inputIndex`를 부여하고,
`status=review_required` 행을 별도 CSV로 복사한다. 검토자는 다음 결정만 기록할 수 있다.

| 결정 | 의미 | 추가 필드 |
|---|---|---|
| `approve_candidate` | 생성된 `reviewCandidates` 중 하나를 승인 | `selectedCandidateIndex`, `reviewedBy`, `reviewedAt` |
| `exclude` | 분석 대상에서 제외 | `reviewedBy`, `reviewedAt` |
| `keep_pending` 또는 빈 값 | 아직 확정하지 않음 | `reviewNote` 선택 |

`applyManualReviews.js`는 결정의 유효성만 검증해 전체 결과에 병합한다. 후보 밖의 자유 입력은
허용하지 않으며, 승인·제외 결과에는 `matchMethod=manual_candidate|manual_excluded`와 검토자,
ISO-8601 검토 시각을 보존한다. DB 도입 시 이 값은 `specialty_normalizations`와 분리된
`normalization_reviews` 이력 테이블에 append-only로 저장한다.

규칙이 바뀌면 자체 테스트 사례와 이 문서를 함께 갱신한다. 의미 추론이 필요한 매핑은 자동 규칙에
추가하지 않고 검토 사례가 반복될 때만 명시적 규칙/사전으로 승격한다.

② 출력 행에는 `normalizationVersion`, `dictionaryVersion`, `dictionarySourceUrl`,
`dictionaryDownloadedAt`을 반드시 남긴다. ③ 이후 JSON은 원본 메타데이터와 규칙 버전을
`provenance`·`methodology`·단계별 version 필드로 이어받는다. API 키나 인증 URL은 계보가 아니므로
산출물에 저장하지 않는다.

## 4. 상표 검색 수집 완전성

③단계는 `(검색어, 정규화 NICE류)`를 고유 쿼리 키로 사용한다. 여러 지역 행이 같은 키를 가지면
KIPRIS 호출 결과를 공유하되 결과 JSON에는 원본 행별 지역과 `inputIndex`를 각각 유지한다.
검색어는 반드시 ②의 `noticeName`이고 NICE류도 확정돼야 한다. 둘 중 하나라도 비어 있으면 호출하지
않는다. 성공·오류 결과에도 ② 원본 행을 `input`으로 보존해 ④가 표시용 `itemName`과 집계용
`noticeName`을 혼동하지 않도록 한다.

- `collectionStatus=complete`: KIPRIS 검색 결과의 마지막 페이지까지 확인함
- `collectionStatus=partial`: 페이지·필터 통과 hit·실행 전체 요청 상한 중 하나에 도달함
- `collectionStatus=error`: API 오류로 해당 쿼리를 완료하지 못함

고유 쿼리 단위 체크포인트는 저장된 `nextPage`부터 재개하며 완료 쿼리는 재호출하지 않는다.
④단계는 partial hit를 버리지 않고 집계하지만 `partialQueryCount`와 경고를 출력한다. 따라서
⑤ 이후 점수에서 부분 수집 데이터를 사용할지는 점수 정책을 확정할 때 명시적으로 결정한다.
