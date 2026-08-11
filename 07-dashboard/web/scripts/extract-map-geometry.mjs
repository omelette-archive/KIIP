import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const prototypeUrl = new URL("../../prototypes/brand-map.html", import.meta.url);
const outputUrl = new URL("../public/data/map-geometry.json", import.meta.url);
const html = await readFile(prototypeUrl, "utf8");

function readConstant(name) {
  const match = html.match(new RegExp(`const\\s+${name}\\s*=\\s*([\\s\\S]*?);\\r?\\n`));
  if (!match) throw new Error(`${name} 지도 상수를 찾지 못했습니다.`);
  return JSON.parse(match[1]);
}

const geometry = {
  schemaVersion: "dashboard-map-geometry-v1",
  viewBox: "0 0 720 860",
  boundaryReference: {
    sourceName: "southkorea/southkorea-maps",
    sourceUrl: "https://github.com/southkorea/southkorea-maps",
    sourceBasis: "2013 KOSTAT boundary",
    generatedFrom: "07-dashboard/prototypes/brand-map.html",
    status: "reference_only",
    warning: "현재 행정구역 경계가 아닌 시각화 참고용 경계입니다.",
  },
  provinces: readConstant("PROVINCES").map(({ name, d, labelX, labelY }) => ({ name, d, labelX, labelY })),
  municipalities: readConstant("MUNI"),
};

await writeFile(outputUrl, `${JSON.stringify(geometry)}\n`, "utf8");
console.log(`map geometry -> ${fileURLToPath(outputUrl)}`);
