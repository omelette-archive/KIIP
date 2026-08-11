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
  // 안성 배 계열이 아니라 실제 샘플(경상북도 데일리, 등록 8건)이 1위로 정렬돼야 함 —
  // registeredTrademarkCount 내림차순 정렬이 실제로 동작하는지 값으로 확인한다.
  const tbodyIndex = html.indexOf("<tbody>");
  const firstRow = html.slice(tbodyIndex, html.indexOf("</tr>", tbodyIndex));
  assert.match(firstRow, />1<\/td>/, "1위 순번이 실제로 매겨져야 함");
  assert.match(firstRow, /데일리/, "등록상표 건수가 가장 많은 행이 1위여야 함(경상북도 데일리, 8건)");
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
  assert.match(html, /dashboardClient\(/);
});
