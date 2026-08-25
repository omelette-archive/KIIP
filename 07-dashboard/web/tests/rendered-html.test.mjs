import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const snapshotUrl = new URL("../public/data/dashboard-snapshot.json", import.meta.url);
const registrationExamplesUrl = new URL("../public/data/verified-registration-examples.json", import.meta.url);

async function loadSnapshot() {
  return JSON.parse(await readFile(snapshotUrl, "utf8"));
}

async function loadRegistrationExamples() {
  return JSON.parse(await readFile(registrationExamplesUrl, "utf8"));
}

function specialtyCoverage(snapshot) {
  let total = 0;
  let decided = 0;
  let applied = 0;
  for (const region of snapshot.regions) {
    if (region.sido === "전국") continue;
    for (const item of region.items) {
      total += 1;
      if (item.metrics.uniqueTrademarkCount.availability !== "available") continue;
      decided += 1;
      if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) applied += 1;
    }
  }
  // 2026-08-21 사용자 재확인: 분모는 확인 완료 특산품이 아니라 수집된 지역×특산품
  // 전체다 — Dashboard.tsx/standalone-client.js의 specialtyCoverage()와 동일.
  return { total, decided, applied, pending: total - decided, rate: total ? applied / total : null };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the data-connected Korean dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  const snapshot = await loadSnapshot();
  const visibleTextHtml = html.replace(/<!--.*?-->/gs, "");
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>지역 특산품-상표 분석·정책지원 플랫폼<\/title>/i);
  // 2026-08-25(#116 재오픈): 요약 화면 클릭 시 나오던 큰 중복 제목(<h1>)이 실제로는
  // 안 지워져 있던 걸 이번에 완전히 제거했다 — 다시 나타나면 안 됨.
  assert.doesNotMatch(html, /지역 특산품 상표 출원 현황/, "요약 화면에 중복되는 큰 제목이 다시 나타나면 안 됨");
  assert.match(html, /마지막 업데이트/);
  assert.doesNotMatch(html, /데이터 생성일|마지막 생성/);
  // 2026-08-19 피드백: "알파테스트라는 말을 제외시키고... 최종본처럼" — 상단 배지·요약 탭
  // 곳곳에 반복 노출하던 "알파 테스트" 문구를 모두 걷어낸다.
  // 같은 이유로 요약 탭의 "데이터 준비 상태"(pipeline-progress) 섹션도 제거했다 —
  // 같은 내용이 데이터 개요 탭에 이미 있고, "다음 개선" 같은 내부 로드맵 문구가 있었다.
  assert.doesNotMatch(html, /알파 테스트/, "알파 테스트 문구가 화면에 노출되면 안 됨(2026-08-19 결정)");
  assert.doesNotMatch(html, /전체 범위 알파|전국 알파|알파 대시보드|ALPHA DATA PREVIEW|ALPHA PIPELINE CHECK/);
  assert.doesNotMatch(html, /class="pipeline-progress"/, "요약 탭에서 데이터 준비 상태 섹션은 제거됨(데이터 개요 탭과 중복)");
  assert.doesNotMatch(html, /수집된 상표 예시|class="showcase"/, "표본 상표를 최신 출원처럼 보이게 하는 요약 섹션은 제거해야 함");
  const mapStart = html.indexOf('<svg class="korea-map"');
  const mapEnd = html.indexOf("</svg>", mapStart);
  const mapHtml = html.slice(mapStart, mapEnd);
  assert.ok(
    mapHtml.lastIndexOf('class="map-shape') < mapHtml.indexOf('class="map-label'),
    "전국 지도 지명은 모든 지역 도형 뒤의 최상위 SVG 레이어에 있어야 함",
  );
  // 2026-08-21: 서울·세종을 화살표로 빼는 대신 경기도 라벨만 살짝 옮겨 겹침을
  // 피한다(사용자 요청) — 전국 지도에는 더 이상 연결선(화살표)이 없어야 한다.
  assert.equal((mapHtml.match(/<polyline[^>]+points=/g) || []).length, 0, "전국 지도에는 화살표(연결선)를 쓰지 않고 경기도 라벨만 옮겨 겹침을 피해야 함");
  assert.match(mapHtml, /서울특별시/);
  assert.match(mapHtml, /세종특별자치시/);
  assert.match(mapHtml, /제주특별자치도/);
  assert.match(mapHtml, /전남·광주 통합권역/);
  assert.doesNotMatch(mapHtml, /map-callout-value/, "지도 지명에 현재 지표 값을 이어 붙여 가독성을 해치면 안 됨");
  assert.ok(
    html.indexOf(">특산품 수</button>") < html.indexOf(">상표 건수</button>") &&
    html.indexOf(">상표 건수</button>") < html.indexOf(">출원율</button>") &&
    html.indexOf(">출원율</button>") < html.indexOf(">등록률</button>"),
    "지도 지표는 특산품 수, 상표 건수, 출원율, 등록률 순서여야 함",
  );
  assert.match(html, new RegExp(snapshot.pipelineStatus.nationwideCandidates.uniqueTrademarkCount.toLocaleString("ko-KR")));
  assert.match(html, /출원인 주소 확보율/);
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.match(html, /지역별 상표 출원/);
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  assert.match(html, /특화작목 비교/);
  assert.match(html, /데이터 개요/);
  assert.match(html, /참고 경계 · <!-- -->2026-07-01/);
  assert.match(html, />특산품 수<\/button>/);
  assert.match(html, />상표 건수<\/button>/);
  assert.match(html, />출원율<\/button>/);
  assert.match(html, />등록률<\/button>/);
  assert.match(html, /지역 주소 일치 출원 중 등록 상태인 건의 비율입니다/);
  assert.match(html, /현재 스냅샷에 수집된 지역×특산품 수입니다/);
  const mapInsightStart = html.indexOf('class="map-insight"');
  const mapInsightEnd = html.indexOf("</aside>", mapInsightStart);
  const mapInsight = html.slice(mapInsightStart, mapInsightEnd);
  assert.match(mapInsight, /class="metric-count-hero"/, "기본 특산품 수 지표는 원형 비율 대신 큰 숫자로 보여야 함");
  assert.doesNotMatch(mapInsight, /class="rate-ring"/, "특산품 수를 비율 원형 게이지로 표시하면 안 됨");
  assert.doesNotMatch(mapInsight, /<em>개<\/em>|<em>건<\/em>/, "큰 숫자 옆 개·건 단위는 설명과 중복되므로 표시하지 않음");
  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(standaloneHtml, /state\.mapMetric === "applicationCoverage"[\s\S]*rateRing\(visibleSpecialtyCoverage\.rate, "출원율"\)/);
  assert.match(standaloneHtml, /state\.mapMetric === "registration"[\s\S]*rateRing\(visibleRegistrationRate, "등록률"\)/);
  assert.match(standaloneHtml, /metric-count-hero[\s\S]*특산품 수[\s\S]*상표 건수/);
  assert.match(standaloneHtml, /상표 출원 상위 특산품|등록 상위 특산품|특산품별 출원 확인 현황/);
  assert.match(standaloneHtml, /dashboardUpdatedAt = latestDate\([\s\S]*metric\.calculatedAt/);
  assert.match(standaloneHtml, /dateOnly\(latestDate\(source\.sourceFetchedAt, source\.sourceLastVerifiedAt\)\)/);
  assert.doesNotMatch(standaloneHtml, /<small>검증 \$\{esc\(source\.sourceLastVerifiedAt/);
  // 집계 대기 품목도 전체 1,692개 분모에 포함하며, 확인이 진행되면 값이 올라간다.
  assert.match(html, /아직 지역별 집계가 안 끝난 품목도 전체 분모에 포함하므로/);
  assert.doesNotMatch(html, />수집 범위<|>브랜드 공백|상표 활용 여지|출원인 주소-대상 지역 일치/);
  assert.match(
    visibleTextHtml,
    /[가-힣]+(?:시|군|구|광역시|특별시|특별자치시) \/ [가-힣A-Za-z0-9]/,
    "지도 옆 표기는 '지역 / 특산품' 형식이어야 함"
  );
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps trademark-like raw labels out of the map specialty summary", async () => {
  const response = await render();
  const html = await response.text();
  const insightStart = html.indexOf('class="map-insight"');
  const insightEnd = html.indexOf("</aside>", insightStart);
  const insight = html.slice(insightStart, insightEnd);
  const rankingStart = html.indexOf('class="ranking"');
  const rankingEnd = html.indexOf("</section>", rankingStart);
  const ranking = html.slice(rankingStart, rankingEnd);
  assert.match(insight, /고시명칭/, "the map summary should show confirmed specialty labels with their notice basis");
  assert.doesNotMatch(insight, /마춤 쌀|임금님표/, "raw brand-like or trademark example labels must not be presented as map specialties");
  assert.doesNotMatch(ranking, /마춤 쌀|임금님표/, "raw brand-like or trademark example labels must not be presented as ranked specialties");
  assert.doesNotMatch(html, /class="showcase"/, "unverified trademark samples should not be promoted on the summary screen");
});

test("shows every collected specialty in the map preview, not just officially-named ones", async () => {
  // 이슈 #111: 지역 특산품 수(예: 고성군 20개)와 요약 페이지 미리보기에 뜨는 개수가 안
  // 맞아 보인다는 지적 — 고시명칭 미확정 원물명(raw_item_name_unclassified)을 미리보기에서
  // 걸러내던 게 원인이었다. coverage-specialty-list와 동일한 원칙(고시명칭 매칭은 판정
  // 기준의 하나일 뿐)을 적용해 지역의 전체 품목을 보여주도록 고쳤다.
  const snapshot = await loadSnapshot();
  const goseong = snapshot.regions.find((region) => region.region.includes("고성군") && region.sido.includes("강원"));
  assert.ok(goseong, "고성군 스냅샷 데이터가 있어야 함");
  assert.equal(goseong.items.length, 20, "고성군에는 20개 품목이 있어야 이 테스트가 의미가 있음");
  const officialCount = goseong.items.filter((item) => item.matchingBasis === "notice_name_and_nice_class" || item.matchingBasis === "raw_item_goods_matched").length;
  assert.ok(officialCount < goseong.items.length, "고성군은 고시명칭 확정 품목보다 미분류 원물명이 더 많아야 이 테스트가 의미가 있음(회귀 시 조용히 통과하면 안 됨)");

  const response = await render();
  const html = await response.text();
  const insightStart = html.indexOf('class="map-insight"');
  const insightEnd = html.indexOf("</aside>", insightStart);
  const insight = html.slice(insightStart, insightEnd);
  assert.match(insight, /왕곡한과|꿀다림 데일리허니/, "미분류 원물명도 지도 옆 미리보기에 나와야 함(고시명칭 확정 품목만 남기면 안 됨)");
});

test("uses every collected region-item specialty as the application-rate denominator", async () => {
  const response = await render();
  const html = await response.text();
  const visibleTextHtml = html.replace(/<!--.*?-->/gs, "");
  const snapshot = await loadSnapshot();
  const coverage = specialtyCoverage(snapshot);
  // 스냅샷의 regionItemCount 전부를 분모로 사용한다. 고시명칭 확인 완료분만
  // 사용하던 과거 분모 1,015개로 되돌아가면 안 된다. 현재 출원 확인은 1,013개다.
  // (2026-08-21: 남양주시 "깻잎"이 원본 병합 스크립트의 지역 필드 오류(sido="")로
  // raw_item_goods_matched 승격에서 누락돼 있던 것을 targeted patch로 보정 — 1,012→1,013.)
  // (2026-08-25: 품질인증수산물(NFQS) 실데이터를 지역 통계에 추가하고, 지역 미제공
  // KOFPI 90건은 "전국" 의사(疑似) 지역에 담아 지도·지역별 통계에서는 제외한다(#114).
  // regionItemCount는 그 "전국 제외" 지역 통계용 값이고, catalogItemCount가 전국까지
  // 포함한 원본 전체 행 수다(scripts/auditDashboardSnapshot.js가 각각을 실제 행 수와
  // 대조해 검증함) — 서로 다른 스코프라 더 이상 같은 값이 아니다.
  const nationwideCatalogCount = snapshot.regions.filter((region) => region.sido === "전국")
    .reduce((sum, region) => sum + region.items.length, 0);
  assert.equal(coverage.total, snapshot.coverage.regionItemCount);
  assert.equal(coverage.total + nationwideCatalogCount, snapshot.coverage.catalogItemCount);
  assert.equal(coverage.total, 1713);
  assert.equal(coverage.decided, 1625);
  assert.equal(coverage.applied, 1016);
  assert.equal(coverage.pending, 88);
  assert.equal(Math.round(coverage.rate * 100), 59);
  const localeNumber = (n) => n.toLocaleString("ko-KR");
  assert.match(visibleTextHtml, new RegExp(`전체 ${localeNumber(coverage.total)}개 중 확인 ${localeNumber(coverage.applied)}개`));
  // 2026-08-21: "출원율 계산" 설명 박스는 요약 탭에서 제거했다(사용자 요청 — 데이터
  // 개요 탭에 같은 내용이 있어 중복). 요약 탭에는 더 이상 노출되지 않아야 한다.
  assert.doesNotMatch(html, /출원율 계산/);
  assert.doesNotMatch(html, /확인 특산품 전체 1,015개|831 ÷ 1,015|출원율 82%/);
});

test("keeps item totals, registration denominator, and pending states explicit", async () => {
  const snapshot = await loadSnapshot();
  const officialRows = snapshot.regions.flatMap((region) =>
    region.items
      .filter((item) => item.matchingBasis === "notice_name_and_nice_class" && item.niceClass)
      .map((item) => ({ region: region.region, item })),
  );
  const driedPersimmon = officialRows.filter(({ item }) => item.itemName === "감말랭이");
  assert.equal(driedPersimmon.length, 3);
  assert.equal(
    driedPersimmon.reduce((sum, { item }) => sum + item.metrics.uniqueTrademarkCount.value, 0),
    66,
    "감말랭이 66건은 세 지역의 주소 일치 출원 합계여야 함",
  );
  assert.equal(
    driedPersimmon.reduce((sum, { item }) => sum + item.metrics.registeredTrademarkCount.value, 0),
    42,
    "감말랭이 등록 42건은 같은 66건 중 등록 상태 합계여야 함",
  );
  // 2026-08-20: 블루베리(신선한 블루베리·31류)는 이번 재수집 대상(사과 등 183개 쿼리)에
  // 포함돼 partial -> complete로 바뀌었다(전국 검색 329건 -> 1,294건, 지역 판정도 완료).
  // 아직 판정 대기 상태를 보여주는 예시로는 이번 재수집 대상이 아니었던 "벌꿀"을 대신 쓴다.
  const honey = officialRows.filter(({ item }) => item.itemName === "벌꿀");
  assert.ok(honey.length > 0, "벌꿀은 고시명칭·NICE류가 확인된 품목이어야 함");
  assert.ok(honey.every(({ item }) => item.dataState === "partial"));
  assert.ok(honey.every(({ item }) => item.metrics.uniqueTrademarkCount.availability === "blocked"));
  assert.ok(honey.every(({ item }) => item.metrics.nationwideSearchTrademarkCount.value === 213));
});

test("tags official items with a category and lets the items tab filter by it", async () => {
  // 이슈 #109(품목 카테고리화). 02-normalize-items/data/item-categories-v1.json을
  // 07-dashboard/lib/snapshot.js가 대조해 확인 특산품(notice_name_and_nice_class /
  // raw_item_goods_matched)에만 category를 붙인다. 미분류 원물명(raw_item_name_unclassified)
  // 에는 붙이지 않는다.
  const snapshot = await loadSnapshot();
  const apple = snapshot.regions.flatMap((region) => region.items).find((item) => item.itemName === "사과" && item.matchingBasis === "notice_name_and_nice_class");
  assert.ok(apple, "사과 스냅샷 데이터가 있어야 함");
  assert.deepEqual(apple.category, { code: "fruit", label: "과일" });
  const unclassified = snapshot.regions.flatMap((region) => region.items).find((item) => item.matchingBasis === "raw_item_name_unclassified");
  assert.ok(unclassified, "미분류 원물명 항목이 있어야 함");
  assert.equal(unclassified.category, null, "미분류 원물명에는 카테고리를 붙이면 안 됨");

  // "items" 탭은 기본 탭(summary)이 아니라 클라이언트 상태 전환 후에만 렌더링되므로,
  // 정적 HTML에는 필터 버튼의 실제 값이 아니라 이를 만드는 JS 소스만 들어있다.
  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(standaloneHtml, /class="item-category-filter"/, "품목별 조회에 유형 필터가 있어야 함");
  assert.match(standaloneHtml, /data-category-filter="\$\{esc\(category\.code\)\}"/, "실제 유형 코드로 필터 버튼을 만들어야 함");
  assert.match(standaloneHtml, /function availableCategories\(\)/, "실제 데이터에 등장하는 유형만 필터로 노출해야 함");
});

test("publishes only goods-confirmed regional application gaps", async () => {
  // 2026-08-21 감사: 지역 출원 수 0만으로는 미출원을 단정할 수 없다. 고시명칭 검색
  // 후보에는 유사 품목·상표명이 섞일 수 있으므로, 지정상품 일치 근거와 지역코드가 모두
  // 있는 항목만 "지역 출원 미확인" 목록에 포함한다.
  const snapshot = await loadSnapshot();
  const candidates = snapshot.regions.flatMap((region) => region.items.map((item) => ({ region, item }))).filter(({ region, item }) =>
    Boolean(region.regionCode) &&
    (item.matchingBasis === "notice_name_and_nice_class" || item.matchingBasis === "raw_item_goods_matched") &&
    item.metrics.uniqueTrademarkCount.availability === "available" &&
    (item.metrics.uniqueTrademarkCount.value || 0) === 0
  );
  const hasGoodsEvidence = ({ item }) => item.matchingBasis === "raw_item_goods_matched" ||
    (item.metrics.confirmedGoodsMatchCount.availability === "available" && (item.metrics.confirmedGoodsMatchCount.value || 0) > 0);
  const publishable = candidates.filter(hasGoodsEvidence);
  const excluded = candidates.filter((entry) => !hasGoodsEvidence(entry));
  const pepperCandidates = candidates.filter(({ item }) => item.noticeName?.includes("고추"));
  assert.equal(publishable.length, 0, "현재 스냅샷에는 지정상품 근거까지 충족한 지역 출원 미확인 항목이 없어야 함");
  assert.equal(excluded.length, 86, "지정상품 근거가 없는 0건 후보는 공개 목록에서 제외해야 함");
  assert.ok(pepperCandidates.length > 0, "고추 관련 0건 후보가 실제로 있어야 감사 조건이 유효함");
  assert.ok(pepperCandidates.every((entry) => !hasGoodsEvidence(entry)), "고추 후보를 지정상품 근거 없이 미출원으로 표시하면 안 됨");
});

test("renders tab navigation and separate application/registration ranking tables", async () => {
  const response = await render();
  const html = await response.text();
  const snapshot = await loadSnapshot();
  assert.match(html, /class="primary-tabs"/, "요약/지역별 상표 출원/지자체별/품목별/특화작목/데이터 개요 6개 탭이 있어야 함");
  assert.match(html, /지역별 상표 출원/);
  assert.match(html, /지자체별 조회/);
  assert.match(html, /품목별 조회/);
  // 2026-08-21 사용자 요청: "등록상표 랭킹"만 있던 걸 출원 랭킹/등록 랭킹 두 개로 나누고,
  // TOP10/50 토글은 없애고 TOP 10 고정으로 단순화했다.
  assert.match(html, /지역·대표 특산품 출원 랭킹/, "출원 랭킹 섹션이 있어야 함");
  assert.match(html, /지역·대표 특산품 등록 랭킹/, "등록 랭킹 섹션이 있어야 함");
  assert.doesNotMatch(html, /class="ranking-toggle"|TOP 50/, "TOP10\/50 토글은 제거돼야 함(고정 TOP 10)");
  const rankingTableCount = (html.match(/class="ranking-table"/g) || []).length;
  assert.equal(rankingTableCount, 2, "출원·등록 랭킹 테이블이 각각 하나씩, 총 두 개 있어야 함");

  const appHeadingIndex = html.indexOf("지역·대표 특산품 출원 랭킹");
  const regHeadingIndex = html.indexOf("지역·대표 특산품 등록 랭킹");
  assert.ok(appHeadingIndex >= 0 && regHeadingIndex > appHeadingIndex, "출원 랭킹이 등록 랭킹보다 먼저 나와야 함");
  const appTbody = html.slice(html.indexOf("<tbody>", appHeadingIndex), html.indexOf("</tbody>", appHeadingIndex));
  const regTbody = html.slice(html.indexOf("<tbody>", regHeadingIndex), html.indexOf("</tbody>", regHeadingIndex));

  // 품목명은 정규화된 대표 특산품이어야 한다(2026-08-11 확정) — 예전 샘플은
  // buildAreaBrandValidationInput.js의 브랜드명("데일리")을 그대로 썼는데, 이는 지역브랜드
  // 조인 검증용일 뿐 대표 특산품이 아니다. 각 랭킹이 실제로 해당 지표(출원 확인 건수 /
  // 등록 완료 건수) 내림차순으로 정렬되는지 확인한다. 단, 지역 귀속이 막힌 스냅샷이면
  // 전국 검색 후보로 억지 순위를 만들지 않고 빈 랭킹을 유지해야 한다(#50).
  const rankingCandidates = snapshot.regions.flatMap((region) => region.items.map((item) => ({ region, item })));
  const checkFirstRow = (firstRow, ranking) => {
    if (ranking) {
      assert.match(firstRow, />1<\/td>/, "1위 순번이 실제로 매겨져야 함");
      assert.match(firstRow, new RegExp(`>${escapeRegExp(ranking.item.itemName)}<`), "주 라벨은 현재 데이터의 대표 특산품명이어야 함");
      assert.match(firstRow, new RegExp(escapeRegExp(ranking.item.noticeName)), "고시명칭은 집계 근거로 병기해야 함");
    } else {
      assert.doesNotMatch(firstRow, />1<\/td>/, "지역 귀속 미검증 전국 후보로 순위를 만들면 안 됨");
    }
    // 랭킹 표 자체에 옛 브랜드명이 품목 라벨로 남아있으면 안 된다. html 전체를 검사하면
    // 무관한 실제 원물명에 우연히 같은 글자가 포함된 경우(예: "꿀다림 데일리허니")까지
    // 걸려서 firstRow(랭킹 1위 행)만 검사한다.
    assert.doesNotMatch(firstRow, /데일리|일선정품|상큼愛/, "랭킹 표에 고시명칭 미정제 브랜드명이 품목으로 남아있으면 안 됨");
  };
  const firstAppRanking = [...rankingCandidates]
    .filter(({ item }) => item.metrics.uniqueTrademarkCount.availability === "available")
    .sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0))[0];
  const firstRegRanking = [...rankingCandidates]
    .filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available")
    .sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0))[0];
  checkFirstRow(appTbody.slice(0, appTbody.indexOf("</tr>")), firstAppRanking);
  checkFirstRow(regTbody.slice(0, regTbody.indexOf("</tr>")), firstRegRanking);
});

test("renders matching criteria once, on the data overview tab, not on the summary tab", async () => {
  const response = await render();
  const html = await response.text();
  // 판정 기준은 하단 <details>가 아니라 눈에 띄는 섹션이어야 한다(2026-08-11 피드백: "작은글씨는
  // 아니면 위에 잘 넣을수있으면 넣고"). 2026-08-19 피드백으로 모든 탭에 반복 노출하던 것을 정리해
  // 요약 탭에만 한 번 보이도록 옮겼었는데, 같은 날 "이게 요약에 있을필요는없어보여"라는 후속
  // 피드백으로 데이터 개요 탭으로 다시 옮겼다. SSR 초기 상태는 요약 탭이라 여기서는 없어야 한다.
  assert.doesNotMatch(html, /class="criteria"/, "판정 기준 섹션은 더 이상 요약 탭 SSR 초기 렌더에 없어야 함");

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(standaloneHtml, /data-overview">\$\{criteriaHtml\(\)\}/, "판정 기준 섹션은 데이터 개요 탭에서만 호출돼야 함");
  assert.doesNotMatch(standaloneHtml, /\$\{criteriaHtml\(\)\}<section class="hero"/, "판정 기준 섹션이 요약 탭(hero) 앞에서 호출되면 안 됨");
  assert.match(standaloneHtml, /판정 기준과 매칭 방법/);
  const standaloneClientSource = standaloneHtml.slice(0, standaloneHtml.indexOf("\ndashboardClient("));
  // 2026-08-21 디자인 정리: "GI 출처 또는 상표 출원 3건 이상"은 실제로 어떤 집계·표시
  // 로직에도 쓰이지 않는 죽은 문구였다(gapScore는 타입에만 존재하고 읽히지 않음) —
  // 사용자 요청으로 검토 후 제거했다. 이 자리를 실제로 쓰이는 매칭 기준으로 대체.
  assert.doesNotMatch(standaloneClientSource, /GI 출처 또는 상표 출원 3건 이상/, "실제로 쓰이지 않는 대표 특산품 판정 기준 문구는 노출되면 안 됨");
  assert.match(standaloneHtml, /지정상품명에서 품목명 확인/, "품목 관련성 확인 기준이 명시돼야 함");
  assert.match(standaloneHtml, /법정동코드 완전일치/, "지역 매칭 기준이 명시돼야 함");
  assert.match(standaloneHtml, /주소 확보율은 참고 지표/, "출원인 주소 확보율의 참고 지표 정책이 명시돼야 함");
  // 2026-08-21 사용자 지적: 품목 관련성 설명이 지정상품 검증을 전제로 읽혔지만, 실제로는
  // 대부분의 "출원 확인" 건수가 아직 지정상품 근거 없이(품목명 검색+주소 일치만) 집계돼
  // 있어 설명이 실제보다 과신을 준다. 진행 상태를 정직하게 명시해야 한다.
  assert.match(
    standaloneHtml,
    /대부분의 "출원 확인" 건수는 품목명 검색어와 출원인 주소까지 확인된 집계이며, 등록원부 지정상품 확인은 계속 보완 중입니다/,
    "품목 매칭 기준 설명에 지정상품 미검증 상태에 대한 정직한 안내가 있어야 함",
  );
  // 2026-08-21 사용자 결정: 현행 류 기준(품목에 매핑된 NICE류만 집계)은 유지하고, 서비스류
  // (음식점업 43류·도소매업 35류 등)는 포함하지 않는다는 범위만 명시한다 — 03-match-trademarks/
  // README.md·docs/data-analysis-guide.md·07-dashboard/README.md와 동일 문구로 통일.
  assert.match(
    standaloneHtml,
    /음식점업 43류·도소매업 35류 등 서비스류는 포함하지 않으며 후속 확장 검토 대상입니다/,
    "상표 검색 기준에 서비스류 미포함 범위 안내가 있어야 함",
  );
});

test("ships a valid dashboard snapshot", async () => {
  const snapshot = await loadSnapshot();
  assert.equal(snapshot.schemaVersion, "dashboard-snapshot-v1");
  assert.equal(snapshot.mode, "full");
  assert.equal(snapshot.pipelineStatus.stage, "alpha");
  assert.equal(snapshot.pipelineStatus.uniqueQueryCounts.total, 861);
  // 2026-08-20: 246개 partial 쿼리 중 232개(1라운드 183개 + 2라운드 49개, 사과·포도·
  // 오리 등)를 재수집하면서 지역×품목 표시 가능 건수와 출원인 주소 확인 건수가 함께 늘었다.
  // 이후 원물+지정상품 매칭(212개)이 추가로 일부 항목을 blocked -> available로 바꿔
  // 1,615 -> 1,617이 됐다. (2026-08-25: 품질인증수산물(NFQS) 실데이터 추가 반영으로
  // 1,617 -> 1,761. 지역 정보가 없는 KOFPI 90건("전국" 의사 지역)은 지역별 통계
  // 성격의 이 필드에서 제외한다 — scripts/auditDashboardSnapshot.js가 정확히 이
  // "전국 제외" 기준으로 검증한다(catalogItemCount는 전국 포함 원본 전체). #114)
  assert.equal(snapshot.pipelineStatus.regionalMetricGate.availableRegionItemCount, 1625);
  assert.equal(snapshot.pipelineStatus.collectionExperiment.outputShape, "query_facts_with_region_row_references");
  assert.equal(snapshot.pipelineStatus.applicantRegionVerification.verifiedCount, 77312);
  assert.equal(snapshot.pipelineStatus.regionalMetricGate.coverageThreshold, 0.6);
  assert.ok(snapshot.regions.length > 0);
  assert.ok(snapshot.sources.some((source) => source.sourceId === "kipris_trademark"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "nongsaro"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "nfqs_quality_cert"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "kofpi_forest_product"));
  assert.ok(snapshot.sources.some((source) => source.sourceId === "forest_product_production_survey"));
  assert.equal(snapshot.coverage.catalogItemCount, 1844);
  assert.equal(snapshot.coverage.nationwideCatalogItemCount, 131);
  assert.equal(snapshot.coverage.nationwideCatalogItemsWithRegionalEvidence, 26);
  assert.equal(snapshot.coverage.regionalEvidenceRows, 27);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.uniqueQueryCount, 131);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.completeUniqueQueryCount, 103);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.partialUniqueQueryCount, 28);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.requestCount, 3210);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.uniqueApplicationCount, 68323);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.completeApplicationCount, 68323);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.registryCompleteCount, 10);
  assert.equal(snapshot.pipelineStatus.supplementalCollection.registryNotCollectedCount, 37661);
  const nationwideCatalog = snapshot.regions.find((region) => region.sido === "전국");
  assert.equal(nationwideCatalog?.items.filter((item) => item.sources.includes("kofpi_forest_product")).length, 90);
  assert.equal(nationwideCatalog?.items.filter((item) => item.sources.includes("nfqs_quality_cert")).length, 41);
  assert.equal(
    snapshot.regions.filter((region) => region.sido !== "전국")
      .flatMap((region) => region.items)
      .filter((item) => item.sources.includes("nfqs_quality_cert")).length,
    0,
    "NFQS 인증사업장 소재지를 지역 특산품으로 귀속하면 안 됨",
  );
  assert.ok(snapshot.warnings.some((warning) => warning.includes("jisokaddr") && warning.includes("인증사업장 소재지")));
  const forestEvidenceItems = nationwideCatalog?.items.filter((item) => item.regionalEvidence?.length) || [];
  assert.equal(forestEvidenceItems.length, 26);
  assert.equal(forestEvidenceItems.reduce((sum, item) => sum + item.regionalEvidence.length, 0), 27);
  assert.ok(forestEvidenceItems.every((item) => item.regionalEvidence.every((row) => row.regionalMetricEligible === false)));
  assert.deepEqual(forestEvidenceItems.find((item) => item.itemName === "밤")?.regionalEvidence.map((row) => row.region), ["충청남도 부여군"]);
  assert.deepEqual(forestEvidenceItems.find((item) => item.itemName === "표고")?.regionalEvidence.map((row) => row.region), ["충청남도 부여군", "전라남도 장흥군"]);
  // 2026-08-25: extractForestProductionPrimaryRegions.py의 ALIASES에 "고로쇠"→"수액"을
  // 추가해 표27(고로쇠, 전남 광양시)이 더 이상 unmatchedSourceTables로 빠지지 않는다(#114 리뷰).
  assert.deepEqual(forestEvidenceItems.find((item) => item.itemName === "수액")?.regionalEvidence.map((row) => row.region), ["전라남도 광양시"]);
  // 2026-08-25(#114 리뷰): Dashboard.tsx에만 있고 standalone-client.js에는 없던
  // "공식 생산 주산지 근거" 안내 문구를 두 구현이 다시 같은 내용을 보여주도록 맞췄다.
  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(standaloneHtml, /공식 생산 주산지 근거/, "standalone-client.js도 React와 동일하게 임산물생산조사 근거 문구를 보여줘야 함");
  const items = snapshot.regions.flatMap((region) => region.items);
  assert.ok(items.every((item) => item.itemName && item.noticeName));
  // 검토대기(고시명칭 미확정) 행을 원물명으로 검색한 결과는 matchingBasis=
  // raw_item_name_unclassified이고 niceClass가 없는 게 정상이다(2026-08-12) — 공식
  // 분류 행만 niceClass가 있어야 한다. 2026-08-20: raw_item_goods_matched(원물명 +
  // 등록원부 지정상품 정규화 일치 + 출원인 주소 지역 일치로 AI가 검토·확정한 항목)도
  // 고시명칭 사전 매칭이 아니므로 niceClass는 없는 게 정상이다.
  assert.ok(
    items.every((item) =>
      item.matchingBasis === "notice_name_and_nice_class"
        ? Boolean(item.niceClass)
        : item.matchingBasis === "raw_item_name_unclassified" || item.matchingBasis === "raw_item_goods_matched"
    )
  );
  assert.ok(items.some((item) => item.matchingBasis === "notice_name_and_nice_class"));
  assert.ok(items.some((item) => item.matchingBasis === "raw_item_name_unclassified"));
  assert.ok(items.some((item) => item.matchingBasis === "raw_item_goods_matched"));
  assert.ok(items.every((item) => !["데일리", "일선정품", "상큼愛"].includes(item.itemName)));
  assert.ok(items.some((item) => item.trademarkExamples?.some((example) => example.title)));
  const availableItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
  const blockedItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "blocked");
  assert.equal(availableItems.filter(({ sources }) => !sources.includes("kofpi_forest_product")).length, 1651, "수집 완료 지역×품목은 주소 확보율과 무관하게 공개해야 함");
  const regionalForestItems = snapshot.regions
    .filter((region) => region.sido !== "전국")
    .flatMap((region) => region.items.filter((item) => item.sources.includes("forest_product_production_survey")));
  assert.equal(regionalForestItems.length, 27);
  assert.equal(regionalForestItems.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available").length, 14);
  assert.equal(regionalForestItems.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0), 121);
  assert.ok(availableItems.every((item) => Number.isFinite(item.metrics.uniqueTrademarkCount.value)));
  assert.ok(blockedItems.every((item) => item.metrics.uniqueTrademarkCount.value === null), "차단된 지역 건수를 0 또는 전국 검색 건수로 노출하면 안 됨");
  assert.ok(
    items.every((item) => Number.isFinite(item.metrics.nationwideSearchTrademarkCount.value)),
    "전국 검색 후보 건수는 별도 참고 지표로 보존해야 함"
  );
  const confirmedItems = items.filter((item) => Number(item.metrics.confirmedGoodsMatchCount.value) > 0);
  if (confirmedItems.length > 0) {
    assert.ok(
      confirmedItems.some((item) => item.trademarkExamples?.some((example) => example.goodsMatchMethod === "normalized_exact")),
      "지정상품 확정 건수가 있으면 사례 목록에서도 그 근거를 확인할 수 있어야 함"
    );
  }
  assert.ok(snapshot.warnings.some((warning) => warning.includes("완전한 모집단")));
});

test("shows every region-item in the detail tabs without a name-match badge", async () => {
  // 2026-08-19 데이터 감사 이후 한동안 raw_item_name_unclassified(고시명칭 미확정) 항목을
  // 특산품 탭·기본 선택에서 통째로 숨겼으나, 사용자 재지적(2026-08-21): 고시명칭 매칭은
  // 여러 판정 기준 중 하나일 뿐이고 원물명 그대로라고 특산품이 아닌 것은 아니다. 한때
  // "명칭 확인중" 배지를 붙였으나, 이 역시 사용자 재지적(2026-08-21) — 고시명칭 사전에
  // 없는 건 대개 영구적인 상태라 "확인 중"이라는 말 자체가 오해를 부르고, 억지로
  // 고시명칭화하는 것도 바람직하지 않다. 이제 탭은 region.items 전체를 아무 표시 없이
  // 그대로 보여준다. 기본 선택(selectedItem)은 공식 특산품을 우선하되, state.itemId가
  // 미분류 원물을 가리키면 그 원물 상세를 그대로 보여줘야 한다(임의로 다른 항목으로
  // 바뀌면 안 됨).
  const snapshot = await loadSnapshot();
  const goseong = snapshot.regions.find((region) => region.region.includes("고성군") && region.sido.includes("강원"));
  assert.ok(goseong, "고성군 스냅샷 데이터가 있어야 함");
  const officialGoseongItems = goseong.items.filter((item) => item.matchingBasis === "notice_name_and_nice_class" && item.noticeName);
  const rawGoseongItems = goseong.items.filter((item) => item.matchingBasis === "raw_item_name_unclassified");
  assert.ok(officialGoseongItems.length > 0, "고성군에는 공식 특산품이 있어야 함");
  assert.ok(
    rawGoseongItems.some((item) => item.itemName === "꿀다림 데일리허니") && rawGoseongItems.some((item) => item.itemName === "왕곡한과"),
    "고성군에는 검토대기 원물명·상호가 실제로 섞여 있어야 이 테스트가 의미가 있음",
  );
  const regionsWithoutOfficialItems = snapshot.regions.filter(
    (region) => region.items.length > 0 && !region.items.some((item) => item.matchingBasis === "notice_name_and_nice_class" && item.noticeName),
  );
  assert.ok(regionsWithoutOfficialItems.length > 0, "공식 특산품은 없지만 미분류 원물은 있는 지역이 실제로 있어야 fallback 검증이 의미가 있음");

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(
    standaloneHtml,
    /const officialRegionItems = \(region\) => region\.items\.filter\(\(item\) => officialItemLabel\(item\)\);/,
    "officialRegionItems 자체는 여전히 공식 특산품만 반환해야 함(기본 선택 우선순위에 사용)",
  );
  assert.match(
    standaloneHtml,
    /return region\.items\.map\(\(row\) => \{ const value = row\.metrics\.uniqueTrademarkCount\.value \|\| 0; const selected = item\.specialtyId === row\.specialtyId;.*return `<button type="button" data-region-item="\$\{esc\(row\.specialtyId \|\| ""\)\}" aria-selected="\$\{selected\}"/,
    "특산품 탭은 region.items 전체를 렌더링해야 함(2026-08-24: 출원건수 기반 태그 클라우드로 변경, #112)",
  );
  assert.doesNotMatch(
    standaloneHtml,
    /specialty-namecheck|명칭 확인중/,
    "명칭 확인중 배지는 오해를 부르므로 완전히 제거되어야 함",
  );
  assert.match(
    standaloneHtml,
    /function selectedItem\(region\) \{ const official = officialRegionItems\(region\); return region\.items\.find\(\(item\) => item\.specialtyId === state\.itemId\) \|\| official\[0\] \|\| region\.items\[0\]; \}/,
    "기본 선택은 official을 우선하되, 지정된 itemId가 미분류 원물이어도 그 항목을 그대로 보여줘야 함",
  );
  assert.doesNotMatch(
    standaloneHtml,
    /고시명칭·NICE류가 확인된 특산품이 없습니다/,
    "공식 특산품이 없어도 원물이 있으면 빈 상태 대신 원물 상세를 보여줘야 함",
  );
});

test("shows registered regional examples without nationwide keyword noise", async () => {
  const snapshot = await loadSnapshot();
  const goseong = snapshot.regions.find((region) => region.region.includes("고성군") && region.sido.includes("강원"));
  const haeDeulMi = goseong.items.find((item) => item.itemName === "해&들米");
  assert.ok(haeDeulMi, "해&들米 스냅샷 데이터가 있어야 함");
  assert.ok(
    haeDeulMi.trademarkExamples.length > 0 && haeDeulMi.trademarkExamples.every((example) => (example.goodsEvidence || []).length === 0),
    "해&들米는 상표 사례는 있지만 지정상품 근거는 하나도 없어야 이 테스트가 의미가 있음",
  );
  const chikso = goseong.items.find((item) => item.itemName === "칡소");
  assert.ok(chikso && chikso.matchingBasis === "raw_item_goods_matched" && chikso.trademarkExamples.some((example) => (example.goodsEvidence || []).length > 0),
    "칡소는 raw_item_goods_matched이고 지정상품 근거가 있어야 이 테스트가 의미가 있음");
  const registrationExamples = await loadRegistrationExamples();
  const gimcheonGrape = registrationExamples.entries.find((entry) => entry.region === "경상북도 김천시" && entry.itemName === "포도");
  assert.equal(gimcheonGrape.examples.length, 4);
  assert.ok(gimcheonGrape.examples.every((example) => example.statusCategory === "registered" && example.applicantRegionMatch === "inside"));

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(
    standaloneHtml,
    /const registeredExamples = examples\.filter\(\(example\) =>[\s\S]*example\.applicantRegionMatch === "inside"/,
    "상표 사례 목록은 등록 상태와 지역 주소 일치를 기준으로 렌더링해야 함",
  );
  assert.match(
    standaloneHtml,
    /const regionGoodsConfirmed = item\.matchingBasis === "raw_item_goods_matched";/,
    "raw_item_goods_matched 항목은 이미 지역 주소 일치까지 확인된 사례라는 것을 표시할 수 있어야 함",
  );
  assert.match(standaloneHtml, /마음을 담은 청개구리 포도원/);
  assert.match(standaloneHtml, /4020150073635/);
  assert.doesNotMatch(standaloneHtml, /상세 사례 미연결/);
  assert.doesNotMatch(standaloneHtml, /확인된 출원 사례|품목명 검색 후보는 실제 관련성이 확정되지 않아 표시하지 않습니다/);
  assert.doesNotMatch(
    standaloneHtml,
    /전국 검색 상표 사례/,
    "예전 헤딩(전국 검색 상표 사례)은 오해를 불렀으므로 남아있으면 안 됨",
  );
});

test("resolves a municipality shape to its region even when the map's stale boundary group disagrees with current data", async () => {
  // 이슈 #113: 지도 도형(2013 KOSTAT, 참고용)은 군위군을 여전히 경상북도 그룹 아래
  // 그리지만, 법정동코드 데이터(2023-06-30 반영)는 군위군을 대구광역시로 기록한다.
  // "경상북도" 지도에서 군위군 도형을 클릭했을 때 sido까지 정확히 일치하는 지역을
  // 찾으면 실패해 아무 데이터도 안 뜨는 게 예전 동작이었다 — 시군구명만으로도 찾아
  // 항상 실제(현재) 행정구역 데이터로 연결돼야 한다.
  const snapshot = await loadSnapshot();
  const gunwi = snapshot.regions.find((region) => region.sigungu === "군위군");
  assert.ok(gunwi, "군위군 스냅샷 데이터가 있어야 함");
  assert.equal(gunwi.sido, "대구광역시", "군위군은 2023년 대구로 편입돼 sido가 대구광역시여야 이 테스트가 의미가 있음");

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(
    standaloneHtml,
    /const findMunicipalityRegion = \(province, name\) =>\s*\n?\s*snapshot\.regions\.find\(\(region\) => region\.sido === province && region\.sigungu === name\)\s*\n?\s*\|\| snapshot\.regions\.find\(\(region\) => region\.sigungu === name\);/,
    "sido가 안 맞아도 시군구명만으로 지역을 찾는 폴백이 있어야 함(#113)",
  );
  assert.doesNotMatch(
    standaloneHtml,
    /snapshot\.regions\.find\(\(row\) => row\.sido === state\.province && row\.sigungu === shape\.name\)/,
    "지도 클릭 핸들러가 findMunicipalityRegion을 거치지 않고 sido 정확 일치만 쓰면 안 됨",
  );
});

test("sizes region/item tag clouds by application count instead of listing them plainly", async () => {
  // 이슈 #112: 지자체별 조회의 품목 목록, 품목별 조회의 지역 목록을 리스트 대신
  // 출원건수 기반 태그 클라우드(글자 크기 비례)로 바꿔달라는 요청. 정확한 크기 비교
  // 정확도가 막대그래프보다 낮다는 걸 안내했지만 사용자가 요청대로 진행을 선택함.
  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(
    standaloneHtml,
    /const wordCloudFontSize = \(value, max\) => \{/,
    "출원건수를 글자 크기로 변환하는 공용 헬퍼가 있어야 함",
  );
  assert.match(standaloneHtml, /class="item-tabs word-cloud"/, "지자체별 조회의 품목 탭이 태그 클라우드여야 함");
  assert.match(standaloneHtml, /class="region-chips word-cloud"/, "품목별 조회의 지역 목록이 태그 클라우드여야 함");
  assert.match(
    standaloneHtml,
    /style="font-size:\$\{wordCloudFontSize\(value, max\)\}px;color:\$\{wordCloudColor\(region\)\}"/,
    "각 태그의 font-size는 인라인 style로 출원건수에 비례해 지정해야 함",
  );
  // 2026-08-24(이슈 #112 후속): 태그 클라우드를 더 컬러풀하게 해달라는 요청 —
  // dataviz 스킬로 검증한(all-pairs CVD·정상시각 하한 통과) 4색 텍스트 팔레트를
  // 이름 해시로 고정 배정한다. 선택된 특산품 탭은 초록 배경에 흰 글자를 유지해야
  // 하므로 그 경우만 색을 비워 CSS의 aria-selected 규칙이 이기게 한다.
  assert.match(
    standaloneHtml,
    /const WORD_CLOUD_PALETTE = \["#2876d4", "#cd4d10", "#008856", "#4a3aa7"\];/,
    "태그 클라우드 색상 팔레트는 dataviz 스킬로 검증한 4색 상수여야 함",
  );
  assert.match(
    standaloneHtml,
    /const colorStyle = selected \? "" : `;color:\$\{wordCloudColor\(row\.specialtyId \|\| itemName\(row\)\)\}`;/,
    "선택된 특산품 탭은 색을 비워 CSS의 흰 글자·초록 배경(aria-selected)이 그대로 적용돼야 함",
  );
});

test("shows an adjustable year-range application/registration trend chart", async () => {
  // 이슈 #116: "지역별 상표 출원" 탭에 연도별 출원·등록 추이 그래프 요청. 등록 계열은
  // KIPRIS 검색 결과에 포함된 실제 등록일자(registrationDate)를 연도별로 집계한 값이다.
  const snapshot = await loadSnapshot();
  const withYearData = snapshot.regions
    .flatMap((region) => region.items)
    .filter((item) => item.applicationYearCounts && Object.keys(item.applicationYearCounts).length > 0);
  assert.ok(withYearData.length > 0, "실제 KIPRIS 재실행으로 채운 연도별 출원 데이터가 스냅샷에 있어야 이 기능이 라이브에서 빈 그래프로 뜨지 않음");

  const standaloneHtml = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  assert.match(
    standaloneHtml,
    /const sumYearCounts = \(items, field\) => \{/,
    "연도별 출원·등록 건수를 합산하는 공용 헬퍼가 있어야 함",
  );
  assert.match(
    standaloneHtml,
    /const TREND_CHART = \{ width: 640, height: 190/,
    "추이 그래프는 지자체 상세에 맞는 소형 크기를 사용해야 함",
  );
  assert.match(
    standaloneHtml,
    /const regionTrendHtml = \(region\) => \{/,
    "선택한 지자체의 전체 특산품 추이를 집계하는 렌더러가 있어야 함",
  );
  assert.match(
    standaloneHtml,
    /class="trend-chart trend-chart-compact region-trend"/,
    "지자체 상세에는 별도의 컴팩트 추이 그래프가 있어야 함",
  );
  assert.match(standaloneHtml, /지역 출원·등록 추이/);
  assert.match(
    standaloneHtml,
    /\$\{regionTrendHtml\(region\)\}[\s\S]*class="item-tabs word-cloud"/,
    "지역 추이 그래프는 선택한 지자체의 품목 탭보다 위에 표시되어야 함",
  );
  assert.match(standaloneHtml, /class="trend-chart"/, "지역별 상표 출원 탭에 추이 그래프 섹션이 있어야 함");
  assert.match(
    standaloneHtml,
    /data-trend-preset="all"/,
  );
  assert.match(
    standaloneHtml,
    /data-trend-preset="5"/,
    "전체·최근5년·최근3년·최근1년 프리셋 버튼이 있어야 함",
  );
  assert.match(standaloneHtml, /id="trend-start-input"/, "시작 연도를 직접 입력할 수 있어야 함");
  assert.match(standaloneHtml, /id="trend-end-input"/, "끝 연도를 직접 입력할 수 있어야 함");
  // 2026-08-25(#116 재오픈): "전체 클릭했을 때만 active가 붙던 걸 최근5/3/1년도
  // 눌렀을 때 진하게 표시되도록" — 4개 프리셋 모두 현재 선택 구간과 정확히 일치할 때만
  // active가 붙어야 하고(드래그로 구간을 벗어나면 전부 비활성), 클래스 자체가 항상
  // 출력돼야 한다(전에는 5/3/1년 버튼에 class 속성 자체가 없어 active가 절대 안 붙었음).
  assert.match(standaloneHtml, /data-trend-preset="5"[^>]*class="\$\{trendStart/, "최근5년 버튼도 선택 상태에 따라 active 클래스가 붙어야 함");
  assert.match(standaloneHtml, /data-trend-preset="3"[^>]*class="\$\{trendStart/, "최근3년 버튼도 선택 상태에 따라 active 클래스가 붙어야 함");
  assert.match(standaloneHtml, /data-trend-preset="1"[^>]*class="\$\{trendStart/, "최근1년 버튼도 선택 상태에 따라 active 클래스가 붙어야 함");
  // 참고 이미지의 양 끝 드래그 핸들 구간 조절 바도 추가했다(사용자가 프리셋 버튼만 있던
  // 이전 결정을 뒤집고 요청) — 지도보다 위쪽에 배치된다(coverage-workspace 앞).
  assert.match(standaloneHtml, /class="trend-range-track"/, "양 끝 드래그 핸들 구간 조절 바가 있어야 함");
  assert.match(standaloneHtml, /id="trend-range-handle-start"/);
  assert.match(standaloneHtml, /id="trend-range-handle-end"/);
  assert.ok(
    standaloneHtml.indexOf('class="trend-chart"') < standaloneHtml.indexOf('class="coverage-workspace"'),
    "연도별 추이 그래프 섹션은 지도(coverage-workspace)보다 위쪽에 있어야 함",
  );
  assert.match(
    standaloneHtml,
    /class="trend-line trend-line-application"/,
  );
  assert.match(
    standaloneHtml,
    /class="trend-line trend-line-registered"/,
    "출원(실선)·등록(점선) 두 계열을 모두 그려야 함",
  );
  assert.match(
    standaloneHtml,
    /등록\(등록원부 보강 완료 건\)/,
    "등록 계열이 실제 등록일자와 등록원부 보강 범위를 사용한다는 점을 화면에 밝혀야 함",
  );
  // 2026-08-25(#116): "최근 1년 볼 때 월별로 봐야 그래프가 의미 있다" — KIPRIS 원본
  // 날짜(YYYYMMDD)에서 뽑은 월별 집계(applicationMonthCounts/registrationMonthCounts)로
  // 선택된 연도 구간을 달 단위로도 볼 수 있는 토글을 추가했다.
  const withMonthData = snapshot.regions
    .flatMap((region) => region.items)
    .filter((item) => item.applicationMonthCounts && Object.keys(item.applicationMonthCounts).length > 0);
  assert.ok(withMonthData.length > 0, "실제 KIPRIS 재실행으로 채운 월별 출원 데이터가 스냅샷에 있어야 이 기능이 라이브에서 빈 그래프로 뜨지 않음");
  assert.match(standaloneHtml, /const sumMonthCounts = \(items, field\) => \{/, "월별 출원·등록 건수를 합산하는 공용 헬퍼가 있어야 함");
  assert.match(standaloneHtml, /const monthIndexOf = \(monthKey\) => \{/, "\"YYYY-MM\"을 연속 정수로 바꿔 기존 trendScales/trendLinePath를 그대로 재사용해야 함");
  assert.match(standaloneHtml, /class="trend-granularity"/, "연도별/월별 전환 토글이 있어야 함");
  assert.match(standaloneHtml, /data-trend-granularity="year"/);
  assert.match(standaloneHtml, /data-trend-granularity="month"/);
  assert.match(
    standaloneHtml,
    /trendMonthHasData\s*\?\s*`<div class="trend-granularity"/,
    "월별 데이터가 있는 범위에서만 토글을 노출해야 함(전부 연도별만 있으면 숨김)",
  );
  assert.match(
    standaloneHtml,
    /class="trend-coverage-note"/,
    "월별 데이터가 연도별보다 적은 범위에서는 몇 건에만 있는지 알리는 안내가 있어야 함",
  );
});

test("ships traceable province and municipality geometry", async () => {
  const raw = await readFile(new URL("../public/data/map-geometry.json", import.meta.url), "utf8");
  const geometry = JSON.parse(raw);
  assert.equal(geometry.schemaVersion, "dashboard-map-geometry-v1");
  assert.equal(geometry.boundaryReference.status, "reference_only");
  assert.match(geometry.boundaryReference.sourceUrl, /southkorea-maps|admdongkor/);
  assert.equal(geometry.provinces.length, 16);
  assert.ok(geometry.municipalities["경상북도"].items.some((row) => row.name === "구미시"));
});

test("generates a self-contained standalone dashboard", async () => {
  const html = await readFile(new URL("../../dashboard.html", import.meta.url), "utf8");
  // 2026-08-21: 전국 지도 화살표(연결선)를 없애고 경기도 라벨만 옮기는 방식으로
  // 바꿨다(사용자 요청) — 화살표용 CSS/폴리라인이 더 이상 없어야 한다.
  assert.doesNotMatch(html, /map-region-label-callout|<polyline/, "standalone map should no longer draw leader-line arrows");
  assert.match(html, /const mapLabelMarkup = \(shapes, municipality\)/, "standalone map should render every geometry label regardless of data availability");
  // 2026-08-21: 서울·세종 화살표 대신 경기도 라벨만 옮기는 방식으로 변경(사용자 요청).
  assert.match(html, /경기도: \{ x: 20, y: 38 \}/, "standalone map should nudge only Gyeonggi's label instead of using leader-line arrows");
  assert.doesNotMatch(html, /const calloutLabels/, "legacy all-label callout layout must not remain in the standalone client");
  assert.match(html, /\$\{shapePaths\}\$\{shapeLabels\}/, "standalone map labels should render after every map shape");
  assert.match(html, /function applicationsScreen\(\)/, "standalone dashboard should ship the separate regional application-rate screen");
  assert.match(html, /전국 시도별 출원율/);
  assert.match(html, /출원 확인 특산품/);
  assert.match(html, /시도를 선택하면 시군구 지도로 전환됩니다/);
  assert.match(html, /region\.sigungu \|\| region\.region} \/ \$\{label}/, "전국 목록은 시군구와 특산품을 함께 나열해야 함");
  assert.doesNotMatch(html, /const uniqueItems/, "도 단위 목록에서 중복 품목을 숨겨 총 특산품 수와 목록 수가 달라지면 안 됨");
  assert.match(html, /bindSearchInput\("#item-search", "itemQuery"\)/, "standalone item search should use the IME-safe input binding");
  assert.match(html, /if \(composing \|\| event\.isComposing\) return;/, "standalone search should not rerender during Korean IME composition");
  assert.match(html, /row\.searchTerms\.some\(\(term\) => term && term\.toLocaleLowerCase\("ko-KR"\)\.includes\(keyword\)\)/, "품목 검색은 공식 표시명 외 원물명·고시명칭도 검색해야 함");
  assert.match(html, /<title>지역 특산품-상표 분석·정책지원 플랫폼<\/title>/);
  assert.match(html, /dashboard-snapshot-v1/);
  assert.match(html, /dashboard-map-geometry-v1/);
  assert.match(html, /특산품 수/);
  assert.match(html, /상표 건수/);
  assert.match(html, /출원율/);
  assert.match(html, /등록률/);
  assert.doesNotMatch(html, />수집 범위<|>브랜드 공백|상표 활용 여지/);
  assert.match(html, /지역 확인 출원/);
  assert.match(html, /등록 건수/);
  assert.doesNotMatch(html, /그중 등록/);
  assert.match(html, /지역별 집계 대기/);
  assert.match(html, /class="item-card-grid"/);
  assert.match(html, /지역 확인 전 전국 검색 후보/);
  assert.match(html, /ITEM_ROW_LIMIT = 100/);
  assert.match(html, /상표 출원 건수 상위/);
  assert.match(html, /class="item-regions-detail"/);
  assert.doesNotMatch(html, /class="item-table-head"|표의 수치 읽는 법/);
  // 2026-08-21 사용자 재확인: 분모는 확인 완료분이 아니라 수집된 지역×특산품 전체다.
  assert.match(html, /지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수/);
  assert.doesNotMatch(html, /if \(!officialItemLabel\(item\)\) return;\s*total \+= 1/);
  assert.doesNotMatch(html, /출원인 주소-대상 지역 일치|두 번째 값은 상표의 유효성 비율이 아닙니다|지역 내 출원 관계|지역 고유 상표|지역 등록 상표|>검증 중</);
  assert.doesNotMatch(html, /주소 확인 후보 중 이 지역 비율|지정상품 자동 일치|지정상품 개별 검토|지정상품 근거 확인 사례/);
  assert.match(html, /출원 건수 기준/);
  assert.match(html, /\$\{esc\(itemName\(item\)\)\} 등록 사례/);
  assert.match(html, /등록 \$\{number\(registeredCount\)\}건 중 사례 \$\{number\(registeredExamples\.length\)\}건/);
  assert.match(html, /등록 항목이 확인되지 않았습니다/);
  assert.match(html, /지정상품:/);
  assert.doesNotMatch(html, /등록원부 지정상품에서 확인된 .* 출원|상표명이 아니라 지정상품명에서 품목명이 직접 확인된 사례입니다/);
  assert.match(html, /class="province-list"/);
  assert.match(html, /data-region-group=/);
  assert.match(html, /시도 \$\{grouped\.length\}곳 · 시군구 \$\{rows\.length\}곳/);
  assert.match(html, /expandedRegionProvince/);
  assert.match(html, /전국 지역 브랜드 지도/);
  assert.doesNotMatch(html, /class="showcase"|recent-showcase|최근 1년 상표 출원이 많은/, "표본 상표 또는 중복 표본 집계 랭킹을 공개 요약에 표시하면 안 됨");
  // 2026-08-24: 비어 있던 별도 미확인 탭은 제거하고, 품목별 조회의 미출원(검토중)
  // 상태에서 향후 확장 제안을 이어가도록 화면 구조를 단순화한다.
  assert.doesNotMatch(html, /지역 출원 미확인|function gapsScreen\(\)|id="gap-search"/);
  assert.match(html, /미출원\(검토중\)/);
  assert.match(html, /특화작목 비교/);
  assert.match(html, /class="compare-readiness"/);
  assert.match(html, /비교 기준 원본 확보 전 · 준비 현황만 확인 가능/);
  assert.match(html, /지역별 특산품 출원 현황/);
  assert.match(html, /전체 특산품 출원율/);
  assert.doesNotMatch(html, /판정 완료분 출원율/);
  assert.match(html, /전체 \$\{coverage\.total\}개 중 출원 확인 \$\{coverage\.applied\}개/);
  assert.doesNotMatch(html, /\$\{coverage\.applied\}\/\$\{coverage\.decided\}/);
  assert.match(html, /원본 대기/);
  assert.doesNotMatch(html, /class="compare-grid"/);
  assert.match(html, /데이터 개요/);
  assert.match(html, /수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다\./);
  assert.match(html, /고유 특산품명/);
  assert.match(html, /상표 매칭 결과/);
  assert.doesNotMatch(html, /<script\s+src=|<link\s+[^>]*href=/);
  // 단일 HTML은 클라이언트가 지도·탭·랭킹·판정 기준을 같은 데이터로 렌더링한다.
  assert.match(html, /primary-tabs/);
  assert.match(html, /ranking-table/);
  assert.match(html, /class="criteria"/, "판정 기준 섹션이 단독 HTML에도 동일하게 있어야 함");
  assert.match(html, /dashboardClient\(/);
});
