const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "data");

const { viewBox, provinces } = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "provinces.json"), "utf8"));
const byProvince = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sample-byProvince.json"), "utf8"));
const muniByProvince = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "muniByProvince.json"), "utf8"));

const dataMap = new Map(byProvince.map((p) => [p.sido, p]));

function stripSuffix(name) {
  return name.replace(/(시|군|구)$/, "");
}

function bucketClass(v, maxV) {
  if (v === null) return "nodata";
  const ratio = v / maxV;
  if (ratio > 0.8) return "seq-500";
  if (ratio > 0.55) return "seq-400";
  if (ratio > 0.3) return "seq-300";
  if (ratio > 0.05) return "seq-200";
  return "seq-100";
}

// ---- 시도 레벨 ----
function provinceTotalUnique(sido) {
  const entry = dataMap.get(sido);
  if (!entry) return null;
  const searched = entry.items.filter((it) => it.searched);
  if (searched.length === 0) return null;
  return searched.reduce((s, it) => s + it.unique, 0);
}

const provinceValues = provinces.map((p) => provinceTotalUnique(p.name)).filter((v) => v !== null);
const provinceMaxV = Math.max(...provinceValues);

const provincesOut = provinces.map((p) => {
  const v = provinceTotalUnique(p.name);
  return { name: p.name, d: p.d, labelX: p.labelX, labelY: p.labelY, bucket: bucketClass(v, provinceMaxV), value: v };
});

// ---- 시군구 레벨 (시도별) ----
function muniTotalUnique(sido, muniName) {
  const entry = dataMap.get(sido);
  if (!entry) return null;
  const key = stripSuffix(muniName);
  const searched = entry.items.filter((it) => it.sigungu === key && it.searched);
  if (searched.length === 0) return null;
  return searched.reduce((s, it) => s + it.unique, 0);
}

const muniOut = {};
for (const [province, map] of Object.entries(muniByProvince)) {
  const values = map.items.map((it) => muniTotalUnique(province, it.name)).filter((v) => v !== null);
  const maxV = values.length ? Math.max(...values) : 1;
  muniOut[province] = {
    viewBox: map.viewBox,
    items: map.items.map((it) => {
      const v = muniTotalUnique(province, it.name);
      return { name: it.name, d: it.d, labelX: it.labelX, labelY: it.labelY, bucket: bucketClass(v, maxV), value: v, sigunguKey: stripSuffix(it.name) };
    }),
  };
}

const dataJs = {};
for (const p of byProvince) dataJs[p.sido] = p;

let html = fs.readFileSync(path.join(__dirname, "map-template.html"), "utf8");
html = html.replace("__VIEWBOX__", viewBox);
html = html.replace("__PROVINCES__", JSON.stringify(provincesOut));
html = html.replace("__MUNI__", JSON.stringify(muniOut));
html = html.replace("__DATA__", JSON.stringify(dataJs));

fs.writeFileSync(path.join(__dirname, "brand-map.html"), html, "utf8");
console.log("written. provinceMaxV=", provinceMaxV, "provinces=", provincesOut.length, "muni provinces=", Object.keys(muniOut).length);
