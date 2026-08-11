import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>지역 브랜드 인사이트<\/title>/i);
  assert.match(html, /지역의 특산품과 상표 활용 현황/);
  assert.match(html, /샘플 데이터/);
  assert.match(html, /출처와 데이터 상태/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("renders tab navigation and a data-connected ranking table (레퍼런스 요약/지자체별/품목별 조회 구조)", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /class="tab-nav"/, "요약/지자체별/품목별 3개 탭 컨테이너가 있어야 함");
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /class="ranking-table"/, "레퍼런스의 등록상표 랭킹 TOP 10/50에 대응하는 테이블");
  // 품목명은 고시명칭 정제를 거친 대표 특산품이어야 한다(2026-08-11 확정) — 예전 샘플은
  // buildAreaBrandValidationInput.js의 브랜드명("데일리")을 그대로 썼는데, 이는 지역브랜드
  // 조인 검증용일 뿐 대표 특산품이 아니다. registeredTrademarkCount 내림차순 정렬이 실제로
  // 동작하는지도 값으로 확인한다(신선한 포도 14건이 1위).
  const tbodyIndex = html.indexOf("<tbody>");
  const firstRow = html.slice(tbodyIndex, html.indexOf("</tr>", tbodyIndex));
  assert.match(firstRow, />1<\/td>/, "1위 순번이 실제로 매겨져야 함");
  assert.match(firstRow, /신선한 포도/, "등록상표 건수가 가장 많은 행이 1위여야 함(경상북도 영양군 신선한 포도, 14건)");
  assert.doesNotMatch(html, /데일리|일선정품|상큼愛/, "고시명칭 미정제 브랜드명이 품목으로 남아있으면 안 됨");
});

test("renders matching criteria prominently and keeps real trademark names alongside the notice-name grouping", async () => {
  const response = await render();
  const html = await response.text();
  // 판정 기준은 하단 <details>가 아니라 항상 보이는 섹션이어야 한다(2026-08-11 피드백:
  // "작은글씨는 아니면 위에 잘 넣을수있으면 넣고").
  assert.match(html, /class="criteria"/);
  assert.match(html, /판정 기준과 매칭 방법/);
  assert.match(html, /GI 출처 또는 상표 출원 3건 이상/, "#29 대표 특산품 기준이 명시돼야 함");
  assert.match(html, /고시상품명칭 정확 일치/, "품목 매칭 기준이 명시돼야 함");
  assert.match(html, /법정동코드 완전일치/, "지역 매칭 기준이 명시돼야 함");

  // 품목(고시명칭)은 그룹핑 기준일 뿐이고, 실제로 어떤 상표명이 출원됐는지는 별도 필드로
  // 보존돼 있어야 한다(2026-08-11 피드백: "핵심은 사과지만 출원 상표명도 보여야").
  const snapshot = JSON.parse(
    await readFile(new URL("../public/data/dashboard-snapshot.json", import.meta.url), "utf8")
  );
  const withTrademarks = snapshot.regions
    .flatMap((region) => region.items)
    .find((item) => Array.isArray(item.recentTrademarks) && item.recentTrademarks.length > 0);
  assert.ok(withTrademarks, "샘플에 최소 1개 품목은 실제 출원 상표명을 보존해야 함");
  assert.ok(withTrademarks.recentTrademarks[0].title, "출원 상표명 텍스트가 있어야 함");
});

test("ships a valid dashboard snapshot", async () => {
  const raw = await readFile(new URL("../public/data/dashboard-snapshot.json", import.meta.url), "utf8");
  const snapshot = JSON.parse(raw);
  assert.equal(snapshot.schemaVersion, "dashboard-snapshot-v1");
  assert.equal(snapshot.mode, "sample");
  assert.ok(snapshot.regions.length > 0);
  assert.ok(snapshot.sources.some((source) => source.sourceId === "ip_registry"));
  assert.ok(snapshot.warnings.some((warning) => warning.includes("전국 모집단")));
});

test("generates a self-contained standalone dashboard", async () => {
  const html = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(html, /<title>지역 브랜드 인사이트<\/title>/);
  assert.match(html, /dashboard-snapshot-v1/);
  assert.doesNotMatch(html, /<script\s+src=|<link\s+[^>]*href=/);
  // 탭·랭킹·품목별 조회는 클라이언트 스크립트가 그려서(SSR 아님) 정적 마크업엔 컨테이너만
  // 있으면 된다 — #totals/#regions/#detail과 같은 기존 패턴을 그대로 따른다.
  assert.match(html, /id="tabs"/);
  assert.match(html, /id="ranking"/);
  assert.match(html, /id="region-view"/);
  assert.match(html, /id="item-view"[^>]*hidden/);
  assert.match(html, /id="criteria"/, "판정 기준 컨테이너가 있어야 함(React판과 동일 기능)");
  assert.match(html, /function trademarkListHtml/, "실제 출원 상표명·지정상품을 그리는 로직이 임베드돼야 함");
  assert.match(html, /dashboardClient\(/);
});
