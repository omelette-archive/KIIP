# ⑦ 대시보드 목업 (정적 HTML 프로토타입)

**상태**: 목업/베이스 자료 · 실제 ⑦단계 구현(Python + Streamlit)이 아니다.

Claude Code 세션에서 ①~④단계 실제 파이프라인 샘플 결과를 갖고 "대시보드가 이런 느낌이면
어떨까"를 검토하려고 만든 정적 HTML 2개다. 코드가 아니라 **레이아웃/인터랙션 방향을 검토하는
베이스 자료**로 커밋해둔다 — 실제 ⑦ 구현 시 그대로 이식하는 게 아니라 참고하는 용도.

> 이전에 합성(가짜) 데이터로 만든 대시보드 v1은 실데이터 파이프라인 방향으로 전환하며
> 제거된 적이 있다(`../README.md` 참고). 이번 목업은 그 실수를 반복하지 않으려고 **①~④를
> 실제로 돌린 샘플 데이터**만 쓴다 — 숫자를 지어내지 않았다.

## 파일

- `pipeline-flow-review.html` — ①크롤링→⑦시각화 전체 흐름을 한 번 검토한 리포트형 목업.
  실제로 동작하는 건 ①~④뿐이고 ⑤⑥⑦은 사람이 수기로 정리한 예시임을 페이지 안에 명시.
- `brand-map.html` — **지도 기반 드릴다운** 목업. 시도 클릭 → 시군구 지도로 확대 → 시군구
  클릭 → 오른쪽 패널에 품목별 상표 현황. 시도/시군구 경계는 실제 GeoJSON(`data/` 참고)이고,
  색과 상세 패널 데이터는 04-analyze-brand 실제 출력(샘플 15건 중 7개 시도/10개 품목)이다.
- `map-template.html` — `brand-map.html`의 템플릿 소스 (`__PROVINCES__` 등 플레이스홀더 포함).
- `buildmap.js` — `data/skorea_provinces.json`(시도 경계)을 SVG path로 투영해 `data/provinces.json` 생성.
- `buildmuni.js` — `data/skorea_municipalities.json`(시군구 경계)을 시도별로 나눠 각각 로컬
  투영, `data/muniByProvince.json` 생성.
- `render.js` — 위 산출물 + `data/sample-byProvince.json`(샘플 데이터)를 `map-template.html`에
  주입해 `brand-map.html`을 만든다.

## 다시 만들기

```bash
node 07-dashboard/prototypes/buildmap.js
node 07-dashboard/prototypes/buildmuni.js
node 07-dashboard/prototypes/render.js
```

`data/provinces.json`, `data/muniByProvince.json`는 빌드 산출물이라 git에 커밋하지 않는다
(`.gitignore` 참고) — 위 스크립트로 다시 만들면 된다.

## data/ 폴더

- `skorea_provinces.json`, `skorea_municipalities.json` — [southkorea/southkorea-maps](https://github.com/southkorea/southkorea-maps)
  (`kostat/2013/json/skorea_provinces_geo_simple.json`, `skorea_municipalities_geo_simple.json`)에서
  받은 실제 행정구역 경계(2013년 KOSTAT 기준). 시도명은 빌드 스크립트가 2026년 현재 파이프라인
  표기(강원특별자치도·전북특별자치도·전남광주통합특별시 등)로 맞춰 매핑한다 —
  `01-collect-specialties/lib/normalize.js`의 `LEGACY_SIDO_ALIASES`와 같은 발상.
- `sample-byProvince.json` — 실제로 ①~④를 15건 샘플로 돌린 결과를 지역(시도)별로 묶은 것.
  새 샘플로 갱신하려면 04-analyze-brand 출력을 지역별로 그룹핑해서 같은 형태로 바꿔주면 된다.

## 다음에 이걸 실제 ⑦로 발전시킨다면

- 지금은 시도 15개 정도의 소량 샘플만 색이 칠해진다 — 실제 ①단계 실키 데이터가 쌓이면 그대로
  확장 가능한 구조지만, 226개 시군구 전체가 채워지면 성능/렌더링 재검토 필요
- "마지막 갱신" 표시는 정적 목업이라 눈속임 애니메이션일 뿐 — 실제 실시간 갱신은
  `artifact-capabilities`류의 라이브 데이터 연동이나 별도 백엔드가 있어야 진짜로 동작한다
- Python + Streamlit으로 갈지, 이 정적 HTML 접근을 그대로 발전시킬지는 아직 미정
  (`../README.md`의 "할 일" 참고)
