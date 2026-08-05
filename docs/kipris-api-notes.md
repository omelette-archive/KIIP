# KIPRIS 상표 Open API 연동 메모

레퍼런스: [chrisryugj/korean-patent-mcp](https://github.com/chrisryugj/korean-patent-mcp) (MIT) —
KIPRIS Plus 오픈API를 MCP 도구로 감싼 서버. 상표 파이프라인을 만들 때 인증·호출·파싱 방식을
그대로 참고할 수 있어 핵심 내용을 정리해둔다.

향후 파이프라인은 **{지역, 품목} 입력 → 실제 상표 출원 여부 확인**을 목표로 한다. 지역/품목
연동 로직 자체는 추후 작업이고, 이 문서는 그 전 단계로 KIPRIS API 호출 방식을 정리해두는 것이 목적.

## 인증

- KIPRIS Plus([plus.kipris.or.kr](https://plus.kipris.or.kr)) 회원가입 후, 사용할 서비스
  (특허·실용 / **상표** / 디자인)를 개별적으로 **활용신청**해야 한다. 신청한 서비스만 정상 호출되고,
  신청하지 않은 오퍼레이션은 `resultCode 30`(미등록)으로 거부됨.
- data.go.kr에서 발급한 키도 동일 키 체계로 동작한다.
- 키는 쿼리스트링으로 전달되므로 반드시 `https`로 호출 (평문 노출 방지).

## 상표 검색 엔드포인트 (레퍼런스 리포 기준)

레퍼런스 리포는 상표 쪽에 **`getWordSearch` 하나만** 감싸고 있다 (최소 구현):

```
GET https://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getWordSearch
    ?searchString={상표명 키워드}
    &numOfRows={1~100, 기본 10}
    &pageNo={기본 1}
    &ServiceKey={인증키}
```

- 인증키 필드명이 `ServiceKey` (특허/실용신안의 `accessKey`와 다름 — 게이트웨이가 다름).
- `searchString`은 상표명 기준 키워드 검색이며, KIPRIS 공식 문서상 실제 상표 검색 오퍼레이션은
  이 외에도 출원번호/출원상태/**상품분류코드**/출원인명/대리인명 등 더 많은 조건을 지원하는 것으로
  보이나(공식 문서 기준), 레퍼런스 리포는 그 전체를 노출하지 않는다 — 파이프라인 구축 시 필요하면
  직접 파라미터를 추가해야 함.
- `word*!?^+` 등은 KIPRIS 검색연산자로 해석되므로 상표명에 특수문자가 있으면 이스케이프 필요.

## 응답 파싱 — 상표 검색 결과 필드 (`<items><item>...`)

레퍼런스 리포 `src/lib/xml-parser.ts`의 `parseTrademarkList()` 기준, 항목(item)당 파싱되는 필드:

| 필드 | XML 태그 | 비고 |
|---|---|---|
| 상표명 | `title` | |
| 출원인명 | `applicantName` | **이름만, 주소 없음** |
| 출원번호 | `applicationNumber` | |
| 출원일 | `applicationDate` | |
| 출원상태 | `applicationStatus` | |
| 품목(상품류) 코드 | `classificationCode` | **품목 매칭에 사용 가능** |
| 등록번호 | `registrationNumber` | |
| 등록일 | `registrationDate` | |
| 공고번호 | `publicationNumber` | |
| 공고일 | `publicationDate` | |
| 권리자 | `regPrivilegeName` | |
| 대리인 | `agentName` | |
| 도면(견본이미지) 경로 | `drawing` | |

공통 헤더: `resultCode`/`resultMsg`, 총 건수는 `totalCount`.

## ⚠️ 알려진 제약 — 지역(주소) 필드 없음

`getWordSearch` 응답에는 **출원인 주소/지역 필드가 없다** (이름만 제공). 즉 "지역 기준 매칭"은
상표 검색 API 단독으로는 불가능해 보인다. 확인한 우회 후보:

- data.go.kr의 별도 데이터셋(`특허청_KIPRISPlus_출원인 법인_REST API` 등)에 출원인 프로필 정보가
  있어, 출원인명으로 조인하면 주소를 얻을 가능성이 있음 — **정확한 응답 필드는 미확인**, 실제 키
  발급 후 활용가이드로 검증 필요.
- 특허 쪽에는 서지상세(`getBibliographyDetailInfoSearch`)가 있지만 상표용 서지상세는 레퍼런스
  리포에 구현되어 있지 않음 (공식 API에 존재하는지도 별도 확인 필요).

→ **TODO**: 실제 API 키 발급 후 위 데이터셋/오퍼레이션에서 주소 필드 존재 여부 확인, 지역 매칭
방식 확정.

## 품목(품목/상품류) 매칭

- `classificationCode`가 검색 결과에 포함되므로, 응답을 받은 뒤 원하는 품목 코드로 필터링하는
  방식은 바로 가능.
- API 요청 단계에서부터 상품분류코드로 필터링하고 싶다면, 레퍼런스 리포가 감싸지 않은 KIPRIS
  공식 상표 검색 오퍼레이션의 추가 파라미터를 직접 호출해야 함 (문서상 상품분류코드 조건 지원
  확인됨, 정확한 파라미터명은 실제 키로 활용가이드 확인 필요).

## resultCode

| 코드 | 의미 |
|---|---|
| 00 | 정상 |
| 10 / 11 | 파라미터 오류 / 필수 누락 |
| 20 | 결과 없음 (정상 처리, 빈 배열) |
| 30 | 인증키 미등록 (해당 서비스 미신청) |
| 31 | 인증키 사용기한 만료 |

## 실행 방식 옵션 (레퍼런스 리포 기준)

1. **공개 remote MCP 서버**: `https://mcp.gomdori.app/patent` — 설치 없이 `kipris-key` 헤더로
   자체 키 전달 가능, 없으면 서버 공용 키로 폴백(무료 한도 보호용 rate limit 있음).
2. **STDIO 로컬 실행**: `node build/index.js` + `.env`의 `KIPRIS_API_KEY`.
3. **HTTP stateless 모드**: `node build/index.js --mode http --port 8000`, 요청 헤더
   (`apikey`/`x-api-key`/`kipris-key`/`Authorization: Bearer`)로 BYOK 가능.

우리 파이프라인은 위 서버를 그대로 붙여 쓸지, 아니면 `api-client.ts`의 호출 방식만 참고해서
이 저장소 안에 직접 fetch 스크립트를 만들지 추후 결정.

## 참고 소스 (레퍼런스 리포, MIT)

- `src/lib/api-client.ts` — `trademarkSearch()`: `ServiceKey` 기반 쿼리 빌드, `getWordSearch` 호출
- `src/lib/xml-parser.ts` — `parseTrademarkList()`, `checkHeader()`, `parseTotalCount()`
- `src/tools/trademark.ts` — Zod 스키마, 캐시 키, `[NOT_FOUND]` 처리
