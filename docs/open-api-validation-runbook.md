# Open API 키·실호출 검증 인수인계

최종 검증일: 2026-08-10  
검증 환경: Windows PowerShell, Node.js 24(로컬), Node.js 22(GitHub Actions)

이 문서는 다른 작업자가 API 신청처·키 위치·실행 명령·검증 완료 범위를 다시 조사하지 않고
바로 이어서 작업하기 위한 기준 문서다. 실제 키 값은 적지 않는다.

## 1. 가장 먼저 확인할 것

작업 루트는 각 worktree의 저장소 루트다. 현재 PC의 기준 키 파일과 검증 worktree는 다음과 같다.

```text
기준 키 파일  C:\Users\이준형\orca\KIIP\.env
검증 worktree C:\Users\이준형\orca\workspaces\KIIP\main
worktree 키   C:\Users\이준형\orca\workspaces\KIIP\main\.env
```

Orca worktree는 `.env`를 자동 공유하지 않는다. 새 worktree에서는 다음 명령으로 기준 복사본을
가져온다.

```powershell
Copy-Item -LiteralPath 'C:\Users\이준형\orca\KIIP\.env' -Destination '.env'
git check-ignore -v .env
```

정상이라면 `git check-ignore`가 `.gitignore:1:.env`를 출력한다. 값은 출력하지 말고 변수명만
확인한다.

```powershell
Get-Content .env |
  Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
```

현재 보관 변수:

```text
KIPRIS_API_KEY
GI_API_KEY
NONGSARO_API_KEY
NONGSARO_LOCAL_BRAND_API_KEY
DATA_GO_KR_API_KEY
```

## 2. 키별 구분 — 서로 바꿔 쓰지 않는다

| 변수 | 발급/제공처 | 실제 계약 | 코드 상태 |
|---|---|---|---|
| `KIPRIS_API_KEY` | KIPRISPlus | `ServiceKey` 쿼리 + XML | ③에서 사용·실키 검증 완료 |
| `GI_API_KEY` | 농식품 공공데이터포털 | URL 경로 키 + MAFRA Grid JSON | ①에서 사용·실키 검증 완료 |
| `NONGSARO_API_KEY` | 농사로 | `apiKey` 쿼리 + XML | 지역특산물 ①에서 사용·실키 검증 완료 |
| `NONGSARO_LOCAL_BRAND_API_KEY` | 농사로 | `areaBrand` 서비스 + XML | 3건 수집·KIPRIS 조인·④ 분석 실검증 완료 |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 | 표준 REST API용 일반 서비스키 | 현재 실행 코드에서는 미사용 |

주의할 구분:

- data.go.kr의 `LINK` 데이터는 공공데이터포털 일반 서비스키를 쓰지 않는다.
- GI는 농식품 포털 자체 키와 허용 IP를 사용한다.
- 농사로 지역특산물·지역 브랜드는 농사로에서 발급받은 회원 API 키를 사용한다.
- 두 농사로 신청 항목에 같은 키가 표시돼도 용도를 구분하려고 환경변수 별칭을 둘 다 보존한다.

## 3. 농사로 지역특산물

### 신청·공식 경로

- 농사로 공공데이터 신청:
  <https://www.nongsaro.go.kr/portal/ps/psn/psnj/openApiLst.ps?menuId=PS65428>
- 검색 서비스명: `지역특산물`
- data.go.kr 카탈로그: <https://www.data.go.kr/data/15101361/openapi.do>
- 실제 base URL: `https://api.nongsaro.go.kr/service/localSpcprd`
- operation: `localSpcprdLst`
- 인증 파라미터: `apiKey`
- 응답: XML

data.go.kr 페이지는 LINK 카탈로그 성격이고, 현재 코드가 읽는 키는 `NONGSARO_API_KEY`다.

### 3건 수집·SQLite 저장

```powershell
node 01-collect-specialties/collectSpecialties.js `
  --sources nongsaro `
  --limit 3 `
  --out 01-collect-specialties/output/nongsaro-key-smoke.csv `
  --db 01-collect-specialties/output/nongsaro-key-smoke.sqlite
```

첫 실행 실측:

```text
HTTP/API 오류       0
논리 API 요청       1
CSV/DB 원본         3건
SQLite inserted     3
updated/unchanged   0 / 0
지역 매칭 경고      0
```

같은 명령을 같은 DB에 한 번 더 실행한 실측:

```text
SQLite inserted     0
updated             0
unchanged           3
raw records         3
raw versions        3 (증가 없음)
```

즉 같은 원본을 다시 받아도 중복 행이나 불필요한 새 버전이 생기지 않는다.

### 페이지·빈 결과·인증 오류

실키로 다음을 별도 확인했다.

| 검증 | 결과 |
|---|---|
| `numOfRows=2`, `limit=3` | 3건, 논리 요청 2회로 실제 페이지 순회 |
| 존재하지 않는 `sText` | 정상 응답 0건 |
| 잘못된 테스트 키 | 인증 오류 감지 |
| 공식 XML 필드 파싱 | 제목·지역·등록일·원문 보존 정상 |

## 4. 농사로 3건 소규모 ①→④ E2E

### ② 규칙 정규화

```powershell
node 02-normalize-items/normalizeItems.js `
  --input 01-collect-specialties/output/nongsaro-key-smoke.csv `
  --out 02-normalize-items/output/nongsaro-key-smoke-normalized.csv `
  --review-out 02-normalize-items/output/nongsaro-key-smoke-review.csv
```

실측: 입력 3, 자동 확정 3, 제외 0, 검토대기 0, 오류 0.

### ③ KIPRIS 실검색

호출량을 작게 유지하려고 쿼리당 1페이지·3건으로 제한했다.

```powershell
node 03-match-trademarks/matchTrademarks.js `
  --input 02-normalize-items/output/nongsaro-key-smoke-normalized.csv `
  --numOfRows 3 `
  --max-pages 1 `
  --max-hits-per-query 3 `
  --max-requests 3 `
  --out 03-match-trademarks/output/nongsaro-key-smoke-result.json
```

실측:

```text
입력/고유 쿼리     3 / 3
KIPRIS 요청         3
성공/오류/건너뜀   3 / 0 / 0
저장 hit            7
partial             3
```

`partial=3`은 장애가 아니다. `--max-pages 1` 보호 상한 때문에 다음 페이지가 남은 쿼리를
완전 수집으로 오인하지 않도록 표시한 것이다.

### ④ 분석

```powershell
node 04-analyze-brand/analyzeBrands.js `
  --input 03-match-trademarks/output/nongsaro-key-smoke-result.json `
  --out 04-analyze-brand/output/nongsaro-key-smoke-analysis.json `
  --asOfYear 2026
```

실측: 성공 쿼리 3, partial 쿼리 3, 고유 상표 후보 7, 오류 0. partial 결과는 집계에 포함하되
경고와 `partialQueryCount`를 보존한다.

## 5. GI 지리적표시

### 공식 경로·계약

- data.go.kr 카탈로그: <https://www.data.go.kr/data/15080629/openapi.do>
- 실제 제공처: 농식품 공공데이터포털
- 실제 URL 형식: `/openapi/{GI_API_KEY}/json/{dataset}/{start}/{end}`
- 필수 조건: `REGIST_NO_REGIST_DE=YYYYMMDD` 완전일치
- 기본 dataset: `Grid_20141225000000000157_1`

공공데이터포털 일반 `DATA_GO_KR_API_KEY`가 아니라 `GI_API_KEY`와 허용 IP가 필요하다.

### 1건 멱등 저장 실측

```powershell
node 01-collect-specialties/collectSpecialties.js `
  --sources gi `
  --gi-date 20130207 `
  --limit 1 `
  --out 01-collect-specialties/output/gi-key-smoke.csv `
  --db 01-collect-specialties/output/gi-key-smoke.sqlite
```

같은 명령을 두 번 실행한 결과:

```text
1회차  success, request 1, row 1, inserted 1
2회차  success, request 1, row 1, unchanged 1
최종   raw records 1, raw versions 1
```

일일 증분·최대 31일 누락 복구는 구현돼 있다. API가 등록일 완전일치만 받으므로 과거 전체를
무작정 날짜 순회하지 않는다. 공식 파일이나 등록일 목록 확보는 #22에서 관리한다.

## 6. 농사로 지역 브랜드

### 공식 경로 탐색 과정

1. 농사로 공공데이터 목록에서 서비스명 `브랜드`로 검색한다.
2. `지역 브랜드` 행의 샘플은 `areaBrand`, 공식 매뉴얼은 `areaBrand.zip`이다.
3. 샘플의 첫 operation은 `selectSclCodeLst`인데, 이건 **실제 브랜드 목록이 아니라 품목
   대분류 코드표**다(공통·식량작물·채소류·과채류·과실류·축산물·특작류·화훼류·농산가공·기타
   10개 코드). 실제 목록 operation은 같은 서비스의 `areaBrandLst`다.

공식 자료:

- 공개 지역브랜드 화면(현재 602건):
  <https://www.nongsaro.go.kr/portal/ps/psz/psza/contentMain.ps?menuId=PS03344>
- 공식 매뉴얼 ZIP: <https://www.nongsaro.go.kr/portal/apiManual/areaBrand.zip>
- service base: `https://api.nongsaro.go.kr/service/areaBrand`
- 코드표 operation: `selectSclCodeLst` — `code`, `codeNm` 10건
- 브랜드 목록 operation: `areaBrandLst` — `totalCount=602`

### 실키 결과

`NONGSARO_LOCAL_BRAND_API_KEY`로 두 operation을 교차검증했다.

```text
HTTP status       200
resultCode        00
resultMsg         정상적으로 처리되었습니다.
응답              XML
selectSclCodeLst   code, codeNm (10개 품목 대분류)
areaBrandLst       aplcnoInfo, rgnoInfo, brandRgsde, cntntsNo,
                   cntntsSj, imgUrl, mainPrdlstNm, signguNm
totalCount         602
```

샘플 3건은 다음 명령으로 별도 JSON에 저장한다. 기본 상한이 3이므로 실수로 602건 전체를 받지
않는다.

```powershell
node 03-match-trademarks/fetchAreaBrands.js `
  --limit 3 `
  --out 03-match-trademarks/output/area-brand-sample.json
```

별도 검증자료를 ③ 입력으로 바꾸고 KIPRIS 조인과 ④ 분석까지 실행한다.

```powershell
node 03-match-trademarks/buildAreaBrandValidationInput.js `
  --input 03-match-trademarks/output/area-brand-sample.json `
  --limit 3 `
  --out 03-match-trademarks/output/area-brand-validation-input.csv

node 03-match-trademarks/matchTrademarks.js `
  --input 03-match-trademarks/output/area-brand-validation-input.csv `
  --area-brands 03-match-trademarks/output/area-brand-sample.json `
  --numOfRows 100 --max-pages 1 --max-hits-per-query 100 --max-requests 3 `
  --out 03-match-trademarks/output/area-brand-validation-result.json

node 04-analyze-brand/analyzeBrands.js `
  --input 03-match-trademarks/output/area-brand-validation-result.json `
  --out 04-analyze-brand/output/area-brand-validation-analysis.json `
  --asOfYear 2026
```

2026-08-10 측정값은 입력 3건, KIPRIS 성공 3건, 오류 0건, 출원번호 완전일치 조인 3건,
지역브랜드 inside 3건이다. 총 고유 KIPRIS hit는 21건이었다. 한 쿼리는 `--max-pages=1` 상한으로
`partial`이며 오류가 아니다. 출원인 주소가 없으므로 `localApplicantShare`는 세 행 모두
`null`이고, 농사로 근거는 별도 `regionalBrand*` 지표로만 반영됐다.

`signguNm`은 법정동코드 완전일치와 고유 접미사 복원만 허용한다. `구미`는 `구미시`로 복원할 수
있지만 `고성`처럼 여러 시도에 후보가 있으면 `unverified`로 남긴다. 조인 규칙은
`area-brand-application-region-join-v1`, 분석 규칙은
`brand-analysis-v2-regional-brand-separated`다. 공식 출처와 전체 기준은
[`data-source-provenance.md`](data-source-provenance.md)에 기록한다.

이 데이터는 특산물 원본이 아니라 이미 등록·출원된 지역 브랜드 검증자료이므로 ① 특산물
목록에 섞지 않는다. 위 3건은 연결 계약 검증용이며 전체 602건을 대표하지 않는다.

## 7. 생성된 로컬 검증 산출물

다음 파일은 현재 worktree에 있고 모두 `.gitignore` 대상이다.

```text
01-collect-specialties/output/nongsaro-key-smoke.csv
01-collect-specialties/output/nongsaro-key-smoke.sqlite
01-collect-specialties/output/gi-key-smoke.csv
01-collect-specialties/output/gi-key-smoke.sqlite
02-normalize-items/output/nongsaro-key-smoke-normalized.csv
02-normalize-items/output/nongsaro-key-smoke-review.csv
03-match-trademarks/output/nongsaro-key-smoke-plan.json
03-match-trademarks/output/nongsaro-key-smoke-result.json
03-match-trademarks/output/nongsaro-key-smoke-result.json.checkpoint.json
03-match-trademarks/output/area-brand-sample.json
03-match-trademarks/output/area-brand-validation-input.csv
03-match-trademarks/output/area-brand-validation-result.json
03-match-trademarks/output/area-brand-validation-result.json.checkpoint.json
04-analyze-brand/output/nongsaro-key-smoke-analysis.json
04-analyze-brand/output/area-brand-validation-analysis.json
```

SQLite의 `-wal`, `-shm` 보조 파일도 Git에 올리지 않는다.

## 8. 완료·후속 상태

완료:

- PR #21: SQLite 누적 저장과 농사로 실키 상태 반영
- PR #25: 루트 진행표 갱신
- 이슈 #2: KIPRIS·GI·농사로 인증/실호출 검증 완료 후 종료
- 이슈 #3: GI·농사로 원문 누적과 멱등 재실행 완료 후 종료
- #24: 농사로 지역브랜드 3건 출원번호 조인·별도 ④ 지표·모호 지역 보수 처리 구현

후속:

- #22: GI 과거 전체 초기 적재 데이터 확보
- #11: 출원인 주소 기반 지역 상표 매칭
- #12: NICE류 후보를 지정상품 상세 대조로 보강
- #29: ⑤ 대표 특산품·브랜드 공백 점수 업무 기준 확정

## 9. 새 작업자 체크리스트

1. 기준 `.env`를 자기 worktree 루트로 복사한다.
2. `git check-ignore -v .env`로 Git 제외를 확인한다.
3. 전체 수집 전에 반드시 `--limit 3`으로 소스별 스모크 테스트를 실행한다.
4. ③ KIPRIS는 먼저 `--dry-run`, 실제 실행은 작은 `--max-requests`로 시작한다.
5. 결과의 `partial`을 오류나 완전 수집으로 잘못 해석하지 않는다.
6. 키 값은 로그·이슈에 복사하지 않고 변수명과 검증 결과만 남긴다.
7. 계약을 바꾸기 전에 이 문서와 각 소스의 공식 매뉴얼·기존 selftest를 확인한다.
