import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const snapshotUrl = new URL("../public/data/dashboard-snapshot.json", import.meta.url);

async function loadSnapshot() {
  return JSON.parse(await readFile(snapshotUrl, "utf8"));
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
  assert.match(html, /<title>지역 브랜드 인사이트<\/title>/i);
  assert.match(html, /지역 특산품 상표 분석/);
  assert.match(html, /전체 범위 알파 · 부분 수집/);
  assert.match(html, /데이터 준비 상태/);
  assert.match(html, /수집된 상표 예시/);
  assert.ok(
    html.indexOf('class="map-workspace"') < html.indexOf('class="showcase"'),
    "지도는 상표 예시보다 먼저 보여야 함",
  );
  assert.match(html, new RegExp(snapshot.pipelineStatus.nationwideCandidates.uniqueTrademarkCount.toLocaleString("ko-KR")));
  assert.match(
    html,
    new RegExp(`완료 ${snapshot.pipelineStatus.uniqueQueryCounts.complete} · 부분 ${snapshot.pipelineStatus.uniqueQueryCounts.partial}`),
  );
  assert.match(html, /출원인 주소 확보율/);
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /특화작목 비교/);
  assert.match(html, /데이터 개요/);
  assert.match(html, /2013 KOSTAT/);
  assert.match(
    visibleTextHtml,
    /[가-힣]+(?:시|군|구|광역시|특별시|특별자치시) \/ [가-힣A-Za-z0-9]/,
    "지도 옆 표기는 '지역 / 특산품' 형식이어야 함"
  );
  assert.match(html, /판정 기준과 매칭 방법/, "매칭 기준은 하단 note가 아니라 상시 노출 섹션에 있어야 함");
  assert.match(html, /고시명칭 \+ NICE류/);
  assert.match(html, /출처와 데이터 상태/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("renders tab navigation and a data-connected ranking table", async () => {
  const response = await render();
  const html = await response.text();
  const snapshot = await loadSnapshot();
  assert.match(html, /class="primary-tabs"/, "요약/지자체별/품목별/특화작목/데이터 개요 5개 탭이 있어야 함");
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

test("renders matching criteria prominently, on every tab, not just as bottom-of-page small print", async () => {
  const response = await render();
  const html = await response.text();
  // 판정 기준은 하단 <details>가 아니라 항상 보이는 섹션이어야 한다(2026-08-11 피드백:
  // "작은글씨는 아니면 위에 잘 넣을수있으면 넣고"). tab 조건문 밖에 있어야 모든 탭에서 보인다.
  assert.match(html, /class="criteria"/);
  assert.match(html, /판정 기준과 매칭 방법/);
  assert.match(html, /GI 출처 또는 상표 출원 3건 이상/, "#29 대표 특산품 기준이 명시돼야 함");
  assert.match(html, /고시상품명칭 정확 일치/, "품목 매칭 기준이 명시돼야 함");
  assert.match(html, /법정동코드 완전일치/, "지역 매칭 기준이 명시돼야 함");
  assert.match(html, /기본 100% 완료 · 알파는 임계값 명시/, "출원인 지역 매칭 차단 기준이 명시돼야 함");
});

test("ships a valid dashboard snapshot", async () => {
  const snapshot = await loadSnapshot();
  assert.equal(snapshot.schemaVersion, "dashboard-snapshot-v1");
  assert.equal(snapshot.mode, "full");
  assert.equal(snapshot.pipelineStatus.stage, "alpha");
  assert.equal(snapshot.pipelineStatus.uniqueQueryCounts.total, 861);
  assert.equal(snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount, 481);
  assert.equal(snapshot.pipelineStatus.collectionExperiment.outputShape, "query_facts_with_region_row_references");
  assert.equal(snapshot.pipelineStatus.applicantRegionVerification.verifiedCount, 43384);
  assert.equal(snapshot.pipelineStatus.regionalMetricGate.coverageThreshold, 0.6);
  assert.ok(snapshot.regions.length > 0);
  assert.ok(snapshot.sources.some((source) => source.sourceId === "kipris_trademark"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "nongsaro"));
  const items = snapshot.regions.flatMap((region) => region.items);
  assert.ok(items.every((item) => item.itemName && item.noticeName));
  // 검토대기(고시명칭 미확정) 행을 원물명으로 검색한 결과는 matchingBasis=
  // raw_item_name_unclassified이고 niceClass가 없는 게 정상이다(2026-08-12) — 공식
  // 분류 행만 niceClass가 있어야 한다.
  assert.ok(
    items.every((item) =>
      item.matchingBasis === "notice_name_and_nice_class"
        ? Boolean(item.niceClass)
        : item.matchingBasis === "raw_item_name_unclassified"
    )
  );
  assert.ok(items.some((item) => item.matchingBasis === "notice_name_and_nice_class"));
  assert.ok(items.some((item) => item.matchingBasis === "raw_item_name_unclassified"));
  assert.ok(items.every((item) => !["데일리", "일선정품", "상큼愛"].includes(item.itemName)));
  assert.ok(items.some((item) => item.trademarkExamples?.some((example) => example.title)));
  const availableItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
  const blockedItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "blocked");
  assert.equal(availableItems.length, 481, "60% 알파 임계값을 통과한 지역×품목 수를 유지해야 함");
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
  assert.match(html, /<title>지역 브랜드 인사이트<\/title>/);
  assert.match(html, /dashboard-snapshot-v1/);
  assert.match(html, /dashboard-map-geometry-v1/);
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.match(html, /특화작목 비교/);
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
