/* eslint-disable @typescript-eslint/no-unused-vars -- invoked after this source is embedded in dashboard.html */
function dashboardClient(snapshot) {
  const labels = { complete_nonzero: "수집 완료", complete_zero: "결과 0건", partial: "부분 수집", error: "오류", skipped: "건너뜀", not_collected: "미수집", complete: "완료" };
  let selectedRegion = (snapshot.regions.find((region) => region.regionCode) || snapshot.regions[0])?.regionCode || snapshot.regions[0]?.region;
  let selectedItem = "";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
  const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const date = (value) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록";
  const metric = (label, value, formatter = number) => `<article class="detail ${value?.availability === "blocked" ? "blocked" : ""}"><span>${label}</span><strong>${formatter(value?.value)}</strong><small>${esc(value?.rationale || labels[value?.status] || value?.status || "근거 확인 중")}${value?.blockingIssue ? ` · <a class="issue" href="https://github.com/omelette-archive/KIIP/issues/${value.blockingIssue.slice(1)}">${value.blockingIssue}</a>` : ""}</small></article>`;

  const totals = snapshot.regions.reduce((acc, region) => {
    region.items.forEach((item) => {
      acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0;
      acc.registered += item.metrics.registeredTrademarkCount.value || 0;
      acc.review += item.metrics.goodsReviewCandidateCount.value || 0;
    });
    return acc;
  }, { trademarks: 0, registered: 0, review: 0 });

  document.querySelector("#generated").textContent = `마지막 생성 ${date(snapshot.generatedAt)}`;
  document.querySelector("#coverage").textContent = `${snapshot.coverage.observedRegionCount}개 지역 · ${snapshot.coverage.regionItemCount}개 품목`;
  document.querySelector("#totals").innerHTML = [
    ["고유 상표", totals.trademarks, "출원번호 우선 중복 제거"],
    ["등록 상표", totals.registered, "등록 상태 확인 표본"],
    ["지정상품 검토 후보", totals.review, "사람 검토 전 자동 확정 제외"],
    ["수집 상태", snapshot.coverage.partialQueryCount ? "부분" : "완료", `완료 ${snapshot.coverage.completeQueryCount} · 부분 ${snapshot.coverage.partialQueryCount}`],
  ].map((row) => `<article class="metric"><span>${row[0]}</span><strong>${row[1]}</strong><small>${row[2]}</small></article>`).join("");

  function filteredRegions() {
    const query = document.querySelector("#search").value.trim().toLocaleLowerCase("ko-KR");
    return !query ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(query) || region.items.some((item) => (item.noticeName || item.itemName || "").toLocaleLowerCase("ko-KR").includes(query)));
  }

  function render() {
    const rows = filteredRegions();
    if (!rows.some((region) => (region.regionCode || region.region) === selectedRegion)) selectedRegion = rows[0]?.regionCode || rows[0]?.region;
    document.querySelector("#regions").innerHTML = rows.length ? rows.map((region) => `<button class="region-button ${(region.regionCode || region.region) === selectedRegion ? "active" : ""}" data-region="${esc(region.regionCode || region.region)}"><strong>${esc(region.region)}</strong><span>${region.items.length}개 품목 · ${labels[region.dataState] || region.dataState}</span></button>`).join("") : '<p class="empty">검색 결과가 없습니다.</p>';
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { selectedRegion = button.dataset.region; selectedItem = ""; render(); }; });
    const region = rows.find((row) => (row.regionCode || row.region) === selectedRegion);
    if (!region) { document.querySelector("#detail").innerHTML = '<p class="empty">표시할 지역이 없습니다.</p>'; return; }
    const item = region.items.find((row) => row.specialtyId === selectedItem) || region.items[0];
    selectedItem = item?.specialtyId || "";
    document.querySelector("#detail").innerHTML = `<div class="content-top"><div><p class="eyebrow">REGION DETAIL</p><h2>${esc(region.region)}</h2></div><span class="state ${region.dataState === "partial" ? "partial" : ""}">${labels[region.dataState] || region.dataState}</span></div><div class="items">${region.items.map((row) => `<button class="item-button ${row.specialtyId === selectedItem ? "active" : ""}" data-item="${esc(row.specialtyId)}">${esc(row.noticeName || row.itemName || "미지정 품목")}</button>`).join("")}</div>${item ? `<div class="detail-grid">${metric("고유 상표", item.metrics.uniqueTrademarkCount)}${metric("등록 상표", item.metrics.registeredTrademarkCount)}${metric("등록률", item.metrics.registrationRate, percent)}${metric("지역 출원인 비중", item.metrics.localApplicantShare, percent)}${metric("지정상품 자동 확인", item.metrics.confirmedGoodsMatchCount)}${metric("지정상품 검토 후보", item.metrics.goodsReviewCandidateCount)}${metric("브랜드 공백 점수", item.metrics.gapScore)}</div>` : ""}`;
    document.querySelectorAll("[data-item]").forEach((button) => { button.onclick = () => { selectedItem = button.dataset.item; render(); }; });
  }

  document.querySelector("#search").addEventListener("input", render);
  render();
  document.querySelector("#sources").innerHTML = snapshot.sources.map((source) => `<article class="source"><strong>${esc(source.sourceLabel || source.sourceId)}</strong>${source.sourceUrl ? `<p><a href="${esc(source.sourceUrl)}">공식 출처 열기 ↗</a></p>` : ""}<dl><dt>계약 버전</dt><dd>${esc(source.sourceContractVersion || "미기록")}</dd><dt>수집일</dt><dd>${esc(source.sourceFetchedAt || "미기록")}</dd><dt>검증일</dt><dd>${esc(source.sourceLastVerifiedAt || "미기록")}</dd></dl></article>`).join("");
  document.querySelector("#warning-title").textContent = `주의·제약 ${snapshot.warnings.length}건`;
  document.querySelector("#warnings").innerHTML = snapshot.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("");
}
