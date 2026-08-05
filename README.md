# KIIP

## 상표 출원 지역 통계 자동화

지역(시군구) + 품목 기준으로 KIPRIS 상표 출원 현황을 확인하는 자동화 파이프라인을 구축 중입니다.

- `docs/kipris-api-notes.md` — KIPRIS 상표 Open API 연동 메모 (인증, 엔드포인트, 응답 필드, 지역 매칭 관련 미해결 이슈)
- `pipeline/` — {지역, 품목} 입력으로 KIPRIS 상표 검색을 호출하는 CLI 파이프라인 v1 (`pipeline/README.md` 참고)
