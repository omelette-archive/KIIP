# API 인증키 보관 주의사항

## 저장 위치

실제 인증키는 저장소 루트의 `.env` 한 곳에만 저장한다. `.env`는 `.gitignore` 대상이며,
이슈·PR·커밋·일반 문서에는 키 값을 기록하지 않는다.

현재 개발 PC에서는 다음 두 파일을 같은 내용으로 유지한다.

- 기준 복사본: `C:\Users\이준형\orca\KIIP\.env`
- 현재 worktree: `C:\Users\이준형\orca\workspaces\KIIP\main\.env`

Orca worktree끼리는 ignored 파일인 `.env`를 자동 공유하지 않는다. 새 worktree에서 API 작업을
시작할 때는 저장소 루트에서 다음 명령을 먼저 실행한다.

```powershell
Copy-Item -LiteralPath 'C:\Users\이준형\orca\KIIP\.env' -Destination '.env'
```

다른 PC에서는 위 절대경로를 사용하지 말고 그 PC의 안전한 기준 위치에서 `.env`를 준비한다.

| 환경변수 | 용도 | 현재 코드 사용 |
|---|---|---|
| `KIPRIS_API_KEY` | KIPRISPlus 상표 검색·출원번호 기반 출원인 주소 조회 | 사용 |
| `GI_API_KEY` | 농식품 공공데이터포털 지리적표시 API | 사용 |
| `NONGSARO_API_KEY` | 농사로 지역특산물 API | 사용 |
| `NONGSARO_LOCAL_BRAND_API_KEY` | 농사로 지역 브랜드 API 신청키 별칭 | 수집·KIPRIS 출원번호 조인에 사용 |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 일반 서비스키 | 현재 미사용·보관만 |
| `IP_REGISTRY_API_KEY` | 지식재산처 등록원부 `getMarkHistory` | 등록번호 기반 주소·지정상품 보강에 사용 |

농사로의 지역특산물과 지역 브랜드에 동일한 회원 API 키가 발급돼도 용도를 잊지 않도록 두
환경변수명을 유지한다. 지역특산물 수집은 `NONGSARO_API_KEY`를 읽고, 지역 브랜드 키는
`03-match-trademarks/fetchAreaBrands.js`가 공식 `areaBrand/areaBrandLst` 목록을 소량 조회할 때
읽는다. 저장한 목록은 ③의 `--area-brands` 옵션으로 KIPRIS 결과에 완전일치 조인할 수 있으며,
④에서는 출원인 주소와 분리된 `regionalBrand*` 지표로 반영한다.

등록원부 키는 `03-match-trademarks/matchTrademarks.js --enrich-registry` 또는 별도
`enrichIpRegistry.js`에서만 사용한다. 공공데이터포털에서 받은 키라도 기존
`DATA_GO_KR_API_KEY`와 용도를 섞지 않고 별도 변수명으로 보존한다.

KIPRIS 키는 상표 단어검색뿐 아니라 `enrichApplicantRegions.js`의 출원번호 기반
`trademarkApplicantInfo` 조회에도 사용한다. 후자는 원문 주소를 산출물에 복사하지 않고
시도·시군구로 정규화한 캐시만 저장한다.

## 취급 규칙

- 키 확인·교체는 로컬 `.env`에서만 한다.
- 로그에는 키 전체나 요청 URL의 인증 부분을 출력하지 않는다.
- PR에는 `.env.example`의 빈 변수명과 이 문서만 포함한다.
- 키가 채팅·이슈·커밋 등에 노출됐다고 판단되면 제공기관에서 재발급하고 `.env`를 교체한다.
- 다른 PC나 서버로 옮길 때는 Git이 아니라 해당 환경의 secret/env 설정을 이용한다.

## 적용 확인

값을 출력하지 않고 변수 존재 여부만 확인한다.

```powershell
Get-Content .env |
  Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } |
  ForEach-Object { ($_ -split '=', 2)[0] }
```

`.env`가 Git 제외 대상인지 확인한다.

```powershell
git check-ignore -v .env
```

전체 신청 경로·실호출 명령·검증 결과는
[`open-api-validation-runbook.md`](open-api-validation-runbook.md)를 따른다.
