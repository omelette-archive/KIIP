/* eslint-disable @typescript-eslint/no-unused-vars -- invoked after this source is embedded in dashboard.html */
function dashboardClient(snapshot) {
  const labels = { complete_nonzero: "수집 완료", complete_zero: "결과 0건", partial: "부분 수집", error: "오류", skipped: "건너뜀", not_collected: "미수집", complete: "완료" };
  const tabs = [["summary", "요약"], ["region", "지자체별 조회"], ["item", "품목별 조회"]];
  let activeTab = "summary";
  let rankingLimit = 10;
  let selectedRegion = (snapshot.regions.find((region) => region.regionCode) || snapshot.regions[0])?.regionCode || snapshot.regions[0]?.region;
  let selectedItem = "";
  let selectedItemName = "";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
  const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const date = (value) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록";
  const yyyymmdd = (value) => {
    const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})$/);
    return match ? `${match[1]}.${match[2]}.${match[3]}` : (value || "미기록");
  };
  const metric = (label, value, formatter = number) => `<article class="detail ${value?.availability === "blocked" ? "blocked" : ""}"><span>${label}</span><strong>${formatter(value?.value)}</strong><small>${esc(value?.rationale || labels[value?.status] || value?.status || "근거 확인 중")}${value?.blockingIssue ? ` · <a class="issue" href="https://github.com/omelette-archive/KIIP/issues/${value.blockingIssue.slice(1)}">${value.blockingIssue}</a>` : ""}</small></article>`;

  // 지역×품목을 평탄화한다. 레퍼런스의 "등록상표 랭킹"·"품목별 조회"는 품목을 전국 단위로
  // 재집계하지만, 우리는 아직 그 집계 로직이 없어(대표 출원지역 TOP3 등, 별도 범위) 있는
  // 그대로의 지역×품목 행 단위로만 다룬다.
  function flattenEntries(regions) {
    return regions.flatMap((region) => region.items.map((item) => ({ region, item })));
  }
  function rankingEntries(regions) {
    return flattenEntries(regions).slice().sort((a, b) => {
      const registeredDiff = (b.item.metrics.registeredTrademarkCount.value ?? -1) - (a.item.metrics.registeredTrademarkCount.value ?? -1);
      if (registeredDiff !== 0) return registeredDiff;
      const uniqueDiff = (b.item.metrics.uniqueTrademarkCount.value ?? -1) - (a.item.metrics.uniqueTrademarkCount.value ?? -1);
      if (uniqueDiff !== 0) return uniqueDiff;
      return a.region.region.localeCompare(b.region.region, "ko");
    });
  }
  function groupByItemName(regions) {
    const groups = new Map();
    for (const entry of flattenEntries(regions)) {
      const key = entry.item.noticeName || entry.item.itemName || "미지정 품목";
      const list = groups.get(key) || [];
      list.push(entry);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([name, entries]) => ({ name, entries })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }

  const totals = snapshot.regions.reduce((acc, region) => {
    region.items.forEach((item) => {
      acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0;
      acc.registered += item.metrics.registeredTrademarkCount.value || 0;
      acc.review += item.metrics.goodsReviewCandidateCount.value || 0;
    });
    return acc;
  }, { trademarks: 0, registered: 0, review: 0 });

  // 판정 기준·매칭 방법은 스냅샷 데이터가 아니라 파이프라인 규칙 자체를 설명하는 고정 텍스트다.
  document.querySelector("#criteria").innerHTML = [
    ["대표 특산품 판정", "GI 출처 또는 상표 출원 3건 이상", "#29 확정(2026-08-11) — GI 미등록이어도 출원 활동이 활발하면 대표로 인정(OR 조건)"],
    ["품목 매칭", "고시상품명칭 정확 일치", "지식재산처 고시상품명칭 13판(2026) 기준. 부분·복수 일치는 추정하지 않고 사람 검토로 분리"],
    ["지역 매칭", "법정동코드 완전일치", "국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만"],
    ["상표 검색", "KIPRIS 단어검색(고시명칭 기준)", "NICE류가 있으면 해당 류만, 미상이면 식품 관련 기본 류(29·30·31·32·33·40·43)로 좁힘"],
    ["고유 상표 / 등록 상표", "출원번호 중복 제거 / 상태=등록만", "③단계가 저장한 hit 기준. KIPRIS 전체 검색 건수(totalCount)와 다를 수 있음"],
    ["출원인 지역 매칭", "등록원부 실시간 조회(등록번호 기준)", "등록 완료된 상표만 대상. 주소가 검증된 표본만 지역 내·외 비중 계산에 사용"],
  ].map(([label, value, note]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("");

  function trademarkListHtml(item) {
    const list = item.recentTrademarks || [];
    if (list.length === 0) return "";
    const rows = list.map((t) => `<li><div class="trademark-list-head"><strong>${esc(t.title || "제목 미기록")}</strong><span class="state ${t.applicationStatus === "등록" ? "" : "partial"}">${esc(t.applicationStatus || "상태 미기록")}</span></div><small>${esc(t.applicant || "출원인 미기록")} · 출원 ${esc(yyyymmdd(t.applicationDate))}</small>${t.designatedGoods && t.designatedGoods.length ? `<div class="goods-chips">${t.designatedGoods.map((g) => `<span class="goods-chip">${esc(g)}</span>`).join("")}</div>` : ""}</li>`).join("");
    return `<div class="trademark-list" aria-label="최근 출원 상표"><p class="eyebrow">RECENT FILINGS — ${esc(item.noticeName || item.itemName || "")}는 품목 그룹핑 기준일 뿐, 실제 출원 상표명입니다</p><ul>${rows}</ul></div>`;
  }

  document.querySelector("#generated").textContent = `마지막 생성 ${date(snapshot.generatedAt)}`;
  document.querySelector("#coverage").textContent = `${snapshot.coverage.observedRegionCount}개 지역 · ${snapshot.coverage.regionItemCount}개 품목`;
  document.querySelector("#totals").innerHTML = [
    ["고유 상표", totals.trademarks, "출원번호 우선 중복 제거"],
    ["등록 상표", totals.registered, "등록 상태 확인 표본"],
    ["지정상품 검토 후보", totals.review, "사람 검토 전 자동 확정 제외"],
    ["수집 상태", snapshot.coverage.partialQueryCount ? "부분" : "완료", `완료 ${snapshot.coverage.completeQueryCount} · 부분 ${snapshot.coverage.partialQueryCount}`],
  ].map((row) => `<article class="metric"><span>${row[0]}</span><strong>${row[1]}</strong><small>${row[2]}</small></article>`).join("");

  document.querySelector("#tabs").innerHTML = tabs.map(([key, label]) => `<button type="button" role="tab" class="tab-button ${key === activeTab ? "active" : ""}" aria-selected="${key === activeTab}" data-tab="${key}">${label}</button>`).join("");
  function bindTabs() {
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { activeTab = button.dataset.tab; applyTabVisibility(); }; });
  }
  function applyTabVisibility() {
    document.querySelectorAll("[data-tab]").forEach((button) => { button.classList.toggle("active", button.dataset.tab === activeTab); button.setAttribute("aria-selected", String(button.dataset.tab === activeTab)); });
    document.querySelector("#totals").hidden = activeTab !== "summary";
    document.querySelector("#ranking").hidden = activeTab !== "summary";
    document.querySelector("#region-view").hidden = activeTab !== "region";
    document.querySelector("#item-view").hidden = activeTab !== "item";
  }
  bindTabs();
  applyTabVisibility();

  function renderRanking() {
    const rows = rankingEntries(snapshot.regions).slice(0, rankingLimit);
    document.querySelector("#ranking").innerHTML = `<div class="ranking-head"><div><p class="eyebrow">TRADEMARK RANKING</p><h2>지역×품목 등록상표 랭킹</h2></div><div class="ranking-toggle" role="group" aria-label="랭킹 표시 건수">${[10, 50].map((limit) => `<button type="button" data-limit="${limit}" class="${limit === rankingLimit ? "active" : ""}">TOP ${limit}</button>`).join("")}</div></div><p class="ranking-note">품목명이 같아도 지역이 다르면 별도 행으로 표시합니다. 전국 품목 단위 집계(대표 출원지역 TOP3, 지리적표시 현황 등)는 아직 준비 중입니다.</p><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>품목</th><th>NICE류</th><th>등록상표</th><th>고유상표</th><th>수집상태</th></tr></thead><tbody>${rows.length ? rows.map((entry, index) => `<tr><td>${index + 1}</td><td>${esc(entry.region.region)}</td><td>${esc(entry.item.noticeName || entry.item.itemName || "미지정 품목")}</td><td>${esc(entry.item.niceClass || "미확정")}</td><td>${number(entry.item.metrics.registeredTrademarkCount.value)}</td><td>${number(entry.item.metrics.uniqueTrademarkCount.value)}</td><td><span class="state ${entry.item.dataState === "partial" ? "partial" : ""}">${esc(labels[entry.item.dataState] || entry.item.dataState)}</span></td></tr>`).join("") : '<tr><td colspan="7" class="empty">랭킹에 표시할 데이터가 없습니다.</td></tr>'}</tbody></table></div>`;
    document.querySelectorAll("[data-limit]").forEach((button) => { button.onclick = () => { rankingLimit = Number(button.dataset.limit); renderRanking(); }; });
  }
  renderRanking();

  function filteredRegions() {
    const query = document.querySelector("#search").value.trim().toLocaleLowerCase("ko-KR");
    return !query ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(query) || region.items.some((item) => (item.noticeName || item.itemName || "").toLocaleLowerCase("ko-KR").includes(query)));
  }

  function renderRegionView() {
    const rows = filteredRegions();
    if (!rows.some((region) => (region.regionCode || region.region) === selectedRegion)) selectedRegion = rows[0]?.regionCode || rows[0]?.region;
    document.querySelector("#regions").innerHTML = rows.length ? rows.map((region) => `<button class="region-button ${(region.regionCode || region.region) === selectedRegion ? "active" : ""}" data-region="${esc(region.regionCode || region.region)}"><strong>${esc(region.region)}</strong><span>${region.items.length}개 품목 · ${labels[region.dataState] || region.dataState}</span></button>`).join("") : '<p class="empty">검색 결과가 없습니다.</p>';
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { selectedRegion = button.dataset.region; selectedItem = ""; renderRegionView(); }; });
    const region = rows.find((row) => (row.regionCode || row.region) === selectedRegion);
    if (!region) { document.querySelector("#detail").innerHTML = '<p class="empty">표시할 지역이 없습니다.</p>'; return; }
    const item = region.items.find((row) => row.specialtyId === selectedItem) || region.items[0];
    selectedItem = item?.specialtyId || "";
    document.querySelector("#detail").innerHTML = `<div class="content-top"><div><p class="eyebrow">REGION DETAIL</p><h2>${esc(region.region)}</h2></div><span class="state ${region.dataState === "partial" ? "partial" : ""}">${labels[region.dataState] || region.dataState}</span></div><div class="items">${region.items.map((row) => `<button class="item-button ${row.specialtyId === selectedItem ? "active" : ""}" data-item="${esc(row.specialtyId)}">${esc(row.noticeName || row.itemName || "미지정 품목")}</button>`).join("")}</div>${item ? `<p class="item-breadcrumb">${esc(region.region)} / ${esc(item.noticeName || item.itemName || "미지정 품목")}</p><div class="detail-grid">${metric("고유 상표", item.metrics.uniqueTrademarkCount)}${metric("등록 상표", item.metrics.registeredTrademarkCount)}${metric("등록률", item.metrics.registrationRate, percent)}${metric("지역 출원인 비중", item.metrics.localApplicantShare, percent)}${metric("지정상품 자동 확인", item.metrics.confirmedGoodsMatchCount)}${metric("지정상품 검토 후보", item.metrics.goodsReviewCandidateCount)}${metric("브랜드 공백 점수", item.metrics.gapScore)}</div>${trademarkListHtml(item)}` : ""}`;
    document.querySelectorAll("[data-item]").forEach((button) => { button.onclick = () => { selectedItem = button.dataset.item; renderRegionView(); }; });
  }

  document.querySelector("#search").addEventListener("input", renderRegionView);
  renderRegionView();

  const itemGroups = groupByItemName(snapshot.regions);
  function filteredItemGroups() {
    const query = document.querySelector("#item-search").value.trim().toLocaleLowerCase("ko-KR");
    return !query ? itemGroups : itemGroups.filter((group) => group.name.toLocaleLowerCase("ko-KR").includes(query));
  }
  function renderItemView() {
    const groups = filteredItemGroups();
    if (!groups.some((group) => group.name === selectedItemName)) selectedItemName = groups[0]?.name || "";
    document.querySelector("#items").innerHTML = groups.length ? groups.map((group) => {
      const registeredTotal = group.entries.reduce((sum, entry) => sum + (entry.item.metrics.registeredTrademarkCount.value || 0), 0);
      return `<button class="region-button ${group.name === selectedItemName ? "active" : ""}" data-item-name="${esc(group.name)}"><strong>${esc(group.name)}</strong><span>${group.entries.length}개 지역 · 등록 ${number(registeredTotal)}건</span></button>`;
    }).join("") : '<p class="empty">검색 결과가 없습니다.</p>';
    document.querySelectorAll("[data-item-name]").forEach((button) => { button.onclick = () => { selectedItemName = button.dataset.itemName; renderItemView(); }; });
    const group = groups.find((row) => row.name === selectedItemName);
    if (!group) { document.querySelector("#item-detail").innerHTML = '<p class="empty">표시할 품목이 없습니다.</p>'; return; }
    document.querySelector("#item-detail").innerHTML = `<div class="content-top"><div><p class="eyebrow">ITEM DETAIL</p><h2>${esc(group.name)}</h2><p>${group.entries.length}개 지역에서 확인됨</p></div></div><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>지역</th><th>NICE류</th><th>등록상표</th><th>고유상표</th><th>등록률</th><th>수집상태</th></tr></thead><tbody>${group.entries.map((entry) => `<tr><td>${esc(entry.region.region)}</td><td>${esc(entry.item.niceClass || "미확정")}</td><td>${number(entry.item.metrics.registeredTrademarkCount.value)}</td><td>${number(entry.item.metrics.uniqueTrademarkCount.value)}</td><td>${percent(entry.item.metrics.registrationRate.value)}</td><td><span class="state ${entry.item.dataState === "partial" ? "partial" : ""}">${esc(labels[entry.item.dataState] || entry.item.dataState)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }
  document.querySelector("#item-search").addEventListener("input", renderItemView);
  renderItemView();

  document.querySelector("#sources").innerHTML = snapshot.sources.map((source) => `<article class="source"><strong>${esc(source.sourceLabel || source.sourceId)}</strong>${source.sourceUrl ? `<p><a href="${esc(source.sourceUrl)}">공식 출처 열기 ↗</a></p>` : ""}<dl><dt>계약 버전</dt><dd>${esc(source.sourceContractVersion || "미기록")}</dd><dt>수집일</dt><dd>${esc(source.sourceFetchedAt || "미기록")}</dd><dt>검증일</dt><dd>${esc(source.sourceLastVerifiedAt || "미기록")}</dd></dl></article>`).join("");
  document.querySelector("#warning-title").textContent = `주의·제약 ${snapshot.warnings.length}건`;
  document.querySelector("#warnings").innerHTML = snapshot.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("");
}
