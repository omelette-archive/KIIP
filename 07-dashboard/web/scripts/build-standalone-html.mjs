import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const inputUrl = new URL("../public/data/dashboard-snapshot.json", import.meta.url);
const outputUrl = new URL("../../dashboard.html", import.meta.url);
const [snapshotText, css, client] = await Promise.all([
  readFile(inputUrl, "utf8"),
  readFile(new URL("./standalone.css", import.meta.url), "utf8"),
  readFile(new URL("./standalone-client.js", import.meta.url), "utf8"),
]);
const snapshot = JSON.parse(snapshotText);
if (snapshot.schemaVersion !== "dashboard-snapshot-v1") {
  throw new Error(`지원하지 않는 스냅샷 계약: ${snapshot.schemaVersion}`);
}
const data = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="지역 특산품과 상표 근거를 함께 확인하는 KIIP 샘플 대시보드"><title>지역 브랜드 인사이트</title><style>${css}</style></head>
<body><main class="shell"><header><div class="brand"><span class="mark">K</span><span><strong>지역 브랜드 인사이트</strong><small>특산품 × 상표 근거 대시보드</small></span></div><div class="meta"><span class="badge">샘플 데이터</span><span id="generated"></span></div></header>
<section class="hero"><div><p class="eyebrow">LOCAL BRAND OBSERVATORY</p><h1>지역의 특산품과 상표 활용 현황을 근거부터 살펴봅니다</h1><p>수집 상태와 공식 출처를 함께 표시해 지금 판단 가능한 범위를 분명히 구분합니다.</p></div><aside class="note"><span>현재 검증 범위</span><strong id="coverage"></strong><p>소규모 E2E 샘플이며 전국 통계로 해석하면 안 됩니다.</p></aside></section>
<section class="metrics" id="totals"></section><section class="workspace"><aside class="panel"><div class="panel-head"><p class="eyebrow">REGION INDEX</p><h2>지역별 조회</h2><input id="search" class="search" type="search" placeholder="지역 또는 품목 검색" aria-label="지역 또는 품목 검색"></div><div id="regions" class="region-list"></div></aside><section class="panel content" id="detail"></section></section>
<section class="section"><p class="eyebrow">PROVENANCE</p><h2>데이터 출처와 버전</h2><div class="sources" id="sources"></div></section><section class="section"><details class="warnings"><summary id="warning-title"></summary><ul id="warnings"></ul></details></section><footer>서버 없이 단독 실행할 수 있습니다. 데이터 교체 후 <code>npm run build:html</code>로 다시 생성합니다.</footer></main>
<script>${client}\ndashboardClient(${data});</script></body></html>`;
await writeFile(outputUrl, html, "utf8");
console.log(`standalone dashboard -> ${fileURLToPath(outputUrl)}`);
