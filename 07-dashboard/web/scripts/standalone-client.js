/* eslint-disable @typescript-eslint/no-unused-vars -- embedded and invoked by dashboard.html */
function dashboardClient(snapshot, geometry, registrationExamples) {
  const labels = { complete_nonzero: "현황 확인", complete_zero: "검색 결과 없음", partial: "검토중", error: "확인 오류", skipped: "분류 확인 필요", not_collected: "확인 전", complete: "집계 완료" };
  const tabs = { summary: "요약", applications: "지역별 출원율", regions: "지자체별 조회", items: "품목별 조회", compare: "특화작목 비교", data: "데이터 개요" };
  const mapLabels = { coverage: "특산품 수", trademarks: "상표 건수", applicationCoverage: "출원율", registration: "등록률" };
  const mapDescriptions = {
    trademarks: "검색 수집이 완료된 항목에서, 출원인 주소가 해당 지역으로 확인된 고유 상표 출원 건수입니다.",
    registration: "지도에 포함된 지역 주소 일치 출원 중 등록 상태인 건의 비율입니다(등록 ÷ 출원).",
    coverage: "현재 스냅샷에 수집된 지역×특산품 수입니다.",
    applicationCoverage: "이 지역에서 수집된 전체 특산품 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 아직 지역별 집계가 안 끝난 품목도 전체 분모에 포함하므로, 데이터가 쌓일수록 값이 올라갈 수 있습니다.",
  };
  const state = { tab: "summary", query: "", itemQuery: "", categoryFilter: "", expandedRegionProvince: null, regionKey: snapshot.regions[0]?.regionCode || snapshot.regions[0]?.region, itemId: "", mapMetric: "coverage", province: null, municipality: null };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
  const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  const date = (value) => value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록";
  const dateOnly = (value) => value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록";
  const latestDate = (...values) => values.filter((value) => value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  const dashboardUpdatedAt = latestDate(
    snapshot.generatedAt,
    ...snapshot.sources.flatMap((source) => [source.sourceFetchedAt, source.sourceLastVerifiedAt]),
    ...snapshot.regions.flatMap((region) => region.items.flatMap((item) => Object.values(item.metrics).map((metric) => metric.calculatedAt))),
  );
  const itemName = (item) => item.itemName || item.noticeName || "미지정 품목";
  // 이슈 #112: 지자체/품목 목록을 리스트 대신 출원건수 기반 태그 클라우드로 보여달라는
  // 요청. 글자 크기 비교는 막대그래프보다 부정확하다는 점을 감안해(글자 수가 다른
  // 단어끼리는 왜곡될 수 있음), 크기 폭을 좁게(12~24px) 잡고 면적에 가깝게 느껴지도록
  // 제곱근 스케일을 쓴다. 정확한 값은 title(hover)과 클릭 시 상세 화면에서 확인한다.
  const wordCloudFontSize = (value, max) => {
    const MIN_PX = 12, MAX_PX = 24;
    if (!max || value <= 0) return MIN_PX;
    const ratio = Math.sqrt(Math.min(1, value / max));
    return Math.round(MIN_PX + (MAX_PX - MIN_PX) * ratio);
  };
  // 이슈 #112 후속: 태그 클라우드를 더 컬러풀하게 해달라는 요청. dataviz 스킬의 6가지
  // 팔레트 검증(node validate_palette.js)을 거쳐 고른 4색이다 — 흰 배경 텍스트 기준
  // WCAG 4.5:1을 넘도록 어둡게 조정한 뒤, 태그가 자유롭게 줄바꿈되어 어느 두 태그든
  // 이웃할 수 있는 상황(all-pairs)에서도 색맹 시뮬레이션 상 구분 가능한 조합만 남겼다
  // (documented 8색 팔레트를 그대로 어둡게 하면 5색 이상에서 실패해, 통과하는 4색으로
  // 제한). 값(면적/글자 크기)과 무관하게 이름 해시로 고정 배정해 리렌더링에도 안 바뀐다.
  const WORD_CLOUD_PALETTE = ["#2876d4", "#cd4d10", "#008856", "#4a3aa7"];
  const wordCloudColor = (seed) => {
    let hash = 5381;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
    return WORD_CLOUD_PALETTE[hash % WORD_CLOUD_PALETTE.length];
  };
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
  const verdictTitle = (verdict) => `사람이 개별 승인하지 않고 규칙 기반 알고리즘이 자동 확정(${verdict.method || "algorithm"}, 신뢰도 ${verdict.confidence ?? "미기록"})`;
  const regionKey = (region) => region.regionCode || region.region;
  // 이슈 #80/#113: 지도 경계는 2026-08-24부터 vuski/admdongkor(2026-07-01 기준,
  // 군위군의 경북→대구 편입 등 최신 행정구역 변경이 반영됨)로 바뀌어 군위군 같은
  // 불일치는 더 이상 발생하지 않는다. 다만 지도 도형은 여전히 제3자가 재배포하는
  // 참고용 데이터라 향후 개편에서 또 어긋날 수 있으므로, sido까지 정확히 일치하는
  // 지역이 없으면 시군구명만으로도 찾는 안전망은 남겨둔다.
  const findMunicipalityRegion = (province, name) =>
    snapshot.regions.find((region) => region.sido === province && region.sigungu === name)
    || snapshot.regions.find((region) => region.sigungu === name);
  // 2026-08-21: 대전·대구·부산·울산·인천광역시, 전남광주통합특별시는 원본 소스(농사로)에
  // 구/군 정보가 아예 없어 시 전체로만 특산품이 잡힌다(region.sigungu === region.sido).
  // 특정 구를 클릭해도 이 "미분류" 행까지 걸러버리면 실제로 있는 데이터가 빈 화면으로
  // 보인다 — 어떤 구를 눌러도 시 전체 미분류 항목은 계속 보여준다(사용자 요청).
  const isUnclassifiedRegion = (region) => region.sigungu === region.sido;
  const fill = (value, max) => value === null ? "#e3e6ec" : `color-mix(in srgb, #0f5fa6 ${Math.round(24 + Math.max(.12, Math.min(1, max ? value / max : 0)) * 68)}%, #e9eef4)`;
  // 2026-08-21: 출원율을 텍스트로만 보여주지 말고 큰 숫자 + 원형 게이지로 보여달라는
  // 요청 — Dashboard.tsx의 RateRing과 동일한 로직을 HTML 문자열로 만든다.
  const rateRing = (value, label = "출원율", size = 128, strokeWidth = 12) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const ratio = value === null ? 0 : Math.max(0, Math.min(1, value));
    const offset = circumference * (1 - ratio);
    const center = size / 2;
    const fillCircle = value === null ? "" : `<circle class="rate-ring-fill" cx="${center}" cy="${center}" r="${radius}" stroke-width="${strokeWidth}" fill="none" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${center} ${center})"></circle>`;
    return `<svg class="rate-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)} ${esc(percent(value))}"><circle class="rate-ring-track" cx="${center}" cy="${center}" r="${radius}" stroke-width="${strokeWidth}" fill="none"></circle>${fillCircle}<text class="rate-ring-label" x="50%" y="50%" text-anchor="middle" dominant-baseline="middle">${esc(percent(value))}</text></svg>`;
  };
  // 2026-08-21: 서울·세종은 경기도에 둘러싸여 있어 화살표(연결선)로 라벨을 빼서
  // 보여줬는데, 오히려 경기도 라벨이 서울 자리와 겹쳐 어색하다는 지적(사용자) — 화살표
  // 없이 경기도 라벨만 살짝 우측 아래로 옮기고, 서울·세종은 제자리에 그대로 표시한다.
  const nationalLabelOffsets = { 경기도: { x: 20, y: 38 } };
  const displayRegionName = (name) => name.replace("전남광주통합특별시", "전남·광주 통합권역");
  const mapLabelMarkup = (shapes, municipality) => shapes.map((shape) => {
    const offset = municipality ? null : nationalLabelOffsets[shape.name];
    const x = shape.labelX + (offset?.x || 0);
    const y = shape.labelY + (offset?.y || 0);
    const label = esc(displayRegionName(shape.name));
    return `<text x="${x}" y="${y}" class="map-label ${municipality ? "map-label-municipality" : "map-label-province"}">${label}</text>`;
  }).join("");
  const totals = snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { acc.availableItems += 1; acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; } acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0, availableItems: 0 });
  const sourceLine = snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean).join(" · ");
  const pipeline = snapshot.pipelineStatus;
  const scopeLabel = snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터";
  const gateTotal = pipeline ? pipeline.regionalMetricGate.availableRegionItemCount + pipeline.regionalMetricGate.blockedRegionItemCount : snapshot.coverage.regionItemCount;
  const uniqueSpecialtyCount = new Set(snapshot.regions.flatMap((region) => region.items.map((item) => itemName(item)))).size;
  const nationalSpecialtyCoverage = specialtyCoverage(snapshot.regions);
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
  // 2026-08-21: 지역별 출원 탭 특산품 목록에 출원 여부를 색으로 구분해 보여준다(사용자
  // 요청) — 법정동코드 미해결 지역(지역명을 못 찾은 것)은 "미출원"과 구분해
  // "구분 정보 없음"으로 표시한다.
  function specialtyFilingStatus(item) {
    const value = item.metrics.uniqueTrademarkCount.value || 0;
    if (item.metrics.uniqueTrademarkCount.availability === "available" && value > 0) {
      return { label: `출원 확인 · ${number(value)}건`, filed: true };
    }
    return { label: "미출원(검토중)", filed: false };
  }
  function regionalMetricPendingReason(item) {
    if (item.dataState === "partial") return "검색 결과의 수집 상한에 도달하여 추가 확인이 필요합니다.";
    if (item.dataState === "error") return "검색 결과를 확인하지 못했습니다.";
    if (item.dataState === "skipped") return "품목 분류 확인이 필요해 지역별 현황에서 제외했습니다.";
    if (item.dataState === "not_collected") return "상표 출원 현황 확인 전입니다.";
    return "지역별 출원 현황을 추가로 확인하고 있습니다.";
  }
  function selectedRegion() { return snapshot.regions.find((region) => regionKey(region) === state.regionKey) || snapshot.regions[0]; }
  function selectedItem(region) { const official = officialRegionItems(region); return region.items.find((item) => item.specialtyId === state.itemId) || official[0] || region.items[0]; }

  function nav() {
    document.querySelector("#primary-tabs").innerHTML = Object.entries(tabs).map(([key, label]) => `<button type="button" data-tab="${key}" class="${state.tab === key ? "active" : ""}" ${state.tab === key ? 'aria-current="page"' : ""}>${label}</button>`).join("");
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { state.tab = button.dataset.tab; state.query = ""; state.itemQuery = ""; state.categoryFilter = ""; render(); }; });
  }

  function summaryScreen() {
    const visibleRegions = state.province ? snapshot.regions.filter((region) => (region.sido || region.region) === state.province && (!state.municipality || region.sigungu === state.municipality || isUnclassifiedRegion(region))) : snapshot.regions;
    const visibleSpecialtyCoverage = specialtyCoverage(visibleRegions);
    // 지도 옆 미리보기는 상표명(예: 등록 브랜드 "임금님표쌀")이나 아직 고시명칭이 확정 안 된
    // 원문 표기가 아니라, 확정된 특산물 고시명칭만 보여준다. 개별 상표명은 지역 상세에서
    // 검색 근거와 함께 확인한다.
    const visibleItems = visibleRegions.flatMap((region) => region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) })));
    const visibleTrademarkCount = visibleItems.reduce((sum, { item }) => item.metrics.uniqueTrademarkCount.availability === "available" ? sum + (item.metrics.uniqueTrademarkCount.value || 0) : sum, 0);
    const visibleRegisteredCount = visibleItems.reduce((sum, { item }) => item.metrics.registeredTrademarkCount.availability === "available" ? sum + (item.metrics.registeredTrademarkCount.value || 0) : sum, 0);
    const visibleRegistrationRate = visibleTrademarkCount ? visibleRegisteredCount / visibleTrademarkCount : null;
    const visibleInsightItems = [...visibleItems].sort((a, b) => {
      if (state.mapMetric === "registration") return (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0);
      if (state.mapMetric === "coverage") return `${a.region.region} ${a.label}`.localeCompare(`${b.region.region} ${b.label}`, "ko-KR");
      return (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0);
    });
    const insightListLabel = state.mapMetric === "coverage" ? "수집 특산품 예시" : state.mapMetric === "trademarks" ? "상표 출원 상위 특산품" : state.mapMetric === "registration" ? "등록 상위 특산품" : "특산품별 출원 확인 현황";
    const insightItemValue = (item) => {
      const available = item.metrics.uniqueTrademarkCount.availability === "available";
      const filed = item.metrics.uniqueTrademarkCount.value || 0;
      if (state.mapMetric === "coverage") return "수집 항목";
      if (!available) return "지역별 집계 대기";
      if (state.mapMetric === "trademarks") return `상표 ${number(filed)}건`;
      if (state.mapMetric === "registration") return filed ? `등록 ${number(item.metrics.registeredTrademarkCount.value || 0)}건 · ${percent(item.metrics.registrationRate.value)}` : "등록 대상 출원 없음";
      return filed > 0 ? `출원 확인 · ${number(filed)}건` : "미출원(검토중)";
    };
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const percentageMetric = ["registration", "applicationCoverage"].includes(state.mapMetric);
    const nationalMax = percentageMetric ? 1 : Math.max(1, ...geometry.provinces.map((shape) => provinceValue(shape.name) || 0));
    const municipalMax = percentageMetric ? 1 : municipal ? Math.max(1, ...municipal.items.map((shape) => regionValue(findMunicipalityRegion(state.province, shape.name)) || 0)) : 1;
    const RANKING_LIMIT = 10;
    const rankingCandidates = snapshot.regions.flatMap((region) => region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; }));
    const applicationRankingRows = [...rankingCandidates].filter(({ item }) => item.metrics.uniqueTrademarkCount.availability === "available").sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
    const registrationRankingRows = [...rankingCandidates].filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available").sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = findMunicipalityRegion(state.province, shape.name); const value = regionValue(region); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, municipalMax)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, nationalMax)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} ${mapValueLabel(value)}"><title>${esc(shape.name)} · ${mapValueLabel(value)}</title></path>`; }).join("");
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const shapeLabels = mapLabelMarkup(activeShapes, Boolean(municipal));
    const insightHero = state.mapMetric === "applicationCoverage"
      ? `<div class="rate-hero">${rateRing(visibleSpecialtyCoverage.rate, "출원율")}<div class="rate-hero-detail"><span>특산품 출원율</span><small>수집 특산품 ${number(visibleSpecialtyCoverage.total)}개 중 출원 확인 ${number(visibleSpecialtyCoverage.applied)}개${visibleSpecialtyCoverage.pending ? ` · 집계 대기 ${number(visibleSpecialtyCoverage.pending)}개` : ""}</small></div></div>`
      : state.mapMetric === "registration"
        ? `<div class="rate-hero">${rateRing(visibleRegistrationRate, "등록률")}<div class="rate-hero-detail"><span>상표 등록률</span><small>지역 주소 일치 출원 ${number(visibleTrademarkCount)}건 중 등록 ${number(visibleRegisteredCount)}건</small></div></div>`
        : state.mapMetric === "coverage"
          ? `<div class="metric-count-hero"><strong>${number(visibleSpecialtyCoverage.total)}</strong><div class="rate-hero-detail"><span>특산품 수</span><small>현재 선택 지역에서 수집된 지역×특산품 항목입니다.</small></div></div>`
          : `<div class="metric-count-hero"><strong>${number(visibleTrademarkCount)}</strong><div class="rate-hero-detail"><span>상표 건수</span><small>출원인 주소가 현재 선택 지역과 일치한 고유 상표 출원입니다.</small></div></div>`;
    const insightList = visibleInsightItems.slice(0, 5).map(({ region, item, label }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span><strong>${esc(region.sigungu || region.region)} / ${esc(label)}</strong><small>${esc(noticeBasis(item))}${item.niceClass ? ` · NICE ${esc(item.niceClass)}류` : ""}</small></span><b>${esc(insightItemValue(item))}</b></button>`).join("") || '<p class="empty">이 지역에는 수집된 특산품이 없습니다.</p>';
    return `<section class="hero"><div><h1>지역 특산품 상표 출원 현황</h1><p class="hero-copy" aria-hidden="true">지역별 특산품의 상표 출원·등록 현황을 지역과 품목 기준으로 제공합니다.</p></div><div class="hero-note"><span>조사 범위</span><strong>${snapshot.coverage.observedRegionCount}개 지역 · ${snapshot.coverage.regionItemCount}건</strong><p>지속 업데이트 예정</p></div></section>
    <section class="metrics"><article><span>특산품 출원율</span><strong>${percent(nationalSpecialtyCoverage.rate)}</strong><small>전체 ${number(nationalSpecialtyCoverage.total)}개 중 확인 ${number(nationalSpecialtyCoverage.applied)}개</small></article><article><span>전국 검색 고유 상표 후보</span><strong>${pipeline ? number(pipeline.nationwideCandidates.uniqueTrademarkCount) : totals.availableItems ? number(totals.trademarks) : "집계 전"}</strong><small>출원번호 중복 제거</small></article><article><span>출원인 주소 확보율</span><strong>${pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>${pipeline ? `확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역별 출원 수 표시 가능</span><strong>${pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>지역×특산품 집계 가능 항목</small></article></section>
    <section class="map-workspace"><div class="map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(displayRegionName(state.province))} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span class="reference-chip" title="${esc(`지도 도형은 ${geometry.boundaryReference.sourceName} 제공 경계(${geometry.boundaryReference.sourceBasis})를 참고용으로 씁니다 — 제3자가 재배포하는 데이터라 향후 행정구역 개편이 지도 도형에 늦게 반영될 수 있으며, 클릭하면 항상 실제(현재) 행정구역 데이터로 연결됩니다.`)}">참고 경계 · ${esc(geometry.boundaryReference.sourceBasis.match(/\d{4}-\d{2}-\d{2}/)?.[0] || geometry.boundaryReference.sourceName)}</span></div><div class="map-toolbar"><div class="map-metrics">${Object.entries(mapLabels).map(([key, label]) => `<button type="button" data-map-metric="${key}" class="${state.mapMetric === key ? "active" : ""}" title="${esc(mapDescriptions[key])}" aria-label="${esc(`${label}: ${mapDescriptions[key]}`)}">${label}</button>`).join("")}</div>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div><p class="map-metric-description"><strong>${mapLabels[state.mapMetric]}</strong><span>${mapDescriptions[state.mapMetric]}</span></p><div class="map-stage"><svg class="korea-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(displayRegionName(state.province))} 시군구 지도` : "대한민국 시도 지도"}">${shapePaths}${shapeLabels}</svg></div><div class="map-legend"><span><i class="legend-swatch no-data"></i>데이터 없음</span><span><i class="legend-swatch low"></i>낮음</span><span><i class="legend-swatch high"></i>높음</span><strong>${mapLabels[state.mapMetric]} 기준</strong></div></div>
    <aside class="map-insight"><h2>${esc(displayRegionName(state.municipality || state.province || "전국"))}</h2>${insightHero}${state.province && visibleRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다. 지도에서 특정 구·군을 눌러도 같은 목록이 표시됩니다.</p>` : ""}<div class="mini-list-heading"><strong>${esc(insightListLabel)}</strong><span>최대 5개</span></div><div class="mini-list">${insightList}</div></aside></section>
    <section class="ranking-columns" aria-label="지역 주소 일치 출원·등록 랭킹">
      <div class="ranking"><div class="section-heading"><div><h2>지역·대표 특산품 출원 랭킹</h2></div><span>TOP ${RANKING_LIMIT}</span></div><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>고시명칭·NICE</th><th>출원 확인</th></tr></thead><tbody>${applicationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(region.region)}</td><td>${esc(label)}</td><td>${esc(item.noticeName)} · ${esc(item.niceClass)}류</td><td>${number(item.metrics.uniqueTrademarkCount.value)}건</td></tr>`).join("")}</tbody></table></div></div>
      <div class="ranking"><div class="section-heading"><div><h2>지역·대표 특산품 등록 랭킹</h2></div><span>TOP ${RANKING_LIMIT}</span></div><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>고시명칭·NICE</th><th>등록 완료</th></tr></thead><tbody>${registrationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(region.region)}</td><td>${esc(label)}</td><td>${esc(item.noticeName)} · ${esc(item.niceClass)}류</td><td>${number(item.metrics.registeredTrademarkCount.value)}건</td></tr>`).join("")}</tbody></table></div></div>
    </section>
    `;
  }

  function applicationsScreen() {
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const areaRegions = state.province ? snapshot.regions.filter((region) => region.sido === state.province && (!state.municipality || region.sigungu === state.municipality || isUnclassifiedRegion(region))) : snapshot.regions;
    const area = specialtyCoverage(areaRegions);
    const areaName = displayRegionName(state.municipality || state.province || "전국");
    const mapLabelsHtml = mapLabelMarkup(activeShapes, Boolean(municipal));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = findMunicipalityRegion(state.province, shape.name); const value = regionValue(region, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, 1)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(shape.name)} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, 1)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(shape.name)} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("");
    const breakdown = (state.province ? areaRegions.map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region })) : [...provinceStats.keys()].map((province) => ({ key: province, label: province, regions: snapshot.regions.filter((region) => region.sido === province), region: null }))).map((row) => ({ ...row, coverage: specialtyCoverage(row.regions), items: row.regions.flatMap((region) => region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) }))) })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
    const listedItemCount = breakdown.reduce((sum, row) => sum + row.items.length, 0);
    return `<section class="screen-section coverage-screen"><div class="screen-heading"><div><h1>지역별 특산품 출원율</h1></div><p>시도별 출원율을 비교하고, 선택한 시도의 시군구별 현황을 확인할 수 있습니다.</p></div>
      ${state.province && areaRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다.</p>` : ""}
      <section class="coverage-workspace">
      <section class="coverage-map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(state.province)} 시군구 출원율` : "전국 시도별 출원율"}</h2></div><div class="coverage-map-actions">${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div></div><p class="map-metric-description"><strong>특산품 출원율</strong><span>지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수 · 명칭 확인·집계 대기도 분모에 포함합니다.</span></p><div class="map-stage coverage-map-stage"><svg class="korea-map coverage-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(state.province)} 시군구별 특산품 출원율 지도` : "대한민국 시도별 특산품 출원율 지도"}">${shapePaths}${mapLabelsHtml}</svg></div><div class="coverage-legend"><span>0%</span><i></i><span>25%</span><span>50%</span><span>75%</span><span>100%</span><b>회색은 데이터 없음</b></div><p class="map-warning">${state.province ? "특산품·상표 데이터 유무와 관계없이 모든 시군구 지명을 표시합니다. 지역을 선택하면 아래 목록도 함께 좁혀집니다." : "특산품·상표 데이터가 없는 시도도 지명은 표시하며 회색으로 구분합니다. 시도를 선택하면 시군구 지도로 전환됩니다."}</p></section>
      <aside class="coverage-insight"><h2>${esc(areaName)}</h2><div class="rate-hero">${rateRing(area.rate)}<div class="rate-hero-detail"><span>특산품 출원율</span><small>전체 수집 ${number(area.total)}개 중 출원 확인 ${number(area.applied)}개${area.pending ? ` · 집계 대기 ${number(area.pending)}개` : ""}</small></div></div><dl class="coverage-insight-stats"><div><dt>선택 범위</dt><dd>${state.municipality ? `${esc(state.province)} 내 시군구` : state.province ? "시군구별 특산품 항목 합산" : "전국 시군구별 특산품 항목 합산"}</dd></div><div><dt>전체 수집 특산품</dt><dd>${number(area.total)}개</dd></div><div><dt>출원 확인 특산품</dt><dd>${number(area.applied)}개</dd></div></dl></aside>
      </section>
      <section class="coverage-directory"><div class="section-heading coverage-directory-heading"><div><span class="coverage-directory-region">${esc(areaName)}</span><h2>특산품별 출원 현황</h2></div><span>특산품 ${number(listedItemCount)}개 · 출원 확인 ${number(area.applied)}개 · 출원율 ${percent(area.rate)}</span></div><div class="coverage-region-grid">${breakdown.map((row) => `<article class="coverage-region-card ${state.municipality && row.label === state.municipality ? "selected" : ""}"><div class="coverage-region-head"><div><strong>${esc(row.label)}</strong><small>특산품 ${number(row.coverage.total)}개</small></div><div class="coverage-region-summary"><span>출원 확인 특산품 ${number(row.coverage.applied)}개</span><b>${percent(row.coverage.rate)}</b></div>${!state.province ? `<button type="button" data-province="${esc(row.label)}">지도에서 보기</button>` : ""}</div><div class="coverage-specialty-list">${row.items.map(({ region, item, label }) => { const status = specialtyFilingStatus(item); return `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span>${esc(state.province ? label : `${region.sigungu || region.region} / ${label}`)}</span><small class="specialty-status ${status.filed ? "filed" : "unfiled"}">${esc(status.label)}</small></button>`; }).join("")}</div></article>`).join("")}</div></section></section>`;
  }

  function regionDetail(region, item) {
    const heading = `<div class="detail-heading"><div><h2>${esc(region.region)}</h2><p>법정동코드 ${esc(region.regionCode || "미확정")}</p></div><span class="state state-${esc(region.dataState)}">${esc(labels[region.dataState] || region.dataState)}</span></div>`;
    if (!item) {
      return `<div class="detail-panel">${heading}<div class="item-tabs" role="tablist"></div><p class="empty">이 지역에는 등록된 특산품 데이터가 없습니다.</p></div>`;
    }
    const regionGoodsConfirmed = item.matchingBasis === "raw_item_goods_matched";
    const verifiedExamples = registrationExamples.entries.find((entry) => entry.region === region.region && entry.specialtyId === item.specialtyId)?.examples || [];
    const examples = [...verifiedExamples, ...(item.trademarkExamples || [])]
      .filter((example, index, rows) => rows.findIndex((row) => row.applicationNumber === example.applicationNumber) === index);
    const registeredExamples = examples.filter((example) => {
      const registered = example.statusCategory === "registered" || (example.applicationStatus || "").includes("등록");
      const local = example.applicantRegionMatch === "inside" ||
        (regionGoodsConfirmed && (example.goodsEvidence?.length || 0) > 0 && ["normalized_exact", "normalized_contains"].includes(example.goodsMatchMethod));
      return registered && local;
    }).slice(0, 10);
    const regionalAvailable = item.metrics.uniqueTrademarkCount.availability === "available";
    const localCount = item.metrics.uniqueTrademarkCount.value || 0;
    const registeredCount = item.metrics.registeredTrademarkCount.value || 0;
    const pendingReason = regionalMetricPendingReason(item);
    return `<div class="detail-panel">
      ${heading}
      <div class="item-tabs word-cloud" role="tablist" aria-label="${esc(region.region)} 특산품 · 출원건수 기준 글자 크기">${(() => { const max = Math.max(1, ...region.items.map((row) => row.metrics.uniqueTrademarkCount.value || 0)); return region.items.map((row) => { const value = row.metrics.uniqueTrademarkCount.value || 0; const selected = item.specialtyId === row.specialtyId; const colorStyle = selected ? "" : `;color:${wordCloudColor(row.specialtyId || itemName(row))}`; return `<button type="button" data-region-item="${esc(row.specialtyId || "")}" aria-selected="${selected}" style="font-size:${wordCloudFontSize(value, max)}px${colorStyle}" title="${esc(itemName(row))} · 출원 ${number(value)}건">${esc(itemName(row))}</button>`; }).join(""); })()}</div>
      <div class="item-title"><div><span>이 지역의 대표 특산품</span><h3>${esc(itemName(item))}</h3><small>${esc(noticeBasis(item))}</small></div><span class="class-chip">${item.niceClass ? `NICE ${esc(item.niceClass)}` : "NICE 분류 미확정"}</span>${item.itemVerdict?.source === "algorithm" ? `<span class="verdict-chip" title="${esc(verdictTitle(item.itemVerdict))}">AI 판정</span>` : ""}</div>
      <div class="metric-reading-note"><strong>출원 건수 기준</strong><p><b>${esc(region.sigungu || region.region)} ${esc(itemName(item))} 출원</b>은 출원인 주소가 ${esc(region.region)}으로 확인된 고유 출원 수입니다. 전국 검색 후보나 주소가 확인되지 않은 출원은 포함하지 않습니다.</p></div>
      <div class="detail-grid">
        <article><span>${esc(region.sigungu || region.region)} ${esc(itemName(item))} 출원</span><strong>${regionalAvailable ? `${number(localCount)}건` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? `출원인 주소가 ${esc(region.region)}으로 확인된 고유 출원` : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${esc(pendingReason)}`}</small></article>
        <article><span>등록 건수</span><strong>${regionalAvailable ? `${number(registeredCount)}건` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? localCount ? `출원 ${number(localCount)}건 중 등록 ${number(registeredCount)}건 · 등록률 ${percent(item.metrics.registrationRate.value)}` : "출원 0건 · 등록률 계산 불가" : "지역 출원 건수가 확인된 뒤 계산합니다."}</small></article>
        <article><span>출원 여부</span><strong>${regionalAvailable ? localCount > 0 ? "출원 확인" : "출원 없음" : "집계 대기"}</strong><small>${regionalAvailable ? localCount > 0 ? "특산품 출원율 계산에서 출원 확인 1개로 집계" : "전체 특산품 수에는 포함되며 출원 확인 수에는 포함되지 않음" : "전체 특산품 수에는 포함되며 출원 확인 전까지 분자에는 넣지 않습니다"}</small></article>
      </div>
      <section class="trademark-examples"><div class="example-heading"><strong>${esc(itemName(item))} 등록 사례</strong><span>등록 ${number(registeredCount)}건 중 사례 ${number(registeredExamples.length)}건</span></div>${registeredExamples.length ? `<div class="example-list">${registeredExamples.map((example) => `<article><div><strong>${esc(example.title || "상표명 미기록")}</strong><small>${[example.applicationNumber, example.applicant, example.niceClass ? `${example.niceClass}류` : null].filter(Boolean).map(esc).join(" · ")}</small></div><span class="goods-chip">등록</span>${example.goodsEvidence.length > 0 ? `<p>지정상품: ${example.goodsEvidence.map((row) => `${esc(row.designatedProductName || "명칭 미기록")}${row.classCode ? ` (${esc(row.classCode)}류)` : ""}`).join(", ")}</p>` : ""}<small class="example-region-note">지역 주소 일치</small></article>`).join("")}</div>` : '<p class="empty">등록 항목이 확인되지 않았습니다.</p>'}</section>
    </div>`;
  }
  function regionsScreen() {
    const keyword = state.query.trim().toLocaleLowerCase("ko-KR");
    const rows = !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => itemName(item).toLocaleLowerCase("ko-KR").includes(keyword)));
    if (!rows.some((region) => regionKey(region) === state.regionKey) && rows[0]) state.regionKey = regionKey(rows[0]);
    const region = selectedRegion(), item = selectedItem(region);
    const groups = new Map();
    rows.forEach((row) => {
      const province = row.sido || row.region;
      const group = groups.get(province) || [];
      group.push(row);
      groups.set(province, group);
    });
    const grouped = [...groups.entries()]
      .map(([province, regions]) => ({ province, regions: regions.sort((a, b) => (a.sigungu || a.region).localeCompare(b.sigungu || b.region, "ko-KR")) }))
      .sort((a, b) => displayRegionName(a.province).localeCompare(displayRegionName(b.province), "ko-KR"));
    const groupsHtml = grouped.map(({ province, regions }) => {
      const expanded = Boolean(keyword) || state.expandedRegionProvince === province;
      const coverage = specialtyCoverage(regions);
      const municipalities = expanded ? `<div class="region-list municipality-list">${regions.map((row) => { const available = row.items.filter((entry) => officialItemLabel(entry) && entry.metrics.uniqueTrademarkCount.availability === "available"); const count = available.reduce((sum, entry) => sum + (entry.metrics.uniqueTrademarkCount.value || 0), 0); const rowCoverage = specialtyCoverage([row]); const municipalityName = row.sigungu && row.sigungu !== row.sido ? row.sigungu : "시도 전체"; return `<button type="button" data-region="${esc(regionKey(row))}" class="region-button ${regionKey(row) === state.regionKey ? "active" : ""}"><span><strong>${esc(municipalityName)}</strong><small>특산품 ${rowCoverage.total}개 · 출원 확인 ${rowCoverage.applied}개 · 출원율 ${percent(rowCoverage.rate)}<br>${available.length ? `지역 주소 일치 출원 ${number(count)}건` : "지역 출원 현황 검토중"}</small></span><span class="state state-${esc(row.dataState)}">${esc(labels[row.dataState] || row.dataState)}</span></button>`; }).join("")}</div>` : "";
      return `<section class="province-group"><button type="button" class="province-toggle" data-region-group="${esc(province)}" aria-expanded="${expanded}"><span><strong>${esc(displayRegionName(province))}</strong><small>시군구 ${regions.length}곳 · 특산품 ${coverage.total}개</small></span><b aria-hidden="true">${expanded ? "−" : "+"}</b></button>${municipalities}</section>`;
    }).join("");
    return `<section class="screen-section"><div class="screen-heading"><div><h1>지자체별 조회</h1></div><p>시도를 선택하면 시군구별 특산품과 해당 지역 주소로 확인된 상표 출원 현황을 볼 수 있습니다.</p></div><section class="workspace"><aside class="region-panel"><div class="panel-heading"><div><h2>지자체 목록</h2></div><span>시도 ${grouped.length}곳 · 시군구 ${rows.length}곳</span></div><label class="search-field"><span class="sr-only">지역 또는 품목 검색</span><input id="region-search" value="${esc(state.query)}" placeholder="지역 또는 품목 검색"></label><div class="province-list">${groupsHtml || '<p class="empty">검색 결과가 없습니다.</p>'}</div></aside>${regionDetail(region, item)}</section></section>`;
  }
  function itemRows() {
    const rows = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, category: item.category || null, searchTerms: [], trademarks: 0, trademarksDisplay: 0, hasProvisional: false, registered: 0, available: 0, availableRegions: [], regions: [], regionCounts: {} };
      row.searchTerms.push(item.itemName, item.noticeName, name);
      const trade = tradeDisplay(item);
      if (trade.value !== null) { row.trademarksDisplay += trade.value; if (trade.provisional) row.hasProvisional = true; }
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.available += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; if (!row.availableRegions.includes(region.region)) row.availableRegions.push(region.region); row.regionCounts[region.region] = (row.regionCounts[region.region] || 0) + (item.metrics.uniqueTrademarkCount.value || 0); }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      rows.set(name, row);
    }));
    const keyword = state.itemQuery.trim().toLocaleLowerCase("ko-KR");
    // 정렬은 확정 건수(trademarks) 기준으로 한다 — 전국 검색까지 섞은 trademarksDisplay로
    // 정렬하면 지역 확인이 안 된 노이즈가 큰 품목이 상위 100개 컷에서 확정 데이터를
    // 밀어낼 수 있다(2026-08-19 결정).
    return [...rows.values()]
      .filter((row) => !keyword || row.searchTerms.some((term) => term && term.toLocaleLowerCase("ko-KR").includes(keyword)) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword)))
      .filter((row) => !state.categoryFilter || row.category?.code === state.categoryFilter)
      .sort((a, b) => b.trademarks - a.trademarks);
  }
  // 이슈 #109(품목 카테고리화): 실제로 데이터에 등장하는 유형만 필터 버튼으로 보여준다.
  function availableCategories() {
    const seen = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => { if (item.category) seen.set(item.category.code, item.category.label); }));
    return [...seen.entries()].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  }
  function itemsScreen() {
    const rows = itemRows(); const ITEM_ROW_LIMIT = 100; const visibleRows = rows.slice(0, ITEM_ROW_LIMIT); return `<section class="screen-section"><div class="screen-heading"><div><h1>품목별 조회</h1></div><p>품목마다 확인 지역과 상표 현황을 카드 한 장에 요약했습니다.</p></div><div class="item-screen"><div class="item-screen-toolbar"><label><span class="sr-only">품목 검색</span><input id="item-search" value="${esc(state.itemQuery)}" placeholder="품목명 또는 지역명 검색"></label><span>${rows.length > ITEM_ROW_LIMIT ? `상표 출원 건수 상위 ${ITEM_ROW_LIMIT}개 표시 · 전체 ${rows.length}개` : `검색 결과 ${rows.length}개`}</span></div><div class="item-category-filter" role="group" aria-label="품목 유형 필터"><button type="button" data-category-filter="" class="${state.categoryFilter === "" ? "active" : ""}">전체</button>${availableCategories().map((category) => `<button type="button" data-category-filter="${esc(category.code)}" class="${state.categoryFilter === category.code ? "active" : ""}">${esc(category.label)}</button>`).join("")}</div><div class="item-reading-guide"><strong>수치 구분</strong><span><b>지역 확인 출원</b> 출원인 주소가 해당 지역과 일치</span><span><b>전국 검색</b> 아직 지역 확인 전인 별도 모집단</span></div><div class="item-card-grid">${visibleRows.map((row, index) => { const decidedRegions = row.availableRegions.length; const pendingRegions = Math.max(0, row.regions.length - decidedRegions); const nationwideOnly = Math.max(0, row.trademarksDisplay - row.trademarks); const statusClass = pendingRegions === 0 ? "complete" : decidedRegions ? "partial" : "pending"; const statusLabel = pendingRegions === 0 ? "전체 지역 판정 완료" : decidedRegions ? "일부 지역 판정" : "지역 집계 대기"; const registrationRate = decidedRegions && row.trademarks ? row.registered / row.trademarks : null; return `<article class="item-card"><div class="item-card-head"><div><span class="item-rank">${String(index + 1).padStart(2, "0")}</span><h2>${esc(row.name)}</h2><small>${row.category ? `${esc(row.category.label)} · ` : ""}${row.regions.length}개 지역에서 확인</small></div><span class="item-status ${statusClass}">${statusLabel}</span></div><details class="item-regions-detail"><summary>전체 ${row.regions.length}개 지역 보기</summary><div class="region-chips word-cloud" aria-label="지역 · 출원건수 기준 글자 크기">${(() => { const max = Math.max(1, ...Object.values(row.regionCounts)); return [...row.regions].sort((a, b) => (row.regionCounts[b] || 0) - (row.regionCounts[a] || 0)).map((region) => { const value = row.regionCounts[region] || 0; return `<span style="font-size:${wordCloudFontSize(value, max)}px;color:${wordCloudColor(region)}" title="${esc(region)} · 출원 ${number(value)}건">${esc(region)}</span>`; }).join(""); })()}</div></details><div class="item-card-metrics"><div><span>지역 확인 출원</span><strong>${decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>판정 완료 ${decidedRegions}/${row.regions.length}개 지역</small></div><div><span>등록 완료</span><strong>${decidedRegions ? `${number(row.registered)}건` : "—"}</strong><small>확인 출원 중 등록 완료</small></div><div><span>등록률</span><strong class="${registrationRate !== null && registrationRate >= 0.5 ? "rate-high" : ""}">${registrationRate !== null ? percent(registrationRate) : decidedRegions ? "계산 불가" : "—"}</strong><small>${registrationRate !== null ? `${number(row.registered)} ÷ ${number(row.trademarks)}` : "지역 확인 후 계산"}</small></div></div>${nationwideOnly > 0 ? `<p class="provisional-note">지역 확인 전 전국 검색 후보 ${number(nationwideOnly)}건은 위 확정 수치에 포함하지 않았습니다.</p>` : ""}</article>`; }).join("") || '<p class="empty item-empty">검색 결과가 없습니다.</p>'}</div><details class="method-note"><summary>품목명 집계 기준 보기</summary><p>고시명칭·NICE류가 확정된 품목만 공식 명칭으로 묶습니다. 아직 고시명칭이 확정되지 않은 원물명은 지역별 상세 화면에 원문 그대로 보존합니다.</p></details></div></section>`;
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
      ["품목 관련성 확인", "지정상품명에서 품목명 확인", '등록원부 지정상품명이 고시상품명칭과 일치하거나 품목명을 포함한 사례만 상세 화면에 표시합니다. NICE류만 일치하거나 검색어로만 포착된 후보는 확인 사례에 포함하지 않습니다. 대부분의 "출원 확인" 건수는 품목명 검색어와 출원인 주소까지 확인된 집계이며, 등록원부 지정상품 확인은 계속 보완 중입니다.'],
      ["지역 매칭", "법정동코드 완전일치", "국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만"],
      ["상표 검색", "KIPRIS 단어검색(고시명칭 기준)", "검색·집계 키는 고시명칭 + NICE류이며, 상표명은 개별 사례로만 보존하고 집계 키로 쓰지 않음. 현재 수치는 각 특산품에 매핑된 고시상품 NICE류 기준입니다. 음식점업 43류·도소매업 35류 등 서비스류는 포함하지 않으며 후속 확장 검토 대상입니다."],
      ["지역 주소 일치 출원 / 등록 완료", "출원인 주소가 해당 지역으로 확인된 출원만", "등록률은 그중 상표 상태가 등록 완료인 건수 ÷ 지역 주소 일치 출원 건수입니다. 전국 검색 후보와 주소 미확보 건은 제외합니다."],
      ["출원인 지역 매칭", "주소 확보율은 참고 지표", "주소가 확인된 건은 지역 귀속에 반영하고, 미확보 건도 원자료와 확보율을 함께 표시합니다. 부분 수집은 별도 상태로 구분합니다."],
    ];
    return `<section class="criteria" aria-label="판정 기준과 매칭 방법"><div class="section-heading"><div><h2>판정 기준과 매칭 방법</h2></div><span>현재 출처 ${esc(sourceLine)}</span></div><div class="criteria-grid">${rows.map(([label, value, note]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join("")}</div></section>`;
  }
  function provenanceHtml() {
    const boundaryDate = geometry.boundaryReference.sourceBasis.match(/\d{4}/)?.[0] || "미기록";
    const sourceMethod = (sourceId) => ({ admin_codes: "공식 파일 내려받기·정규화", gi: "공식 목록 스냅샷·보완 수집", nongsaro: "농사로 API(XML)", nongsaro_area_brand: "농사로 API(XML)·출원번호 대조", kipris_trademark: "KIPRISPlus API·단어 검색", kipris_trademark_applicant: "KIPRISPlus API·출원인 주소 조회", ip_registry: "공공데이터 API(JSON)·등록원부 보완", kipo_notice_goods: "공식 고시상품명칭 파일 대조" }[sourceId] || (sourceId.includes("specialties") ? "공식 목록 스냅샷·보완 수집" : "공식 소스 스냅샷"));
    const rows = snapshot.sources.filter((source) => source.sourceUrl).map((source) => `<tr><th scope="row">${esc(source.sourceLabel || source.sourceId)}</th><td><a href="${esc(source.sourceUrl)}" target="_blank" rel="noreferrer">공식 페이지 ↗</a></td><td>${esc(source.sourceContractVersion || "버전 미기록")}</td><td>${esc(sourceMethod(source.sourceId))}</td><td>${esc(dateOnly(latestDate(source.sourceFetchedAt, source.sourceLastVerifiedAt)))}</td></tr>`).join("");
    return `<section class="provenance"><div class="section-heading"><div><h2>출처와 데이터 상태</h2></div><span>${esc(snapshot.schemaVersion)}</span></div><div class="source-table-wrap"><table class="source-table"><caption class="sr-only">데이터별 출처와 수집 상태</caption><thead><tr><th>데이터명</th><th>출처</th><th>수집 소스</th><th>수집 방법</th><th>최근 수집 일자</th></tr></thead><tbody>${rows}<tr><th scope="row">지도 경계</th><td><a href="${esc(geometry.boundaryReference.sourceUrl)}" target="_blank" rel="noreferrer">공식 원본 ↗</a></td><td>${esc(geometry.boundaryReference.sourceName)}</td><td>경계 파일 생성·코드 조인</td><td>${esc(boundaryDate)}</td></tr></tbody></table></div></section>`;
  }
  function bind() {
    document.querySelectorAll("[data-map-metric]").forEach((button) => { button.onclick = () => { state.mapMetric = button.dataset.mapMetric; render(); }; });
    document.querySelectorAll("[data-province]").forEach((shape) => { const open = () => { state.province = shape.dataset.province; state.municipality = null; render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    document.querySelectorAll("[data-municipality]").forEach((shape) => { const open = () => { state.municipality = shape.dataset.municipality; const region = findMunicipalityRegion(state.province, state.municipality); if (region) state.regionKey = regionKey(region); render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    const back = document.querySelector("#map-back"); if (back) back.onclick = () => { state.province = null; state.municipality = null; render(); };
    // 이슈 #112: 요약 탭에서 지역/품목을 클릭해 지자체별 조회로 이동할 때 그 지역의
    // 시/도 아코디언을 자동으로 펼치지 않는다 — 전체 시/도 목록이 평소 상태(접힘)
    // 그대로 보이게 한다. 좌측 목록에서 직접 아코디언을 펼치는 클릭(data-region-group)은
    // 그대로 유지된다.
    document.querySelectorAll("[data-open-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.openRegion; state.itemId = button.dataset.openItem; state.tab = "regions"; render(); }; });
    document.querySelectorAll("[data-region-group]").forEach((button) => { button.onclick = () => { state.expandedRegionProvince = state.expandedRegionProvince === button.dataset.regionGroup ? null : button.dataset.regionGroup; render(); }; });
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.region; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-region-item]").forEach((button) => { button.onclick = () => { state.itemId = button.dataset.regionItem; render(); }; });
    bindSearchInput("#region-search", "query");
    bindSearchInput("#item-search", "itemQuery");
    document.querySelectorAll("[data-category-filter]").forEach((button) => { button.onclick = () => { state.categoryFilter = button.dataset.categoryFilter; render(); }; });
  }
  function render() {
    nav();
    document.querySelector("#app").innerHTML = state.tab === "summary" ? summaryScreen() : state.tab === "applications" ? applicationsScreen() : state.tab === "regions" ? regionsScreen() : state.tab === "items" ? itemsScreen() : state.tab === "compare" ? compareScreen() : dataScreen();
    bind();
  }

  document.querySelector("#generated").textContent = `마지막 업데이트 ${date(dashboardUpdatedAt)}`;
  document.querySelector("#scope-label").textContent = scopeLabel;
  document.querySelector("#snapshot-id").textContent = `Snapshot ${snapshot.snapshotId} · 업데이트 ${date(dashboardUpdatedAt)}`;
  document.querySelector("#brand-home").onclick = () => { state.tab = "summary"; render(); };
  render();
}
