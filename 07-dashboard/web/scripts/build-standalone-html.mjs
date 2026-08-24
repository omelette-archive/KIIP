import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const inputUrl = process.argv[2]
  ? pathToFileURL(path.resolve(process.argv[2]))
  : new URL("../public/data/dashboard-snapshot.json", import.meta.url);
const outputUrl = process.argv[3]
  ? pathToFileURL(path.resolve(process.argv[3]))
  : new URL("../../dashboard.html", import.meta.url);
const [snapshotText, geometryText, registrationExamplesText, cssText, client, logoMarkBuffer, logoLockupBuffer] = await Promise.all([
  readFile(inputUrl, "utf8"),
  readFile(new URL("../public/data/map-geometry.json", import.meta.url), "utf8"),
  readFile(new URL("../public/data/verified-registration-examples.json", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("./standalone-client.js", import.meta.url), "utf8"),
  readFile(new URL("../public/images/kiip-logo-mark.png", import.meta.url)),
  readFile(new URL("../public/images/kiip-logo-lockup.png", import.meta.url)),
]);
const logoMarkDataUri = `data:image/png;base64,${logoMarkBuffer.toString("base64")}`;
const logoLockupDataUri = `data:image/png;base64,${logoLockupBuffer.toString("base64")}`;
const snapshot = JSON.parse(snapshotText);
const geometry = JSON.parse(geometryText);
const registrationExamples = JSON.parse(registrationExamplesText);
if (snapshot.schemaVersion !== "dashboard-snapshot-v1") {
  throw new Error(`지원하지 않는 스냅샷 계약: ${snapshot.schemaVersion}`);
}
const data = JSON.stringify(snapshot).replaceAll("<", "\\u003c");
const mapData = JSON.stringify(geometry).replaceAll("<", "\\u003c");
const registrationData = JSON.stringify(registrationExamples).replaceAll("<", "\\u003c");
const css = cssText.replace(/^@import\s+"tailwindcss";\s*/u, "");
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="지역 특산품의 상표 출원·등록 현황을 지역과 품목별로 제공하는 KIIP 대시보드"><title>지역 특산물 상표 출원 분석</title><style>${css}</style></head>
<body><main class="shell"><header class="topbar" id="top"><button class="brand brand-button" id="brand-home" type="button" aria-label="지역 특산물 상표 출원 분석 홈"><img class="brand-mark" src="${logoMarkDataUri}" alt="KIIP" width="36" height="24"><span><strong>지역 특산물 상표 출원 분석</strong><small>지역 특산품 상표 출원 현황</small></span></button><div class="snapshot-meta"><span class="sample-badge" id="scope-label"></span><span id="generated"></span></div></header><nav class="primary-tabs" id="primary-tabs" aria-label="대시보드 화면"></nav><div id="app"></div><footer><div class="footer-brand"><img class="footer-logo" src="${logoLockupDataUri}" alt="한국지식재산연구원 Korea Institute of Intellectual Property" height="26"><span>지역 특산품 상표 출원 현황</span></div><span id="snapshot-id"></span></footer></main>
<script>${client}\ndashboardClient(${data},${mapData},${registrationData});</script></body></html>`;
await writeFile(outputUrl, html, "utf8");
console.log(`standalone dashboard -> ${fileURLToPath(outputUrl)}`);
