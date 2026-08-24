// 이슈 #80/#113: 기존 map-geometry.json은 southkorea/southkorea-maps의 2013년 KOSTAT
// 경계(07-dashboard/prototypes/의 buildmap.js/buildmuni.js → extract-map-geometry.mjs
// 경로)를 참고용으로 썼다. 군위군이 2023-07-01 경북에서 대구로 편입됐지만 그 경계는
// 여전히 경북 아래 그려져, 실제 행정구역 데이터(법정동코드, 2023-06-30 반영)와 지도
// 도형이 어긋나는 문제가 있었다(#113에서 발견 — 클릭 시 지역을 못 찾는 기능 버그로도
// 나타났음).
//
// vuski/admdongkor(https://github.com/vuski/admdongkor)는 통계청 SGIS 경계를 바탕으로
// 행정구역 변경 이력을 반영해 지속 갱신하는 오픈소스 저장소다. 데이터는
// CC BY 4.0(원 출처 SGIS는 KOGL 1유형) — 출처 표기 조건으로 재배포 가능. 시군구(sgg)/
// 시도(sido) "light"(단순화) 버전을 시점별로 제공하며, 각 sgg 행에 이미 소속 시도명
// (sidonm)이 붙어 있어 이 프로젝트가 쓰는 "전남광주통합특별시" 같은 통합 표기와도
// 이름이 그대로 맞는다(2013 KOSTAT 원본처럼 시도 코드→명칭 별도 매핑표가 필요 없음).
//
// 재현성을 위해 버전을 고정한다 — "최신"으로 매번 흘러가지 않고, 갱신하려면 아래
// SOURCE_VERSION을 의도적으로 바꾸고 이 주석의 검증 날짜도 함께 갱신한다.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as adk from "admdongkor";

const SOURCE_VERSION = "20260701"; // 2026-08-24 확인 시점 최신 시점(adk.versions(2026) 마지막 값)
const outputUrl = new URL("../public/data/map-geometry.json", import.meta.url);

function ringToPath(ring, project) {
  return ring.map((pt, i) => (i === 0 ? "M" : "L") + project(pt).join(",")).join(" ") + " Z";
}

function boundsOf(features) {
  let minLng = 999, maxLng = -999, minLat = 999, maxLat = -999;
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const [lng, lat] of poly[0]) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, maxLng, minLat, maxLat };
}

// 2013 KOSTAT 파이프라인(buildmap.js/buildmuni.js)과 동일한 투영: 위도 중심으로 경도를
// cos(lat) 축소한 뒤 박스에 맞춰 스케일 — 시각적으로 이전 지도와 같은 방식이라 UI 쪽
// 좌표 처리(라벨 오프셋 등)를 그대로 재사용할 수 있다.
function makeProjector(bounds, W, H, PAD) {
  const { minLng, maxLng, minLat, maxLat } = bounds;
  const centerLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((centerLat * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * lngScale, 0.0001);
  const spanY = Math.max(maxLat - minLat, 0.0001);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = PAD + ((W - 2 * PAD) - spanX * scale) / 2;
  const offY = PAD + ((H - 2 * PAD) - spanY * scale) / 2;
  return ([lng, lat]) => {
    const x = offX + (lng - minLng) * lngScale * scale;
    const y = offY + (maxLat - lat) * scale; // flip Y (north up)
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };
}

function buildProvinces(sidoFeatures) {
  const W = 720, H = 860, PAD = 10;
  const byName = new Map();
  for (const f of sidoFeatures) {
    const name = f.properties.sidonm;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }
  const allFeatures = sidoFeatures;
  const project = makeProjector(boundsOf(allFeatures), W, H, PAD);
  const provinces = [...byName.entries()].map(([name, feats]) => {
    const dParts = [];
    const allPts = [];
    for (const f of feats) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        dParts.push(ringToPath(poly[0], project));
        for (const pt of poly[0]) allPts.push(project(pt));
      }
    }
    const cx = allPts.reduce((s, p) => s + p[0], 0) / allPts.length;
    const cy = allPts.reduce((s, p) => s + p[1], 0) / allPts.length;
    return { name, d: dParts.join(" "), labelX: Math.round(cx * 10) / 10, labelY: Math.round(cy * 10) / 10 };
  });
  return { viewBox: `0 0 ${W} ${H}`, provinces };
}

// 고양시덕양구/고양시일산동구/고양시일산서구처럼 시가 구로 세분화된 sgg 이름은
// "OO시OO구"로 이어져 있다(공백 없음). 이 대시보드의 실제 지역 데이터(농사로 기반)는
// 이런 대도시를 구 단위로 세분화하지 않고 "고양시" 하나로만 갖고 있어(기존에 이미
// 알려진 5개 광역시·7개 인구도시 구/군 세분화 불가 한계와 같은 종류), 구 단위 도형을
// 그대로 두면 실제 데이터와 매칭되는 shape가 하나도 없어진다. 시 이름으로 다시 묶어
// 준다(전남광주통합특별시를 이름으로 묶는 것과 같은 방식).
function parentCityName(sggName) {
  const match = sggName.match(/^(.+시)(.+구)$/);
  return match ? match[1] : null;
}

function buildMunicipalities(sggFeatures) {
  const W = 640, H = 640, PAD = 14;
  const byProvince = new Map();
  for (const f of sggFeatures) {
    const key = f.properties.sidonm;
    if (!byProvince.has(key)) byProvince.set(key, []);
    byProvince.get(key).push(f);
  }
  const result = {};
  for (const [key, feats] of byProvince) {
    const project = makeProjector(boundsOf(feats), W, H, PAD);
    const byName = new Map();
    for (const f of feats) {
      const name = parentCityName(f.properties.sggnm) || f.properties.sggnm;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(f);
    }
    const items = [...byName.entries()].map(([name, group]) => {
      const dParts = [];
      const allPts = [];
      for (const f of group) {
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) {
          dParts.push(ringToPath(poly[0], project));
          for (const pt of poly[0]) allPts.push(project(pt));
        }
      }
      const cx = allPts.reduce((s, p) => s + p[0], 0) / allPts.length;
      const cy = allPts.reduce((s, p) => s + p[1], 0) / allPts.length;
      return {
        name,
        code: group.length === 1 ? group[0].properties.sggcd : group.map((f) => f.properties.sggcd).join(","),
        d: dParts.join(" "),
        labelX: Math.round(cx * 10) / 10,
        labelY: Math.round(cy * 10) / 10,
      };
    });
    result[key] = { viewBox: `0 0 ${W} ${H}`, items };
  }
  return result;
}

const [sidoGeo, sggGeo] = await Promise.all([adk.get(SOURCE_VERSION, "sido"), adk.get(SOURCE_VERSION, "sgg")]);
const { viewBox, provinces } = buildProvinces(sidoGeo.features);
const municipalities = buildMunicipalities(sggGeo.features);

const geometry = {
  schemaVersion: "dashboard-map-geometry-v1",
  viewBox,
  boundaryReference: {
    sourceName: "vuski/admdongkor (통계청 SGIS 경계 기반)",
    sourceUrl: "https://github.com/vuski/admdongkor",
    sourceBasis: `${SOURCE_VERSION.slice(0, 4)}-${SOURCE_VERSION.slice(4, 6)}-${SOURCE_VERSION.slice(6, 8)} 기준 행정구역 경계 (CC BY 4.0, 원출처 통계청 SGIS·KOGL 1유형)`,
    generatedFrom: "07-dashboard/web/scripts/build-map-geometry.mjs",
    status: "reference_only",
    warning: "제3자가 재배포하는 경계 데이터입니다 — 정밀 측량 경계가 아닌 시각화 참고용입니다.",
  },
  provinces,
  municipalities,
};

await writeFile(outputUrl, `${JSON.stringify(geometry)}\n`, "utf8");
console.log(`map geometry (${SOURCE_VERSION}) -> ${fileURLToPath(outputUrl)}`);
console.log(`provinces: ${provinces.length}, municipality groups: ${Object.keys(municipalities).length}, total shapes: ${Object.values(municipalities).reduce((s, m) => s + m.items.length, 0)}`);
