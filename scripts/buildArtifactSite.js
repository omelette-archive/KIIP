#!/usr/bin/env node
"use strict";

/**
 * 현재 대시보드와 Git 이력의 과거 대시보드를 GitHub Pages용 정적 사이트로 묶는다.
 * 외부 패키지 없이 로컬과 GitHub Actions에서 같은 결과를 만든다.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_PATH = "07-dashboard/dashboard.html";
const REPOSITORY_URL = "https://github.com/omelette-archive/KIIP";
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new?template=artifact-feedback.yml`;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function readSnapshotMetadata(html) {
  const prefix = "dashboardClient(";
  const start = html.lastIndexOf(prefix);
  if (start < 0) return {};

  try {
    const argumentStart = start + prefix.length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let argumentEnd = -1;
    for (let index = argumentStart; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        argumentEnd = index + 1;
        break;
      }
    }
    if (argumentEnd < 0) return {};
    const snapshot = JSON.parse(html.slice(argumentStart, argumentEnd));
    return {
      snapshotId: snapshot.snapshotId || null,
      schemaVersion: snapshot.schemaVersion || null,
      generatedAt: snapshot.generatedAt || null,
      sourceMaxFetchedAt: snapshot.asOf?.sourceMaxFetchedAt || null,
      stage: snapshot.pipelineStatus?.stage || null,
      inputScope: snapshot.pipelineStatus?.inputScope || snapshot.mode || null,
    };
  } catch {
    return {};
  }
}

function readVersions(limit) {
  const format = "%H%x1f%aI%x1f%s%x1e";
  const output = runGit([
    "log",
    "--follow",
    `--max-count=${limit}`,
    `--format=${format}`,
    "--",
    DASHBOARD_PATH,
  ]);

  if (!output) return [];
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, committedAt, ...subjectParts] = record.split("\x1f");
      return {
        sha,
        shortSha: sha.slice(0, 12),
        committedAt,
        subject: subjectParts.join("\x1f"),
      };
    });
}

function pageShell({ title, description, body }) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink:#17211c; --muted:#647068; --line:#dce4df; --paper:#fff; --wash:#f2f6f3; --brand:#087f5b; --warn:#9a6700; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:linear-gradient(145deg,#eef6f0 0,#f9fbfa 42%,#edf3f6 100%); font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(1040px,calc(100% - 32px)); margin:0 auto; padding:64px 0 80px; }
    h1,h2 { line-height:1.2; letter-spacing:-.03em; }
    h1 { margin:14px 0 16px; font-size:clamp(2rem,5vw,3.8rem); }
    h2 { margin:0 0 16px; font-size:1.25rem; }
    p { margin:0 0 16px; }
    a { color:var(--brand); }
    .eyebrow,.badge { display:inline-flex; align-items:center; gap:7px; border-radius:999px; font-weight:700; }
    .eyebrow { color:var(--brand); text-transform:uppercase; letter-spacing:.08em; font-size:.76rem; }
    .badge { padding:5px 10px; color:var(--warn); background:#fff5cf; font-size:.8rem; }
    .lede { max-width:760px; color:#405048; font-size:1.08rem; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin:28px 0 46px; }
    .button { display:inline-block; padding:12px 17px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); text-decoration:none; font-weight:700; box-shadow:0 8px 24px #183b2a0c; }
    .button.primary { color:#fff; border-color:var(--brand); background:var(--brand); }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }
    .card { padding:22px; border:1px solid var(--line); border-radius:16px; background:#ffffffd9; box-shadow:0 14px 40px #183b2a0a; }
    .meta { display:grid; grid-template-columns:auto 1fr; gap:7px 14px; margin:0; }
    .meta dt { color:var(--muted); }
    .meta dd { margin:0; overflow-wrap:anywhere; }
    .version-list { margin:0; padding:0; list-style:none; }
    .version-list li { display:grid; grid-template-columns:minmax(92px,auto) 1fr; gap:8px 14px; padding:14px 0; border-top:1px solid var(--line); }
    .version-list li:first-child { border-top:0; padding-top:0; }
    .version-list a { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-weight:700; }
    .version-list small { display:block; color:var(--muted); }
    .notice { margin-top:18px; padding:14px 16px; border-left:4px solid #e1a800; background:#fff9e5; }
    footer { margin-top:42px; color:var(--muted); font-size:.9rem; }
    @media (max-width:560px) { main { padding-top:38px; } .version-list li { grid-template-columns:1fr; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function versionItems(versions) {
  return versions
    .map(
      (version) => `<li>
        <div><a href="./${version.shortSha}/">${version.shortSha}</a><small>${escapeHtml(version.committedAt.slice(0, 10))}</small></div>
        <div>${escapeHtml(version.subject)}<small><a href="${REPOSITORY_URL}/commit/${version.sha}">변경 내용 확인</a></small></div>
      </li>`
    )
    .join("\n");
}

function buildLanding(metadata, versions, headSha) {
  const recentItems = versionItems(versions.slice(0, 5)).replaceAll('href="./', 'href="./versions/');
  const generatedDate = metadata.generatedAt ? metadata.generatedAt.slice(0, 10) : "확인 불가";
  const sourceDate = metadata.sourceMaxFetchedAt ? metadata.sourceMaxFetchedAt.slice(0, 10) : "확인 불가";
  return pageShell({
    title: "KIIP 현재 산출물",
    description: "KIIP 알파 대시보드 최신본, 버전 이력, 피드백 창구",
    body: `
      <span class="eyebrow">KIIP · 현재까지의 산출물</span>
      <h1>지역 브랜드 인사이트<br>알파 대시보드</h1>
      <p class="lede">지금까지 연결된 특산품·상표 데이터와 분석 결과를 한 파일로 확인하는 검토용 산출물입니다. 최신본과 과거 버전을 같은 주소 체계에서 열 수 있습니다.</p>
      <div class="actions">
        <a class="button primary" href="./latest/">최신 알파 대시보드 열기</a>
        <a class="button" href="./versions/">버전 내역</a>
        <a class="button" href="${FEEDBACK_URL}">피드백 남기기</a>
      </div>
      <div class="grid">
        <section class="card">
          <h2>현재 빌드</h2>
          <dl class="meta">
            <dt>단계</dt><dd><span class="badge">ALPHA · 검토용</span></dd>
            <dt>스냅샷</dt><dd>${escapeHtml(metadata.snapshotId || "미표기")}</dd>
            <dt>생성일</dt><dd>${escapeHtml(generatedDate)}</dd>
            <dt>데이터 기준</dt><dd>${escapeHtml(sourceDate)}</dd>
            <dt>계약</dt><dd>${escapeHtml(metadata.schemaVersion || "미표기")}</dd>
            <dt>배포 커밋</dt><dd><a href="${REPOSITORY_URL}/commit/${headSha}">${escapeHtml(headSha.slice(0, 12))}</a></dd>
          </dl>
          <p class="notice">배포 전 알파 테스트 결과입니다. 미완료 수집과 차단된 지표는 화면의 경고·출처 표시와 함께 해석해 주세요.</p>
        </section>
        <section class="card">
          <h2>최근 버전</h2>
          <ul class="version-list">${recentItems || "<li>기록된 버전이 없습니다.</li>"}</ul>
          <p><a href="./versions/">전체 버전 보기 →</a></p>
        </section>
      </div>
      <footer>원본 파일: <a href="${REPOSITORY_URL}/blob/main/${DASHBOARD_PATH}">${DASHBOARD_PATH}</a> · 자동 게시: GitHub Pages</footer>`,
  });
}

function buildVersionIndex(versions) {
  return pageShell({
    title: "KIIP 산출물 버전 내역",
    description: "KIIP 알파 대시보드의 렌더링 가능한 Git 버전 내역",
    body: `
      <span class="eyebrow">KIIP · 산출물 기록</span>
      <h1>대시보드 버전 내역</h1>
      <p class="lede">각 항목은 <code>${DASHBOARD_PATH}</code>가 변경된 Git 커밋입니다. 버전 링크는 당시 HTML을 그대로 렌더링합니다.</p>
      <div class="actions"><a class="button primary" href="../latest/">최신본 열기</a><a class="button" href="../">산출물 허브</a><a class="button" href="${FEEDBACK_URL}">피드백 남기기</a></div>
      <section class="card"><ul class="version-list">${versionItems(versions) || "<li>기록된 버전이 없습니다.</li>"}</ul></section>
      <footer>Git 이력: <a href="${REPOSITORY_URL}/commits/main/${DASHBOARD_PATH}">GitHub에서 확인</a></footer>`,
  });
}

function parseArgs(argv) {
  const options = { output: path.join(ROOT, ".artifact-site"), limit: 50 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") options.output = path.resolve(ROOT, argv[++index]);
    else if (argv[index] === "--limit") options.limit = Number.parseInt(argv[++index], 10);
    else throw new Error(`알 수 없는 옵션: ${argv[index]}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) {
    throw new Error("--limit은 1~200 사이 정수여야 합니다.");
  }
  return options;
}

function buildSite({ output, limit }) {
  const dashboardFile = path.join(ROOT, DASHBOARD_PATH);
  const currentHtml = fs.readFileSync(dashboardFile, "utf8");
  const metadata = readSnapshotMetadata(currentHtml);
  const versions = readVersions(limit);
  const headSha = runGit(["rev-parse", "HEAD"]);

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, "latest"), { recursive: true });
  fs.mkdirSync(path.join(output, "versions"), { recursive: true });
  fs.writeFileSync(path.join(output, "latest", "index.html"), currentHtml);

  for (const version of versions) {
    const versionHtml = execFileSync("git", ["show", `${version.sha}:${DASHBOARD_PATH}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const versionDir = path.join(output, "versions", version.shortSha);
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "index.html"), versionHtml);
  }

  fs.writeFileSync(path.join(output, "index.html"), buildLanding(metadata, versions, headSha));
  fs.writeFileSync(path.join(output, "versions", "index.html"), buildVersionIndex(versions));
  fs.writeFileSync(
    path.join(output, "manifest.json"),
    `${JSON.stringify({ artifact: DASHBOARD_PATH, headSha, metadata, versions }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(output, ".nojekyll"), "");

  return { output, metadata, versions, headSha };
}

if (require.main === module) {
  try {
    const result = buildSite(parseArgs(process.argv.slice(2)));
    console.log(
      `[artifact-site] ${result.output} 생성 완료 (최신본 1개, 과거 버전 ${result.versions.length}개)`
    );
  } catch (error) {
    console.error(`[artifact-site] 실패: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildSite, parseArgs, readSnapshotMetadata };
