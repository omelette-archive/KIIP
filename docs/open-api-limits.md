# Open API 계정·호출 제한

최종 확인: 2026-08-06. 숫자는 공식 공개 페이지 기준이며, 계정별 실제 할당량은 승인 후
마이페이지/관리 화면을 최종 기준으로 한다.

## 확인 결과

| 서비스 | 비용·승인 | 공개 호출 제한 | 현재 대응 |
|---|---|---|---|
| 지리적표시 등록정보 | 무료, 제공기관 연계형 API | 제공기관 정책에 따라 상이(공개 숫자 없음) | 승인 후 계정 할당량 확인 전에는 수동/개발 실행만 허용 |
| 농사로 지역특산물 | 무료, 개발 자동승인·운영 심의승인 | 제공기관 정책에 따라 상이(공개 숫자 없음) | 공식 포맷이 XML이므로 실키와 XML 어댑터 검증 필요 |
| KIPRISPlus 상표 API | 무료 월 1,000회, 이후 유료 | 회원 계정 기준 초당 50회. 무료 호출은 전체 상품 합산 월 1,000회이며 매월 1일 초기화 | 배치 1회 기본 상한 100건, 동시 요청 기본 2 |

KIPRISPlus는 2026-03-03부터 **유료 기관 고객** 대상으로 초당 75회 시범 확대를 공지했지만,
부하 상황에 따라 원래 제한으로 되돌릴 수 있다고 명시했다. 이 프로젝트는 계정 유형이 확정되기
전까지 공통 50회/초를 상한으로 간주한다.

## 공식 근거

- 지리적표시 등록정보: <https://www.data.go.kr/data/15080629/openapi.do>
- 농사로 지역특산물: <https://www.data.go.kr/data/15101361/openapi.do>
- 농사로 제공기관 API 목록: <https://www.nongsaro.go.kr/portal/ps/psn/psnj/openApiLst.ps?menuId=PS65428>
- KIPRISPlus FAQ(호출 제한): <https://plus.kipris.or.kr/portal/bbs/Faq_info.do?buttonIndex=&pageIndex=3>
- KIPRISPlus 이용요금: <https://plus.kipris.or.kr/portal/use/paymentMmg.do?menuNo=200026>
- KIPRISPlus 유료 기관 초당 제한 시범 확대 공지: <https://plus.kipris.or.kr/eng/bbs/view.do?bbsId=B0000011&nttId=1452&menuNo=300016>

## 운영 체크리스트

1. GI/농사로 활용신청 승인 후 실제 `baseUrl`, 인증키, 일/월 트래픽을 마이페이지에서 확인한다.
2. 계정별 할당량은 저장소에 키와 함께 기록하지 않고 배포 환경 설정/운영 문서에 기록한다.
3. KIPRIS 배치 전 예상 검색 행 수를 확인한다. `--max-requests`를 높일 때는 월간 잔여량을 먼저 확인한다.
4. 재시도도 실제 API 호출로 계산될 수 있으므로 논리 행 수보다 여유를 둔다.
5. HTTP 429/차단 응답이 확인되면 자동 재시도를 중단하고 제공기관 정책을 재확인한다.

