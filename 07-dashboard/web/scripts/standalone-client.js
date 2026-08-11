/* eslint-disable @typescript-eslint/no-unused-vars -- embedded and invoked by dashboard.html */
function dashboardClient(snapshot, geometry) {
  const labels = { complete_nonzero: "수집 완료", complete_zero: "결과 0건", partial: "부분 수집", error: "오류", skipped: "건너뜀", not_collected: "미수집", complete: "완료" };
  const tabs = { summary: "요약", regions: "지자체별 조회", items: "품목별 조회", compare: "특화작목 비교" };
  const mapLabels = { trademarks: "상표 건수", registration: "등록률", coverage: "수집 범위", gap: "브랜드 공백" };
  const state = { tab: "summary", query: "", itemQuery: "", regionKey: snapshot.regions[0]?.regionCode || snapshot.regions[0]?.region, itemId: "", mapMetric: "trademarks", province: null, municipality: null };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
  const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const date = (value) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록";
  const itemName = (item) => item.noticeName || item.itemName || "미지정 품목";
  const regionKey = (region) => region.regionCode || region.region;
  const fill = (value, max) => value === null ? "#e5e1d7" : `color-mix(in srgb, #1f6d56 ${Math.round(24 + Math.max(.12, Math.min(1, max ? value / max : 0)) * 68)}%, #e7eee9)`;
  const totals = snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0 });
  const provinceStats = new Map();
  snapshot.regions.forEach((region) => {
    const name = region.sido || region.region;
    const row = provinceStats.get(name) || { trademarks: 0, registered: 0, items: 0, complete: 0, gaps: [] };
    region.items.forEach((item) => { row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; row.items += 1; if (["complete_nonzero", "complete_zero"].includes(item.dataState)) row.complete += 1; if (typeof item.metrics.gapScore.value === "number") row.gaps.push(item.metrics.gapScore.value); });
    provinceStats.set(name, row);
  });
  const hasGap = [...provinceStats.values()].some((row) => row.gaps.length);

  function provinceValue(name) {
    const row = provinceStats.get(name); if (!row) return null;
    if (state.mapMetric === "trademarks") return row.trademarks;
    if (state.mapMetric === "registration") return row.trademarks ? row.registered / row.trademarks : 0;
    if (state.mapMetric === "coverage") return row.items;
    return row.gaps.length ? row.gaps.reduce((a, b) => a + b, 0) / row.gaps.length : null;
  }
  function regionValue(region) {
    if (!region) return null;
    const trademarks = region.items.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0);
    const registered = region.items.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0);
    if (state.mapMetric === "trademarks") return trademarks;
    if (state.mapMetric === "registration") return trademarks ? registered / trademarks : 0;
    if (state.mapMetric === "coverage") return region.items.length;
    const gaps = region.items.map((item) => item.metrics.gapScore.value).filter((value) => typeof value === "number");
    return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  }
  function mapValueLabel(value) { if (value === null) return "데이터 없음"; if (state.mapMetric === "registration") return percent(value); if (state.mapMetric === "gap") return `${Math.round(value)}점`; return `${number(value)}${state.mapMetric === "trademarks" ? "건" : "개 품목"}`; }
  function selectedRegion() { return snapshot.regions.find((region) => regionKey(region) === state.regionKey) || snapshot.regions[0]; }
  function selectedItem(region) { return region.items.find((item) => item.specialtyId === state.itemId) || region.items[0]; }

  function nav() {
    document.querySelector("#primary-tabs").innerHTML = Object.entries(tabs).map(([key, label]) => `<button type="button" data-tab="${key}" class="${state.tab === key ? "active" : ""}" ${state.tab === key ? 'aria-current="page"' : ""}>${label}</button>`).join("");
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { state.tab = button.dataset.tab; state.query = ""; state.itemQuery = ""; render(); }; });
  }

  function summaryScreen() {
    const visibleRegions = state.province ? snapshot.regions.filter((region) => (region.sido || region.region) === state.province && (!state.municipality || region.sigungu === state.municipality)) : snapshot.regions;
    const visibleItems = visibleRegions.flatMap((region) => region.items.map((item) => ({ region, item }))).sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const nationalMax = Math.max(1, ...geometry.provinces.map((shape) => provinceValue(shape.name) || 0));
    const municipalMax = municipal ? Math.max(1, ...municipal.items.map((shape) => regionValue(snapshot.regions.find((region) => region.sido === state.province && region.sigungu === shape.name)) || 0)) : 1;
    const shapes = municipal ? municipal.items.map((shape) => { const region = snapshot.regions.find((row) => row.sido === state.province && row.sigungu === shape.name); const value = regionValue(region); return `<g><path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, municipalMax)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path><text x="${shape.labelX}" y="${shape.labelY}" class="map-label">${esc(shape.name.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구)$/u, ""))}</text></g>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name); return `<g><path d="${shape.d}" class="map-shape" style="fill:${fill(value, nationalMax)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path><text x="${shape.labelX}" y="${shape.labelY}" class="map-label">${esc(shape.name.replace(/(특별자치도|특별자치시|통합특별시|특별시|광역시|도)$/u, ""))}</text></g>`; }).join("");
    return `<section class="hero"><div><p class="eyebrow">LOCAL BRAND OBSERVATORY</p><h1>지역 특산품의 상표 공백을<br>지도와 근거로 살펴봅니다.</h1><p class="hero-copy">레퍼런스의 지도·지자체·품목·특화작목 구조를 따르되, 수집된 값과 미수집 상태를 섞지 않습니다. 현재는 소규모 E2E 검증 범위입니다.</p></div><div class="hero-note"><span>현재 검증 범위</span><strong>${snapshot.coverage.observedRegionCount}개 지역 · ${snapshot.coverage.regionItemCount}개 품목</strong><p>전국 지도 틀은 표시하지만 색상 값은 샘플이 존재하는 지역에만 적용합니다.</p></div></section>
    <section class="metrics"><article><span>고유 상표</span><strong>${number(totals.trademarks)}</strong><small>출원번호 우선 중복 제거</small></article><article><span>등록 상표</span><strong>${number(totals.registered)}</strong><small>등록 상태 확인 표본</small></article><article><span>지정상품 검토 후보</span><strong>${number(totals.review)}</strong><small>확실한 항목만 자동 확정</small></article><article><span>수집 상태</span><strong>${snapshot.coverage.partialQueryCount ? "부분" : "완료"}</strong><small>완료 ${snapshot.coverage.completeQueryCount} · 부분 ${snapshot.coverage.partialQueryCount}</small></article></section>
    <section class="map-workspace"><div class="map-card"><div class="map-heading"><div><p class="eyebrow">BRAND GAP MAP</p><h2>${state.province ? `${esc(state.province)} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span class="reference-chip">참고 경계 · 2013 KOSTAT</span></div><div class="map-toolbar"><div class="map-metrics">${Object.entries(mapLabels).map(([key, label]) => `<button type="button" data-map-metric="${key}" class="${state.mapMetric === key ? "active" : ""}" ${key === "gap" && !hasGap ? 'disabled title="현재 샘플의 공백 점수가 차단 상태입니다."' : ""}>${label}</button>`).join("")}</div>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div><div class="map-stage"><svg class="korea-map" viewBox="${municipal?.viewBox || geometry.viewBox}" role="img" aria-label="${state.province ? `${esc(state.province)} 시군구 지도` : "대한민국 시도 지도"}">${shapes}</svg></div><div class="map-legend"><span><i class="legend-swatch no-data"></i>데이터 없음</span><span><i class="legend-swatch low"></i>낮음</span><span><i class="legend-swatch high"></i>높음</span><strong>${mapLabels[state.mapMetric]} 기준</strong></div><p class="map-warning">${esc(geometry.boundaryReference.warning)} 공백 점수는 #29 기준과 값이 준비될 때만 활성화됩니다.</p></div>
    <aside class="map-insight"><p class="eyebrow">SELECTED AREA</p><h2>${esc(state.municipality || state.province || "전국 샘플")}</h2><p class="insight-summary">${state.province ? `${visibleRegions.length}개 수집 지역, ${visibleItems.length}개 품목` : `${snapshot.coverage.observedRegionCount}개 수집 지역만 색상에 반영`}</p><div class="mini-list">${visibleItems.slice(0, 5).map(({ region, item }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span><strong>${esc(itemName(item))}</strong><small>${esc(region.region)}</small></span><b>${number(item.metrics.uniqueTrademarkCount.value)}건</b></button>`).join("") || '<p class="empty">이 지역의 샘플 데이터가 없습니다.</p>'}</div><div class="insight-note"><strong>표시 원칙</strong><p>샘플이 없는 지역은 0건이 아니라 ‘데이터 없음’입니다. 회색 영역을 상표 공백으로 해석하지 않습니다.</p></div></aside></section>`;
  }

  function regionDetail(region, item) {
    return `<div class="detail-panel"><div class="detail-heading"><div><p class="eyebrow">REGION DETAIL</p><h2>${esc(region.region)}</h2><p>법정동코드 ${esc(region.regionCode || "미확정")}</p></div><span class="state state-${esc(region.dataState)}">${esc(labels[region.dataState] || region.dataState)}</span></div><div class="item-tabs">${region.items.map((row) => `<button type="button" data-region-item="${esc(row.specialtyId || "")}" aria-selected="${item.specialtyId === row.specialtyId}">${esc(itemName(row))}</button>`).join("")}</div><div class="item-title"><div><span>선택 품목</span><h3>${esc(itemName(item))}</h3></div><span class="class-chip">NICE ${esc(item.niceClass || "미확정")}</span></div><div class="detail-grid"><article><span>고유 상표</span><strong>${number(item.metrics.uniqueTrademarkCount.value)}건</strong><small>${esc(item.metrics.uniqueTrademarkCount.rationale)}</small></article><article><span>등록 상표</span><strong>${number(item.metrics.registeredTrademarkCount.value)}건</strong><small>등록률 ${percent(item.metrics.registrationRate.value)}</small></article><article><span>지역 출원인 비중</span><strong>${percent(item.metrics.localApplicantShare.value)}</strong><small>${item.metrics.localApplicantShare.availability === "blocked" ? "주소 검증률 부족" : "등록원부 주소 근거"}</small></article><article><span>브랜드 공백 점수</span><strong>${item.metrics.gapScore.value ?? "검토 중"}</strong><small>${item.metrics.gapScore.availability === "blocked" ? "#29 기준 또는 대표성 근거 확인" : "낮은 상표 활용도 기준"}</small></article></div><div class="review-strip"><div><span>자동 확정</span><strong>${number(item.metrics.confirmedGoodsMatchCount.value)}건</strong></div><div><span>사람 검토 필요</span><strong>${number(item.metrics.goodsReviewCandidateCount.value)}건</strong></div><p>확실한 항목은 자동 처리하고, 지정상품 후보처럼 눈으로 볼 항목만 검토 큐에 남깁니다.</p></div></div>`;
  }
  function regionsScreen() {
    const keyword = state.query.trim().toLocaleLowerCase("ko-KR");
    const rows = !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => itemName(item).toLocaleLowerCase("ko-KR").includes(keyword)));
    if (!rows.some((region) => regionKey(region) === state.regionKey) && rows[0]) state.regionKey = regionKey(rows[0]);
    const region = selectedRegion(), item = selectedItem(region);
    return `<section class="screen-section"><div class="screen-heading"><div><p class="eyebrow">LOCAL GOVERNMENT</p><h1>지자체별 조회</h1></div><p>지역 → 품목 → 근거 지표 순으로 확인합니다.</p></div><section class="workspace"><aside class="region-panel"><div class="panel-heading"><div><p class="eyebrow">REGION INDEX</p><h2>수집 지역</h2></div><span>${rows.length}건</span></div><label class="search-field"><span class="sr-only">지역 또는 품목 검색</span><input id="region-search" value="${esc(state.query)}" placeholder="지역 또는 품목 검색"></label><div class="region-list">${rows.map((row) => { const count = row.items.reduce((sum, entry) => sum + (entry.metrics.uniqueTrademarkCount.value || 0), 0); return `<button type="button" data-region="${esc(regionKey(row))}" class="region-button ${regionKey(row) === state.regionKey ? "active" : ""}"><span><strong>${esc(row.region)}</strong><small>${row.items.length}개 품목 · 상표 ${number(count)}건</small></span><span class="state state-${esc(row.dataState)}">${esc(labels[row.dataState] || row.dataState)}</span></button>`; }).join("") || '<p class="empty">검색 결과가 없습니다.</p>'}</div></aside>${regionDetail(region, item)}</section></section>`;
  }
  function itemRows() {
    const rows = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => { const name = itemName(item); const row = rows.get(name) || { name, trademarks: 0, registered: 0, regions: [] }; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; if (!row.regions.includes(region.region)) row.regions.push(region.region); rows.set(name, row); }));
    const keyword = state.itemQuery.trim().toLocaleLowerCase("ko-KR");
    return [...rows.values()].filter((row) => !keyword || row.name.toLocaleLowerCase("ko-KR").includes(keyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword))).sort((a, b) => b.trademarks - a.trademarks);
  }
  function itemsScreen() {
    const rows = itemRows(); return `<section class="screen-section"><div class="screen-heading"><div><p class="eyebrow">ITEM EXPLORER</p><h1>품목별 조회</h1></div><p>품목을 기준으로 지역과 상표 활동을 다시 묶었습니다.</p></div><div class="item-screen"><div class="item-screen-toolbar"><label><span class="sr-only">품목 검색</span><input id="item-search" value="${esc(state.itemQuery)}" placeholder="품목 또는 지역 검색"></label><span>${rows.length}개 품목</span></div><div class="item-table"><div class="item-table-head"><span>품목</span><span>수집 지역</span><span>고유 상표</span><span>등록 상표</span><span>등록률</span></div>${rows.map((row, index) => `<div class="item-table-row"><span><b>${String(index + 1).padStart(2, "0")}</b><strong>${esc(row.name)}</strong></span><span>${esc(row.regions.join(", "))}</span><span>${number(row.trademarks)}건</span><span>${number(row.registered)}건</span><span>${percent(row.trademarks ? row.registered / row.trademarks : null)}</span></div>`).join("")}</div><div class="method-note"><strong>집계 기준</strong><p>현재 스냅샷의 정규화된 품목명을 기준으로 지역별 결과를 재그룹했습니다. 샘플 밖 지역은 포함하지 않습니다.</p></div></div></section>`;
  }
  function compareScreen() {
    return `<section class="screen-section"><div class="screen-heading"><div><p class="eyebrow">SPECIALIZED CROP MATCH</p><h1>특화작목 비교</h1></div><p>정책 지정 작목과 실제 상표 활동의 일치 여부를 비교하는 화면입니다.</p></div><div class="compare-banner"><span>현재 상태</span><strong>정책 지정 특화작목 원본 미수집 · 비교 대기</strong><p>농사로 지역특산물과 정책 지정 특화작목은 같은 데이터가 아니므로 임의로 대체하지 않습니다.</p></div><div class="compare-grid">${[...provinceStats.entries()].map(([province, row]) => { const names = snapshot.regions.filter((region) => (region.sido || region.region) === province).flatMap((region) => region.items.map(itemName)); return `<article><div class="compare-head"><h2>${esc(province)}</h2><span>비교 대기</span></div><dl><dt>현재 공식 특산품 후보</dt><dd>${esc(names.join(", ") || "없음")}</dd><dt>정책 지정 특화작목</dt><dd class="missing">미수집</dd><dt>상표 활동 표본</dt><dd>${number(row.trademarks)}건</dd><dt>일치 여부</dt><dd class="missing">판정 불가</dd></dl></article>`; }).join("")}</div><div class="compare-sources"><article><span>추가 수집 1</span><strong>농촌진흥청 지역특화작목 지정 목록</strong><p>계획 기간·지역·작목·근거 버전을 구조화해야 합니다.</p></article><article><span>추가 수집 2</span><strong>한국지식재산연구원 로컬브랜드 근거</strong><p>2024년 보고서의 지역·품목 대응표와 페이지 근거가 필요합니다.</p></article><article><span>자동화 원칙</span><strong>정책 목록 확보 후 결정론적 비교</strong><p>명칭 후보만 사람 검토하고 나머지 집계·일치 판정은 자동화합니다.</p></article></div></section>`;
  }

  function provenance() {
    document.querySelector("#provenance").innerHTML = `<div class="section-heading"><div><p class="eyebrow">TRACEABLE BY DESIGN</p><h2>출처와 데이터 상태</h2></div><span>${esc(snapshot.schemaVersion)}</span></div><div class="source-grid">${snapshot.sources.filter((source) => source.sourceUrl).map((source) => `<a href="${esc(source.sourceUrl)}" target="_blank" rel="noreferrer"><span>${esc(source.sourceLabel || source.sourceId)}</span><strong>${esc(source.sourceContractVersion || "버전 미기록")}</strong><small>검증 ${esc(source.sourceLastVerifiedAt || date(source.sourceFetchedAt))}</small></a>`).join("")}<a href="${esc(geometry.boundaryReference.sourceUrl)}" target="_blank" rel="noreferrer"><span>지도 경계</span><strong>${esc(geometry.boundaryReference.sourceName)}</strong><small>${esc(geometry.boundaryReference.sourceBasis)} · 참고용</small></a></div><details><summary>현재 해석 주의사항 ${snapshot.warnings.length}건 보기</summary><ul>${snapshot.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></details>`;
  }
  function bind() {
    document.querySelectorAll("[data-map-metric]").forEach((button) => { button.onclick = () => { state.mapMetric = button.dataset.mapMetric; render(); }; });
    document.querySelectorAll("[data-province]").forEach((shape) => { const open = () => { state.province = shape.dataset.province; state.municipality = null; render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    document.querySelectorAll("[data-municipality]").forEach((shape) => { const open = () => { state.municipality = shape.dataset.municipality; const region = snapshot.regions.find((row) => row.sido === state.province && row.sigungu === state.municipality); if (region) state.regionKey = regionKey(region); render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    const back = document.querySelector("#map-back"); if (back) back.onclick = () => { state.province = null; state.municipality = null; render(); };
    document.querySelectorAll("[data-open-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.openRegion; state.itemId = button.dataset.openItem; state.tab = "regions"; render(); }; });
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.region; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-region-item]").forEach((button) => { button.onclick = () => { state.itemId = button.dataset.regionItem; render(); }; });
    const regionSearch = document.querySelector("#region-search"); if (regionSearch) regionSearch.oninput = () => { state.query = regionSearch.value; render(); document.querySelector("#region-search")?.focus(); };
    const itemSearch = document.querySelector("#item-search"); if (itemSearch) itemSearch.oninput = () => { state.itemQuery = itemSearch.value; render(); document.querySelector("#item-search")?.focus(); };
  }
  function render() {
    nav();
    document.querySelector("#app").innerHTML = state.tab === "summary" ? summaryScreen() : state.tab === "regions" ? regionsScreen() : state.tab === "items" ? itemsScreen() : compareScreen();
    bind();
  }

  document.querySelector("#generated").textContent = `마지막 생성 ${date(snapshot.generatedAt)}`;
  document.querySelector("#snapshot-id").textContent = `Snapshot ${snapshot.snapshotId}`;
  document.querySelector("#brand-home").onclick = () => { state.tab = "summary"; render(); };
  provenance();
  render();
}
