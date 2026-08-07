const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "data");

const muniRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "skorea_municipalities.json"), "utf8"));

// 2013 GeoJSON 시도 코드 -> 현재(2026) 파이프라인 시도명. 전라남도(36)+광주광역시(24)는
// 현재 admin master에서 "전남광주통합특별시" 하나로 묶여 있어 두 코드를 같은 provinceKey로 합친다.
const CODE_TO_PROVINCE = {
  "11": "서울특별시", "21": "부산광역시", "22": "대구광역시", "23": "인천광역시",
  "24": "전남광주통합특별시", "25": "대전광역시", "26": "울산광역시",
  "29": "세종특별자치시", "31": "경기도", "32": "강원특별자치도",
  "33": "충청북도", "34": "충청남도", "35": "전북특별자치도",
  "36": "전남광주통합특별시", "37": "경상북도", "38": "경상남도", "39": "제주특별자치도",
};

function ringToPath(ring, project) {
  return ring.map((pt, i) => (i === 0 ? "M" : "L") + project(pt).join(",")).join(" ") + " Z";
}

function buildLocalMap(features, W, H, PAD) {
  let minLng=999,maxLng=-999,minLat=999,maxLat=-999;
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const [lng,lat] of poly[0]) {
      if (lng<minLng) minLng=lng; if (lng>maxLng) maxLng=lng;
      if (lat<minLat) minLat=lat; if (lat>maxLat) maxLat=lat;
    }
  }
  const centerLat = (minLat+maxLat)/2;
  const lngScale = Math.cos(centerLat * Math.PI/180);
  const spanX = Math.max((maxLng-minLng)*lngScale, 0.0001);
  const spanY = Math.max((maxLat-minLat), 0.0001);
  const scale = Math.min((W-2*PAD)/spanX, (H-2*PAD)/spanY);
  const offX = PAD + ((W-2*PAD) - spanX*scale)/2;
  const offY = PAD + ((H-2*PAD) - spanY*scale)/2;
  function project([lng, lat]) {
    const x = offX + (lng - minLng) * lngScale * scale;
    const y = offY + (maxLat - lat) * scale;
    return [Math.round(x*10)/10, Math.round(y*10)/10];
  }

  const items = features.map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const dParts = [];
    const allPts = [];
    for (const poly of polys) {
      dParts.push(ringToPath(poly[0], project));
      for (const pt of poly[0]) allPts.push(project(pt));
    }
    const cx = allPts.reduce((s,p)=>s+p[0],0)/allPts.length;
    const cy = allPts.reduce((s,p)=>s+p[1],0)/allPts.length;
    return {
      name: f.properties.name,
      code: f.properties.code,
      d: dParts.join(" "),
      labelX: Math.round(cx*10)/10,
      labelY: Math.round(cy*10)/10,
    };
  });
  return { viewBox: `0 0 ${W} ${H}`, items };
}

const byProvinceKey = new Map();
for (const f of muniRaw.features) {
  const provCode = f.properties.code.slice(0, 2);
  const key = CODE_TO_PROVINCE[provCode];
  if (!key) continue;
  if (!byProvinceKey.has(key)) byProvinceKey.set(key, []);
  byProvinceKey.get(key).push(f);
}

const result = {};
for (const [key, features] of byProvinceKey) {
  result[key] = buildLocalMap(features, 640, 640, 14);
}

fs.writeFileSync(path.join(DATA_DIR, "muniByProvince.json"), JSON.stringify(result), "utf8");
console.log("provinces with muni maps:", Object.keys(result).length);
for (const [k, v] of Object.entries(result)) console.log(" ", k, "->", v.items.length, "군구");
