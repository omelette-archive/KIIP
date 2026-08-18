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
  assert.match(landing, /지역 특산품<br>상표 분석 결과/);
  assert.match(landing, /대시보드 보기/);
  assert.match(landing, /현재 데이터 범위/);
  assert.match(landing, /최근 변경/);
  assert.match(landing, /issues\/76/);
  assert.match(landing, /최신 공개본에 대한 의견을 이슈 댓글로 남깁니다/);
  assert.doesNotMatch(landing, /issues\/new\?template=artifact-feedback\.yml/);
  assert.doesNotMatch(landing, /검토한 페이지와 버전을 지정/);
  const currentResult = landing.slice(0, landing.indexOf("RECENT UPDATES"));
  assert.strictEqual((currentResult.match(/알파 테스트 · 검토용/g) || []).length, 1, "알파 상태 배지는 한 번만 표시한다");
  assert.doesNotMatch(currentResult, /알파 대시보드|전국 알파|전체 범위 알파/);
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
