#!/usr/bin/env node
import fs from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("사용법: node scripts/review-enrichment-output.mjs <enriched-result.json>");
  process.exit(1);
}

const document = JSON.parse(fs.readFileSync(input, "utf8"));
const queryFacts = document.storageMode === "query_facts" && document.queryFacts
  ? Object.values(document.queryFacts)
  : [];
const entries = queryFacts.length > 0 ? queryFacts : (document.results || []);
const hits = entries.flatMap((entry) => entry.hits || []);
const count = (values) => values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
const applicant = count(hits.map((hit) => hit.applicantRegionMatch || "unverified"));
const goods = count(hits.map((hit) => hit.goodsMatchMethod || "unverified"));
const registry = count(hits.map((hit) => hit.ipRegistryStatus || "not_collected"));
const rows = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
const summary = {
  input,
  storageMode: document.storageMode || "results",
  queryCount: document.queryFacts ? Object.keys(document.queryFacts).length : (document.results || []).length,
  hitCount: hits.length,
  registryStatus: document.ipRegistryEnrichment?.status || "not_recorded",
  registryCounts: document.ipRegistryEnrichment?.counts || {},
  applicantRegionMatch: rows(applicant),
  goodsMatchMethod: rows(goods),
  ipRegistryStatus: rows(registry),
  warnings: [],
};
if (summary.storageMode === "query_facts" && queryFacts.length === 0) {
  summary.warnings.push("storageMode=query_facts인데 queryFacts가 비어 있습니다.");
}
if (hits.length > 0 && !hits.some((hit) => hit.ipRegistryStatus === "complete")) {
  summary.warnings.push("등록원부 complete hit가 없습니다. 캐시·호출 예산·등록번호를 확인하세요.");
}
if (hits.length > 0 && !hits.some((hit) => ["normalized_exact", "normalized_contains", "class_only"].includes(hit.goodsMatchMethod))) {
  summary.warnings.push("지정상품 매칭 결과가 없습니다. 등록원부 보강이 실제 hit에 적용됐는지 확인하세요.");
}
console.log(JSON.stringify(summary, null, 2));
