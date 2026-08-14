#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSite, readSnapshotMetadata } = require("./buildArtifactSite");

const ROOT = path.resolve(__dirname, "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "kiip-artifact-site-"));

try {
  const source = fs.readFileSync(path.join(ROOT, "07-dashboard", "dashboard.html"), "utf8");
  const result = buildSite({ output, limit: 3 });
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));

  assert.deepStrictEqual(result.metadata, readSnapshotMetadata(source));
  assert.strictEqual(fs.readFileSync(path.join(output, "latest", "index.html"), "utf8"), source);
  assert.ok(fs.existsSync(path.join(output, "index.html")));
  assert.ok(fs.existsSync(path.join(output, "versions", "index.html")));
  assert.ok(fs.existsSync(path.join(output, ".nojekyll")));
  assert.ok(manifest.versions.length >= 1 && manifest.versions.length <= 3);
  for (const version of manifest.versions) {
    assert.match(version.shortSha, /^[0-9a-f]{12}$/);
    assert.ok(fs.existsSync(path.join(output, "versions", version.shortSha, "index.html")));
  }
  const landing = fs.readFileSync(path.join(output, "index.html"), "utf8");
  const versionIndex = fs.readFileSync(path.join(output, "versions", "index.html"), "utf8");
  assert.match(landing, /최신 알파 대시보드 열기/);
  for (const [html, base] of [
    [landing, output],
    [versionIndex, path.join(output, "versions")],
  ]) {
    for (const [, href] of html.matchAll(/href="(\.{1,2}\/[^"#?]+)"/g)) {
      const target = path.resolve(base, href);
      assert.ok(
        fs.existsSync(target) || fs.existsSync(path.join(target, "index.html")),
        `깨진 내부 링크: ${href}`
      );
    }
  }
  console.log(`[testArtifactSite] 최신본과 과거 버전 ${manifest.versions.length}개 생성 검증 통과`);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
