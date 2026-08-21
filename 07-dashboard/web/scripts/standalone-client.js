/* eslint-disable @typescript-eslint/no-unused-vars -- embedded and invoked by dashboard.html */
function dashboardClient(snapshot, geometry) {
  const labels = { complete_nonzero: "현황 확인", complete_zero: "검색 결과 없음", partial: "추가 확인 필요", error: "확인 오류", skipped: "분류 확인 필요", not_collected: "확인 전", complete: "집계 완료" };
  const tabs = { summary: "요약", applications: "지역별 출원율", regions: "지자체별 조회", items: "품목별 조회", gaps: "지역 출원 미확인", compare: "특화작목 비교", data: "데이터 개요" };
  const mapLabels = { coverage: "특산품 수", trademarks: "상표 건수", applicationCoverage: "출원율", registration: "등록률" };
  const mapDescriptions = {
    trademarks: "검색 수집이 완료된 항목에서, 출원인 주소가 해당 지역으로 확인된 고유 상표 출원 건수입니다.",
    registration: "지도에 포함된 지역 주소 일치 출원 중 등록 상태인 건의 비율입니다(등록 ÷ 출원).",
    coverage: "현재 스냅샷에 수집된 지역×특산품 수입니다.",
    applicationCoverage: "이 지역에서 수집된 전체 특산품 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 아직 지역별 집계가 안 끝난 품목도 전체 분모에 포함하므로, 데이터가 쌓일수록 값이 올라갈 수 있습니다.",
  };
  const state = { tab: "summary", query: "", itemQuery: "", gapQuery: "", regionKey: snapshot.regions[0]?.regionCode || snapshot.regions[0]?.region, itemId: "", mapMetric: "coverage", province: null, municipality: null, rankingLimit: 10 };
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
  // 2026-08-20: raw_item_goods_matched(원물명 + 등록원부 지정상품 정규화 일치 + 출원인
  // 주소 지역 일치로 AI가 검토·확정한 항목)는 판정 근거는 다르지만 화면에서는 구분 없이
  // 동일한 "확인 특산품"으로 취급한다(사용자 결정). 판단 근거는 matchingBasis 값과
  // metrics.*.rationale에만 남기고 UI 텍스트로는 노출하지 않는다.
  const OFFICIAL_MATCHING_BASES = new Set(["notice_name_and_nice_class", "raw_item_goods_matched"]);
  const officialNoticeName = (item) => item.matchingBasis && OFFICIAL_MATCHING_BASES.has(item.matchingBasis) ? item.noticeName : null;
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
  // 지자체 상세의 "특산품 탭"은 고시명칭이 확정된 공식 특산품만 골라 보여준다.
  // matchingBasis=raw_item_name_unclassified인 검토대기 원물명·상호(예: "꿀다림
  // 데일리허니", "왕곡한과")는 삭제하지 않고 데이터에는 남기되, 탭 목록·기본 선택에서는
  // 절대 노출하지 않는다(2026-08-19 데이터 감사). 지역에 공식 특산품이 하나도 없는
  // 경우(11/124개 지역)에도 원물을 대신 보여주지 않고, 호출부에서 "확인된 특산품 없음"
  // 빈 상태로 분기한다.
  const officialRegionItems = (region) => region.items.filter((item) => officialItemLabel(item));
  const specialtyCoverage = (regions) => {
    let total = 0, decided = 0, applied = 0;
    regions.forEach((region) => region.items.forEach((item) => {
      total += 1;
      if (item.metrics.uniqueTrademarkCount.availability !== "available") return;
      decided += 1;
      if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) applied += 1;
    }));
    // 2026-08-21 사용자 재확인: 분모는 고시명칭 확인 완료분이 아니라 스냅샷에 수집된
    // 지역×특산품 전체다(현재 전국 1,692개). 아직 명칭·지역별 집계 확인이 덜 끝난
    // 품목도 분모에 포함하고, 지역 주소 일치 출원이 확인될 때만 분자에 더한다.
    return { total, decided, applied, pending: total - decided, rate: total ? applied / total : null };
  };
  // 2026-08-19 방향 전환: 지역 확인이 안 끝난 상표를 지역 수치처럼 보여주지 않는다
  // (전국 키워드 검색은 그 지역과 무관한 값이 대부분 섞여 부풀려 보인다). 지도·지역별
  // 조회·지역 상세는 지역 귀속이 확정된 값만 쓰고, 확정 전은 "집계 대기"로 표시한다.
  // 품목별 조회 카드에서만 "지역 확인 전 전국 검색 후보 N건은 확정 수치에 포함하지
  // 않았습니다"처럼 별도 참고용으로 tradeDisplay를 쓴다 — 확정치와 절대 합산하지 않는다.
  const tradeDisplay = (item) => {
    const metric = item.metrics.uniqueTrademarkCount;
    if (metric.availability === "available") return { value: metric.value, provisional: false };
    const nationwide = item.metrics.nationwideSearchTrademarkCount;
    return typeof nationwide?.value === "number" ? { value: nationwide.value, provisional: true } : { value: null, provisional: false };
  };
  const goodsMethod = (method) => ({ normalized_exact: "특산품 활용 확정", normalized_contains: "고시명칭 포함·인정", class_only: "NICE류 검토", mismatch: "지정상품 불일치", unverified: "미검증" })[method] || method;
  const verdictTitle = (verdict) => `사람이 개별 승인하지 않고 규칙 기반 알고리즘이 자동 확정(${verdict.method || "algorithm"}, 신뢰도 ${verdict.confidence ?? "미기록"})`;
  const regionKey = (region) => region.regionCode || region.region;
  // 2026-08-21: 대전·대구·부산·울산·인천광역시, 전남광주통합특별시는 원본 소스(농사로)에
  // 구/군 정보가 아예 없어 시 전체로만 특산품이 잡힌다(region.sigungu === region.sido).
  // 특정 구를 클릭해도 이 "미분류" 행까지 걸러버리면 실제로 있는 데이터가 빈 화면으로
  // 보인다 — 어떤 구를 눌러도 시 전체 미분류 항목은 계속 보여준다(사용자 요청).
  const isUnclassifiedRegion = (region) => region.sigungu === region.sido;
  const fill = (value, max) => value === null ? "#e3e6ec" : `color-mix(in srgb, #0f5fa6 ${Math.round(24 + Math.max(.12, Math.min(1, max ? value / max : 0)) * 68)}%, #e9eef4)`;
  const nationalLabelOffsets = { 서울특별시: { x: -52, y: -28 }, 세종특별자치시: { x: -60, y: -31 } };
  const displayRegionName = (name) => name.replace("전남광주통합특별시", "전남·광주 통합권역");
  const mapLabelMarkup = (shapes, municipality) => shapes.map((shape) => {
    const offset = municipality ? null : nationalLabelOffsets[shape.name];
    const x = shape.labelX + (offset?.x || 0);
    const y = shape.labelY + (offset?.y || 0);
    const label = esc(displayRegionName(shape.name));
    if (!offset) return `<text x="${x}" y="${y}" class="map-label ${municipality ? "map-label-municipality" : "map-label-province"}">${label}</text>`;
    return `<g class="map-region-label map-region-label-callout"><polyline points="${shape.labelX},${shape.labelY} ${(shape.labelX + x) / 2},${(shape.labelY + y) / 2} ${x + 22},${y + 4}"></polyline><text x="${x}" y="${y}" class="map-label map-label-province">${label}</text></g>`;
  }).join("");
  const totals = snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { acc.availableItems += 1; acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; } acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0, availableItems: 0 });
  const sourceLine = snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean).join(" · ");
  const pipeline = snapshot.pipelineStatus;
  const scopeLabel = snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터";
  const gateTotal = pipeline ? pipeline.regionalMetricGate.availableRegionItemCount + pipeline.regionalMetricGate.blockedRegionItemCount : snapshot.coverage.regionItemCount;
  const uniqueSpecialtyCount = new Set(snapshot.regions.flatMap((region) => region.items.map((item) => itemName(item)))).size;
  const nationalSpecialtyCoverage = specialtyCoverage(snapshot.regions);
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
    const row = provinceStats.get(name) || { trademarks: 0, registered: 0, verified: 0, totalItems: 0, decidedItems: 0, appliedItems: 0 };
    region.items.forEach((item) => {
      const official = Boolean(officialItemLabel(item));
      row.totalItems += 1;
      if (item.metrics.uniqueTrademarkCount.availability === "available") {
        row.decidedItems += 1;
        if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) row.appliedItems += 1;
      }
      // 지역 단위 상표 집계(trademarks/verified/registered)는 고시명칭이 확정된 공식
      // 특산품만 포함한다. matchingBasis=raw_item_name_unclassified인 검토대기 원물명·
      // 상호(예: "꿀다림 데일리허니", "왕곡한과")는 uniqueTrademarkCount가 available이어도
      // 지역 상표 건수 합계에 섞이면 안 된다(2026-08-19 데이터 감사).
      if (official && item.metrics.uniqueTrademarkCount.availability === "available") {
        row.verified += 1;
        row.trademarks += item.metrics.uniqueTrademarkCount.value || 0;
        row.registered += item.metrics.registeredTrademarkCount.value || 0;
      }
    });
    provinceStats.set(name, row);
  });
  function provinceValue(name, metric = state.mapMetric) {
    const row = provinceStats.get(name); if (!row) return null;
    if (metric === "trademarks") return row.verified ? row.trademarks : null;
    if (metric === "registration") return row.verified && row.trademarks ? row.registered / row.trademarks : null;
    if (metric === "coverage") return row.totalItems;
    return row.totalItems ? row.appliedItems / row.totalItems : null;
  }
  function regionValue(region, metric = state.mapMetric) {
    if (!region) return null;
    const verified = region.items.filter((item) => officialItemLabel(item) && item.metrics.uniqueTrademarkCount.availability === "available");
    const trademarks = verified.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0);
    const registered = verified.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0);
    if (["trademarks", "registration"].includes(metric) && verified.length === 0) return null;
    if (metric === "trademarks") return trademarks;
    if (metric === "registration") return trademarks ? registered / trademarks : 0;
    const coverage = specialtyCoverage([region]);
    if (metric === "coverage") return coverage.total;
    return coverage.rate;
  }
  function mapValueLabel(value, metric = state.mapMetric) { if (value === null) return "데이터 없음"; if (["registration", "applicationCoverage"].includes(metric)) return percent(value); return `${number(value)}${metric === "trademarks" ? "건" : "개 품목"}`; }
  function regionalMetricPendingReason(item) {
    if (item.dataState === "partial") return "검색 결과의 수집 상한에 도달하여 추가 확인이 필요합니다.";
    if (item.dataState === "error") return "검색 결과를 확인하지 못했습니다.";
    if (item.dataState === "skipped") return "품목 분류 확인이 필요해 지역별 현황에서 제외했습니다.";
    if (item.dataState === "not_collected") return "상표 출원 현황 확인 전입니다.";
    return "지역별 출원 현황을 추가로 확인하고 있습니다.";
  }
  function selectedRegion() { return snapshot.regions.find((region) => regionKey(region) === state.regionKey) || snapshot.regions[0]; }
  function selectedItem(region) { const official = officialRegionItems(region); return official.find((item) => item.specialtyId === state.itemId) || official[0]; }

  function nav() {
    document.querySelector("#primary-tabs").innerHTML = Object.entries(tabs).map(([key, label]) => `<button type="button" data-tab="${key}" class="${state.tab === key ? "active" : ""}" ${state.tab === key ? 'aria-current="page"' : ""}>${label}</button>`).join("");
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { state.tab = button.dataset.tab; state.query = ""; state.itemQuery = ""; render(); }; });
  }

  function summaryScreen() {
    const visibleRegions = state.province ? snapshot.regions.filter((region) => (region.sido || region.region) === state.province && (!state.municipality || region.sigungu === state.municipality || isUnclassifiedRegion(region))) : snapshot.regions;
    const visibleSpecialtyCoverage = specialtyCoverage(visibleRegions);
    // 지도 옆 미리보기는 상표명(예: 등록 브랜드 "임금님표쌀")이나 아직 고시명칭이 확정 안 된
    // 원문 표기가 아니라, 확정된 특산물 고시명칭만 보여준다. 원문 표기·상표 사례는 지역 상세와
    // "수집된 상표 예시"에서 별도로 확인한다.
    const visibleItems = visibleRegions.flatMap((region) => region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; })).sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const percentageMetric = ["registration", "applicationCoverage"].includes(state.mapMetric);
    const nationalMax = percentageMetric ? 1 : Math.max(1, ...geometry.provinces.map((shape) => provinceValue(shape.name) || 0));
    const municipalMax = percentageMetric ? 1 : municipal ? Math.max(1, ...municipal.items.map((shape) => regionValue(snapshot.regions.find((region) => region.sido === state.province && region.sigungu === shape.name)) || 0)) : 1;
    const rankingRows = snapshot.regions.flatMap((region) => region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; })).filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available").sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = snapshot.regions.find((row) => row.sido === state.province && row.sigungu === shape.name); const value = regionValue(region); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, municipalMax)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, nationalMax)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path>`; }).join("");
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const shapeLabels = mapLabelMarkup(activeShapes, Boolean(municipal));
    return `<section class="hero"><div><h1>지역 특산품 상표 출원 현황</h1><p class="hero-copy">지역별 특산품의 상표 출원·등록 현황을 지역과 품목 기준으로 제공합니다.</p></div><div class="hero-note"><span>조사 범위</span><strong>${snapshot.coverage.observedRegionCount}개 지역 · ${snapshot.coverage.regionItemCount}건의 지역-품목 기록</strong><p>현재까지 수집된 데이터 기준이며, 지속 업데이트 예정입니다.</p></div></section>
    <section class="metrics"><article><span>특산품 출원율</span><strong>${percent(nationalSpecialtyCoverage.rate)}</strong><small>수집 특산품 전체 ${number(nationalSpecialtyCoverage.total)}개 중 ${number(nationalSpecialtyCoverage.applied)}개 출원 확인 · 지역별 집계 완료 ${number(nationalSpecialtyCoverage.decided)}개 · 집계 대기 ${number(nationalSpecialtyCoverage.pending)}개</small></article><article><span>전국 검색 고유 상표 후보</span><strong>${pipeline ? number(pipeline.nationwideCandidates.uniqueTrademarkCount) : totals.availableItems ? number(totals.trademarks) : "집계 전"}</strong><small>출원번호 중복 제거 · 지역별 출원 수와는 다른 전국 검색 결과</small></article><article><span>출원인 주소 확보율</span><strong>${pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>${pipeline ? `고유 후보 중 확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역별 출원 수 표시 가능</span><strong>${pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>검색 수집이 완료된 지역×특산품 항목 수</small></article></section>
    <section class="map-workspace"><div class="map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(displayRegionName(state.province))} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span class="reference-chip">참고 경계 · 2013 KOSTAT</span></div><div class="map-toolbar"><div class="map-metrics">${Object.entries(mapLabels).map(([key, label]) => `<button type="button" data-map-metric="${key}" class="${state.mapMetric === key ? "active" : ""}" title="${esc(mapDescriptions[key])}" aria-label="${esc(`${label}: ${mapDescriptions[key]}`)}">${label}</button>`).join("")}</div>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div><p class="map-metric-description"><strong>${mapLabels[state.mapMetric]}</strong><span>${mapDescriptions[state.mapMetric]}</span></p><div class="map-stage"><svg class="korea-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(displayRegionName(state.province))} 시군구 지도` : "대한민국 시도 지도"}">${shapePaths}${shapeLabels}</svg></div><div class="map-legend"><span><i class="legend-swatch no-data"></i>데이터 없음</span><span><i class="legend-swatch low"></i>낮음</span><span><i class="legend-swatch high"></i>높음</span><strong>${mapLabels[state.mapMetric]} 기준</strong></div><p class="map-warning">${esc(geometry.boundaryReference.warning)} 특산품·상표 데이터가 없어도 지명은 표시합니다. 집계 대기 특산품은 출원 미확인으로 계산돼 출원율 분모에는 포함됩니다.</p></div>
    <aside class="map-insight"><h2>${esc(displayRegionName(state.municipality || state.province || "전국"))}</h2><p class="insight-summary">수집 특산품 ${number(visibleSpecialtyCoverage.total)}개 중 출원 확인 ${number(visibleSpecialtyCoverage.applied)}개 · 출원율 ${percent(visibleSpecialtyCoverage.rate)} · 지역별 집계 완료 ${number(visibleSpecialtyCoverage.decided)}개${visibleSpecialtyCoverage.pending ? ` · 집계 대기 ${number(visibleSpecialtyCoverage.pending)}개` : ""}</p>${state.province && visibleRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다. 지도에서 특정 구·군을 눌러도 같은 목록이 표시됩니다.</p>` : ""}<div class="mini-list">${visibleItems.slice(0, 5).map(({ region, item, label }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span><strong>${esc(region.sigungu || region.region)} / ${esc(label)}</strong><small>${esc(noticeBasis(item))} · NICE ${esc(item.niceClass)}류</small></span><b>${item.metrics.uniqueTrademarkCount.availability === "available" ? (item.metrics.uniqueTrademarkCount.value || 0) > 0 ? `출원 확인 · ${number(item.metrics.uniqueTrademarkCount.value)}건` : "출원 없음 · 판정 완료" : "지역별 집계 대기"}</b></button>`).join("") || '<p class="empty">이 지역에는 고시명칭이 확인된 특산품이 없습니다.</p>'}</div><div class="insight-note"><strong>출원율 계산</strong><p>지역 주소 일치 출원이 확인된 특산품 수 ÷ 이 지역에서 수집된 전체 특산품 수입니다. 명칭 확인이나 지역별 집계가 덜 끝난 항목도 분모에 포함하고 분자에는 넣지 않으므로, 후속 확인이 진행되면 출원율이 올라갈 수 있습니다.</p></div></aside></section>
    <section class="ranking" aria-label="지역 주소 일치 출원 중 등록 랭킹"><div class="section-heading"><div><h2>지역·대표 특산품 등록 상표 랭킹</h2></div><div class="ranking-toggle">${[10, 50].map((limit) => `<button type="button" data-ranking-limit="${limit}" class="${state.rankingLimit === limit ? "active" : ""}">TOP ${limit}</button>`).join("")}</div></div><p class="ranking-note">출원인 주소가 해당 지역과 일치한 출원 가운데 등록 상태인 건수로 순위를 정합니다. 고시명칭·NICE류가 확인된 특산품명만 표시하고, 개별 상표명은 아래 상표 예시와 상세 화면에서 확인합니다.</p><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>고시명칭·NICE</th><th>그중 등록</th></tr></thead><tbody>${rankingRows.slice(0, state.rankingLimit).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(region.region)}</td><td>${esc(label)}</td><td>${esc(item.noticeName)} · ${esc(item.niceClass)}류</td><td>${number(item.metrics.registeredTrademarkCount.value)}건</td></tr>`).join("")}</tbody></table></div></section>
    ${trademarkShowcase.length ? `<section class="showcase" aria-label="수집된 상표 사례"><div class="section-heading"><div><h2>수집된 상표 예시</h2></div><span>최근 출원 · 품목별 1건</span></div><p class="showcase-intro">고시명칭으로 검색된 전국 후보이며, 해당 지역 출원으로 확정된 목록은 아닙니다.</p><div class="showcase-grid">${trademarkShowcase.map(({ region, item, example }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span class="showcase-item">${esc(itemName(item))} 검색 사례</span><strong>${esc(example.title)}</strong><small>${esc(compactDate(example.applicationDate))} · ${esc(example.applicationStatus || "상태 미기록")}</small><span class="showcase-number">${esc(example.applicationNumber || "출원번호 미기록")} →</span></button>`).join("")}</div></section>` : ""}`;
  }

  function applicationsScreen() {
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const areaRegions = state.province ? snapshot.regions.filter((region) => region.sido === state.province && (!state.municipality || region.sigungu === state.municipality || isUnclassifiedRegion(region))) : snapshot.regions;
    const area = specialtyCoverage(areaRegions);
    const areaName = displayRegionName(state.municipality || state.province || "전국");
    const mapLabelsHtml = mapLabelMarkup(activeShapes, Boolean(municipal));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = snapshot.regions.find((row) => row.sido === state.province && row.sigungu === shape.name); const value = regionValue(region, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, 1)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(shape.name)} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, 1)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(shape.name)} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("");
    const breakdown = (state.province ? areaRegions.map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region })) : [...provinceStats.keys()].map((province) => ({ key: province, label: province, regions: snapshot.regions.filter((region) => region.sido === province), region: null }))).map((row) => ({ ...row, coverage: specialtyCoverage(row.regions), items: row.regions.flatMap((region) => officialRegionItems(region).map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) }))) })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
    const listedItemCount = breakdown.reduce((sum, row) => sum + row.items.length, 0);
    return `<section class="screen-section coverage-screen"><div class="screen-heading"><div><h1>지역별 특산품 출원율</h1></div><p>시도별 출원율을 비교하고, 선택한 시도의 시군구별 현황을 확인할 수 있습니다.</p></div>
      ${state.province && areaRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다.</p>` : ""}
      <section class="coverage-kpis" aria-label="${esc(areaName)} 특산품 출원 현황"><article><span>선택 지역</span><strong>${esc(areaName)}</strong><small>${state.municipality ? `${esc(state.province)} 내 시군구` : state.province ? "시군구별 특산품 항목 합산" : "전국 시군구별 특산품 항목 합산"}</small></article><article><span>전체 수집 특산품</span><strong>${number(area.total)}개</strong><small>현재 스냅샷의 지역×특산품 전체 항목</small></article><article><span>출원 확인 특산품</span><strong>${number(area.applied)}개</strong><small>전체 수집 특산품 ${number(area.total)}개 중 1건 이상 출원 확인</small></article><article class="coverage-rate-kpi"><span>특산품 출원율</span><strong>${percent(area.rate)}</strong><small>전체 수집 ${number(area.total)}개 중 출원 확인 ${number(area.applied)}개${area.pending ? ` · 집계 대기 ${number(area.pending)}개` : " · 전체 지역별 집계 완료"}</small></article></section>
      <section class="coverage-map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(state.province)} 시군구 출원율` : "전국 시도별 출원율"}</h2></div><div class="coverage-map-actions"><span class="reference-chip">색이 진할수록 출원율이 높음</span>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div></div><p class="map-metric-description"><strong>특산품 출원율</strong><span>지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수 · 명칭 확인·집계 대기도 분모에 포함합니다.</span></p><div class="map-stage coverage-map-stage"><svg class="korea-map coverage-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(state.province)} 시군구별 특산품 출원율 지도` : "대한민국 시도별 특산품 출원율 지도"}">${shapePaths}${mapLabelsHtml}</svg></div><div class="coverage-legend"><span>0%</span><i></i><span>25%</span><span>50%</span><span>75%</span><span>100%</span><b>회색은 데이터 없음</b></div><p class="map-warning">${state.province ? "특산품·상표 데이터 유무와 관계없이 모든 시군구 지명을 표시합니다. 지역을 선택하면 아래 목록도 함께 좁혀집니다." : "특산품·상표 데이터가 없는 시도도 지명은 표시하며 회색으로 구분합니다. 시도를 선택하면 시군구 지도로 전환됩니다."}</p></section>
      <section class="coverage-directory"><div class="section-heading coverage-directory-heading"><div><span class="coverage-directory-region">${esc(areaName)}</span><h2>특산품별 출원 현황</h2></div><span>특산품 ${number(listedItemCount)}개 · 출원 확인 ${number(area.applied)}개 · 출원율 ${percent(area.rate)}</span></div><div class="coverage-region-grid">${breakdown.map((row) => `<article class="coverage-region-card ${state.municipality && row.label === state.municipality ? "selected" : ""}"><div class="coverage-region-head"><div><strong>${esc(row.label)}</strong><small>특산품 ${number(row.coverage.total)}개</small></div><div class="coverage-region-summary"><span>출원 확인 특산품 ${number(row.coverage.applied)}개</span><b>${percent(row.coverage.rate)}</b></div>${!state.province ? `<button type="button" data-province="${esc(row.label)}">지도에서 보기</button>` : ""}</div><div class="coverage-specialty-list">${row.items.map(({ region, item, label }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span>${esc(state.province ? label : `${region.sigungu || region.region} / ${label}`)}</span><small>${item.metrics.uniqueTrademarkCount.availability === "available" ? (item.metrics.uniqueTrademarkCount.value || 0) > 0 ? `출원 확인 · ${number(item.metrics.uniqueTrademarkCount.value)}건` : "지역 출원 미확인" : "추가 확인 필요"}</small></button>`).join("")}</div></article>`).join("")}</div></section></section>`;
  }

  function regionDetail(region, item) {
    const heading = `<div class="detail-heading"><div><h2>${esc(region.region)}</h2><p>법정동코드 ${esc(region.regionCode || "미확정")}</p></div><span class="state state-${esc(region.dataState)}">${esc(labels[region.dataState] || region.dataState)}</span></div>`;
    if (!item) {
      return `<div class="detail-panel">${heading}<div class="item-tabs" role="tablist"></div><p class="empty">고시명칭·NICE류가 확인된 특산품이 없습니다 · 검토대기 원물명·상호 ${region.items.length}개</p></div>`;
    }
    const examples = item.trademarkExamples || [];
    const regionalAvailable = item.metrics.uniqueTrademarkCount.availability === "available";
    const localCount = item.metrics.uniqueTrademarkCount.value || 0;
    const registeredCount = item.metrics.registeredTrademarkCount.value || 0;
    const pendingReason = regionalMetricPendingReason(item);
    return `<div class="detail-panel">${heading}<div class="item-tabs">${officialRegionItems(region).map((row) => `<button type="button" data-region-item="${esc(row.specialtyId || "")}" aria-selected="${item.specialtyId === row.specialtyId}">${esc(itemName(row))}</button>`).join("")}</div><div class="item-title"><div><span>이 지역의 대표 특산품</span><h3>${esc(itemName(item))}</h3><small>${esc(noticeBasis(item))}</small></div><span class="class-chip">${item.niceClass ? `NICE ${esc(item.niceClass)}` : "NICE 분류 미확정"}</span>${item.itemVerdict?.source === "algorithm" ? `<span class="verdict-chip" title="${esc(verdictTitle(item.itemVerdict))}">AI 판정</span>` : ""}</div><div class="metric-reading-note"><strong>아래 수치의 기준</strong><p>전국 검색 결과 전체가 아니라, 출원인 주소가 <b>${esc(region.region)}</b>으로 확인된 출원을 지역 수치로 셉니다. 등록 비율은 그중 등록 상태 건수 ÷ 지역 주소 일치 출원 건수입니다.</p></div><div class="detail-grid"><article><span>${esc(itemName(item))} · 지역 주소 일치 출원</span><strong>${regionalAvailable ? `${number(localCount)}건` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? `출원인 주소가 ${esc(region.region)}으로 확인된 고유 출원` : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${esc(pendingReason)}`}</small></article><article><span>그중 등록 상태</span><strong>${regionalAvailable ? `${number(registeredCount)}건` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? localCount ? `${number(registeredCount)} ÷ ${number(localCount)} · 등록 비율 ${percent(item.metrics.registrationRate.value)}` : "지역 주소 일치 출원 0건 · 등록 비율 계산 불가" : "지역 주소 일치 출원 수가 확정된 뒤 계산합니다."}</small></article><article><span>주소 확인 후보 중 이 지역 비율</span><strong>${regionalAvailable ? item.metrics.localApplicantShare.value === null ? "계산 불가" : percent(item.metrics.localApplicantShare.value) : "지역별 집계 대기"}</strong><small>${regionalAvailable ? "주소를 판정할 수 있었던 전국 검색 후보 중 이 지역 주소와 일치한 비율 · 주소 미확보 후보 제외" : esc(pendingReason)}</small></article><article><span>이 특산품의 출원 판정</span><strong>${regionalAvailable ? localCount > 0 ? "출원 확인" : "출원 없음" : "집계 대기"}</strong><small>${regionalAvailable ? localCount > 0 ? "특산품 출원율 계산에서 출원 확인 1개로 집계" : "판정은 완료됐으며 특산품 출원율의 분모에만 포함" : "판정 전이라 출원 미확인으로 계산되어 특산품 출원율의 분모에 포함됩니다"}</small></article></div><div class="review-strip"><div><span>지정상품 자동 일치</span><strong>${number(item.metrics.confirmedGoodsMatchCount.value)}건</strong></div><div><span>지정상품 개별 검토</span><strong>${number(item.metrics.goodsReviewCandidateCount.value)}건</strong></div><p>상표명은 사례로 보존하고, 대표 특산품 집계 키와 분리합니다.</p></div><section class="trademark-examples"><div class="example-heading"><strong>전국 검색 상표 사례</strong><span>지역 귀속 전 검색 후보 · 최근 출원 + 지정상품 근거 우선 · 최대 ${examples.length || 0}건</span></div>${examples.length ? `<div class="example-list">${examples.map((example) => `<article><div><strong>${esc(example.title || "상표명 미기록")}</strong><small>${esc(example.applicationNumber || "출원번호 미기록")} · ${esc(example.applicationDate || "출원일 미기록")} · ${esc(example.applicationStatus || "상태 미기록")}</small></div><span class="goods-chip ${example.goodsReviewRequired ? "review" : ""}">${esc(goodsMethod(example.goodsMatchMethod))}</span>${example.goodsEvidence?.length ? `<p>지정상품: ${example.goodsEvidence.map((row) => `${esc(row.designatedProductName || "명칭 미기록")}${row.classCode ? ` (${esc(row.classCode)}류)` : ""}`).join(", ")}</p>` : ""}</article>`).join("")}</div>` : '<p class="empty">현재 스냅샷에는 개별 상표명이 포함되지 않았습니다.</p>'}</section></div>`;
  }
  function regionsScreen() {
    const keyword = state.query.trim().toLocaleLowerCase("ko-KR");
    const rows = !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => itemName(item).toLocaleLowerCase("ko-KR").includes(keyword)));
    if (!rows.some((region) => regionKey(region) === state.regionKey) && rows[0]) state.regionKey = regionKey(rows[0]);
    const region = selectedRegion(), item = selectedItem(region);
    return `<section class="screen-section"><div class="screen-heading"><div><h1>지자체별 조회</h1></div><p>지자체별 특산품과 해당 지역 주소로 확인된 상표 출원 현황을 제공합니다.</p></div><section class="workspace"><aside class="region-panel"><div class="panel-heading"><div><h2>지자체 목록</h2></div><span>${rows.length}곳</span></div><label class="search-field"><span class="sr-only">지역 또는 품목 검색</span><input id="region-search" value="${esc(state.query)}" placeholder="지역 또는 품목 검색"></label><div class="region-list">${rows.map((row) => { const available = row.items.filter((entry) => officialItemLabel(entry) && entry.metrics.uniqueTrademarkCount.availability === "available"); const count = available.reduce((sum, entry) => sum + (entry.metrics.uniqueTrademarkCount.value || 0), 0); const coverage = specialtyCoverage([row]); return `<button type="button" data-region="${esc(regionKey(row))}" class="region-button ${regionKey(row) === state.regionKey ? "active" : ""}"><span><strong>${esc(row.region)}</strong><small>특산품 ${coverage.total}개 · 출원 확인 ${coverage.applied}개 · 출원율 ${percent(coverage.rate)}<br>${available.length ? `지역 주소 일치 출원 ${number(count)}건` : "지역 출원 현황 추가 확인 필요"}</small></span><span class="state state-${esc(row.dataState)}">${esc(labels[row.dataState] || row.dataState)}</span></button>`; }).join("") || '<p class="empty">검색 결과가 없습니다.</p>'}</div></aside>${regionDetail(region, item)}</section></section>`;
  }
  function itemRows() {
    const rows = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, trademarks: 0, trademarksDisplay: 0, hasProvisional: false, registered: 0, available: 0, availableRegions: [], regions: [] };
      const trade = tradeDisplay(item);
      if (trade.value !== null) { row.trademarksDisplay += trade.value; if (trade.provisional) row.hasProvisional = true; }
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.available += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; if (!row.availableRegions.includes(region.region)) row.availableRegions.push(region.region); }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      rows.set(name, row);
    }));
    const keyword = state.itemQuery.trim().toLocaleLowerCase("ko-KR");
    // 정렬은 확정 건수(trademarks) 기준으로 한다 — 전국 검색까지 섞은 trademarksDisplay로
    // 정렬하면 지역 확인이 안 된 노이즈가 큰 품목이 상위 100개 컷에서 확정 데이터를
    // 밀어낼 수 있다(2026-08-19 결정).
    return [...rows.values()].filter((row) => !keyword || row.name.toLocaleLowerCase("ko-KR").includes(keyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword))).sort((a, b) => b.trademarks - a.trademarks);
  }
  function itemsScreen() {
    const rows = itemRows(); const ITEM_ROW_LIMIT = 100; const visibleRows = rows.slice(0, ITEM_ROW_LIMIT); return `<section class="screen-section"><div class="screen-heading"><div><h1>품목별 조회</h1></div><p>품목마다 확인 지역과 상표 현황을 카드 한 장에 요약했습니다.</p></div><div class="item-screen"><div class="item-screen-toolbar"><label><span class="sr-only">품목 검색</span><input id="item-search" value="${esc(state.itemQuery)}" placeholder="품목명 또는 지역명 검색"></label><span>${rows.length > ITEM_ROW_LIMIT ? `상표 출원 건수 상위 ${ITEM_ROW_LIMIT}개 표시 · 전체 ${rows.length}개` : `검색 결과 ${rows.length}개`}</span></div><div class="item-reading-guide"><strong>수치 구분</strong><span><b>지역 확인 출원</b> 출원인 주소가 해당 지역과 일치</span><span><b>전국 검색</b> 아직 지역 확인 전인 별도 모집단</span></div><div class="item-card-grid">${visibleRows.map((row, index) => { const decidedRegions = row.availableRegions.length; const pendingRegions = Math.max(0, row.regions.length - decidedRegions); const nationwideOnly = Math.max(0, row.trademarksDisplay - row.trademarks); const statusClass = pendingRegions === 0 ? "complete" : decidedRegions ? "partial" : "pending"; const statusLabel = pendingRegions === 0 ? "전체 지역 판정 완료" : decidedRegions ? "일부 지역 판정" : "지역 집계 대기"; return `<article class="item-card"><div class="item-card-head"><div><span class="item-rank">${String(index + 1).padStart(2, "0")}</span><h2>${esc(row.name)}</h2><small>${row.regions.length}개 지역에서 확인</small></div><span class="item-status ${statusClass}">${statusLabel}</span></div><details class="item-regions-detail"><summary>전체 ${row.regions.length}개 지역 보기</summary><div class="region-chips">${row.regions.map((region) => `<span>${esc(region)}</span>`).join("")}</div></details><div class="item-card-metrics"><div><span>지역 확인 출원</span><strong>${decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>판정 완료 ${decidedRegions}/${row.regions.length}개 지역</small></div><div><span>그중 등록</span><strong>${decidedRegions ? `${number(row.registered)}건` : "—"}</strong><small>확인 출원 중 등록 상태</small></div><div><span>등록률</span><strong>${decidedRegions && row.trademarks ? percent(row.registered / row.trademarks) : decidedRegions ? "계산 불가" : "—"}</strong><small>${decidedRegions && row.trademarks ? `${number(row.registered)} ÷ ${number(row.trademarks)}` : "지역 확인 후 계산"}</small></div></div>${nationwideOnly > 0 ? `<p class="provisional-note">지역 확인 전 전국 검색 후보 ${number(nationwideOnly)}건은 위 확정 수치에 포함하지 않았습니다.</p>` : ""}</article>`; }).join("") || '<p class="empty item-empty">검색 결과가 없습니다.</p>'}</div><details class="method-note"><summary>품목명 집계 기준 보기</summary><p>고시명칭·NICE류가 확정된 품목만 공식 명칭으로 묶습니다. 아직 고시명칭이 확정되지 않은 원물명은 지역별 상세 화면에 원문 그대로 보존합니다.</p></details></div></section>`;
  }
  // 지역 출원 미확인 목록은 특산품명, 지정상품 일치 근거, 지역 주소 판정이 모두 갖춰진
  // 항목만 공개한다. 단순 고시명칭 검색 결과와 미분류 원물명은 공개 목록에서 제외한다.
  function gapRows() {
    const confirmed = new Map();
    let excludedCount = 0;
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      if (!region.regionCode) return;
      if (item.metrics.uniqueTrademarkCount.availability !== "available") return;
      if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) return;
      const officialLabel = officialItemLabel(item);
      if (!officialLabel) return;
      const confirmedGoods = item.metrics.confirmedGoodsMatchCount;
      const hasDesignatedGoodsEvidence = item.matchingBasis === "raw_item_goods_matched" || (confirmedGoods?.availability === "available" && (confirmedGoods.value || 0) > 0);
      if (!hasDesignatedGoodsEvidence) { excludedCount += 1; return; }
      const row = confirmed.get(officialLabel) || { name: officialLabel, regions: [] };
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      confirmed.set(officialLabel, row);
    }));
    const sortRows = (map) => [...map.values()].sort((a, b) => b.regions.length - a.regions.length || a.name.localeCompare(b.name, "ko-KR"));
    const keyword = state.gapQuery.trim().toLocaleLowerCase("ko-KR");
    const matches = (row) => !keyword || row.name.toLocaleLowerCase("ko-KR").includes(keyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword));
    const allConfirmed = sortRows(confirmed);
    return { confirmed: allConfirmed.filter(matches), totalConfirmed: allConfirmed.length, excludedCount };
  }
  function gapItemCard(row, statusLabel) {
    return `<article class="item-card"><div class="item-card-head"><div><h2>${esc(row.name)}</h2><small>${row.regions.length}개 지역에서 지역 출원 미확인</small></div><span class="item-status pending">${esc(statusLabel)}</span></div><details class="item-regions-detail"><summary>해당 지역 ${row.regions.length}개 보기</summary><div class="region-chips">${row.regions.map((region) => `<span>${esc(region)}</span>`).join("")}</div></details></article>`;
  }
  function gapsScreen() {
    const rows = gapRows();
    const empty = `<div class="gap-empty item-empty"><strong>현재 공개할 수 있는 지역 출원 미확인 항목이 없습니다.</strong><p>지정상품 근거가 확인되지 않은 후보 ${number(rows.excludedCount)}건은 목록에서 제외했습니다. 지정상품과 지역 귀속 근거가 보완되면 이 목록에 반영됩니다.</p></div>`;
    return `<section class="screen-section"><div class="screen-heading"><div><h1>지역 출원 미확인</h1></div><p>특산품 지정상품과 지역 귀속 근거를 모두 확인한 항목만 제공합니다.</p></div><div class="compare-banner gap-definition"><span>표시 기준</span><strong>지정상품 일치 · 출원인 주소 판정 완료</strong><p>전국 검색 결과가 있더라도 해당 지역 주소의 출원이 확인되지 않은 경우입니다. 전국에 관련 출원이 없다는 의미는 아니며, 지정상품 근거가 확인되지 않은 품목은 목록에서 제외합니다.</p></div>${rows.totalConfirmed ? `<label class="search-field gap-search"><span class="sr-only">품목 또는 지역 검색</span><input id="gap-search" value="${esc(state.gapQuery)}" placeholder="품목명 또는 지역명 검색"></label>` : ""}<section class="compare-region-section gap-results"><div class="compare-section-head"><div><span>확인 기준 충족</span><h2>지역 주소의 출원이 확인되지 않은 특산품</h2></div><p>품목명과 지정상품 근거가 확인된 결과입니다.</p></div><div class="item-card-grid">${rows.confirmed.map((row) => gapItemCard(row, "지역 출원 미확인")).join("") || empty}</div></section></section>`;
  }
  function dataScreen() {
    if (!pipeline) return '<section class="screen-section"><p class="empty">파이프라인 개요 데이터가 없습니다.</p></section>';
    const addressRate = Math.round((pipeline.applicantRegionVerification.rate || 0) * 100);
    const previewRate = pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal);
    return `<section class="screen-section data-overview">${criteriaHtml()}<div class="screen-heading"><div><h1>특산물과 상표가<br>데이터가 되기까지</h1></div><p>수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다.</p></div><div class="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>${number(pipeline.rowCounts.total)}</strong><small>지역-특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>${number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역-품목 조합</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>${number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 전국 고유 후보</small></article><i>→</i><article class="flow-highlight"><span>05 · 지역별 집계</span><strong>${number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>지역 출원 수 표시 가능 항목</small></article></div><div class="data-summary-grid"><article class="data-summary-card"><h2>특산물 데이터</h2><div class="data-stat"><strong>${number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div class="data-stat"><strong>${number(snapshot.coverage.regionItemCount)}개</strong><span>지역-품목 조합</span></div><div class="data-stat"><strong>${number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p class="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article class="data-summary-card"><h2>상표 매칭 결과</h2><div class="match-bars"><div><span>특산품 출원율 <b>${percent(nationalSpecialtyCoverage.rate)}</b></span><em><i style="width:${Math.round((nationalSpecialtyCoverage.rate || 0) * 100)}%"></i></em><small>출원 확인 ${number(nationalSpecialtyCoverage.applied)} / 전체 수집 특산품 ${number(nationalSpecialtyCoverage.total)}(지역별 집계 완료 ${number(nationalSpecialtyCoverage.decided)})</small></div><div><span>고유 상표 주소 확보 <b>${number(pipeline.applicantRegionVerification.verifiedCount)}건</b></span><em><i style="width:${addressRate}%"></i></em><small>전국 고유 후보 중 ${percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>지역별 출원 수 표시 가능 <b>${number(pipeline.regionalMetricGate.availableRegionItemCount)}개</b></span><em><i style="width:${Math.max(2, Math.round(previewRate * 100))}%"></i></em><small>전체 ${number(gateTotal)}개 지역-품목 중 ${percent(previewRate)}</small></div></div><p class="match-explanation">특산품 출원율은 현재 수집된 지역×특산품 전체 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 전체 ${number(nationalSpecialtyCoverage.total)}개 중 명칭 확인이나 지역별 집계가 덜 끝난 항목도 분모에 포함하며, 출원이 확인될 때만 분자에 더합니다 — 후속 확인이 진행되면 값이 올라갈 수 있습니다.</p></article></div><div class="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>특산품 출원율 = 지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수</b>입니다. 명칭 확인이나 지역별 집계가 아직 끝나지 않은 항목도 분모에 포함하고 분자에는 넣지 않습니다. <b>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 출원번호 중복을 제거한 전국 검색 후보이며, 등록 비율은 지역 주소 일치 출원 중 등록 상태인 건의 비율로 별도 계산합니다. 검색이 부분 수집 상태인 품목은 0건으로 확정하지 않고 <b>지역별 집계 대기</b>로 표시합니다.</p></div>${provenanceHtml()}</section>`;
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
    const comparisonRows = [...provinceStats.keys()].map((province) => {
      const regions = snapshot.regions.filter((region) => (region.sido || region.region) === province);
      const coverage = specialtyCoverage(regions);
      const names = [...new Set(regions.flatMap((region) => region.items.map(officialItemLabel).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "ko-KR"));
      return { province, coverage, names };
    }).sort((a, b) => b.coverage.applied - a.coverage.applied || b.coverage.total - a.coverage.total || a.province.localeCompare(b.province, "ko-KR"));
    return `<section class="screen-section"><div class="screen-heading"><div><h1>특화작목 비교</h1></div><p>지금 비교할 수 있는 데이터와 아직 필요한 데이터를 먼저 구분했습니다.</p></div><div class="compare-banner"><span>현재 단계</span><strong>비교 기준 원본 확보 전 · 준비 현황만 확인 가능</strong><p>정책 지정 특화작목 목록이 아직 없어 일치율은 계산하지 않습니다. 현재 지역 특산품과 출원 현황은 아래에서 먼저 확인할 수 있습니다.</p></div><div class="compare-readiness"><article class="ready"><span>01 · 현재 보유</span><strong>지역 특산품·상표 현황</strong><p>지역별 전체 수집 특산품 수, 출원 확인 수와 출원율</p></article><i>→</i><article class="waiting"><span>02 · 추가 필요</span><strong>정책 지정 특화작목 원본</strong><p>지정 지역·작목·기간·근거 문서</p></article><i>→</i><article><span>03 · 원본 확보 후</span><strong>일치·누락 비교</strong><p>정책 작목 대비 상표 활동과 미출원 품목</p></article></div><section class="compare-region-section"><div class="compare-section-head"><div><span>현재 확인 가능</span><h2>지역별 특산품 출원 현황</h2></div><p>정책 비교 결과가 아니라, 비교에 투입될 현재 데이터입니다.</p></div><div class="compare-region-table"><div class="compare-region-head"><span>지역</span><span>전체 수집 특산품</span><span>전체 특산품 출원율</span><span>정책 비교</span></div>${comparisonRows.map(({ province, coverage, names }) => `<div class="compare-region-row"><strong>${esc(province)}</strong><div><b>${number(coverage.total)}개</b></div><div><b>${percent(coverage.rate)}</b><small>전체 ${coverage.total}개 중 출원 확인 ${coverage.applied}개 · 지역별 집계 완료 ${coverage.decided}개${coverage.pending ? ` · ${coverage.pending}개 대기` : ""}</small></div><span class="compare-waiting">원본 대기</span><details class="compare-items-detail"><summary>명칭 확인 완료 특산품 ${number(names.length)}개 보기</summary><div class="compare-item-chips">${names.map((name) => `<span>${esc(name)}</span>`).join("")}</div></details></div>`).join("")}</div></section><div class="compare-sources"><article><span>필수 입력</span><strong>농촌진흥청 지역특화작목 지정 목록</strong><p>지역·작목·계획 기간·근거 버전을 구조화해야 합니다.</p></article><article><span>처리 원칙</span><strong>원본 확보 후 자동 비교</strong><p>명칭 정규화 후보만 개별 검토하고 집계·일치 판정은 자동화합니다.</p></article></div></section>`;
  }

  // 데이터 개요 탭에서만 한 번 보여준다(2026-08-19: 요약 탭에 있을 필요가 없다는
  // 피드백에 따라 데이터 개요로 옮김. 그 전에는 모든 탭에 반복 노출하던 것을 정리했었음).
  function criteriaHtml() {
    const rows = [
      ["품목 매칭", "고시명칭 일치·포함", "지정상품명이 고시상품명칭과 일치하거나 포함되면 특산품 활용 출원으로 인정하고, NICE류만 일치하면 개별 검토로 분리합니다."],
      ["지역 매칭", "법정동코드 완전일치", "국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만"],
      ["상표 검색", "KIPRIS 단어검색(고시명칭 기준)", "검색·집계 키는 고시명칭 + NICE류이며, 상표명은 개별 사례로만 보존하고 집계 키로 쓰지 않음"],
      ["지역 주소 일치 출원 / 그중 등록", "출원인 주소가 해당 지역으로 확인된 출원만", "등록 비율은 그중 등록 상태 건수 ÷ 지역 주소 일치 출원 건수입니다. 전국 검색 후보와 주소 미확보 건은 제외합니다."],
      ["출원인 지역 매칭", "주소 확보율은 참고 지표", "주소가 확인된 건은 지역 귀속에 반영하고, 미확보 건도 원자료와 확보율을 함께 표시합니다. 부분 수집은 별도 상태로 구분합니다."],
    ];
    return `<section class="criteria" aria-label="판정 기준과 매칭 방법"><div class="section-heading"><div><h2>판정 기준과 매칭 방법</h2></div><span>현재 출처 ${esc(sourceLine)}</span></div><div class="criteria-grid">${rows.map(([label, value, note]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("")}</div></section>`;
  }
  function provenanceHtml() {
    return `<section class="provenance"><div class="section-heading"><div><h2>출처와 데이터 상태</h2></div><span>${esc(snapshot.schemaVersion)}</span></div><div class="source-grid">${snapshot.sources.filter((source) => source.sourceUrl).map((source) => `<a href="${esc(source.sourceUrl)}" target="_blank" rel="noreferrer"><span>${esc(source.sourceLabel || source.sourceId)}</span><strong>${esc(source.sourceContractVersion || "버전 미기록")}</strong><small>검증 ${esc(source.sourceLastVerifiedAt || date(source.sourceFetchedAt))}</small></a>`).join("")}<a href="${esc(geometry.boundaryReference.sourceUrl)}" target="_blank" rel="noreferrer"><span>지도 경계</span><strong>${esc(geometry.boundaryReference.sourceName)}</strong><small>${esc(geometry.boundaryReference.sourceBasis)} · 참고용</small></a></div></section>`;
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
    bindSearchInput("#gap-search", "gapQuery");
  }
  function render() {
    nav();
    document.querySelector("#app").innerHTML = state.tab === "summary" ? summaryScreen() : state.tab === "applications" ? applicationsScreen() : state.tab === "regions" ? regionsScreen() : state.tab === "items" ? itemsScreen() : state.tab === "gaps" ? gapsScreen() : state.tab === "compare" ? compareScreen() : dataScreen();
    if (state.tab === "regions") {
      document.querySelectorAll(".detail-grid article").forEach((article) => {
        if (article.querySelector("span")?.textContent?.trim() === "그중 등록 상태") article.remove();
      });
      const metricNote = document.querySelector(".detail-panel .metric-reading-note p");
      if (metricNote) metricNote.textContent = "전국 검색 결과 전체가 아니라, 출원인 주소가 해당 지역으로 확인된 출원을 지역 수치로 셉니다.";
    }
    bind();
  }

  document.querySelector("#generated").textContent = `마지막 생성 ${date(snapshot.generatedAt)}`;
  document.querySelector("#scope-label").textContent = scopeLabel;
  document.querySelector("#snapshot-id").textContent = `Snapshot ${snapshot.snapshotId} · 마지막 생성 ${date(snapshot.generatedAt)}`;
  document.querySelector("#brand-home").onclick = () => { state.tab = "summary"; render(); };
  render();
}
