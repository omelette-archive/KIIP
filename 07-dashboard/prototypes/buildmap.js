const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "data");
const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "skorea_provinces.json"), "utf8"));

const W = 720, H = 860, PAD = 10;
let minLng=999,maxLng=-999,minLat=999,maxLat=-999;
for (const f of raw.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) for (const [lng,lat] of ring) {
    if (lng<minLng) minLng=lng; if (lng>maxLng) maxLng=lng;
    if (lat<minLat) minLat=lat; if (lat>maxLat) maxLat=lat;
  }
}
const centerLat = (minLat+maxLat)/2;
const lngScale = Math.cos(centerLat * Math.PI/180);
const spanX = (maxLng-minLng)*lngScale;
const spanY = (maxLat-minLat);
const scale = Math.min((W-2*PAD)/spanX, (H-2*PAD)/spanY);
const offX = PAD + ((W-2*PAD) - spanX*scale)/2;
const offY = PAD + ((H-2*PAD) - spanY*scale)/2;

function project([lng, lat]) {
  const x = offX + (lng - minLng) * lngScale * scale;
  const y = offY + (maxLat - lat) * scale; // flip Y (north up)
  return [Math.round(x*10)/10, Math.round(y*10)/10];
}

function ringToPath(ring) {
  return ring.map((pt, i) => (i === 0 ? "M" : "L") + project(pt).join(",")).join(" ") + " Z";
}

// 2013 GeoJSON 명칭 -> 현재(2026) 파이프라인이 쓰는 시도명. 전라남도+광주광역시는
// 현재 admin master에서 "전남광주통합특별시" 하나로 통합돼 있어 두 폴리곤을 같은
// provinceKey로 묶는다(01-collect-specialties/lib/normalize.js의 LEGACY_SIDO_ALIASES와
// 같은 발상).
const NAME_MAP = {
  "서울특별시": "서울특별시",
  "부산광역시": "부산광역시",
  "대구광역시": "대구광역시",
  "인천광역시": "인천광역시",
  "광주광역시": "전남광주통합특별시",
  "대전광역시": "대전광역시",
  "울산광역시": "울산광역시",
  "세종특별자치시": "세종특별자치시",
  "경기도": "경기도",
  "강원도": "강원특별자치도",
  "충청북도": "충청북도",
  "충청남도": "충청남도",
  "전라북도": "전북특별자치도",
  "전라남도": "전남광주통합특별시",
  "경상북도": "경상북도",
  "경상남도": "경상남도",
  "제주특별자치도": "제주특별자치도",
};

const byProvince = new Map();
for (const f of raw.features) {
  const oldName = f.properties.name;
  const key = NAME_MAP[oldName] || oldName;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const dParts = [];
  const allPts = [];
  for (const poly of polys) {
    // 외곽 링만 사용(구멍/섬 내부 링은 이 단순화 지도에서 생략)
    dParts.push(ringToPath(poly[0]));
    for (const pt of poly[0]) allPts.push(project(pt));
  }
  const cx = allPts.reduce((s,p)=>s+p[0],0)/allPts.length;
  const cy = allPts.reduce((s,p)=>s+p[1],0)/allPts.length;
  if (!byProvince.has(key)) byProvince.set(key, { paths: [], cx: 0, cy: 0, n: 0 });
  const entry = byProvince.get(key);
  entry.paths.push(dParts.join(" "));
  entry.cx += cx; entry.cy += cy; entry.n++;
}

const provinces = [...byProvince.entries()].map(([name, e]) => ({
  name,
  d: e.paths.join(" "),
  labelX: Math.round((e.cx / e.n) * 10) / 10,
  labelY: Math.round((e.cy / e.n) * 10) / 10,
}));

fs.writeFileSync(
  path.join(DATA_DIR, "provinces.json"),
  JSON.stringify({ viewBox: `0 0 ${W} ${H}`, provinces }, null, 0),
  "utf8"
);
console.log("provinces:", provinces.length);
console.log(provinces.map(p => p.name));
