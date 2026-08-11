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
  const visibleTextHtml = html.replace(/<!--.*?-->/gs, "");
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>지역 브랜드 인사이트<\/title>/i);
  assert.match(html, /지역 특산품의 상표 공백/);
  assert.match(html, /샘플 데이터/);
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /특화작목 비교/);
  assert.match(html, /2013 KOSTAT/);
  assert.match(visibleTextHtml, /영양군 \/ (사과|배|포도)/, "지도 옆 표기는 '지역 / 특산품' 형식이어야 함");
  assert.match(html, /판정 기준과 매칭 방법/, "매칭 기준은 하단 note가 아니라 상시 노출 섹션에 있어야 함");
  assert.match(html, /고시명칭 \+ NICE류/);
  assert.match(html, /출처와 데이터 상태/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("renders tab navigation and a data-connected ranking table", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /class="primary-tabs"/, "요약/지자체별/품목별/특화작목 4개 탭이 있어야 함");
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /class="ranking-table"/, "레퍼런스의 등록상표 랭킹 TOP 10/50에 대응하는 테이블");
  // 품목명은 고시명칭 정제를 거친 대표 특산품이어야 한다(2026-08-11 확정) — 예전 샘플은
  // buildAreaBrandValidationInput.js의 브랜드명("데일리")을 그대로 썼는데, 이는 지역브랜드
  // 조인 검증용일 뿐 대표 특산품이 아니다. registeredTrademarkCount 내림차순 정렬이 실제로
  // 동작하는지도 값으로 확인한다(포도 / 고시명칭 신선한 포도, 등록 14건이 1위).
  const tbodyIndex = html.indexOf("<tbody>");
  const firstRow = html.slice(tbodyIndex, html.indexOf("</tr>", tbodyIndex)).replace(/<!--.*?-->/gs, "");
  assert.match(firstRow, />1<\/td>/, "1위 순번이 실제로 매겨져야 함");
  assert.match(firstRow, />(사과|배|포도|토마토)</, "주 라벨은 브랜드명·고시명칭이 아니라 대표 특산품명이어야 함");
  assert.match(firstRow, /신선한 (사과|배|포도|토마토)/, "고시명칭은 집계 근거로 병기해야 함");
  assert.doesNotMatch(html, /데일리|일선정품|상큼愛/, "고시명칭 미정제 브랜드명이 품목으로 남아있으면 안 됨");
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
  assert.match(html, /등록원부 실시간 조회/, "출원인 지역 매칭 기준이 명시돼야 함");
});

test("ships a valid dashboard snapshot", async () => {
  const raw = await readFile(new URL("../public/data/dashboard-snapshot.json", import.meta.url), "utf8");
  const snapshot = JSON.parse(raw);
  assert.equal(snapshot.schemaVersion, "dashboard-snapshot-v1");
  assert.equal(snapshot.mode, "sample");
  assert.ok(snapshot.regions.length > 0);
  assert.ok(snapshot.sources.some((source) => source.sourceId === "kipris_trademark"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "nongsaro"));
  const items = snapshot.regions.flatMap((region) => region.items);
  assert.ok(items.every((item) => item.itemName && item.noticeName && item.niceClass));
  assert.ok(items.every((item) => item.matchingBasis === "notice_name_and_nice_class"));
  assert.ok(items.some((item) => item.itemName === "사과" && item.noticeName === "신선한 사과"));
  assert.ok(items.every((item) => !["데일리", "일선정품", "상큼愛"].includes(item.itemName)));
  assert.ok(items.some((item) => item.trademarkExamples?.some((example) => example.title)));
  assert.ok(items.some((item) => item.trademarkExamples?.some((example) => example.goodsMatchMethod === "normalized_exact")));
  assert.ok(snapshot.warnings.some((warning) => warning.includes("전국 모집단")));
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
  assert.doesNotMatch(html, /<script\s+src=|<link\s+[^>]*href=/);
  // 단일 HTML은 클라이언트가 지도·탭·랭킹·판정 기준을 같은 데이터로 렌더링한다.
  assert.match(html, /primary-tabs/);
  assert.match(html, /ranking-table/);
  assert.match(html, /class="criteria"/, "판정 기준 섹션이 단독 HTML에도 동일하게 있어야 함");
  assert.match(html, /dashboardClient\(/);
});
