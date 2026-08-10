# API 인증키 보관 주의사항

## 저장 위치

실제 인증키는 저장소 루트의 `.env` 한 곳에만 저장한다. `.env`는 `.gitignore` 대상이며,
이슈·PR·커밋·일반 문서에는 키 값을 기록하지 않는다.

| 환경변수 | 용도 | 현재 코드 사용 |
|---|---|---|
| `KIPRIS_API_KEY` | KIPRISPlus 상표 검색 | 사용 |
| `GI_API_KEY` | 농식품 공공데이터포털 지리적표시 API | 사용 |
| `NONGSARO_API_KEY` | 농사로 지역특산물 API | 사용 |
| `NONGSARO_LOCAL_BRAND_API_KEY` | 농사로 지역 브랜드 API 신청키 별칭 | 미사용·보관만 |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 일반 서비스키 | 현재 미사용·보관만 |

농사로의 지역특산물과 지역 브랜드에 동일한 회원 API 키가 발급돼도 용도를 잊지 않도록 두
환경변수명을 유지한다. 현재 실행 코드는 `NONGSARO_API_KEY`만 읽는다.

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
