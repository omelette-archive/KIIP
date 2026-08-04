#!/usr/bin/env node
/**
 * data/*.json 을 dashboard/template.html 에 주입해 dashboard/index.html(자체완결형)을 생성한다.
 * 실제 데이터로 교체하려면 data/sample_trademark_data.json 을 동일한 컬럼 구조로 바꾸고
 * 이 스크립트를 다시 실행하면 된다.
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataPath = path.join(root, "data", "sample_trademark_data.json");
const templatePath = path.join(root, "dashboard", "template.html");
const outPath = path.join(root, "dashboard", "index.html");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const template = fs.readFileSync(templatePath, "utf8");

const regionCount = new Set(data.map((d) => `${d.sido}|${d.sigungu}`)).size;
const generatedAt = new Date().toISOString().slice(0, 10);

const output = template
  .replace("__DATA_JSON__", JSON.stringify(data))
  .replace("__GENERATED_AT__", generatedAt)
  .replace("__ROW_COUNT__", String(data.length))
  .replace("__REGION_COUNT__", String(regionCount));

fs.writeFileSync(outPath, output, "utf8");
console.log(`Built dashboard/index.html (${data.length} rows, ${regionCount} regions)`);
