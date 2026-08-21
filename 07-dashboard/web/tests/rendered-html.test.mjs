import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const snapshotUrl = new URL("../public/data/dashboard-snapshot.json", import.meta.url);

async function loadSnapshot() {
  return JSON.parse(await readFile(snapshotUrl, "utf8"));
}

function specialtyCoverage(snapshot) {
  let total = 0;
  let decided = 0;
  let applied = 0;
  for (const region of snapshot.regions) {
    for (const item of region.items) {
      total += 1;
      if (item.metrics.uniqueTrademarkCount.availability !== "available") continue;
      decided += 1;
      if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) applied += 1;
    }
  }
  // 2026-08-21 사용자 재확인: 분모는 확인 완료 특산품이 아니라 수집된 지역×특산품
  // 전체다 — Dashboard.tsx/standalone-client.js의 specialtyCoverage()와 동일.
  return { total, decided, applied, pending: total - decided, rate: total ? applied / total : null };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the data-connected Korean dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  const snapshot = await loadSnapshot();
  const visibleTextHtml = html.replace(/<!--.*?-->/gs, "");
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>지역 특산물 상표 출원 분석<\/title>/i);
  assert.match(html, /지역 특산품 상표 출원 현황/);
  // 2026-08-19 피드백: "알파테스트라는 말을 제외시키고... 최종본처럼" — 상단 배지·요약 탭
  // 곳곳에 반복 노출하던 "알파 테스트" 문구를 모두 걷어낸다.
  // 같은 이유로 요약 탭의 "데이터 준비 상태"(pipeline-progress) 섹션도 제거했다 —
  // 같은 내용이 데이터 개요 탭에 이미 있고, "다음 개선" 같은 내부 로드맵 문구가 있었다.
  assert.doesNotMatch(html, /알파 테스트/, "알파 테스트 문구가 화면에 노출되면 안 됨(2026-08-19 결정)");
  assert.doesNotMatch(html, /전체 범위 알파|전국 알파|알파 대시보드|ALPHA DATA PREVIEW|ALPHA PIPELINE CHECK/);
  assert.doesNotMatch(html, /class="pipeline-progress"/, "요약 탭에서 데이터 준비 상태 섹션은 제거됨(데이터 개요 탭과 중복)");
  assert.match(html, /수집된 상표 예시/);
  assert.ok(
    html.indexOf('class="map-workspace"') < html.indexOf('class="showcase"'),
    "지도는 상표 예시보다 먼저 보여야 함",
  );
  const mapStart = html.indexOf('<svg class="korea-map"');
  const mapEnd = html.indexOf("</svg>", mapStart);
  const mapHtml = html.slice(mapStart, mapEnd);
  assert.ok(
    mapHtml.lastIndexOf('class="map-shape') < mapHtml.indexOf('class="map-label'),
    "전국 지도 지명은 모든 지역 도형 뒤의 최상위 SVG 레이어에 있어야 함",
  );
  assert.equal((mapHtml.match(/<polyline[^>]+points=/g) || []).length, 2, "전국 지도 연결선은 겹치는 서울·세종 두 곳에만 사용해야 함");
  assert.match(mapHtml, /서울특별시/);
  assert.match(mapHtml, /세종특별자치시/);
  assert.match(mapHtml, /제주특별자치도/);
  assert.match(mapHtml, /전남·광주 통합권역/);
  assert.doesNotMatch(mapHtml, /map-callout-value/, "지도 지명에 현재 지표 값을 이어 붙여 가독성을 해치면 안 됨");
  assert.ok(
    html.indexOf(">특산품 수</button>") < html.indexOf(">상표 건수</button>") &&
    html.indexOf(">상표 건수</button>") < html.indexOf(">출원율</button>") &&
    html.indexOf(">출원율</button>") < html.indexOf(">등록률</button>"),
    "지도 지표는 특산품 수, 상표 건수, 출원율, 등록률 순서여야 함",
  );
  assert.match(html, new RegExp(snapshot.pipelineStatus.nationwideCandidates.uniqueTrademarkCount.toLocaleString("ko-KR")));
  assert.match(html, /출원인 주소 확보율/);
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.match(html, /지역별 출원율/);
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /특화작목 비교/);
  assert.match(html, /데이터 개요/);
  assert.match(html, /2013 KOSTAT/);
  assert.match(html, />특산품 수<\/button>/);
  assert.match(html, />상표 건수<\/button>/);
  assert.match(html, />출원율<\/button>/);
  assert.match(html, />등록률<\/button>/);
  assert.match(html, /지역 주소 일치 출원 중 등록 상태인 건의 비율입니다/);
  assert.match(html, /현재 스냅샷에 수집된 지역×특산품 수입니다/);
  // 집계 대기 품목도 전체 1,692개 분모에 포함하며, 확인이 진행되면 값이 올라간다.
  assert.match(html, /아직 지역별 집계가 안 끝난 품목도 전체 분모에 포함하므로/);
  assert.doesNotMatch(html, />수집 범위<|>브랜드 공백|상표 활용 여지|출원인 주소-대상 지역 일치/);
  assert.match(
    visibleTextHtml,
    /[가-힣]+(?:시|군|구|광역시|특별시|특별자치시) \/ [가-힣A-Za-z0-9]/,
    "지도 옆 표기는 '지역 / 특산품' 형식이어야 함"
  );
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps trademark-like raw labels out of the map specialty summary", async () => {
  const response = await render();
  const html = await response.text();
  const insightStart = html.indexOf('class="map-insight"');
  const insightEnd = html.indexOf("</aside>", insightStart);
  const insight = html.slice(insightStart, insightEnd);
  const rankingStart = html.indexOf('class="ranking"');
  const rankingEnd = html.indexOf("</section>", rankingStart);
  const ranking = html.slice(rankingStart, rankingEnd);
  assert.match(insight, /감말랭이/, "the map summary should show a confirmed specialty label");
  assert.doesNotMatch(insight, /마춤 쌀|임금님표/, "raw brand-like or trademark example labels must not be presented as map specialties");
  assert.doesNotMatch(ranking, /마춤 쌀|임금님표/, "raw brand-like or trademark example labels must not be presented as ranked specialties");
  assert.match(html, /class="showcase"/, "trademark names should remain in their separate example section");
});

test("uses every collected region-item specialty as the application-rate denominator", async () => {
  const response = await render();
  const html = await response.text();
  const visibleTextHtml = html.replace(/<!--.*?-->/gs, "");
  const snapshot = await loadSnapshot();
  const coverage = specialtyCoverage(snapshot);
  // 스냅샷의 regionItemCount 1,692개 전부를 분모로 사용한다. 고시명칭 확인 완료분만
  // 사용하던 과거 분모 1,015개로 되돌아가면 안 된다. 현재 출원 확인은 1,012개이며,
  // 지역별 집계가 덜 끝난 75개도 분모에 남아 초기 출원율을 보수적으로 낮춘다.
  assert.equal(coverage.total, snapshot.coverage.regionItemCount);
  assert.equal(coverage.total, 1692);
  assert.equal(coverage.decided, 1617);
  assert.equal(coverage.applied, 1012);
  assert.equal(coverage.pending, 75);
  assert.equal(Math.round(coverage.rate * 100), 60);
  const localeNumber = (n) => n.toLocaleString("ko-KR");
  assert.match(visibleTextHtml, new RegExp(`수집 특산품 전체 ${localeNumber(coverage.total)}개 중 ${localeNumber(coverage.applied)}개 출원 확인 · 지역별 집계 완료 ${localeNumber(coverage.decided)}개 · 집계 대기 ${localeNumber(coverage.pending)}개`));
  // 2026-08-21: "출원율 계산" 설명 박스는 요약 탭에서 제거했다(사용자 요청 — 데이터
  // 개요 탭에 같은 내용이 있어 중복). 요약 탭에는 더 이상 노출되지 않아야 한다.
  assert.doesNotMatch(html, /출원율 계산/);
  assert.doesNotMatch(html, /확인 특산품 전체 1,015개|831 ÷ 1,015|출원율 82%/);
});

test("keeps item totals, registration denominator, and pending states explicit", async () => {
  const snapshot = await loadSnapshot();
  const officialRows = snapshot.regions.flatMap((region) =>
    region.items
      .filter((item) => item.matchingBasis === "notice_name_and_nice_class" && item.niceClass)
      .map((item) => ({ region: region.region, item })),
  );
  const driedPersimmon = officialRows.filter(({ item }) => item.itemName === "감말랭이");
  assert.equal(driedPersimmon.length, 3);
  assert.equal(
    driedPersimmon.reduce((sum, { item }) => sum + item.metrics.uniqueTrademarkCount.value, 0),
    66,
    "감말랭이 66건은 세 지역의 주소 일치 출원 합계여야 함",
  );
  assert.equal(
    driedPersimmon.reduce((sum, { item }) => sum + item.metrics.registeredTrademarkCount.value, 0),
    42,
    "감말랭이 등록 42건은 같은 66건 중 등록 상태 합계여야 함",
  );
  // 2026-08-20: 블루베리(신선한 블루베리·31류)는 이번 재수집 대상(사과 등 183개 쿼리)에
  // 포함돼 partial -> complete로 바뀌었다(전국 검색 329건 -> 1,294건, 지역 판정도 완료).
  // 아직 판정 대기 상태를 보여주는 예시로는 이번 재수집 대상이 아니었던 "벌꿀"을 대신 쓴다.
  const honey = officialRows.filter(({ item }) => item.itemName === "벌꿀");
  assert.ok(honey.length > 0, "벌꿀은 고시명칭·NICE류가 확인된 품목이어야 함");
  assert.ok(honey.every(({ item }) => item.dataState === "partial"));
  assert.ok(honey.every(({ item }) => item.metrics.uniqueTrademarkCount.availability === "blocked"));
  assert.ok(honey.every(({ item }) => item.metrics.nationwideSearchTrademarkCount.value === 213));
});

test("publishes only goods-confirmed regional application gaps", async () => {
  // 2026-08-21 감사: 지역 출원 수 0만으로는 미출원을 단정할 수 없다. 고시명칭 검색
  // 후보에는 유사 품목·상표명이 섞일 수 있으므로, 지정상품 일치 근거와 지역코드가 모두
  // 있는 항목만 "지역 출원 미확인" 목록에 포함한다.
  const snapshot = await loadSnapshot();
  const candidates = snapshot.regions.flatMap((region) => region.items.map((item) => ({ region, item }))).filter(({ region, item }) =>
    Boolean(region.regionCode) &&
    (item.matchingBasis === "notice_name_and_nice_class" || item.matchingBasis === "raw_item_goods_matched") &&
    item.metrics.uniqueTrademarkCount.availability === "available" &&
    (item.metrics.uniqueTrademarkCount.value || 0) === 0
  );
  const hasGoodsEvidence = ({ item }) => item.matchingBasis === "raw_item_goods_matched" ||
    (item.metrics.confirmedGoodsMatchCount.availability === "available" && (item.metrics.confirmedGoodsMatchCount.value || 0) > 0);
  const publishable = candidates.filter(hasGoodsEvidence);
  const excluded = candidates.filter((entry) => !hasGoodsEvidence(entry));
  const pepperCandidates = candidates.filter(({ item }) => item.noticeName?.includes("고추"));
  assert.equal(publishable.length, 0, "현재 스냅샷에는 지정상품 근거까지 충족한 지역 출원 미확인 항목이 없어야 함");
  assert.equal(excluded.length, 86, "지정상품 근거가 없는 0건 후보는 공개 목록에서 제외해야 함");
  assert.ok(pepperCandidates.length > 0, "고추 관련 0건 후보가 실제로 있어야 감사 조건이 유효함");
  assert.ok(pepperCandidates.every((entry) => !hasGoodsEvidence(entry)), "고추 후보를 지정상품 근거 없이 미출원으로 표시하면 안 됨");
});

test("renders tab navigation and a data-connected ranking table", async () => {
  const response = await render();
  const html = await response.text();
  const snapshot = await loadSnapshot();
  assert.match(html, /class="primary-tabs"/, "요약/지역별 출원율/지자체별/품목별/특화작목/데이터 개요 6개 탭이 있어야 함");
  assert.match(html, /지역별 출원율/);
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /class="ranking-table"/, "레퍼런스의 등록상표 랭킹 TOP 10/50에 대응하는 테이블");
  // 품목명은 정규화된 대표 특산품이어야 한다(2026-08-11 확정) — 예전 샘플은
  // buildAreaBrandValidationInput.js의 브랜드명("데일리")을 그대로 썼는데, 이는 지역브랜드
  // 조인 검증용일 뿐 대표 특산품이 아니다. registeredTrademarkCount 내림차순 정렬이 실제로
  // 동작하는지도 확인한다. 단, 지역 귀속이 막힌 스냅샷이면 전국 검색 후보로 억지 순위를
  // 만들지 않고 빈 랭킹을 유지해야 한다(#50).
  const tbodyIndex = html.indexOf("<tbody>");
  const firstRow = html.slice(tbodyIndex, html.indexOf("</tr>", tbodyIndex)).replace(/<!--.*?-->/gs, "");
  const firstRanking = snapshot.regions
    .flatMap((region) => region.items.map((item) => ({ region, item })))
    .filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available")
    .sort(
      (a, b) =>
        (b.item.metrics.registeredTrademarkCount.value || 0) -
        (a.item.metrics.registeredTrademarkCount.value || 0)
    )[0];
  if (firstRanking) {
    assert.match(firstRow, />1<\/td>/, "1위 순번이 실제로 매겨져야 함");
    assert.match(firstRow, new RegExp(`>${escapeRegExp(firstRanking.item.itemName)}<`), "주 라벨은 현재 데이터의 대표 특산품명이어야 함");
    assert.match(firstRow, new RegExp(escapeRegExp(firstRanking.item.noticeName)), "고시명칭은 집계 근거로 병기해야 함");
  } else {
    assert.doesNotMatch(firstRow, />1<\/td>/, "지역 귀속 미검증 전국 후보로 순위를 만들면 안 됨");
    assert.match(html, /검증 중/, "차단된 지역 지표는 0건이 아니라 검증 중으로 표시해야 함");
  }
  // 랭킹 표 자체에 옛 브랜드명이 품목 라벨로 남아있으면 안 된다. html 전체를 검사하면
  // 무관한 실제 원물명에 우연히 같은 글자가 포함된 경우(예: "꿀다림 데일리허니")까지
  // 걸려서 firstRow(랭킹 1위 행)만 검사한다 — line 128의 정확 일치 검사가 전체 스냅샷은
  // 이미 커버한다.
  assert.doesNotMatch(firstRow, /데일리|일선정품|상큼愛/, "랭킹 표에 고시명칭 미정제 브랜드명이 품목으로 남아있으면 안 됨");
});

test("renders matching criteria once, on the data overview tab, not on the summary tab", async () => {
  const response = await render();
  const html = await response.text();
  // 판정 기준은 하단 <details>가 아니라 눈에 띄는 섹션이어야 한다(2026-08-11 피드백: "작은글씨는
  // 아니면 위에 잘 넣을수있으면 넣고"). 2026-08-19 피드백으로 모든 탭에 반복 노출하던 것을 정리해
  // 요약 탭에만 한 번 보이도록 옮겼었는데, 같은 날 "이게 요약에 있을필요는없어보여"라는 후속
  // 피드백으로 데이터 개요 탭으로 다시 옮겼다. SSR 초기 상태는 요약 탭이라 여기서는 없어야 한다.
  assert.doesNotMatch(html, /class="criteria"/, "판정 기준 섹션은 더 이상 요약 탭 SSR 초기 렌더에 없어야 함");

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(standaloneHtml, /data-overview">\$\{criteriaHtml\(\)\}/, "판정 기준 섹션은 데이터 개요 탭에서만 호출돼야 함");
  assert.doesNotMatch(standaloneHtml, /\$\{criteriaHtml\(\)\}<section class="hero"/, "판정 기준 섹션이 요약 탭(hero) 앞에서 호출되면 안 됨");
  assert.match(standaloneHtml, /판정 기준과 매칭 방법/);
  const standaloneClientSource = standaloneHtml.slice(0, standaloneHtml.indexOf("\ndashboardClient("));
  // 2026-08-21 디자인 정리: "GI 출처 또는 상표 출원 3건 이상"은 실제로 어떤 집계·표시
  // 로직에도 쓰이지 않는 죽은 문구였다(gapScore는 타입에만 존재하고 읽히지 않음) —
  // 사용자 요청으로 검토 후 제거했다. 이 자리를 실제로 쓰이는 매칭 기준으로 대체.
  assert.doesNotMatch(standaloneClientSource, /GI 출처 또는 상표 출원 3건 이상/, "실제로 쓰이지 않는 대표 특산품 판정 기준 문구는 노출되면 안 됨");
  assert.match(standaloneHtml, /고시명칭 일치·포함/, "품목 매칭 기준이 명시돼야 함");
  assert.match(standaloneHtml, /법정동코드 완전일치/, "지역 매칭 기준이 명시돼야 함");
  assert.match(standaloneHtml, /주소 확보율은 참고 지표/, "출원인 주소 확보율의 참고 지표 정책이 명시돼야 함");
});

test("ships a valid dashboard snapshot", async () => {
  const snapshot = await loadSnapshot();
  assert.equal(snapshot.schemaVersion, "dashboard-snapshot-v1");
  assert.equal(snapshot.mode, "full");
  assert.equal(snapshot.pipelineStatus.stage, "alpha");
  assert.equal(snapshot.pipelineStatus.uniqueQueryCounts.total, 861);
  // 2026-08-20: 246개 partial 쿼리 중 232개(1라운드 183개 + 2라운드 49개, 사과·포도·
  // 오리 등)를 재수집하면서 지역×품목 표시 가능 건수와 출원인 주소 확인 건수가 함께 늘었다.
  // 이후 원물+지정상품 매칭(212개)이 추가로 일부 항목을 blocked -> available로 바꿔
  // 1,615 -> 1,617이 됐다.
  assert.equal(snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount, 1617);
  assert.equal(snapshot.pipelineStatus.collectionExperiment.outputShape, "query_facts_with_region_row_references");
  assert.equal(snapshot.pipelineStatus.applicantRegionVerification.verifiedCount, 77312);
  assert.equal(snapshot.pipelineStatus.regionalMetricGate.coverageThreshold, 0.6);
  assert.ok(snapshot.regions.length > 0);
  assert.ok(snapshot.sources.some((source) => source.sourceId === "kipris_trademark"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "nongsaro"));
  const items = snapshot.regions.flatMap((region) => region.items);
  assert.ok(items.every((item) => item.itemName && item.noticeName));
  // 검토대기(고시명칭 미확정) 행을 원물명으로 검색한 결과는 matchingBasis=
  // raw_item_name_unclassified이고 niceClass가 없는 게 정상이다(2026-08-12) — 공식
  // 분류 행만 niceClass가 있어야 한다. 2026-08-20: raw_item_goods_matched(원물명 +
  // 등록원부 지정상품 정규화 일치 + 출원인 주소 지역 일치로 AI가 검토·확정한 항목)도
  // 고시명칭 사전 매칭이 아니므로 niceClass는 없는 게 정상이다.
  assert.ok(
    items.every((item) =>
      item.matchingBasis === "notice_name_and_nice_class"
        ? Boolean(item.niceClass)
        : item.matchingBasis === "raw_item_name_unclassified" || item.matchingBasis === "raw_item_goods_matched"
    )
  );
  assert.ok(items.some((item) => item.matchingBasis === "notice_name_and_nice_class"));
  assert.ok(items.some((item) => item.matchingBasis === "raw_item_name_unclassified"));
  assert.ok(items.some((item) => item.matchingBasis === "raw_item_goods_matched"));
  assert.ok(items.every((item) => !["데일리", "일선정품", "상큼愛"].includes(item.itemName)));
  assert.ok(items.some((item) => item.trademarkExamples?.some((example) => example.title)));
  const availableItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
  const blockedItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "blocked");
  assert.equal(availableItems.length, 1617, "수집 완료 지역×품목은 주소 확보율과 무관하게 공개해야 함");
  assert.ok(availableItems.every((item) => Number.isFinite(item.metrics.uniqueTrademarkCount.value)));
  assert.ok(blockedItems.every((item) => item.metrics.uniqueTrademarkCount.value === null), "차단된 지역 건수를 0 또는 전국 검색 건수로 노출하면 안 됨");
  assert.ok(
    items.every((item) => Number.isFinite(item.metrics.nationwideSearchTrademarkCount.value)),
    "전국 검색 후보 건수는 별도 참고 지표로 보존해야 함"
  );
  const confirmedItems = items.filter((item) => Number(item.metrics.confirmedGoodsMatchCount.value) > 0);
  if (confirmedItems.length > 0) {
    assert.ok(
      confirmedItems.some((item) => item.trademarkExamples?.some((example) => example.goodsMatchMethod === "normalized_exact")),
      "지정상품 확정 건수가 있으면 사례 목록에서도 그 근거를 확인할 수 있어야 함"
    );
  }
  assert.ok(snapshot.warnings.some((warning) => warning.includes("완전한 모집단")));
});

test("keeps the region detail item tabs and default item selection scoped to official specialty items", async () => {
  // 2026-08-19 데이터 감사: 고성군 상세 화면의 "특산품 탭"에 특산물·원물이 아닌
  // matchingBasis=raw_item_name_unclassified 원물명·상호(예: "꿀다림 데일리허니",
  // "왕곡한과")가 섞여 나오는 문제가 보고됐다. 탭 목록·기본 선택(chooseRegion/selectedItem)은
  // officialItemLabel이 확정된 항목만 골라야 하고, 공식 특산품이 하나도 없는 지역은 원물로
  // 대체 노출하지 않고 빈 상태를 보여줘야 한다.
  const snapshot = await loadSnapshot();
  const goseong = snapshot.regions.find((region) => region.region.includes("고성군") && region.sido.includes("강원"));
  assert.ok(goseong, "고성군 스냅샷 데이터가 있어야 함");
  const officialGoseongItems = goseong.items.filter((item) => item.matchingBasis === "notice_name_and_nice_class" && item.noticeName);
  const rawGoseongItems = goseong.items.filter((item) => item.matchingBasis === "raw_item_name_unclassified");
  assert.ok(officialGoseongItems.length > 0, "고성군에는 공식 특산품이 있어야 함(빈 상태 분기가 아니라 필터링 분기를 검증하기 위함)");
  assert.ok(
    rawGoseongItems.some((item) => item.itemName === "꿀다림 데일리허니") && rawGoseongItems.some((item) => item.itemName === "왕곡한과"),
    "고성군에는 검토대기 원물명·상호가 실제로 섞여 있어야 이 테스트가 의미가 있음",
  );
  const regionsWithoutOfficialItems = snapshot.regions.filter(
    (region) => !region.items.some((item) => item.matchingBasis === "notice_name_and_nice_class" && item.noticeName),
  );
  assert.ok(regionsWithoutOfficialItems.length > 0, "공식 특산품이 하나도 없는 지역이 실제로 있어야 빈 상태 분기가 의미가 있음");

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(
    standaloneHtml,
    /const officialRegionItems = \(region\) => region\.items\.filter\(\(item\) => officialItemLabel\(item\)\);/,
    "officialRegionItems는 공식 특산품만 반환해야 하고, 원물로 대체(fallback)하면 안 됨",
  );
  assert.doesNotMatch(
    standaloneHtml,
    /officialRegionItems = \(region\) => \{ const official = region\.items\.filter[^}]*return official\.length \? official : region\.items/,
    "공식 특산품이 없다고 원물 전체를 다시 노출하는 예전 fallback 로직이 되살아나면 안 됨",
  );
  assert.match(
    standaloneHtml,
    /<div class="item-tabs">\$\{officialRegionItems\(region\)\.map/,
    "지자체 상세의 특산품 탭은 officialRegionItems로 걸러진 목록만 렌더링해야 함",
  );
  assert.doesNotMatch(
    standaloneHtml,
    /<div class="item-tabs">\$\{region\.items\.map/,
    "특산품 탭이 지역의 전체 원본 items(검토대기 원물 포함)를 그대로 렌더링하면 안 됨",
  );
  assert.match(
    standaloneHtml,
    /function selectedItem\(region\) \{ const official = officialRegionItems\(region\); return official\.find\(\(item\) => item\.specialtyId === state\.itemId\) \|\| official\[0\]; \}/,
    "기본 선택 항목도 officialRegionItems로 걸러진 목록 안에서만 찾아야 하고, state.itemId가 검토대기 원물 id를 가리켜도 원물 상세로 되돌아가면 안 됨",
  );
  assert.match(
    standaloneHtml,
    /고시명칭·NICE류가 확인된 특산품이 없습니다 · 검토대기 원물명·상호 \$\{region\.items\.length\}개/,
    "공식 특산품이 없는 지역은 원물을 대신 보여주지 않고 명시적인 빈 상태를 표시해야 함",
  );
});

test("ships traceable province and municipality geometry", async () => {
  const raw = await readFile(new URL("../public/data/map-geometry.json", import.meta.url), "utf8");
  const geometry = JSON.parse(raw);
  assert.equal(geometry.schemaVersion, "dashboard-map-geometry-v1");
  assert.equal(geometry.boundaryReference.status, "reference_only");
  assert.match(geometry.boundaryReference.sourceUrl, /southkorea-maps/);
  assert.equal(geometry.provinces.length, 16);
  assert.ok(geometry.municipalities["경상북도"].items.some((row) => row.name === "구미시"));
});

test("generates a self-contained standalone dashboard", async () => {
  const html = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(html, /\.map-region-label-callout polyline \{ fill: none;/, "standalone map should include restrained leader lines for the two crowded labels");
  assert.match(html, /const mapLabelMarkup = \(shapes, municipality\)/, "standalone map should render every geometry label regardless of data availability");
  assert.match(html, /서울특별시: \{ x: -52, y: -28 \}, 세종특별자치시: \{ x: -60, y: -31 \}/, "standalone map should limit national callouts to Seoul and Sejong");
  assert.doesNotMatch(html, /const calloutLabels/, "legacy all-label callout layout must not remain in the standalone client");
  assert.match(html, /\$\{shapePaths\}\$\{shapeLabels\}/, "standalone map labels should render after every map shape");
  assert.match(html, /function applicationsScreen\(\)/, "standalone dashboard should ship the separate regional application-rate screen");
  assert.match(html, /전국 시도별 출원율/);
  assert.match(html, /출원 확인 특산품/);
  assert.match(html, /시도를 선택하면 시군구 지도로 전환됩니다/);
  assert.match(html, /region\.sigungu \|\| region\.region} \/ \$\{label}/, "전국 목록은 시군구와 특산품을 함께 나열해야 함");
  assert.doesNotMatch(html, /const uniqueItems/, "도 단위 목록에서 중복 품목을 숨겨 총 특산품 수와 목록 수가 달라지면 안 됨");
  assert.match(html, /bindSearchInput\("#item-search", "itemQuery"\)/, "standalone item search should use the IME-safe input binding");
  assert.match(html, /if \(composing \|\| event\.isComposing\) return;/, "standalone search should not rerender during Korean IME composition");
  assert.match(html, /<title>지역 특산물 상표 출원 분석<\/title>/);
  assert.match(html, /dashboard-snapshot-v1/);
  assert.match(html, /dashboard-map-geometry-v1/);
  assert.match(html, /특산품 수/);
  assert.match(html, /상표 건수/);
  assert.match(html, /출원율/);
  assert.match(html, /등록률/);
  assert.doesNotMatch(html, />수집 범위<|>브랜드 공백|상표 활용 여지/);
  assert.match(html, /지역 확인 출원/);
  assert.match(html, /그중 등록/);
  assert.match(html, /지역별 집계 대기/);
  assert.match(html, /class="item-card-grid"/);
  assert.match(html, /지역 확인 전 전국 검색 후보/);
  assert.match(html, /ITEM_ROW_LIMIT = 100/);
  assert.match(html, /상표 출원 건수 상위/);
  assert.match(html, /class="item-regions-detail"/);
  assert.doesNotMatch(html, /class="item-table-head"|표의 수치 읽는 법/);
  // 2026-08-21 사용자 재확인: 분모는 확인 완료분이 아니라 수집된 지역×특산품 전체다.
  assert.match(html, /지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수/);
  assert.doesNotMatch(html, /if \(!officialItemLabel\(item\)\) return;\s*total \+= 1/);
  assert.doesNotMatch(html, /출원인 주소-대상 지역 일치|두 번째 값은 상표의 유효성 비율이 아닙니다|지역 내 출원 관계|지역 고유 상표|지역 등록 상표|>검증 중</);
  assert.match(html, /article\.querySelector\("span"\).*그중 등록 상태/);
  assert.match(html, /전국 지역 브랜드 지도/);
  // 2026-08-21: "지역 출원 미확인" 탭 — 품목명·지정상품 일치 근거·지역 주소 판정이 모두
  // 갖춰진 항목만 보여준다(사용자 요청 — 브랜드명·미분류 원물명 오염 방지).
  assert.match(html, /지역 출원 미확인/);
  assert.match(html, /function gapsScreen\(\)/);
  assert.match(html, /지정상품 일치/);
  assert.match(html, /id="gap-search"/);
  assert.match(html, /특화작목 비교/);
  assert.match(html, /class="compare-readiness"/);
  assert.match(html, /비교 기준 원본 확보 전 · 준비 현황만 확인 가능/);
  assert.match(html, /지역별 특산품 출원 현황/);
  assert.match(html, /전체 특산품 출원율/);
  assert.doesNotMatch(html, /판정 완료분 출원율/);
  assert.match(html, /전체 \$\{coverage\.total\}개 중 출원 확인 \$\{coverage\.applied\}개/);
  assert.doesNotMatch(html, /\$\{coverage\.applied\}\/\$\{coverage\.decided\}/);
  assert.match(html, /원본 대기/);
  assert.doesNotMatch(html, /class="compare-grid"/);
  assert.match(html, /데이터 개요/);
  assert.match(html, /특산물과 상표가<br>데이터가 되기까지/);
  assert.match(html, /고유 특산품명/);
  assert.match(html, /상표 매칭 결과/);
  assert.doesNotMatch(html, /<script\s+src=|<link\s+[^>]*href=/);
  // 단일 HTML은 클라이언트가 지도·탭·랭킹·판정 기준을 같은 데이터로 렌더링한다.
  assert.match(html, /primary-tabs/);
  assert.match(html, /ranking-table/);
  assert.match(html, /class="criteria"/, "판정 기준 섹션이 단독 HTML에도 동일하게 있어야 함");
  assert.match(html, /dashboardClient\(/);
});
