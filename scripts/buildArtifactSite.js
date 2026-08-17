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
      observedRegionCount: snapshot.coverage?.observedRegionCount ?? null,
      regionItemCount: snapshot.coverage?.regionItemCount ?? null,
      nationwideTrademarkCount:
        snapshot.pipelineStatus?.nationwideCandidates?.uniqueTrademarkCount ?? null,
      availableRegionItemCount:
        snapshot.pipelineStatus?.regionalMetricGate?.availableRegionItemCount ?? null,
      addressVerificationRate:
        snapshot.pipelineStatus?.applicantRegionVerification?.rate ?? null,
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
    :root { color-scheme:light; --ink:#16221c; --muted:#68736d; --line:#dbe4de; --paper:#fff; --wash:#f3f7f4; --brand:#087f5b; --brand-dark:#075c44; --warn:#8a5b00; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:#f5f8f6; font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(1120px,calc(100% - 32px)); margin:0 auto; padding:0 0 72px; }
    h1,h2 { line-height:1.2; letter-spacing:-.03em; }
    h1 { margin:10px 0 16px; font-size:clamp(2.15rem,5vw,4.4rem); }
    h2 { margin:0 0 16px; font-size:1.25rem; }
    p { margin:0 0 16px; }
    a { color:var(--brand); }
    .site-header { display:flex; align-items:center; justify-content:space-between; min-height:72px; border-bottom:1px solid var(--line); }
    .site-brand { color:var(--ink); text-decoration:none; font-weight:800; letter-spacing:-.02em; }
    .site-brand span { color:var(--muted); font-weight:600; }
    nav { display:flex; gap:22px; }
    nav a { color:#3d4b43; text-decoration:none; font-size:.92rem; font-weight:650; }
    .hero { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(300px,.75fr); gap:46px; align-items:center; padding:74px 0 56px; }
    .eyebrow,.badge { display:inline-flex; align-items:center; gap:7px; border-radius:999px; font-weight:700; }
    .eyebrow { color:var(--brand); text-transform:uppercase; letter-spacing:.08em; font-size:.76rem; }
    .badge { padding:5px 10px; color:var(--warn); background:#fff3c4; font-size:.8rem; }
    .lede { max-width:760px; color:#405048; font-size:1.08rem; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin:28px 0 0; }
    .button { display:inline-block; padding:12px 17px; border:1px solid var(--line); border-radius:9px; background:var(--paper); color:var(--ink); text-decoration:none; font-weight:700; }
    .button.primary { color:#fff; border-color:var(--brand); background:var(--brand); }
    .button.primary:hover { background:var(--brand-dark); }
    .status-card { padding:24px; border:1px solid #cfe0d6; border-radius:18px; background:var(--paper); box-shadow:0 20px 55px #173b2910; }
    .status-line { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:20px; }
    .live { display:flex; align-items:center; gap:8px; color:var(--brand-dark); font-weight:800; }
    .live::before { width:9px; height:9px; border-radius:50%; background:#15a36f; content:""; box-shadow:0 0 0 4px #dcf5e9; }
    .meta { display:grid; grid-template-columns:auto 1fr; gap:7px 14px; margin:0; }
    .meta dt { color:var(--muted); }
    .meta dd { margin:0; overflow-wrap:anywhere; }
    .section { margin-top:26px; }
    .section-heading { display:flex; justify-content:space-between; gap:20px; align-items:end; margin-bottom:16px; }
    .section-heading h2 { margin:0; font-size:1.55rem; }
    .section-heading p { margin:0; color:var(--muted); }
    .metrics { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--line); border-radius:16px; background:var(--paper); overflow:hidden; }
    .metric { padding:23px; border-left:1px solid var(--line); }
    .metric:first-child { border-left:0; }
    .metric strong { display:block; font-size:1.8rem; line-height:1.2; letter-spacing:-.04em; }
    .metric span { display:block; margin-top:6px; color:var(--muted); font-size:.88rem; }
    .card { padding:24px; border:1px solid var(--line); border-radius:16px; background:var(--paper); }
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; }
    th,td { padding:14px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-size:.78rem; letter-spacing:.06em; text-transform:uppercase; }
    td:first-child a { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-weight:750; }
    td small { display:block; color:var(--muted); }
    tbody tr:last-child td { border-bottom:0; }
    .guide-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .guide-grid a { display:block; min-height:142px; padding:22px; border:1px solid var(--line); border-radius:14px; background:var(--paper); color:var(--ink); text-decoration:none; }
    .guide-grid a:hover { border-color:#9fc5b3; }
    .guide-grid strong { display:block; margin-bottom:8px; }
    .guide-grid span { color:var(--muted); font-size:.92rem; }
    .notice { margin-top:16px; padding:13px 15px; border-radius:9px; color:#5f4708; background:#fff7d8; font-size:.9rem; }
    footer { margin-top:42px; color:var(--muted); font-size:.9rem; }
    code { padding:2px 5px; border-radius:5px; background:#eaf0ec; }
    @media (max-width:800px) { .hero { grid-template-columns:1fr; padding-top:50px; } .metrics { grid-template-columns:repeat(2,1fr); } .metric:nth-child(3) { border-left:0; border-top:1px solid var(--line); } .metric:nth-child(4) { border-top:1px solid var(--line); } .guide-grid { grid-template-columns:1fr; } }
    @media (max-width:560px) { .site-header { align-items:flex-start; flex-direction:column; justify-content:center; gap:6px; padding:14px 0; } nav { gap:14px; } .hero { padding:40px 0; } .metrics { grid-template-columns:1fr; } .metric { border-left:0; border-top:1px solid var(--line); } .metric:first-child { border-top:0; } .section-heading { align-items:start; flex-direction:column; } }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function versionRows(versions, prefix = "./") {
  return versions
    .map(
      (version) => `<tr>
        <td><a href="${prefix}${version.shortSha}/">${version.shortSha}</a></td>
        <td>${escapeHtml(version.committedAt.slice(0, 10))}</td>
        <td>${escapeHtml(version.subject)}</td>
        <td><a href="${REPOSITORY_URL}/commit/${version.sha}">변경 보기</a></td>
      </tr>`
    )
    .join("\n");
}

function number(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("ko-KR").format(value) : "—";
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function buildLanding(metadata, versions, headSha) {
  const recentRows = versionRows(versions.slice(0, 5), "./versions/");
  const generatedDate = metadata.generatedAt ? metadata.generatedAt.slice(0, 10) : "확인 불가";
  const sourceDate = metadata.sourceMaxFetchedAt ? metadata.sourceMaxFetchedAt.slice(0, 10) : "확인 불가";
  return pageShell({
    title: "KIIP 공개 산출물",
    description: "KIIP 지역 특산품 상표 분석 결과와 변경 이력",
    body: `
      <header class="site-header"><a class="site-brand" href="./">KIIP <span>/ 공개 산출물</span></a><nav><a href="./latest/">대시보드</a><a href="./versions/">변경 이력</a><a href="${FEEDBACK_URL}">피드백</a></nav></header>
      <section class="hero">
        <div>
          <span class="eyebrow">CURRENT RESULT</span>
          <h1>지역 특산품<br>상표 분석 결과</h1>
          <p class="lede">특산품 수집부터 상표 매칭, 지역별 지표까지 현재 연결된 결과를 한 화면에서 확인할 수 있습니다.</p>
          <div class="actions"><a class="button primary" href="./latest/">대시보드 보기 →</a><a class="button" href="./versions/">이전 결과 비교</a></div>
        </div>
        <aside class="status-card">
          <div class="status-line"><span class="live">현재 공개본</span><span class="badge">알파 테스트 · 검토용</span></div>
          <dl class="meta">
            <dt>결과 생성</dt><dd>${escapeHtml(generatedDate)}</dd>
            <dt>데이터 기준</dt><dd>${escapeHtml(sourceDate)}</dd>
            <dt>스냅샷</dt><dd>${escapeHtml(metadata.snapshotId || "—")}</dd>
            <dt>배포 버전</dt><dd><a href="${REPOSITORY_URL}/commit/${headSha}">${escapeHtml(headSha.slice(0, 12))}</a></dd>
          </dl>
          <p class="notice">기능과 데이터 검토를 위한 공개본입니다. 공식 통계로 인용하기 전에 화면의 수집 상태와 출처를 확인해 주세요.</p>
        </aside>
      </section>
      <section class="section" aria-labelledby="coverage-title"><div class="section-heading"><div><span class="eyebrow">DATA COVERAGE</span><h2 id="coverage-title">현재 데이터 범위</h2></div><p>숫자는 최신 스냅샷에서 자동으로 갱신됩니다.</p></div><div class="metrics">
        <div class="metric"><strong>${number(metadata.observedRegionCount)}</strong><span>수집 지역</span></div>
        <div class="metric"><strong>${number(metadata.regionItemCount)}</strong><span>지역×품목 조합</span></div>
        <div class="metric"><strong>${number(metadata.nationwideTrademarkCount)}</strong><span>전국 상표 후보</span></div>
        <div class="metric"><strong>${number(metadata.availableRegionItemCount)}</strong><span>지역 지표 표시 가능</span></div>
      </div></section>
      <section class="section" aria-labelledby="guide-title"><div class="section-heading"><div><span class="eyebrow">QUICK ACCESS</span><h2 id="guide-title">확인하고 기록하기</h2></div></div><div class="guide-grid">
        <a href="./latest/"><strong>현재 결과 확인 →</strong><span>지역·품목별 상표 현황과 데이터 준비 상태를 봅니다.</span></a>
        <a href="./versions/"><strong>변경 이력 비교 →</strong><span>과거 시점의 HTML을 열어 결과 변화를 확인합니다.</span></a>
        <a href="${FEEDBACK_URL}"><strong>피드백 남기기 →</strong><span>검토한 페이지와 버전을 지정해 의견을 기록합니다.</span></a>
      </div></section>
      <section class="section card" aria-labelledby="history-title"><div class="section-heading"><div><span class="eyebrow">RECENT UPDATES</span><h2 id="history-title">최근 변경</h2></div><a href="./versions/">전체 이력 보기 →</a></div><div class="table-wrap"><table><thead><tr><th>버전</th><th>날짜</th><th>변경 내용</th><th>Git</th></tr></thead><tbody>${recentRows || '<tr><td colspan="4">기록된 버전이 없습니다.</td></tr>'}</tbody></table></div></section>
      <footer>원본 파일 <a href="${REPOSITORY_URL}/blob/main/${DASHBOARD_PATH}">${DASHBOARD_PATH}</a> · 주소 확보율 ${percent(metadata.addressVerificationRate)} · 자동 게시</footer>`,
  });
}

function buildVersionIndex(versions) {
  return pageShell({
    title: "KIIP 대시보드 변경 이력",
    description: "KIIP 지역 특산품 상표 분석 대시보드의 변경 이력",
    body: `
      <header class="site-header"><a class="site-brand" href="../">KIIP <span>/ 공개 산출물</span></a><nav><a href="../latest/">대시보드</a><a href="./">변경 이력</a><a href="${FEEDBACK_URL}">피드백</a></nav></header>
      <section class="hero"><div><span class="eyebrow">VERSION HISTORY</span><h1>대시보드<br>변경 이력</h1><p class="lede">결과 화면이 바뀐 시점과 내용을 확인하고, 당시 공개된 HTML을 그대로 열어 비교할 수 있습니다.</p><div class="actions"><a class="button primary" href="../latest/">현재 결과 보기 →</a><a class="button" href="../">산출물 홈</a></div></div><aside class="status-card"><h2>버전 기준</h2><p><code>${DASHBOARD_PATH}</code>가 변경된 Git 커밋을 한 버전으로 기록합니다.</p><p class="notice">버전 링크는 당시 화면을 재현하며, Git 링크는 변경된 파일과 커밋 설명을 보여줍니다.</p></aside></section>
      <section class="section card"><div class="table-wrap"><table><thead><tr><th>버전</th><th>날짜</th><th>변경 내용</th><th>Git</th></tr></thead><tbody>${versionRows(versions) || '<tr><td colspan="4">기록된 버전이 없습니다.</td></tr>'}</tbody></table></div></section>
      <footer>전체 Git 이력은 <a href="${REPOSITORY_URL}/commits/main/${DASHBOARD_PATH}">원본 저장소</a>에서 확인할 수 있습니다.</footer>`,
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
