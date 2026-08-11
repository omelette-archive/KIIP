import fs from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv[2] || "../output/area-brand-ip-registry-dashboard.json");
const output = path.resolve("public/data/dashboard-snapshot.json");
const snapshot = JSON.parse(fs.readFileSync(input, "utf8").replace(/^\uFEFF/, ""));

if (snapshot.schemaVersion !== "dashboard-snapshot-v1" || !Array.isArray(snapshot.regions)) {
  throw new Error("dashboard-snapshot-v1 입력이 아닙니다.");
}
if (snapshot.mode !== "sample" && snapshot.mode !== "full") {
  throw new Error("snapshot.mode는 sample 또는 full이어야 합니다.");
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`[sync-snapshot] ${snapshot.snapshotId} -> ${output}`);
