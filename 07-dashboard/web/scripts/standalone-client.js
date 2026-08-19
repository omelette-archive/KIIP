/* eslint-disable @typescript-eslint/no-unused-vars -- embedded and invoked by dashboard.html */
function dashboardClient(snapshot, geometry) {
  const labels = { complete_nonzero: "수집 완료", complete_zero: "결과 0건", partial: "부분 수집", error: "오류", skipped: "건너뜀", not_collected: "미수집", complete: "완료" };
  const tabs = { summary: "요약", regions: "지자체별 조회", items: "품목별 조회", compare: "특화작목 비교", data: "데이터 개요" };
  const mapLabels = { trademarks: "상표 건수", registration: "등록률", coverage: "수집 범위", filing: "출원율" };
  const state = { tab: "summary", query: "", itemQuery: "", regionKey: snapshot.regions[0]?.regionCode || snapshot.regions[0]?.region, itemId: "", mapMetric: "trademarks", province: null, municipality: null, rankingLimit: 10 };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
  const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const date = (value) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록";
  const compactDate = (value) => value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}` : value || "출원일 미기록";
  const itemName = (item) => item.itemName || item.noticeName || "미지정 품목";
  // item.noticeName은 고시명칭이 확정 안 된 행에도 채워져 있다(③ 검색에 쓴 원물명 검색어를
  // 그대로 담음 — 04-analyze-brand/lib/analyzer.js entryDimensions 참고). matchingBasis가
  // notice_name_and_nice_class일 때만 실제로 지식재산처 고시상품명칭 사전과 대조해 확정된
  // 값이므로, "고시명칭"이라는 라벨은 이 조건을 거친 값에만 붙여야 한다 — 아니면 원물명이나
  // (검토대기 상태에서 상표 검색에 쓰인) 임의 검색어를 마치 공식 분류인 것처럼 보여주게 된다.
  const officialNoticeName = (item) => item.matchingBasis === "notice_name_and_nice_class" ? item.noticeName : null;
  const noticeBasis = (item) => { const name = officialNoticeName(item); return name ? `고시명칭 ${name}` : "고시명칭 미확정"; };
  // 신선한/미가공 접두어는 품목 자체가 아니라 매칭 규칙이 붙인 수식어라, 품목별 조회처럼
  // 여러 지역을 하나의 품목으로 묶어 보여줄 때는 "신선한 사과"가 아니라 "사과"로
  // 표시한다(02-normalize-items/lib/ruleNormalizer.js의 접두어 화이트리스트와 동일 어휘).
  const DISPLAY_PREFIXES = ["신선한 ", "미가공 "];
  const officialItemLabel = (item) => {
    const name = officialNoticeName(item);
    if (!name) return null;
    const prefix = DISPLAY_PREFIXES.find((candidate) => name.startsWith(candidate));
    return prefix ? name.slice(prefix.length) : name;
  };
  const goodsMethod = (method) => ({ normalized_exact: "특산품 활용 확정", normalized_contains: "고시명칭 포함·인정", class_only: "NICE류 검토", mismatch: "지정상품 불일치", unverified: "미검증" })[method] || method;
  const verdictTitle = (verdict) => `사람이 개별 승인하지 않고 규칙 기반 알고리즘이 자동 확정(${verdict.method || "algorithm"}, 신뢰도 ${verdict.confidence ?? "미기록"})`;
  const regionKey = (region) => region.regionCode || region.region;
  const fill = (value, max) => value === null ? "#e5e1d7" : `color-mix(in srgb, #1f6d56 ${Math.round(24 + Math.max(.12, Math.min(1, max ? value / max : 0)) * 68)}%, #e7eee9)`;
  const totals = snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { acc.availableItems += 1; acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; } acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0, availableItems: 0 });
  const sourceLine = snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean).join(" · ");
  const pipeline = snapshot.pipelineStatus;
  const isAlpha = pipeline?.stage === "alpha";
  const scopeLabel = isAlpha ? "알파 테스트 · 부분 수집" : snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터";
  const gateTotal = pipeline ? pipeline.regionalMetricGate.availableRegionItemCount + pipeline.regionalMetricGate.blockedRegionItemCount : snapshot.coverage.regionItemCount;
  const uniqueSpecialtyCount = new Set(snapshot.regions.flatMap((region) => region.items.map((item) => itemName(item)))).size;
  const filingStats = (() => {
    let total = 0;
    let filed = 0;
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      if (item.dataState === "complete_nonzero" || item.dataState === "complete_zero") { total += 1; if (item.dataState === "complete_nonzero") filed += 1; }
    }));
    return { total, filed, rate: total ? filed / total : null };
  })();
  const trademarkShowcase = [];
  const showcaseApplications = new Set();
  const showcaseItems = new Set();
  const showcaseCandidates = snapshot.regions.flatMap((region) => region.items.flatMap((item) => (item.trademarkExamples || []).filter((example) => example.title).map((example) => ({ region, item, example })))).sort((a, b) => (b.example.applicationDate || "").localeCompare(a.example.applicationDate || ""));
  for (const row of showcaseCandidates) {
    const applicationKey = row.example.applicationNumber || row.example.title || "";
    const itemKey = itemName(row.item);
    if (!applicationKey || showcaseApplications.has(applicationKey) || showcaseItems.has(itemKey)) continue;
    showcaseApplications.add(applicationKey); showcaseItems.add(itemKey); trademarkShowcase.push(row);
    if (trademarkShowcase.length === 6) break;
  }
  const provinceStats = new Map();
  snapshot.regions.forEach((region) => {
    const name = region.sido || region.region;
    const row = provinceStats.get(name) || { trademarks: 0, registered: 0, verified: 0, items: 0, complete: 0, nonzero: 0 };
    region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { row.verified += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; } row.items += 1; if (["complete_nonzero", "complete_zero"].includes(item.dataState)) { row.complete += 1; if (item.dataState === "complete_nonzero") row.nonzero += 1; } });
    provinceStats.set(name, row);
  });

  // 출원율은 출원인 주소 귀속과 무관하게, ② 수집이 끝난 품목 중 상표 검색 결과가 있었는지(complete_nonzero)만
  // 본다 — 지역 귀속은 데이터의 한계이므로 별도로 수치화하지 않기로 함(2026-08-19 결정).
  function regionFilingSummary(region) {
    if (!region) return null;
    const counted = region.items.filter((item) => item.dataState === "complete_nonzero" || item.dataState === "complete_zero");
    if (!counted.length) return null;
    const filed = counted.filter((item) => item.dataState === "complete_nonzero").length;
    return { filed, total: counted.length, rate: filed / counted.length };
  }
  function provinceValue(name) {
    const row = provinceStats.get(name); if (!row) return null;
    if (state.mapMetric === "trademarks") return row.verified ? row.trademarks : null;
    if (state.mapMetric === "registration") return row.verified && row.trademarks ? row.registered / row.trademarks : null;
    if (state.mapMetric === "coverage") return row.items;
    return row.complete ? row.nonzero / row.complete : null;
  }
  function regionValue(region) {
    if (!region) return null;
    if (state.mapMetric === "coverage") return region.items.length;
    if (state.mapMetric === "filing") return regionFilingSummary(region)?.rate ?? null;
    const verified = region.items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
    if (!verified.length) return null;
    const trademarks = verified.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0);
    if (state.mapMetric === "trademarks") return trademarks;
    const registered = verified.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0);
    return trademarks ? registered / trademarks : 0;
  }
  function mapValueLabel(value) { if (value === null) return "데이터 없음"; if (state.mapMetric === "registration" || state.mapMetric === "filing") return percent(value); return `${number(value)}${state.mapMetric === "trademarks" ? "건" : "개 품목"}`; }
  function selectedRegion() { return snapshot.regions.find((region) => regionKey(region) === state.regionKey) || snapshot.regions[0]; }
  function selectedItem(region) { return region.items.find((item) => item.specialtyId === state.itemId) || region.items[0]; }

  function nav() {
    document.querySelector("#primary-tabs").innerHTML = Object.entries(tabs).map(([key, label]) => `<button type="button" data-tab="${key}" class="${state.tab === key ? "active" : ""}" ${state.tab === key ? 'aria-current="page"' : ""}>${label}</button>`).join("");
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { state.tab = button.dataset.tab; state.query = ""; state.itemQuery = ""; render(); }; });
  }

  function summaryScreen() {
    const visibleRegions = state.province ? snapshot.regions.filter((region) => (region.sido || region.region) === state.province && (!state.municipality || region.sigungu === state.municipality)) : snapshot.regions;
    // 지도 옆 미리보기는 상표명(예: 등록 브랜드 "임금님표쌀")이나 아직 고시명칭이 확정 안 된
    // 원문 표기가 아니라, 확정된 특산물 고시명칭만 보여준다. 원문 표기·상표 사례는 지역 상세와
    // "수집된 상표 예시"에서 별도로 확인한다.
    const visibleItems = visibleRegions.flatMap((region) => region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; })).sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const nationalMax = Math.max(1, ...geometry.provinces.map((shape) => provinceValue(shape.name) || 0));
    const municipalMax = municipal ? Math.max(1, ...municipal.items.map((shape) => regionValue(snapshot.regions.find((region) => region.sido === state.province && region.sigungu === shape.name)) || 0)) : 1;
    const rankingRows = snapshot.regions.flatMap((region) => region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; })).filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available").sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = snapshot.regions.find((row) => row.sido === state.province && row.sigungu === shape.name); const value = regionValue(region); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, municipalMax)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, nationalMax)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path>`; }).join("");
    const shapeLabels = municipal ? municipal.items.map((shape) => `<text x="${shape.labelX}" y="${shape.labelY}" class="map-label map-label-municipality">${esc(shape.name)}</text>`).join("") : geometry.provinces.map((shape) => `<text x="${shape.labelX}" y="${shape.labelY}" class="map-label map-label-province">${esc(shape.name)}</text>`).join("");
    return `${criteriaHtml()}<section class="hero"><div><p class="eyebrow">LOCAL BRAND OBSERVATORY</p><h1>지역 특산품 상표 분석</h1><p class="hero-copy">지역별 특산품과 관련 상표 현황을 한눈에 확인합니다.</p></div><div class="hero-note"><span>DATA COVERAGE</span><strong>${snapshot.coverage.observedRegionCount}개 지역 · ${snapshot.coverage.regionItemCount}개 지역×품목</strong><p>${isAlpha && pipeline ? `주소 확보율 ${percent(pipeline.applicantRegionVerification.rate)} · 확보된 값 기준으로 표시합니다.` : "현재 확인 가능한 데이터 범위입니다."}</p></div></section>
    <section class="metrics"><article><span>특산품 출원율</span><strong>${filingStats.total ? percent(filingStats.rate) : "—"}</strong><small>${filingStats.total ? `수집 완료 ${number(filingStats.total)}개 특산품 중 상표 출원 확인 ${number(filingStats.filed)}개` : "수집 완료 전"}</small></article><article><span>전국 검색 고유 상표 후보</span><strong>${pipeline ? number(pipeline.nationwideCandidates.uniqueTrademarkCount) : totals.availableItems ? number(totals.trademarks) : "검증 중"}</strong><small>출원번호 중복 제거 · 지역 상표 건수 아님</small></article><article><span>출원인 주소 확보율</span><strong>${pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>${pipeline ? `확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역 지표 표시 가능</span><strong>${pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>수집 완료 항목은 주소 확보율과 무관하게 표시</small></article><article><span>고유 검색 조합</span><strong>${pipeline ? number(pipeline.uniqueQueryCounts.total) : snapshot.coverage.partialQueryCount ? "부분" : "완료"}</strong><small>${pipeline ? `완료 ${number(pipeline.uniqueQueryCounts.complete)} · 부분 ${number(pipeline.uniqueQueryCounts.partial)}` : `입력행 완료 ${snapshot.coverage.completeQueryCount} · 부분 ${snapshot.coverage.partialQueryCount}`}</small></article></section>
    <section class="map-workspace"><div class="map-card"><div class="map-heading"><div><p class="eyebrow">BRAND GAP MAP</p><h2>${state.province ? `${esc(state.province)} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span class="reference-chip">참고 경계 · 2013 KOSTAT</span></div><div class="map-toolbar"><div class="map-metrics">${Object.entries(mapLabels).map(([key, label]) => `<button type="button" data-map-metric="${key}" class="${state.mapMetric === key ? "active" : ""}">${label}</button>`).join("")}</div>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div><div class="map-stage"><svg class="korea-map" viewBox="${municipal?.viewBox || geometry.viewBox}" role="img" aria-label="${state.province ? `${esc(state.province)} 시군구 지도` : "대한민국 시도 지도"}">${shapePaths}${shapeLabels}</svg></div><div class="map-legend"><span><i class="legend-swatch no-data"></i>데이터 없음</span><span><i class="legend-swatch low"></i>낮음</span><span><i class="legend-swatch high"></i>높음</span><strong>${mapLabels[state.mapMetric]} 기준</strong></div><p class="map-warning">${esc(geometry.boundaryReference.warning)} 지도를 클릭하면 해당 지역의 특산품 목록과 상표 사례를 확인할 수 있습니다.</p></div>
    <aside class="map-insight"><p class="eyebrow">SELECTED AREA</p><h2>${esc(state.municipality || state.province || "전국")}</h2><p class="insight-summary">${state.province ? `${visibleRegions.length}개 수집 지역, ${visibleItems.length}개 고시명칭 확인 특산품` : `${snapshot.coverage.observedRegionCount}개 관측 지역 · 고시명칭 확인 품목만 표시`}</p><div class="mini-list">${visibleItems.slice(0, 5).map(({ region, item, label }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span><strong>${esc(region.sigungu || region.region)} / ${esc(label)}</strong><small>${esc(noticeBasis(item))} · NICE ${esc(item.niceClass)}류</small></span><b>${item.metrics.uniqueTrademarkCount.availability === "available" ? `출원 ${number(item.metrics.uniqueTrademarkCount.value)}건` : "데이터 검토 중"}</b></button>`).join("") || '<p class="empty">이 지역에는 고시명칭이 확인된 특산품이 없습니다.</p>'}</div><div class="insight-note"><strong>표시 원칙</strong><p>지도 옆에는 고시명칭·NICE류가 확인된 특산품명만 표시합니다. 미확정 원물 후보는 상세 조회에 보존하고, 개별 상표명은 상표 예시에서만 보여줍니다.</p></div></aside></section>
    <section class="ranking" aria-label="등록상표 랭킹"><div class="section-heading"><div><p class="eyebrow">TRADEMARK RANKING</p><h2>지역×대표 특산품 등록상표 랭킹</h2></div><div class="ranking-toggle">${[10, 50].map((limit) => `<button type="button" data-ranking-limit="${limit}" class="${state.rankingLimit === limit ? "active" : ""}">TOP ${limit}</button>`).join("")}</div></div><p class="ranking-note">고시명칭·NICE류가 확인된 특산품명만 표시합니다. 개별 상표명은 집계명이 아니라 아래 상표 예시와 상세 화면에서만 확인합니다.</p><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>고시명칭·NICE</th><th>등록상표</th></tr></thead><tbody>${rankingRows.slice(0, state.rankingLimit).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(region.region)}</td><td>${esc(label)}</td><td>${esc(item.noticeName)} · ${esc(item.niceClass)}류</td><td>${number(item.metrics.registeredTrademarkCount.value)}건</td></tr>`).join("")}</tbody></table></div></section>
    ${trademarkShowcase.length ? `<section class="showcase" aria-label="수집된 상표 사례"><div class="section-heading"><div><p class="eyebrow">TRADEMARK EXAMPLES</p><h2>수집된 상표 예시</h2></div><span>최근 출원 · 품목별 1건</span></div><p class="showcase-intro">고시명칭으로 검색된 전국 후보이며, 해당 지역 출원으로 확정된 목록은 아닙니다.</p><div class="showcase-grid">${trademarkShowcase.map(({ region, item, example }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span class="showcase-item">${esc(itemName(item))} 검색 사례</span><strong>${esc(example.title)}</strong><small>${esc(compactDate(example.applicationDate))} · ${esc(example.applicationStatus || "상태 미기록")}</small><span class="showcase-number">${esc(example.applicationNumber || "출원번호 미기록")} →</span></button>`).join("")}</div></section>` : ""}
    ${pipeline ? `<section class="pipeline-progress" aria-label="데이터 준비 상태"><div class="section-heading"><div><p class="eyebrow">DATA READINESS</p><h2>데이터 준비 상태</h2></div><span>수집·검증 단위별 현황</span></div><div class="pipeline-grid"><article><span>지역×품목 입력행</span><strong>${number(pipeline.rowCounts.total)}행</strong><p>검색 가능 ${number(pipeline.rowCounts.searchable)} · 건너뜀 ${number(pipeline.rowCounts.skipped)}<br>완전 ${number(pipeline.rowCounts.complete)} · 부분 ${number(pipeline.rowCounts.partial)}</p></article><article><span>출원인 주소 확보</span><strong>${percent(pipeline.applicantRegionVerification.rate)}</strong><p>확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}<br>고유 상표 후보 기준</p></article><article><span>지역 지표 표시 상태</span><strong>${number(pipeline.regionalMetricGate.blockedRegionItemCount)}개 확인 필요</strong><p>${(pipeline.regionalMetricGate.coverageThreshold ?? 1) < 1 ? `검토용 표시 기준 ${percent(pipeline.regionalMetricGate.coverageThreshold)}를 적용했습니다. ` : "지역×품목별 수집과 주소 귀속이 모두 완료돼야 공개합니다. "}일부 결과를 0건으로 간주하지 않습니다.</p></article><article class="pipeline-bottleneck"><span>다음 개선</span><strong>검색 조건 정밀화와 주소 보강 확대</strong><p>중복 검색 단위 분리와 부분 수집 재개는 반영했습니다. 남은 광범위 검색어를 좁히고 새 상표 후보의 주소를 증분 보강합니다.</p></article></div></section>` : ""}`;
  }

  function regionDetail(region, item) {
    const examples = item.trademarkExamples || [];
    return `<div class="detail-panel"><div class="detail-heading"><div><p class="eyebrow">REGION DETAIL</p><h2>${esc(region.region)}</h2><p>법정동코드 ${esc(region.regionCode || "미확정")}</p></div><span class="state state-${esc(region.dataState)}">${esc(labels[region.dataState] || region.dataState)}</span></div><div class="item-tabs">${region.items.map((row) => `<button type="button" data-region-item="${esc(row.specialtyId || "")}" aria-selected="${item.specialtyId === row.specialtyId}">${esc(itemName(row))}</button>`).join("")}</div><div class="item-title"><div><span>이 지역의 대표 특산품</span><h3>${esc(itemName(item))}</h3><small>${esc(noticeBasis(item))}</small></div><span class="class-chip">${item.niceClass ? `NICE ${esc(item.niceClass)}` : "NICE 분류 미확정"}</span>${item.itemVerdict?.source === "algorithm" ? `<span class="verdict-chip" title="${esc(verdictTitle(item.itemVerdict))}">AI 판정</span>` : ""}</div><div class="detail-grid"><article><span>${esc(itemName(item))} 지역 상표 출원</span><strong>${item.metrics.uniqueTrademarkCount.availability === "available" ? `${number(item.metrics.uniqueTrademarkCount.value)}건` : "검증 중"}</strong><small>${item.metrics.uniqueTrademarkCount.availability === "blocked" ? `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · 주소 귀속 필요` : "출원인 주소가 해당 지역으로 확인된 건"}</small></article><article><span>지역 등록 상표</span><strong>${item.metrics.registeredTrademarkCount.availability === "available" ? `${number(item.metrics.registeredTrademarkCount.value)}건` : "검증 중"}</strong><small>등록률 ${percent(item.metrics.registrationRate.value)}</small></article><article><span>지역 출원인 비중</span><strong>${percent(item.metrics.localApplicantShare.value)}</strong><small>${item.metrics.localApplicantShare.availability === "blocked" ? "주소 검증률 부족" : "등록원부 주소 근거"}</small></article><article><span>브랜드 공백 점수</span><strong>${item.metrics.gapScore.value ?? "검토 중"}</strong><small>${item.metrics.gapScore.availability === "blocked" ? `${esc(item.metrics.gapScore.blockingIssue || "#50")} 지역 귀속 또는 기준 확인` : "낮은 상표 활용도 기준"}</small></article></div><div class="review-strip"><div><span>자동 확정</span><strong>${number(item.metrics.confirmedGoodsMatchCount.value)}건</strong></div><div><span>사람 검토 필요</span><strong>${number(item.metrics.goodsReviewCandidateCount.value)}건</strong></div><p>상표명은 사례로 보존하고, 대표 특산품 집계 키와 분리합니다.</p></div><section class="trademark-examples"><div class="example-heading"><strong>전국 검색 상표 사례</strong><span>지역 귀속 전 검색 후보 · 최근 출원 + 지정상품 근거 우선 · 최대 ${examples.length || 0}건</span></div>${examples.length ? `<div class="example-list">${examples.map((example) => `<article><div><strong>${esc(example.title || "상표명 미기록")}</strong><small>${esc(example.applicationNumber || "출원번호 미기록")} · ${esc(example.applicationDate || "출원일 미기록")} · ${esc(example.applicationStatus || "상태 미기록")}</small></div><span class="goods-chip ${example.goodsReviewRequired ? "review" : ""}">${esc(goodsMethod(example.goodsMatchMethod))}</span>${example.goodsEvidence?.length ? `<p>지정상품: ${example.goodsEvidence.map((row) => `${esc(row.designatedProductName || "명칭 미기록")}${row.classCode ? ` (${esc(row.classCode)}류)` : ""}`).join(", ")}</p>` : ""}</article>`).join("")}</div>` : '<p class="empty">현재 스냅샷에는 개별 상표명이 포함되지 않았습니다.</p>'}</section></div>`;
  }
  function regionsScreen() {
    const keyword = state.query.trim().toLocaleLowerCase("ko-KR");
    const rows = !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => itemName(item).toLocaleLowerCase("ko-KR").includes(keyword)));
    if (!rows.some((region) => regionKey(region) === state.regionKey) && rows[0]) state.regionKey = regionKey(rows[0]);
    const region = selectedRegion(), item = selectedItem(region);
    return `<section class="screen-section"><div class="screen-heading"><div><p class="eyebrow">LOCAL GOVERNMENT</p><h1>지자체별 조회</h1></div><p>지역 → 품목 → 근거 지표 순으로 확인합니다.</p></div><section class="workspace"><aside class="region-panel"><div class="panel-heading"><div><p class="eyebrow">REGION INDEX</p><h2>수집 지역</h2></div><span>${rows.length}건</span></div><label class="search-field"><span class="sr-only">지역 또는 품목 검색</span><input id="region-search" value="${esc(state.query)}" placeholder="지역 또는 품목 검색"></label><div class="region-list">${rows.map((row) => { const verified = row.items.filter((entry) => entry.metrics.uniqueTrademarkCount.availability === "available"); const count = verified.reduce((sum, entry) => sum + (entry.metrics.uniqueTrademarkCount.value || 0), 0); const filing = regionFilingSummary(row); return `<button type="button" data-region="${esc(regionKey(row))}" class="region-button ${regionKey(row) === state.regionKey ? "active" : ""}"><span><strong>${esc(row.region)}</strong><small>${row.items.length}개 품목 · ${verified.length ? `상표 ${number(count)}건` : "데이터 검토 중"}${filing ? ` · 출원율 ${percent(filing.rate)} (${filing.filed}/${filing.total})` : ""}</small></span><span class="state state-${esc(row.dataState)}">${esc(labels[row.dataState] || row.dataState)}</span></button>`; }).join("") || '<p class="empty">검색 결과가 없습니다.</p>'}</div></aside>${regionDetail(region, item)}</section></section>`;
  }
  function itemRows() {
    const rows = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, trademarks: 0, registered: 0, verified: 0, regions: [] };
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.verified += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      rows.set(name, row);
    }));
    const keyword = state.itemQuery.trim().toLocaleLowerCase("ko-KR");
    return [...rows.values()].filter((row) => !keyword || row.name.toLocaleLowerCase("ko-KR").includes(keyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword))).sort((a, b) => b.trademarks - a.trademarks);
  }
  function itemsScreen() {
    const rows = itemRows(); const pendingTitle = "상표 출원은 확인됐지만 출원인 주소가 이 지역인지 아직 검증되지 않았습니다."; return `<section class="screen-section"><div class="screen-heading"><div><p class="eyebrow">ITEM EXPLORER</p><h1>품목별 조회</h1></div><p>품목을 기준으로 지역과 상표 활동을 다시 묶었습니다.</p></div><div class="item-screen"><div class="item-screen-toolbar"><label><span class="sr-only">품목 검색</span><input id="item-search" value="${esc(state.itemQuery)}" placeholder="품목 또는 지역 검색"></label><span>${rows.length}개 품목</span></div><p class="ranking-note">표의 숫자는 특산품 개수가 아니라, 이 품목명으로 아래 지역들에 출원된 상표 건수입니다. 등록률 = 등록 완료 건수 ÷ 상표 출원 건수. "주소 확인 중"은 출원인 주소가 이 지역인지 아직 검증되지 않아 건수를 낼 수 없다는 뜻이며, 품목이 없다는 의미가 아닙니다.</p><div class="item-table"><div class="item-table-head"><span>품목</span><span>수집 지역</span><span title="출원인 주소가 이 지역으로 확인된 고유 상표 출원 건수 합계">상표 출원 건수</span><span title="위 출원 건수 중 상표가 등록 상태로 확인된 건수">등록 완료 건수</span><span title="등록 완료 건수 ÷ 상표 출원 건수">등록률</span></div>${rows.map((row, index) => `<div class="item-table-row"><span><b>${String(index + 1).padStart(2, "0")}</b><strong>${esc(row.name)}</strong></span><span>${esc(row.regions.join(", "))}</span><span${row.verified ? "" : ` title="${pendingTitle}"`}>${row.verified ? `${number(row.trademarks)}건` : "주소 확인 중"}</span><span${row.verified ? "" : ` title="${pendingTitle}"`}>${row.verified ? `${number(row.registered)}건` : "주소 확인 중"}</span><span>${row.verified ? percent(row.trademarks ? row.registered / row.trademarks : null) : "—"}</span></div>`).join("")}</div><div class="method-note"><strong>집계 기준</strong><p>고시명칭·NICE류가 확정된 품목만 공식 명칭 기준으로 재그룹합니다("풋고추"·"파프리카"는 같은 "고추"로 합쳐짐). 아직 고시명칭이 확정되지 않은 검토대기 원물명은 지역별 상세 화면에서 원문 그대로 확인할 수 있습니다.</p></div></div></section>`;
  }
  function dataScreen() {
    if (!pipeline) return '<section class="screen-section"><p class="empty">파이프라인 개요 데이터가 없습니다.</p></section>';
    const addressRate = Math.round((pipeline.applicantRegionVerification.rate || 0) * 100);
    const previewRate = pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal);
    return `<section class="screen-section data-overview"><div class="screen-heading"><div><p class="eyebrow">DATA JOURNEY</p><h1>특산물과 상표가<br>데이터가 되기까지</h1></div><p>수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다.</p></div><div class="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>${number(pipeline.rowCounts.total)}</strong><small>지역×특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>${number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역×품목</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>${number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 고유 후보</small></article><i>→</i><article class="flow-highlight"><span>05 · 지역 지표</span><strong>${number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>검증 기준 통과 항목</small></article></div><div class="data-summary-grid"><article class="data-summary-card"><p class="eyebrow">SPECIALTY DATA</p><h2>특산물 데이터</h2><div class="data-stat"><strong>${number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div class="data-stat"><strong>${number(snapshot.coverage.regionItemCount)}개</strong><span>지역×품목 조합</span></div><div class="data-stat"><strong>${number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p class="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article class="data-summary-card"><p class="eyebrow">TRADEMARK MATCH</p><h2>상표 매칭 결과</h2><div class="match-bars"><div><span>주소 확보 완료 <b>${number(pipeline.applicantRegionVerification.verifiedCount)}</b></span><em><i style="width:${addressRate}%"></i></em><small>전국 상표 후보 중 출원인 주소를 확인한 비율 ${percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>지역 지표 표시 가능 <b>${number(pipeline.regionalMetricGate.availableRegionItemCount)}</b></span><em><i style="width:${Math.max(2, Math.round(previewRate * 100))}%"></i></em><small>전체 지역×품목 조합 중 지표를 표시할 수 있는 비율 ${percent(previewRate)}</small></div></div><p class="data-card-note">상표 검색은 품목명 키워드로 전국 후보를 찾는 방식이라, 검색된 상표 중에는 이 지역과 무관한 다른 지역·전국 출원인(주소지 기준)도 많이 섞여 있습니다. 지역 지표(상표 건수·등록률)에는 출원인 주소지가 이 지역으로 확인된 건만 사용합니다.</p></article></div><div class="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>${number(pipeline.rowCounts.total)}행</b>은 수집 입력량, <b>${number(uniqueSpecialtyCount)}개</b>는 고유 특산품명, <b>${number(pipeline.uniqueQueryCounts.total)}개</b>는 실제 API 검색 조합입니다. <b>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 전국 상표 후보이며, 지역 지표에는 출원인 주소와 수집률 기준을 통과한 값만 사용합니다.</p></div></section>`;
  }

  function bindSearchInput(selector, stateKey) {
    const input = document.querySelector(selector);
    if (!input) return;
    let composing = false;
    const commit = (value) => {
      state[stateKey] = value;
      render();
      const nextInput = document.querySelector(selector);
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(value.length, value.length);
      }
    };
    input.oncompositionstart = () => { composing = true; };
    input.oncompositionend = (event) => { composing = false; commit(event.currentTarget.value); };
    input.oninput = (event) => {
      const value = event.currentTarget.value;
      state[stateKey] = value;
      if (composing || event.isComposing) return;
      commit(value);
    };
  }
  function compareScreen() {
    return `<section class="screen-section"><div class="screen-heading"><div><p class="eyebrow">SPECIALIZED CROP MATCH</p><h1>특화작목 비교</h1></div><p>정책 지정 작목과 실제 상표 활동의 일치 여부를 비교하는 화면입니다.</p></div><div class="compare-banner"><span>현재 상태</span><strong>정책 지정 특화작목 원본 미수집 · 비교 대기</strong><p>농사로 지역특산물과 정책 지정 특화작목은 같은 데이터가 아니므로 임의로 대체하지 않습니다.</p></div><div class="compare-grid">${[...provinceStats.entries()].map(([province, row]) => { const names = snapshot.regions.filter((region) => (region.sido || region.region) === province).flatMap((region) => region.items.map(itemName)); return `<article><div class="compare-head"><h2>${esc(province)}</h2><span>비교 대기</span></div><dl><dt>현재 공식 특산품 후보</dt><dd>${esc(names.join(", ") || "없음")}</dd><dt>정책 지정 특화작목</dt><dd class="missing">미수집</dd><dt>지역 상표 활동</dt><dd>${row.verified ? `${number(row.trademarks)}건` : "검증 중"}</dd><dt>일치 여부</dt><dd class="missing">판정 불가</dd></dl></article>`; }).join("")}</div><div class="compare-sources"><article><span>추가 수집 1</span><strong>농촌진흥청 지역특화작목 지정 목록</strong><p>계획 기간·지역·작목·근거 버전을 구조화해야 합니다.</p></article><article><span>추가 수집 2</span><strong>한국지식재산연구원 로컬브랜드 근거</strong><p>2024년 보고서의 지역·품목 대응표와 페이지 근거가 필요합니다.</p></article><article><span>자동화 원칙</span><strong>정책 목록 확보 후 결정론적 비교</strong><p>명칭 후보만 사람 검토하고 나머지 집계·일치 판정은 자동화합니다.</p></article></div></section>`;
  }

  // 요약 탭에서만 한 번 보여준다(다른 탭에서도 매번 반복 노출되던 것을 정리).
  function criteriaHtml() {
    const rows = [
      ["대표 특산품 판정", "GI 출처 또는 상표 출원 3건 이상", "#29 확정(2026-08-11) — GI 미등록이어도 출원 활동이 활발하면 대표로 인정(OR 조건)"],
      ["품목 매칭", "고시명칭 일치·포함", "지정상품명이 고시상품명칭과 일치하거나 포함되면 특산품 활용 출원으로 인정하고, NICE류만 일치하면 사람 검토로 분리합니다."],
      ["지역 매칭", "법정동코드 완전일치", "국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만"],
      ["상표 검색", "KIPRIS 단어검색(고시명칭 기준)", "검색·집계 키는 고시명칭 + NICE류이며, 상표명은 개별 사례로만 보존하고 집계 키로 쓰지 않음"],
      ["지역 상표 / 등록 상표", "출원인 주소가 해당 지역으로 확인된 건만", "전국 KIPRIS 검색 후보는 별도 보존하며 지역 건수·등록률에 포함하지 않음"],
      ["출원인 지역 매칭", "주소 확보율은 참고 지표", "주소가 확인된 건은 지역 귀속에 반영하고, 미확보 건도 원자료와 확보율을 함께 표시합니다. 부분 수집은 별도 상태로 구분합니다."],
    ];
    return `<section class="criteria" aria-label="판정 기준과 매칭 방법"><div class="section-heading"><div><p class="eyebrow">HOW THIS IS BUILT</p><h2>판정 기준과 매칭 방법</h2></div><span>현재 출처 ${esc(sourceLine)}</span></div><div class="criteria-grid">${rows.map(([label, value, note]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("")}</div></section>`;
  }
  function provenance() {
    document.querySelector("#provenance").innerHTML = `<div class="section-heading"><div><p class="eyebrow">TRACEABLE BY DESIGN</p><h2>출처와 데이터 상태</h2></div><span>${esc(snapshot.schemaVersion)}</span></div><div class="source-grid">${snapshot.sources.filter((source) => source.sourceUrl).map((source) => `<a href="${esc(source.sourceUrl)}" target="_blank" rel="noreferrer"><span>${esc(source.sourceLabel || source.sourceId)}</span><strong>${esc(source.sourceContractVersion || "버전 미기록")}</strong><small>검증 ${esc(source.sourceLastVerifiedAt || date(source.sourceFetchedAt))}</small></a>`).join("")}<a href="${esc(geometry.boundaryReference.sourceUrl)}" target="_blank" rel="noreferrer"><span>지도 경계</span><strong>${esc(geometry.boundaryReference.sourceName)}</strong><small>${esc(geometry.boundaryReference.sourceBasis)} · 참고용</small></a></div><details><summary>현재 해석 주의사항 ${snapshot.warnings.length}건 보기</summary><ul>${snapshot.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></details>`;
  }
  function bind() {
    document.querySelectorAll("[data-ranking-limit]").forEach((button) => { button.onclick = () => { state.rankingLimit = Number(button.dataset.rankingLimit); render(); }; });
    document.querySelectorAll("[data-map-metric]").forEach((button) => { button.onclick = () => { state.mapMetric = button.dataset.mapMetric; render(); }; });
    document.querySelectorAll("[data-province]").forEach((shape) => { const open = () => { state.province = shape.dataset.province; state.municipality = null; render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    document.querySelectorAll("[data-municipality]").forEach((shape) => { const open = () => { state.municipality = shape.dataset.municipality; const region = snapshot.regions.find((row) => row.sido === state.province && row.sigungu === state.municipality); if (region) state.regionKey = regionKey(region); render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    const back = document.querySelector("#map-back"); if (back) back.onclick = () => { state.province = null; state.municipality = null; render(); };
    document.querySelectorAll("[data-open-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.openRegion; state.itemId = button.dataset.openItem; state.tab = "regions"; render(); }; });
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.region; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-region-item]").forEach((button) => { button.onclick = () => { state.itemId = button.dataset.regionItem; render(); }; });
    bindSearchInput("#region-search", "query");
    bindSearchInput("#item-search", "itemQuery");
  }
  function render() {
    nav();
    document.querySelector("#app").innerHTML = state.tab === "summary" ? summaryScreen() : state.tab === "regions" ? regionsScreen() : state.tab === "items" ? itemsScreen() : state.tab === "compare" ? compareScreen() : dataScreen();
    bind();
  }

  document.querySelector("#generated").textContent = `마지막 생성 ${date(snapshot.generatedAt)}`;
  document.querySelector("#scope-label").textContent = scopeLabel;
  document.querySelector("#snapshot-id").textContent = `Snapshot ${snapshot.snapshotId}`;
  document.querySelector("#brand-home").onclick = () => { state.tab = "summary"; render(); };
  provenance();
  render();
}
