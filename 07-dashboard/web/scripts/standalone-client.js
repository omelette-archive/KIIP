/* eslint-disable @typescript-eslint/no-unused-vars -- embedded and invoked by dashboard.html */
function dashboardClient(snapshot, geometry, registrationExamples) {
  const labels = { complete_nonzero: "현황 확인", complete_zero: "검색 결과 없음", partial: "검토중", error: "확인 오류", skipped: "분류 확인 필요", not_collected: "확인 전", complete: "집계 완료" };
  const tabs = { summary: "요약", applications: "지역별 상표 출원", regions: "지자체별 조회", items: "품목별 조회", strategy: "비즈니스 전략", compare: "특화작목 비교", data: "데이터 개요" };
  const mapLabels = { coverage: "특산품 수", trademarks: "상표 건수", applicationCoverage: "출원율", registration: "등록률" };
  const mapDescriptions = {
    trademarks: "검색 수집이 완료된 항목에서, 출원인 주소가 해당 지역으로 확인된 고유 상표 출원 건수입니다.",
    registration: "지도에 포함된 지역 주소 일치 출원 중 등록 상태인 건의 비율입니다(등록 ÷ 출원).",
    coverage: "현재 스냅샷에 수집된 지역×특산품 수입니다.",
    applicationCoverage: "이 지역에서 수집된 전체 특산품 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 아직 지역별 집계가 안 끝난 품목도 전체 분모에 포함하므로, 데이터가 쌓일수록 값이 올라갈 수 있습니다.",
  };
  const displayRegionName = (name) => name.replace("전남광주통합특별시", "전남·광주 통합권역");
  // 이슈 #116(2026-09-01): 광역자치단체 나열 순서를 행정표준코드 순서(서울→…→제주)로 통일.
  const PROVINCE_ORDER = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충청북", "충청남", "전북", "전라남", "경상북", "경상남", "제주"];
  const provinceRank = (name) => {
    if (/전남.*광주|광주.*전남/.test(name)) return PROVINCE_ORDER.indexOf("전라남") + 0.5;
    if (name === "전국" || name.startsWith("전국 ")) return 99;
    const index = PROVINCE_ORDER.findIndex((prefix) => name.startsWith(prefix));
    return index === -1 ? 50 : index;
  };
  const compareProvince = (a, b) => provinceRank(a) - provinceRank(b) || displayRegionName(a).localeCompare(displayRegionName(b), "ko-KR");
  const firstRegionProvince = [...new Set(snapshot.regions.map((region) => region.sido).filter((sido) => sido && sido !== "전국"))].sort(compareProvince)[0] || null;
  const state = { tab: "summary", query: "", itemQuery: "", categoryFilter: "", selectedRegionProvince: firstRegionProvince, expandedRegionProvince: null, regionKey: "", itemId: "", mapMetric: "coverage", province: null, municipality: null, trendStartYear: null, trendEndYear: null };
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
  const ITEM_DISPLAY_ALIASES = { "치악산 배": "배", "치악산 한우": "한우", "치악산 복숭아": "복숭아", "큰송이 버섯": "버섯", "치악산 사과": "사과", "조엄고구마": "고구마", "쌀토토미": "쌀", "치악산토종다래": "다래" };
  const displayItemName = (value) => { const name = String(value || "").trim(); return ITEM_DISPLAY_ALIASES[name] || name; };
  const itemName = (item) => displayItemName(item.itemName || item.noticeName) || "미지정 품목";
  const cropBadgeHtml = (item, withYear = false) => item.regionalSpecialtyCropBadge
    ? `<em class="crop-badge crop-badge-${esc(item.regionalSpecialtyCropBadge.tier)}">${esc(item.regionalSpecialtyCropBadge.tier)}${withYear ? ` · ${number(item.regionalSpecialtyCropBadge.referenceYear)}` : ""}</em>`
    : "";
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
  // 이슈 #116: 실제 출원일자·등록일자 기준 연도별 추이. 등록 계열은 등록원부 보강 완료 건이다.
  const sumYearCounts = (items, field) => {
    const totals = {};
    for (const item of items) {
      const counts = item[field];
      if (!counts) continue;
      for (const [year, value] of Object.entries(counts)) {
        const y = Number(year);
        if (Number.isFinite(y)) totals[y] = (totals[y] || 0) + value;
      }
    }
    return totals;
  };
  const TREND_CHART = { width: 960, height: 220, padLeft: 46, padRight: 16, padTop: 14, padBottom: 28 };
  const trendScales = (startYear, endYear, maxValue) => {
    const { width, height, padLeft, padRight, padTop, padBottom } = TREND_CHART;
    const span = Math.max(1, endYear - startYear);
    const x = (year) => padLeft + ((year - startYear) / span) * (width - padLeft - padRight);
    const baseY = height - padBottom;
    const y = (value) => baseY - (Math.max(0, value) / Math.max(1, maxValue)) * (height - padTop - padBottom);
    return { x, y, baseY };
  };
  const trendLinePath = (years, totals, scales) =>
    years.map((year, index) => `${index === 0 ? "M" : "L"}${scales.x(year).toFixed(1)},${scales.y(totals[year] || 0).toFixed(1)}`).join("");
  const trendYearLabels = (years) => {
    if (years.length <= 12) return years;
    const step = Math.ceil(years.length / 6);
    return years.filter((_, index) => index % step === 0 || index === years.length - 1);
  };
  const trendHandlePercent = (year, fullStart, fullEnd) => {
    if (fullEnd <= fullStart) return 0;
    return ((year - fullStart) / (fullEnd - fullStart)) * 100;
  };
  // 이슈 #116(2026-09-01): 지자체별 조회 추이 그래프 크기 조절(작게/보통/크게).
  // :root[data-trend-size]에 저장하고 CSS가 province-detail-cols 비율을 바꾼다.
  const trendSizeControlHtml = `<div class="trend-size-control" role="group" aria-label="추이 그래프 크기"><span>그래프 크기</span><button type="button" data-trend-size="s">작게</button><button type="button" data-trend-size="m">보통</button><button type="button" data-trend-size="l">크게</button></div>`;
  const regionTrendHtml = (region, heading = "지역 출원·등록 추이", subtitle) => {
    const trendSubtitle = subtitle || `${region.region} 전체 특산품 · 연도별`;
    const applicationTotals = sumYearCounts(region.items, "applicationYearCounts");
    const registrationTotals = sumYearCounts(region.items, "registrationYearCounts");
    const years = [...new Set([...Object.keys(applicationTotals), ...Object.keys(registrationTotals)])].map(Number).sort((a, b) => a - b);
    if (!years.length) return `<section class="trend-chart trend-chart-compact region-trend"><div class="section-heading"><div><h2>${esc(heading)}</h2></div><span>${esc(region.region)}</span></div><p class="empty">이 지역은 아직 연도별 데이터가 없습니다.</p></section>`;
    const start = years[0], end = years[years.length - 1];
    const max = Math.max(1, ...years.map((year) => Math.max(applicationTotals[year] || 0, registrationTotals[year] || 0)));
    const scale = trendScales(start, end, max);
    return `<section class="trend-chart trend-chart-compact region-trend"><div class="section-heading"><div><h2>${esc(heading)}</h2></div><span>${esc(trendSubtitle)}</span></div><svg class="trend-svg" viewBox="0 0 ${TREND_CHART.width} ${TREND_CHART.height}" role="img" aria-label="${esc(region.region)} ${start}년부터 ${end}년까지 출원·등록 추이">${[0, 0.5, 1].map((fraction) => { const value = Math.round(max * fraction); const yPos = scale.y(value); return `<g><line x1="${TREND_CHART.padLeft}" x2="${TREND_CHART.width - TREND_CHART.padRight}" y1="${yPos}" y2="${yPos}" class="trend-gridline" /><text x="${TREND_CHART.padLeft - 7}" y="${yPos}" class="trend-axis-label trend-axis-y">${number(value)}</text></g>`; }).join("")}<path d="${trendLinePath(years, applicationTotals, scale)}L${scale.x(end).toFixed(1)},${scale.baseY}L${scale.x(start).toFixed(1)},${scale.baseY}Z" class="trend-area" /><path d="${trendLinePath(years, registrationTotals, scale)}" class="trend-line trend-line-registered" /><path d="${trendLinePath(years, applicationTotals, scale)}" class="trend-line trend-line-application" />${years.map((year) => `<circle cx="${scale.x(year)}" cy="${scale.y(applicationTotals[year] || 0)}" r="2.8" class="trend-point trend-point-application"><title>${year}년 출원 ${number(applicationTotals[year] || 0)}건</title></circle>`).join("")}${years.map((year) => `<circle cx="${scale.x(year)}" cy="${scale.y(registrationTotals[year] || 0)}" r="2.8" class="trend-point trend-point-registered"><title>${year}년 등록 ${number(registrationTotals[year] || 0)}건</title></circle>`).join("")}${trendYearLabels(years).map((year) => `<text x="${scale.x(year)}" y="${TREND_CHART.height - 5}" class="trend-axis-label trend-axis-x">${year}</text>`).join("")}</svg><p class="trend-legend"><span class="trend-legend-swatch trend-legend-application"></span>출원<span class="trend-legend-swatch trend-legend-registered"></span>등록</p></section>`;
  };
  // 이슈 #116(2026-08-26): 품목별 조회 광역 단위 출원 비중 원그래프 — 상위 4개 광역 + 기타.
  const SHARE_COLORS = ["#2f6fed", "#12b76a", "#f79009", "#7a5af8", "#98a2b3"];
  function provinceShareSegments(counts) {
    const entries = Object.entries(counts).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return { segments: [], total: 0 };
    const top = entries.slice(0, 4);
    const restTotal = entries.slice(4).reduce((sum, [, value]) => sum + value, 0);
    const rows = restTotal > 0 ? [...top, ["기타", restTotal]] : top;
    return { segments: rows.map(([name, value]) => ({ name, value, pct: value / total })), total };
  }
  function shareConicGradient(segments) {
    let acc = 0;
    const stops = segments.map((segment, index) => {
      const start = (acc * 360).toFixed(1);
      acc += segment.pct;
      return `${SHARE_COLORS[index % SHARE_COLORS.length]} ${start}deg ${(acc * 360).toFixed(1)}deg`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }
  function shareDonutHtml(counts, label) {
    const { segments, total } = provinceShareSegments(counts);
    if (!total) return '<div class="item-share empty"><p class="empty">아직 지역 확인 출원이 없습니다.</p></div>';
    const legend = segments.map((segment, index) => `<li><i style="background:${SHARE_COLORS[index % SHARE_COLORS.length]}"></i>${esc(displayRegionName(segment.name))}<b>${percent(segment.pct)}</b></li>`).join("");
    return `<div class="item-share"><div class="item-share-donut" style="background:${shareConicGradient(segments)}" role="img" aria-label="${esc(label)} 광역 단위 출원 비중"></div><ul class="item-share-legend">${legend}</ul></div>`;
  }
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
    return displayItemName(prefix ? name.slice(prefix.length) : name);
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
  const kiprisSearchUrl = (applicationNumber) => `https://www.kipris.or.kr/khome/search/searchResult.do?tab=trademark&searchKeyword=${encodeURIComponent(`AN=${applicationNumber}`)}`;
  const GI_MARK_LABELS = { "44": "GI 단체표장", "48": "GI 증명표장" };
  const giMarkLabel = (applicationNumber) => applicationNumber ? GI_MARK_LABELS[applicationNumber.slice(0, 2)] || null : null;
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
  // 이슈 #116/#74/#110(2026-08-31 확대): 품목명을 전국·전류로 검색한 원물→가공품→서비스 단계별
  // 상표 활동. 지역 통계와 분리된 참고 지표이며, 단계별 건수는 176개 품목 전부에 붙지만
  // topRegion/topApplicant(지역 관련 필드)는 원물 단계 상위 출원인이 생산자형으로 확인된
  // 품목에서만 값이 채워지고 나머지는 null이다(attachNationwideBusinessFlow.js). Dashboard.tsx의
  // NationwideFlowCard와 동일 구조 — 화면에는 "AI 판정" 표시를 넣지 않는다(사용자 결정).
  const FLOW_STAGE_LABELS = { raw: "원물", processed: "가공품", service: "서비스·확장" };
  const nationwideFlowCardHtml = (flow, itemLabel) => {
    const { raw, processed, service } = flow.stages;
    const otherRegion = [processed.topRegion, service.topRegion].filter((region) => region && region !== raw.topRegion)[0];
    const clusterNote = raw.topRegion && otherRegion
      ? `<p class="nationwide-flow-note">${esc(raw.topRegion)}에서 원물 활동이 가장 활발하고, ${esc(otherRegion)}에서 가공·서비스 활동이 두드러집니다.</p>`
      : "";
    const stagesHtml = ["raw", "processed", "service"].map((key, index) => `${index > 0 ? '<i class="nationwide-flow-arrow" aria-hidden="true">→</i>' : ""}<div class="nationwide-flow-stage nationwide-flow-stage-${key}"><span>${FLOW_STAGE_LABELS[key]}</span><strong>${number(flow.stages[key].count)}건</strong>${flow.stages[key].topRegion ? `<small>${esc(flow.stages[key].topRegion)}</small>` : ""}</div>`).join("");
    return `<section class="nationwide-flow-card">
      <div class="section-heading"><div><h2>${esc(itemLabel)} 비즈니스 확장 흐름</h2></div><span>전국 상표 검색 · 참고 지표</span></div>
      <div class="nationwide-flow-stages">${stagesHtml}</div>
      ${clusterNote}
    </section>`;
  };
  // 이슈 #116(2026-08-26) 사용자 재요청: 상태 아이콘·배지, 근거 수치 스탯 줄, 문장별 도트
  // 마커로 가독성을 높였다 — Dashboard.tsx의 BusinessStrategyCard와 동일 구조.
  const businessStrategyCardHtml = (briefing, title, footerHtml = "") => {
    const evidence = briefing.evidence || {};
    const stats = [
      typeof evidence.uniqueTrademarkCount === "number" ? `<div class="strategy-stat"><span>고유 상표</span><strong>${number(evidence.uniqueTrademarkCount)}건</strong></div>` : "",
      typeof evidence.registrationRate === "number" ? `<div class="strategy-stat"><span>등록률</span><strong>${percent(evidence.registrationRate)}</strong></div>` : "",
      typeof evidence.localApplicantShare === "number" ? `<div class="strategy-stat"><span>지역 출원인 비중</span><strong>${percent(evidence.localApplicantShare)}</strong></div>` : "",
    ].join("");
    return `<section class="business-strategy${briefing.isGapAlert ? " alert" : ""}">
      <div class="strategy-head"><div class="strategy-head-title"><span class="strategy-status-icon" aria-hidden="true">${briefing.isGapAlert ? "!" : "✓"}</span><strong>${esc(title)}</strong></div><span class="strategy-status-badge">${briefing.isGapAlert ? "공백 알림" : "양호"}</span></div>
      ${stats ? `<div class="strategy-stat-row">${stats}</div>` : ""}
      <ul class="business-strategy-list">${briefing.sentences.map((sentence) => `<li>${esc(sentence)}</li>`).join("")}</ul>
      <p class="business-strategy-note">⑤·⑥단계 분석 결과에서 고정 템플릿으로 생성한 문장입니다(${esc(briefing.templateVersion || "버전 미기록")}).${footerHtml}</p>
    </section>`;
  };
  // 2026-08-21: 서울·세종은 경기도에 둘러싸여 있어 화살표(연결선)로 라벨을 빼서
  // 보여줬는데, 오히려 경기도 라벨이 서울 자리와 겹쳐 어색하다는 지적(사용자) — 화살표
  // 없이 경기도 라벨만 살짝 우측 아래로 옮기고, 서울·세종은 제자리에 그대로 표시한다.
  const nationalLabelOffsets = { 경기도: { x: 20, y: 38 } };
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
  const regionalRegions = snapshot.regions.filter((region) => region.sido !== "전국");
  const nationalSpecialtyCoverage = specialtyCoverage(regionalRegions);
  const provinceStats = new Map();
  regionalRegions.forEach((region) => {
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
    const metric = item.metrics.uniqueTrademarkCount;
    const value = metric.value || 0;
    if (metric.availability === "available" && value > 0) {
      return { label: `출원 확인 · ${number(value)}건${metric.partial ? "+" : ""}`, filed: true };
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
  function selectedRegion() { return snapshot.regions.find((region) => regionKey(region) === state.regionKey) || null; }
  function selectedItem(region) { if (!region) return null; const official = officialRegionItems(region); return region.items.find((item) => item.specialtyId === state.itemId) || official[0] || region.items[0]; }

  function nav() {
    document.querySelector("#primary-tabs").innerHTML = Object.entries(tabs).map(([key, label]) => `<button type="button" data-tab="${key}" class="${state.tab === key ? "active" : ""}" ${state.tab === key ? 'aria-current="page"' : ""}>${label}</button>`).join("");
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { state.tab = button.dataset.tab; state.query = ""; state.itemQuery = ""; state.categoryFilter = ""; render(); }; });
  }

  function summaryScreen() {
    // 이슈 #116(2026-09-01): 전국 단위 카탈로그(sido="전국")를 지도·요약 "특산품 수"
    // 모집단에서 제외해 hero·데이터 개요(regionItemCount)와 숫자를 통일한다.
    const visibleRegions = state.province ? regionalRegions.filter((region) => (region.sido || region.region) === state.province && (!state.municipality || region.sigungu === state.municipality || isUnclassifiedRegion(region))) : regionalRegions;
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
    const rankingCandidates = regionalRegions.flatMap((region) => region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; }));
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
    return `<section class="metrics"><article><span>전국 특산품 수</span><strong>${number(nationalSpecialtyCoverage.total)}</strong><small>${snapshot.coverage.observedRegionCount}개 지역 · 지역×특산품 수집 항목</small></article><article><span>특산품 출원율</span><strong>${percent(nationalSpecialtyCoverage.rate)}</strong><small>출원 확인 ${number(nationalSpecialtyCoverage.applied)}개</small></article><article><span>출원인 주소 확보율</span><strong>${pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>${pipeline ? `확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역별 출원 수 표시 가능</span><strong>${pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>지역×특산품 집계 가능 항목</small></article></section>
    <section class="summary-row" aria-label="특산품 순위·지도·출원 랭킹">
    <aside class="map-insight"><h2>${esc(displayRegionName(state.municipality || state.province || "전국"))} · ${esc(mapLabels[state.mapMetric])}</h2>${insightHero}${state.province && visibleRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다. 지도에서 특정 구·군을 눌러도 같은 목록이 표시됩니다.</p>` : ""}<div class="mini-list-heading"><strong>${esc(insightListLabel)}</strong><span>최대 5개</span></div><div class="mini-list">${insightList}</div></aside>
    <div class="map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(displayRegionName(state.province))} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span class="reference-chip" title="${esc(`지도 도형은 ${geometry.boundaryReference.sourceName} 제공 경계(${geometry.boundaryReference.sourceBasis})를 참고용으로 씁니다 — 제3자가 재배포하는 데이터라 향후 행정구역 개편이 지도 도형에 늦게 반영될 수 있으며, 클릭하면 항상 실제(현재) 행정구역 데이터로 연결됩니다.`)}">참고 경계 · ${esc(geometry.boundaryReference.sourceBasis.match(/\d{4}-\d{2}-\d{2}/)?.[0] || geometry.boundaryReference.sourceName)}</span></div><div class="map-toolbar"><div class="map-metrics">${Object.entries(mapLabels).map(([key, label]) => `<button type="button" data-map-metric="${key}" class="${state.mapMetric === key ? "active" : ""}" title="${esc(mapDescriptions[key])}" aria-label="${esc(`${label}: ${mapDescriptions[key]}`)}">${label}</button>`).join("")}</div>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div><p class="map-metric-description"><strong>${mapLabels[state.mapMetric]}</strong><span>${mapDescriptions[state.mapMetric]}</span></p><div class="map-stage"><svg class="korea-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(displayRegionName(state.province))} 시군구 지도` : "대한민국 시도 지도"}">${shapePaths}${shapeLabels}</svg></div><div class="map-legend"><span><i class="legend-swatch no-data"></i>데이터 없음</span><span><i class="legend-swatch low"></i>낮음</span><span><i class="legend-swatch high"></i>높음</span><strong>${mapLabels[state.mapMetric]} 기준</strong></div></div>
    <div class="ranking-columns" aria-label="지역 주소 일치 출원·등록 랭킹">
      <div class="ranking"><div class="section-heading"><div><h2>지역·대표 특산품 출원 랭킹</h2></div><span>TOP ${RANKING_LIMIT}</span></div><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>출원 확인</th></tr></thead><tbody>${applicationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(region.region)}</td><td${officialNoticeName(item) ? ` title="${esc(`고시명칭 ${item.noticeName}${item.niceClass ? ` · NICE ${item.niceClass}류` : ""}`)}"` : ""}>${esc(label)}</td><td>${number(item.metrics.uniqueTrademarkCount.value)}건</td></tr>`).join("")}</tbody></table></div></div>
      <div class="ranking"><div class="section-heading"><div><h2>지역·대표 특산품 등록 랭킹</h2></div><span>TOP ${RANKING_LIMIT}</span></div><div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>등록 완료</th></tr></thead><tbody>${registrationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(region.region)}</td><td${officialNoticeName(item) ? ` title="${esc(`고시명칭 ${item.noticeName}${item.niceClass ? ` · NICE ${item.niceClass}류` : ""}`)}"` : ""}>${esc(label)}</td><td>${number(item.metrics.registeredTrademarkCount.value)}건</td></tr>`).join("")}</tbody></table></div></div>
    </div>
    </section>
    `;
  }

  function applicationsScreen() {
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const areaRegions = state.province ? regionalRegions.filter((region) => region.sido === state.province && (!state.municipality || region.sigungu === state.municipality || isUnclassifiedRegion(region))) : regionalRegions;
    const area = specialtyCoverage(areaRegions);
    const areaName = displayRegionName(state.municipality || state.province || "전국");
    const mapLabelsHtml = mapLabelMarkup(activeShapes, Boolean(municipal));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = findMunicipalityRegion(state.province, shape.name); const value = regionValue(region, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, 1)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(shape.name)} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(shape.name)} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, 1)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(shape.name)} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(shape.name)} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("");
    const breakdown = (state.province ? areaRegions.map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region })) : [...provinceStats.keys()].map((province) => ({ key: province, label: province, regions: snapshot.regions.filter((region) => region.sido === province), region: null }))).map((row) => ({ ...row, coverage: specialtyCoverage(row.regions), items: row.regions.flatMap((region) => region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) }))) })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
    const listedItemCount = breakdown.reduce((sum, row) => sum + row.items.length, 0);
    const compositionRows = [...provinceStats.entries()].filter(([, stat]) => stat.trademarks > 0).sort((a, b) => b[1].trademarks - a[1].trademarks).slice(0, 10);
    const compositionMax = Math.max(1, ...compositionRows.map(([, stat]) => stat.trademarks));
    const compositionHtml = state.province ? "" : `<section class="province-composition"><div class="section-heading"><div><h2>광역별 상표 출원·등록 구성</h2></div><span>지역 주소 일치 출원 상위 10개</span></div><div class="composition-list">${compositionRows.map(([province, stat], index) => `<button type="button" data-province="${esc(province)}"><span class="composition-rank">${index + 1}</span><strong>${esc(displayRegionName(province))}</strong><span class="composition-bar"><i style="width:${stat.trademarks / compositionMax * 100}%"><b style="width:${stat.trademarks ? stat.registered / stat.trademarks * 100 : 0}%"></b></i></span><small>출원 ${number(stat.trademarks)} · 등록 ${number(stat.registered)}</small></button>`).join("")}</div><p class="composition-legend"><i></i>출원 <b></b>등록</p></section>`;
    const trendItems = areaRegions.flatMap((region) => region.items);
    const trendApplicationTotals = sumYearCounts(trendItems, "applicationYearCounts");
    const trendRegisteredTotals = sumYearCounts(trendItems, "registrationYearCounts");
    const trendAllYears = [...new Set([...Object.keys(trendApplicationTotals), ...Object.keys(trendRegisteredTotals)])].map(Number).sort((a, b) => a - b);
    const trendFullStart = trendAllYears[0] ?? new Date().getFullYear();
    const trendFullEnd = trendAllYears[trendAllYears.length - 1] ?? new Date().getFullYear();
    const trendStart = Math.min(state.trendStartYear ?? trendFullStart, trendFullEnd);
    const trendEnd = Math.max(state.trendEndYear ?? trendFullEnd, trendStart);
    const trendYears = [];
    for (let year = trendStart; year <= trendEnd; year++) trendYears.push(year);
    const trendMax = Math.max(1, ...trendYears.map((year) => Math.max(trendApplicationTotals[year] || 0, trendRegisteredTotals[year] || 0)));
    const trendScale = trendScales(trendStart, trendEnd, trendMax);
    const trendHasData = trendAllYears.length > 0;
    const trendChartHtml = trendHasData
      ? `<div class="trend-controls"><div class="trend-presets" role="group" aria-label="추이 그래프 기간 프리셋"><button type="button" data-trend-preset="all" class="${trendStart === trendFullStart && trendEnd === trendFullEnd ? "active" : ""}">전체</button><button type="button" data-trend-preset="5" data-trend-full-end="${trendFullEnd}" class="${trendStart === trendFullEnd - 4 && trendEnd === trendFullEnd ? "active" : ""}">최근 5년</button><button type="button" data-trend-preset="3" data-trend-full-end="${trendFullEnd}" class="${trendStart === trendFullEnd - 2 && trendEnd === trendFullEnd ? "active" : ""}">최근 3년</button><button type="button" data-trend-preset="1" data-trend-full-end="${trendFullEnd}" class="${trendStart === trendFullEnd && trendEnd === trendFullEnd ? "active" : ""}">최근 1년</button></div><div class="trend-range-inputs"><label><span class="sr-only">시작 연도</span>${trendStart}<input type="number" id="trend-start-input" aria-label="시작 연도" value="${trendStart}"></label><span>~</span><label><span class="sr-only">끝 연도</span>${trendEnd}<input type="number" id="trend-end-input" aria-label="끝 연도" value="${trendEnd}"></label></div></div><div class="trend-range-slider"><span class="trend-range-label">${trendFullStart}년 – ${trendFullEnd}년 중 ${trendStart}년 – ${trendEnd}년 선택</span><div class="trend-range-track" data-full-start="${trendFullStart}" data-full-end="${trendFullEnd}"><div class="trend-range-fill" style="left:${trendHandlePercent(trendStart, trendFullStart, trendFullEnd)}%;right:${100 - trendHandlePercent(trendEnd, trendFullStart, trendFullEnd)}%"></div><button type="button" id="trend-range-handle-start" class="trend-range-handle trend-range-handle-start" role="slider" aria-label="시작 연도 조절" aria-valuemin="${trendFullStart}" aria-valuemax="${trendEnd}" aria-valuenow="${trendStart}" data-value="${trendStart}" style="left:${trendHandlePercent(trendStart, trendFullStart, trendFullEnd)}%"></button><button type="button" id="trend-range-handle-end" class="trend-range-handle trend-range-handle-end" role="slider" aria-label="끝 연도 조절" aria-valuemin="${trendStart}" aria-valuemax="${trendFullEnd}" aria-valuenow="${trendEnd}" data-value="${trendEnd}" style="left:${trendHandlePercent(trendEnd, trendFullStart, trendFullEnd)}%"></button></div></div><svg class="trend-svg" viewBox="0 0 ${TREND_CHART.width} ${TREND_CHART.height}" role="img" aria-label="${trendStart}년부터 ${trendEnd}년까지 연도별 출원·등록 건수 추이">${[0, 0.5, 1].map((fraction) => { const value = Math.round(trendMax * fraction); const yPos = trendScale.y(value); return `<g><line x1="${TREND_CHART.padLeft}" x2="${TREND_CHART.width - TREND_CHART.padRight}" y1="${yPos}" y2="${yPos}" class="trend-gridline" /><text x="${TREND_CHART.padLeft - 8}" y="${yPos}" class="trend-axis-label trend-axis-y">${number(value)}</text></g>`; }).join("")}<path d="${trendLinePath(trendYears, trendApplicationTotals, trendScale)}L${trendScale.x(trendEnd).toFixed(1)},${trendScale.baseY}L${trendScale.x(trendStart).toFixed(1)},${trendScale.baseY}Z" class="trend-area" /><path d="${trendLinePath(trendYears, trendRegisteredTotals, trendScale)}" class="trend-line trend-line-registered" /><path d="${trendLinePath(trendYears, trendApplicationTotals, trendScale)}" class="trend-line trend-line-application" />${trendYears.map((year) => `<circle cx="${trendScale.x(year)}" cy="${trendScale.y(trendApplicationTotals[year] || 0)}" r="2.6" class="trend-point trend-point-application"><title>${year}년 출원 ${number(trendApplicationTotals[year] || 0)}건</title></circle>`).join("")}${trendYears.map((year) => `<circle cx="${trendScale.x(year)}" cy="${trendScale.y(trendRegisteredTotals[year] || 0)}" r="2.6" class="trend-point trend-point-registered"><title>${year}년 등록 ${number(trendRegisteredTotals[year] || 0)}건</title></circle>`).join("")}${trendYearLabels(trendYears).map((year) => `<text x="${trendScale.x(year)}" y="${TREND_CHART.height - 6}" class="trend-axis-label trend-axis-x">${year}</text>`).join("")}</svg><p class="trend-legend"><span class="trend-legend-swatch trend-legend-application"></span>출원<span class="trend-legend-swatch trend-legend-registered"></span>등록(등록원부 보강 완료 건)</p>`
      : `<p class="empty">이 범위는 아직 연도별 출원 데이터가 수집되지 않았습니다.</p>`;
    return `<section class="screen-section coverage-screen"><p class="screen-note">시도별 출원율을 비교하고, 선택한 시도의 시군구별 현황을 확인할 수 있습니다.</p>
      ${state.province && areaRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다.</p>` : ""}
      <div class="${state.province ? "applications-compact-row solo" : "applications-compact-row"}">
      ${compositionHtml}
      <section class="trend-chart"><div class="section-heading"><div><h2>연도별 출원·등록 추이</h2></div><span>${esc(areaName)} · 실제 출원일자·등록일자 기준</span></div>${trendChartHtml}</section>
      <section class="coverage-map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(state.province)} 시군구 출원율` : "전국 시도별 출원율"}</h2></div><div class="coverage-map-actions">${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div></div><p class="map-metric-description"><strong>특산품 출원율</strong><span>지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수 · 명칭 확인·집계 대기도 분모에 포함합니다.</span></p><div class="map-stage coverage-map-stage"><svg class="korea-map coverage-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(state.province)} 시군구별 특산품 출원율 지도` : "대한민국 시도별 특산품 출원율 지도"}">${shapePaths}${mapLabelsHtml}</svg></div><div class="coverage-legend"><span>0%</span><i></i><span>25%</span><span>50%</span><span>75%</span><span>100%</span><b>회색은 데이터 없음</b></div><p class="map-warning">${state.province ? "특산품·상표 데이터 유무와 관계없이 모든 시군구 지명을 표시합니다. 지역을 선택하면 아래 목록도 함께 좁혀집니다." : "특산품·상표 데이터가 없는 시도도 지명은 표시하며 회색으로 구분합니다. 시도를 선택하면 시군구 지도로 전환됩니다."}</p></section>
      <aside class="coverage-insight"><h2>${esc(areaName)}</h2><div class="rate-hero">${rateRing(area.rate)}<div class="rate-hero-detail"><span>특산품 출원율</span><small>전체 수집 ${number(area.total)}개 중 출원 확인 ${number(area.applied)}개${area.pending ? ` · 집계 대기 ${number(area.pending)}개` : ""}</small></div></div><dl class="coverage-insight-stats"><div><dt>선택 범위</dt><dd>${state.municipality ? `${esc(state.province)} 내 시군구` : state.province ? "시군구별 특산품 항목 합산" : "전국 시군구별 특산품 항목 합산"}</dd></div><div><dt>전체 수집 특산품</dt><dd>${number(area.total)}개</dd></div><div><dt>출원 확인 특산품</dt><dd>${number(area.applied)}개</dd></div></dl></aside>
      </div>
      <section class="coverage-directory"><div class="section-heading coverage-directory-heading"><div><span class="coverage-directory-region">${esc(areaName)}</span><h2>특산품별 출원 현황</h2></div><span>특산품 ${number(listedItemCount)}개 · 출원 확인 ${number(area.applied)}개 · 출원율 ${percent(area.rate)}</span></div><div class="coverage-region-grid">${breakdown.map((row) => `<article class="coverage-region-card ${state.municipality && row.label === state.municipality ? "selected" : ""}"><div class="coverage-region-head"><div><strong>${esc(row.label)}</strong><small>특산품 ${number(row.coverage.total)}개</small></div><div class="coverage-region-summary"><span>출원 확인 특산품 ${number(row.coverage.applied)}개</span><b>${percent(row.coverage.rate)}</b></div>${!state.province ? `<button type="button" data-province="${esc(row.label)}">지도에서 보기</button>` : ""}</div><div class="coverage-specialty-list">${row.items.map(({ region, item, label }) => { const status = specialtyFilingStatus(item); return `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span>${esc(state.province ? label : `${region.sigungu || region.region} / ${label}`)}</span><small class="specialty-status ${status.filed ? "filed" : "unfiled"}">${esc(status.label)}</small></button>`; }).join("")}</div></article>`).join("")}</div></section></section>`;
  }

  function provinceDetail(province, regions) {
    const coverage = specialtyCoverage(regions);
    const items = regions.flatMap((region) => region.items);
    const available = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
    const applications = available.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0);
    const registrations = available.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0);
    return `<div class="detail-panel province-detail"><div class="detail-heading"><div><p class="eyebrow">광역 기본 보기</p><h2>${esc(displayRegionName(province))}</h2><p>시군구 ${regions.length}곳의 특산품·상표 현황 합계</p></div><span class="state">광역 집계</span></div>${trendSizeControlHtml}<div class="province-detail-cols">${regionTrendHtml({ region: province, items })}<div class="detail-grid province-summary-grid"><article><span>전체 수집 특산품</span><strong>${number(coverage.total)}개</strong><small>시군구별 지역×품목 합계</small></article><article><span>출원 확인 특산품</span><strong>${number(coverage.applied)}개</strong><small>전체 특산품 출원율 ${percent(coverage.rate)}</small></article><article><span>지역 주소 일치 출원</span><strong>${number(applications)}건</strong><small>등록 완료 ${number(registrations)}건</small></article></div></div><section class="province-municipalities"><div class="section-heading"><div><h2>시군구 상세</h2></div><span>지역을 선택하면 품목별 상세로 전환</span></div><div>${regions.map((region) => { const rowCoverage = specialtyCoverage([region]); const name = region.sigungu && region.sigungu !== region.sido ? region.sigungu : "시도 전체"; return `<button type="button" data-region="${esc(regionKey(region))}"><strong>${esc(name)}</strong><small>특산품 ${rowCoverage.total}개 · 출원 확인 ${rowCoverage.applied}개</small></button>`; }).join("")}</div></section></div>`;
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
    const regionalPartial = Boolean(item.metrics.uniqueTrademarkCount.partial);
    const localCount = item.metrics.uniqueTrademarkCount.value || 0;
    const registeredCount = item.metrics.registeredTrademarkCount.value || 0;
    const pendingReason = regionalMetricPendingReason(item);
    return `<div class="detail-panel">
      ${heading}
      ${regionTrendHtml(region)}
      <div class="item-tabs word-cloud" role="tablist" aria-label="${esc(region.region)} 특산품 · 출원건수 기준 글자 크기">${(() => { const max = Math.max(1, ...region.items.map((row) => row.metrics.uniqueTrademarkCount.value || 0)); return region.items.map((row) => { const value = row.metrics.uniqueTrademarkCount.value || 0; const selected = item.specialtyId === row.specialtyId; const colorStyle = selected ? "" : `;color:${wordCloudColor(row.specialtyId || itemName(row))}`; return `<button type="button" data-region-item="${esc(row.specialtyId || "")}" aria-selected="${selected}" style="font-size:${wordCloudFontSize(value, max)}px${colorStyle}" title="${esc(itemName(row))} · 출원 ${number(value)}건">${esc(itemName(row))}</button>`; }).join(""); })()}</div>
      <div class="item-title"><div><span>이 지역의 대표 특산품</span><h3>${esc(itemName(item))}${cropBadgeHtml(item, true)}</h3><small>${esc(noticeBasis(item))}</small></div><span class="class-chip">${item.niceClass ? `NICE ${esc(item.niceClass)}` : "NICE 분류 미확정"}</span>${item.itemVerdict?.source === "algorithm" ? `<span class="verdict-chip" title="${esc(verdictTitle(item.itemVerdict))}">AI 판정</span>` : ""}</div>
      <div class="metric-reading-note"><strong>출원 건수 기준</strong><p><b>${esc(region.sigungu || region.region)} ${esc(itemName(item))} 출원</b>은 출원인 주소가 ${esc(region.region)}으로 확인된 고유 출원 수입니다. 전국 검색 후보나 주소가 확인되지 않은 출원은 포함하지 않습니다.</p></div>
      ${item.regionalEvidence?.length ? `<div class="metric-reading-note"><strong>공식 생산 주산지 근거</strong><p>${esc(item.regionalEvidence.map((evidence) => `${evidence.region} (${evidence.referenceYear})`).join(", "))} · 임산물생산조사 기준입니다. ${item.regionalEvidence.some((evidence) => evidence.regionalMetricEligible) ? "출원인 주소를 주산지와 대조해 지역 상표 통계에 반영했습니다." : "검색 범위가 완료된 뒤 지역 상표 통계에 반영합니다."}</p></div>` : ""}
      <div class="detail-grid">
        <article><span>${esc(region.sigungu || region.region)} ${esc(itemName(item))} 출원</span><strong>${regionalAvailable ? `${number(localCount)}건${regionalPartial ? "+" : ""}` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? (regionalPartial ? `출원인 주소가 ${esc(region.region)}으로 확인된 최소값 — 전국 검색이 상한에 도달해 더 있을 수 있습니다` : `출원인 주소가 ${esc(region.region)}으로 확인된 고유 출원`) : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${esc(pendingReason)}`}</small></article>
        <article><span>등록 건수</span><strong>${regionalAvailable ? `${number(registeredCount)}건` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? localCount ? `출원 ${number(localCount)}건 중 등록 ${number(registeredCount)}건 · 등록률 ${percent(item.metrics.registrationRate.value)}` : "출원 0건 · 등록률 계산 불가" : "지역 출원 건수가 확인된 뒤 계산합니다."}</small></article>
        <article><span>출원 여부</span><strong>${regionalAvailable ? localCount > 0 ? "출원 확인" : "출원 없음" : "집계 대기"}</strong><small>${regionalAvailable ? localCount > 0 ? "특산품 출원율 계산에서 출원 확인 1개로 집계" : "전체 특산품 수에는 포함되며 출원 확인 수에는 포함되지 않음" : "전체 특산품 수에는 포함되며 출원 확인 전까지 분자에는 넣지 않습니다"}</small></article>
      </div>
      ${item.businessFlow ? nationwideFlowCardHtml(item.businessFlow, itemName(item) || "이 품목") : ""}
      ${item.briefing && item.briefing.sentences.length > 0 ? businessStrategyCardHtml(item.briefing, "비즈니스 확장 전략") : ""}
      <section class="trademark-examples"><div class="example-heading"><strong>${esc(itemName(item))} 등록 사례</strong><span>등록 ${number(registeredCount)}건 중 사례 ${number(registeredExamples.length)}건</span></div>${registeredExamples.length ? `<div class="example-list">${registeredExamples.map((example) => `<article><div><strong>${esc(example.title || "상표명 미기록")}</strong><small>${[example.applicationNumber, example.applicant, example.niceClass ? `${example.niceClass}류` : null].filter(Boolean).map(esc).join(" · ")}</small></div><span class="goods-chip">등록</span>${giMarkLabel(example.applicationNumber) ? `<span class="gi-mark-chip">${esc(giMarkLabel(example.applicationNumber))}</span>` : ""}${example.goodsEvidence.length > 0 ? `<p>지정상품: ${example.goodsEvidence.map((row) => `${esc(row.designatedProductName || "명칭 미기록")}${row.classCode ? ` (${esc(row.classCode)}류)` : ""}`).join(", ")}</p>` : ""}<small class="example-region-note">지역 주소 일치</small>${example.applicationNumber ? `<button type="button" class="kipris-link" title="출원번호가 클립보드에 복사됩니다 · KIPRIS 상표 검색창에 붙여넣으세요" data-kipris-application="${esc(example.applicationNumber)}">KIPRIS에서 보기 ↗</button>` : ""}</article>`).join("")}</div>` : '<p class="empty">등록 항목이 확인되지 않았습니다.</p>'}</section>
    </div>`;
  }
  function regionsScreen() {
    const keyword = state.query.trim().toLocaleLowerCase("ko-KR");
    const rows = !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => itemName(item).toLocaleLowerCase("ko-KR").includes(keyword)));
    const groups = new Map();
    rows.forEach((row) => {
      const province = row.sido || row.region;
      const group = groups.get(province) || [];
      group.push(row);
      groups.set(province, group);
    });
    const grouped = [...groups.entries()]
      .map(([province, regions]) => ({ province, regions: regions.sort((a, b) => (a.sigungu || a.region).localeCompare(b.sigungu || b.region, "ko-KR")) }))
      .sort((a, b) => compareProvince(a.province, b.province));
    const activeProvince = grouped.some((group) => group.province === state.selectedRegionProvince) ? state.selectedRegionProvince : grouped[0]?.province || null;
    const activeProvinceRegions = grouped.find((group) => group.province === activeProvince)?.regions || [];
    const region = rows.find((row) => regionKey(row) === state.regionKey) || null;
    const item = selectedItem(region);
    const groupsHtml = grouped.map(({ province, regions }) => {
      const expanded = Boolean(keyword) || state.expandedRegionProvince === province;
      const coverage = specialtyCoverage(regions);
      const municipalities = expanded ? `<div class="region-list municipality-list">${regions.map((row) => { const available = row.items.filter((entry) => officialItemLabel(entry) && entry.metrics.uniqueTrademarkCount.availability === "available"); const count = available.reduce((sum, entry) => sum + (entry.metrics.uniqueTrademarkCount.value || 0), 0); const rowCoverage = specialtyCoverage([row]); const municipalityName = row.sigungu && row.sigungu !== row.sido ? row.sigungu : "시도 전체"; return `<button type="button" data-region="${esc(regionKey(row))}" class="region-button ${regionKey(row) === state.regionKey ? "active" : ""}"><span><strong>${esc(municipalityName)}</strong><small>특산품 ${rowCoverage.total}개 · 출원 확인 ${rowCoverage.applied}개 · 출원율 ${percent(rowCoverage.rate)}<br>${available.length ? `지역 주소 일치 출원 ${number(count)}건` : "지역 출원 현황 검토중"}</small></span><span class="state state-${esc(row.dataState)}">${esc(labels[row.dataState] || row.dataState)}</span></button>`; }).join("")}</div>` : "";
      return `<section class="province-group"><button type="button" class="province-toggle" data-region-group="${esc(province)}" aria-expanded="${expanded}"><span><strong>${esc(displayRegionName(province))}</strong><small>시군구 ${regions.length}곳 · 특산품 ${coverage.total}개</small></span><b aria-hidden="true">${expanded ? "−" : "+"}</b></button>${municipalities}</section>`;
    }).join("");
    const detail = region ? regionDetail(region, item) : activeProvince ? provinceDetail(activeProvince, activeProvinceRegions) : '<div class="detail-panel"><p class="empty">조회할 광역자치단체를 선택하세요.</p></div>';
    const allProvinces = [...new Set(snapshot.regions.map((row) => row.sido || row.region))].sort(compareProvince);
    const provinceTabbarHtml = `<nav class="province-tabbar">${allProvinces.map((province) => `<button type="button" data-province-tab="${esc(province)}" class="${activeProvince === province ? "active" : ""}">${esc(displayRegionName(province))}</button>`).join("")}</nav>`;
    return `<section class="screen-section"><p class="screen-note">광역자치단체 합계를 기본으로 보여주며, 시군구를 선택하면 품목별 상세로 전환됩니다.</p>${provinceTabbarHtml}<section class="workspace"><aside class="region-panel"><div class="panel-heading"><div><h2>지자체 목록</h2></div><span>시도 ${grouped.length}곳 · 시군구 ${rows.length}곳</span></div><label class="search-field"><span class="sr-only">지역 또는 품목 검색</span><input id="region-search" value="${esc(state.query)}" placeholder="지역 또는 품목 검색"></label><div class="province-list">${groupsHtml || '<p class="empty">검색 결과가 없습니다.</p>'}</div></aside>${detail}</section></section>`;
  }
  function itemRows() {
    const rows = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, category: item.category || null, searchTerms: [], trademarks: 0, trademarksDisplay: 0, hasProvisional: false, registered: 0, available: 0, availableRegions: [], regions: [], regionCounts: {}, provinceCounts: {}, matchedItems: [] };
      row.searchTerms.push(item.itemName, item.noticeName, name);
      const trade = tradeDisplay(item);
      if (trade.value !== null) { row.trademarksDisplay += trade.value; if (trade.provisional) row.hasProvisional = true; }
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.available += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; if (!row.availableRegions.includes(region.region)) row.availableRegions.push(region.region); row.regionCounts[region.region] = (row.regionCounts[region.region] || 0) + (item.metrics.uniqueTrademarkCount.value || 0); const province = region.sido || region.region; row.provinceCounts[province] = (row.provinceCounts[province] || 0) + (item.metrics.uniqueTrademarkCount.value || 0); }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      row.matchedItems.push(item);
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
    const rows = itemRows(); const ITEM_ROW_LIMIT = 100; const visibleRows = rows.slice(0, ITEM_ROW_LIMIT); return `<section class="screen-section"><p class="screen-note">품목마다 확인 지역과 상표 현황을 카드 한 장에 요약했습니다.</p><div class="item-screen"><div class="item-screen-toolbar"><label><span class="sr-only">품목 검색</span><input id="item-search" value="${esc(state.itemQuery)}" placeholder="품목명 또는 지역명 검색"></label><span>${rows.length > ITEM_ROW_LIMIT ? `상표 출원 건수 상위 ${ITEM_ROW_LIMIT}개 표시 · 전체 ${rows.length}개` : `검색 결과 ${rows.length}개`}</span></div><div class="item-category-filter" role="group" aria-label="품목 유형 필터"><button type="button" data-category-filter="" class="${state.categoryFilter === "" ? "active" : ""}">전체</button>${availableCategories().map((category) => `<button type="button" data-category-filter="${esc(category.code)}" class="${state.categoryFilter === category.code ? "active" : ""}">${esc(category.label)}</button>`).join("")}</div><div class="item-reading-guide"><strong>수치 구분</strong><span><b>지역 확인 출원</b> 출원인 주소가 해당 지역과 일치</span><span><b>전국 검색</b> 아직 지역 확인 전인 별도 모집단</span></div><div class="item-card-grid">${visibleRows.map((row, index) => { const decidedRegions = row.availableRegions.length; const pendingRegions = Math.max(0, row.regions.length - decidedRegions); const nationwideOnly = Math.max(0, row.trademarksDisplay - row.trademarks); const statusClass = pendingRegions === 0 ? "complete" : decidedRegions ? "partial" : "pending"; const statusLabel = pendingRegions === 0 ? "전체 지역 판정 완료" : decidedRegions ? "일부 지역 판정" : "지역 집계 대기"; const registrationRate = decidedRegions && row.trademarks ? row.registered / row.trademarks : null; return `<article class="item-card"><div class="item-card-head"><div><span class="item-rank">${String(index + 1).padStart(2, "0")}</span><h2>${esc(row.name)}</h2><small>${row.category ? `${esc(row.category.label)} · ` : ""}${row.regions.length}개 지역에서 확인</small></div><span class="item-status ${statusClass}">${statusLabel}</span></div><details class="item-regions-detail"><summary>전체 ${row.regions.length}개 지역 보기</summary><div class="region-chips word-cloud" aria-label="지역 · 출원건수 기준 글자 크기">${(() => { const max = Math.max(1, ...Object.values(row.regionCounts)); return [...row.regions].sort((a, b) => (row.regionCounts[b] || 0) - (row.regionCounts[a] || 0)).map((region) => { const value = row.regionCounts[region] || 0; return `<span style="font-size:${wordCloudFontSize(value, max)}px;color:${wordCloudColor(region)}" title="${esc(region)} · 출원 ${number(value)}건">${esc(region)}</span>`; }).join(""); })()}</div></details><div class="item-card-metrics"><div><span>지역 확인 출원</span><strong>${decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>판정 완료 ${decidedRegions}/${row.regions.length}개 지역</small></div><div><span>등록 완료</span><strong>${decidedRegions ? `${number(row.registered)}건` : "—"}</strong><small>확인 출원 중 등록 완료</small></div><div><span>등록률</span><strong class="${registrationRate !== null && registrationRate >= 0.5 ? "rate-high" : ""}">${registrationRate !== null ? percent(registrationRate) : decidedRegions ? "계산 불가" : "—"}</strong><small>${registrationRate !== null ? `${number(row.registered)} ÷ ${number(row.trademarks)}` : "지역 확인 후 계산"}</small></div></div>${decidedRegions > 0 ? `<div class="item-card-charts">${regionTrendHtml({ region: row.name, items: row.matchedItems }, "연도별 출원건수", `${row.name} · 전체 지역 합계`)}<div class="item-share-block"><div class="section-heading"><div><h2>광역 단위 출원 비중</h2></div></div>${shareDonutHtml(row.provinceCounts, row.name)}</div></div>` : ""}${nationwideOnly > 0 ? `<p class="provisional-note">지역 확인 전 전국 검색 후보 ${number(nationwideOnly)}건은 위 확정 수치에 포함하지 않았습니다.</p>` : ""}</article>`; }).join("") || '<p class="empty item-empty">검색 결과가 없습니다.</p>'}</div><details class="method-note"><summary>품목명 집계 기준 보기</summary><p>고시명칭·NICE류가 확정된 품목만 공식 명칭으로 묶습니다. 아직 고시명칭이 확정되지 않은 원물명은 지역별 상세 화면에 원문 그대로 보존합니다.</p></details></div></section>`;
  }
  function dataScreen() {
    if (!pipeline) return '<section class="screen-section"><p class="empty">파이프라인 개요 데이터가 없습니다.</p></section>';
    const addressRate = Math.round((pipeline.applicantRegionVerification.rate || 0) * 100);
    const previewRate = pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal);
    return `<section class="screen-section data-overview">${criteriaHtml()}<p class="screen-note">수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다.</p><div class="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>${number(pipeline.rowCounts.total)}</strong><small>지역-특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>${number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역-품목 조합</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>${number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 전국 고유 후보</small></article><i>→</i><article class="flow-highlight"><span>05 · 지역별 집계</span><strong>${number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>지역 출원 수 표시 가능 항목</small></article></div><div class="data-summary-grid"><article class="data-summary-card"><h2>특산물 데이터</h2><div class="data-stat"><strong>${number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div class="data-stat"><strong>${number(snapshot.coverage.regionItemCount)}개</strong><span>지역-품목 조합</span></div><div class="data-stat"><strong>${number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p class="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article class="data-summary-card"><h2>상표 매칭 결과</h2><div class="match-bars"><div><span>특산품 출원율 <b>${percent(nationalSpecialtyCoverage.rate)}</b></span><em><i style="width:${Math.round((nationalSpecialtyCoverage.rate || 0) * 100)}%"></i></em><small>출원 확인 ${number(nationalSpecialtyCoverage.applied)} / 전체 수집 특산품 ${number(nationalSpecialtyCoverage.total)}(지역별 집계 완료 ${number(nationalSpecialtyCoverage.decided)})</small></div><div><span>고유 상표 주소 확보 <b>${number(pipeline.applicantRegionVerification.verifiedCount)}건</b></span><em><i style="width:${addressRate}%"></i></em><small>전국 고유 후보 중 ${percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>지역별 출원 수 표시 가능 <b>${number(pipeline.regionalMetricGate.availableRegionItemCount)}개</b></span><em><i style="width:${Math.max(2, Math.round(previewRate * 100))}%"></i></em><small>전체 ${number(gateTotal)}개 지역-품목 중 ${percent(previewRate)}</small></div></div><p class="match-explanation">특산품 출원율은 현재 수집된 지역×특산품 전체 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 전체 ${number(nationalSpecialtyCoverage.total)}개 중 명칭 확인이나 지역별 집계가 덜 끝난 항목도 분모에 포함하며, 출원이 확인될 때만 분자에 더합니다 — 후속 확인이 진행되면 값이 올라갈 수 있습니다.</p></article></div><div class="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>특산품 출원율 = 지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수</b>입니다. 명칭 확인이나 지역별 집계가 아직 끝나지 않은 항목도 분모에 포함하고 분자에는 넣지 않습니다. <b>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 출원번호 중복을 제거한 전국 검색 후보이며, 등록 비율은 지역 주소 일치 출원 중 등록 상태인 건의 비율로 별도 계산합니다. 검색이 부분 수집 상태인 품목은 0건으로 확정하지 않고 <b>지역별 집계 대기</b>로 표시합니다.</p></div>${provenanceHtml()}</section>`;
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
  function strategyScreen() {
    const alertRows = [];
    const okRows = [];
    outer: for (const region of regionalRegions) {
      for (const item of region.items) {
        if (!item.briefing?.sentences?.length) continue;
        if (item.briefing.isGapAlert && alertRows.length < 1) alertRows.push({ region, item });
        else if (!item.briefing.isGapAlert && okRows.length < 1) okRows.push({ region, item });
        if (alertRows.length >= 1 && okRows.length >= 1) break outer;
      }
    }
    const samples = [...alertRows, ...okRows];
    const sampleHtml = samples.map(({ region, item }) => businessStrategyCardHtml(
      item.briefing,
      `${region.region} · ${itemName(item)}`,
      ` <button type="button" class="strategy-jump-link" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}">지자체별 조회에서 자세히 보기 →</button>`
    )).join("");
    return `<section class="screen-section strategy-screen"><p class="screen-note">⑤·⑥단계 분석에서 이미 생성되는 품목별 비즈니스 확장 전략 브리핑입니다. 아직 표본 단계라 공백 알림·양호 사례 1건씩만 시범으로 보여주고, 반응을 보고 전체 품목으로 확장할지 판단합니다.</p>${samples.length === 0 ? '<p class="empty">아직 표시할 샘플이 없습니다.</p>' : ""}<div class="strategy-sample-list">${sampleHtml}</div></section>`;
  }
  function compareScreen() {
    const comparisonRows = [...provinceStats.keys()].map((province) => {
      const regions = snapshot.regions.filter((region) => (region.sido || region.region) === province);
      const cropGroups = new Map();
      for (const region of regions) for (const item of region.items) {
        const badge = item.regionalSpecialtyCropBadge;
        if (!badge) continue;
        const current = cropGroups.get(badge.officialItemName) || { tier: badge.tier, items: [] };
        current.items.push(item);
        cropGroups.set(badge.officialItemName, current);
      }
      const policyCrops = [...cropGroups.entries()].map(([name, group]) => {
        const decided = group.items.some((item) => item.metrics.uniqueTrademarkCount.availability === "available");
        const applications = group.items.reduce((sum, item) => item.metrics.uniqueTrademarkCount.availability === "available" ? sum + (item.metrics.uniqueTrademarkCount.value || 0) : sum, 0);
        return { name, tier: group.tier, decided, applications, applied: applications > 0 };
      }).sort((a, b) => a.tier.localeCompare(b.tier, "ko-KR") || a.name.localeCompare(b.name, "ko-KR"));
      const policyDecided = policyCrops.filter((crop) => crop.decided).length;
      const policyApplied = policyCrops.filter((crop) => crop.applied).length;
      // 이슈 #117(2026-08-26 샘플 참고): 대표작목이 실제 등록 상표 TOP5 안에 있는지 직접 대조.
      const registeredByName = new Map();
      for (const region of regions) for (const item of region.items) {
        const name = officialItemLabel(item);
        if (!name || item.metrics.registeredTrademarkCount.availability !== "available") continue;
        registeredByName.set(name, (registeredByName.get(name) || 0) + (item.metrics.registeredTrademarkCount.value || 0));
      }
      const topRegisteredItems = [...registeredByName.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
      const flagshipCrop = policyCrops.find((crop) => crop.tier === "대표작목") || null;
      const flagshipRank = flagshipCrop ? topRegisteredItems.findIndex((row) => row.name === flagshipCrop.name) : -1;
      const flagshipMatch = flagshipRank >= 0;
      return { province, policyCrops, policyDecided, policyApplied, policyRate: policyCrops.length ? policyApplied / policyCrops.length : null, topRegisteredItems, flagshipCrop, flagshipMatch, flagshipRank };
    }).filter((row) => row.policyCrops.length > 0).sort((a, b) => b.policyApplied - a.policyApplied || b.policyCrops.length - a.policyCrops.length || a.province.localeCompare(b.province, "ko-KR"));
    const flagshipRowsHtml = comparisonRows.filter((row) => row.flagshipCrop).map(({ province, flagshipCrop, topRegisteredItems, flagshipMatch, flagshipRank }) => `<div class="compare-flagship-row"><strong>${esc(displayRegionName(province))}</strong><div class="compare-flagship-name">${esc(flagshipCrop.name)}</div><ol class="compare-top5-list">${topRegisteredItems.length === 0 ? '<li class="empty">등록 상표 없음</li>' : topRegisteredItems.map((row, index) => `<li class="${row.name === flagshipCrop.name ? "match" : ""}">${index + 1}. ${esc(row.name)} <b>${number(row.count)}건</b></li>`).join("")}</ol><span class="${flagshipMatch ? "compare-flagship-match" : "compare-flagship-mismatch"}">${flagshipMatch ? `일치 · ${flagshipRank + 1}위` : "불일치"}</span></div>`).join("");
    const flagshipMatchCount = comparisonRows.filter((row) => row.flagshipMatch).length;
    const rowsHtml = comparisonRows.map(({ province, policyCrops, policyDecided, policyApplied, policyRate }) => `<div class="compare-region-row"><strong>${esc(province)}</strong><div><b>${number(policyCrops.length)}개</b><small>농촌진흥청 2025 지정</small></div><div><b>${number(policyApplied)}개 · ${percent(policyRate)}</b><small>주소 일치 출원 1건 이상</small></div><span class="${policyDecided === policyCrops.length ? "compare-complete" : "compare-waiting"}">${policyDecided === policyCrops.length ? "전량 집계" : `${policyDecided}/${policyCrops.length} 집계`}</span><details class="compare-items-detail"><summary>특화작목 ${number(policyCrops.length)}개 보기</summary><div class="compare-item-chips">${policyCrops.map((crop) => `<span class="${crop.applied ? "filed" : crop.decided ? "unfiled" : "pending"}">${esc(crop.name)} · ${esc(crop.tier)} · ${crop.applied ? `출원 ${number(crop.applications)}건` : crop.decided ? "출원 미확인" : "집계 대기"}</span>`).join("")}</div></details></div>`).join("");
    return `<section class="screen-section"><p class="screen-note">농촌진흥청이 2025년에 지정한 9개 도·69개 특화작목과 지역 주소 일치 상표 현황을 비교합니다.</p><div class="compare-banner"><span>공식 원본 반영 완료</span><strong>대표작목 9 · 집중육성작목 18 · 자체육성작목 42</strong><p>모든 작목을 공식 지정 범위인 도 단위 특산품으로 수집했습니다. 시군구는 임의로 배분하지 않습니다.</p></div><section class="compare-flagship-section"><div class="compare-section-head"><div><span>대표작목 우선순위 대조</span><h2>도별 대표작목 vs 실제 등록 상표 TOP5</h2></div><p>도 대표작목(농촌진흥청 지정 1개)이 그 도의 <b>등록 완료</b> 상표 상위 5개 품목 안에 실제로 있는지 대조합니다. 출원 중인 건은 포함하지 않습니다.</p></div><div class="compare-flagship-table"><div class="compare-flagship-head"><span>도</span><span>대표작목(정책 지정)</span><span>실제 등록 상표 TOP5</span><span>일치</span></div>${flagshipRowsHtml}</div><p class="compare-flagship-note">9개 도 중 ${flagshipMatchCount}개 도에서 대표작목과 실제 등록 상표를 주도하는 품목이 일치합니다. 나머지 도는 정책상 육성 중인 작목과 실제 브랜드 출원을 주도하는 품목이 다르다는 뜻입니다 — 특화작목이 아직 상표 등록으로 이어지지 않았거나, 쌀·소고기 같은 범용 품목이 여전히 지역 브랜드 활동을 주도하고 있을 수 있습니다.</p></section><section class="compare-region-section"><div class="compare-section-head"><div><span>69개 전체 상세</span><h2>등급별 특화작목 출원 현황</h2></div><p>출원율은 해당 도 주소의 출원이 1건 이상 확인된 작목 비율입니다(대표·집중육성·자체육성 전체).</p></div><div class="compare-region-table"><div class="compare-region-head"><span>지역</span><span>지정 작목</span><span>상표 출원 확인</span><span>집계 상태</span></div>${rowsHtml}</div></section><div class="compare-sources"><article><span>공식 근거</span><strong>농촌진흥청 2025년도 지역특화작목 현황</strong><p>제1차 종합계획(2021~2025) 종료 시점의 69개 배정을 사용합니다.</p></article><article><span>지역 판정</span><strong>출원인 주소를 도 단위로 대조</strong><p>검색 상한은 집계 대기로 구분합니다.</p></article></div></section>`;
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
    const sourceGroup = (sourceId) => sourceId === "admin_codes" ? "지역 정보" : sourceId.includes("kipris") || ["ip_registry", "kipo_notice_goods", "nongsaro_area_brand"].includes(sourceId) ? "상표 정보" : "특산품 현황";
    // 이슈 #116(2026-08-26): 가나다순 대신 특산품 현황 → 상표 정보 → 지역 정보 순(수집→매칭→지역 조인 파이프라인 순서)
    const sourceGroupOrder = { "특산품 현황": 0, "상표 정보": 1, "지역 정보": 2 };
    const sourceGroupRank = (sourceId) => sourceGroupOrder[sourceGroup(sourceId)] ?? 99;
    const sourceItems = (sourceId) => ({ admin_codes: "법정동 코드·행정구역명", gi: "농산물 지리적표시", nongsaro: "지역 특산물", nfqs_quality_cert: "인증 수산물(전국)", kofpi_forest_product: "임산물 품목", rda_regional_specialty_crops: "도별 지역특화작목 69개", kipris_trademark: "상표 출원·상태·일자", kipris_trademark_applicant: "출원인 주소", ip_registry: "등록번호·등록일·지정상품", kipo_notice_goods: "고시상품명칭·NICE류", nongsaro_area_brand: "지역 브랜드·출원번호" }[sourceId] || (sourceId.includes("specialties") ? "지역·품목·원문 명칭" : "원천 제공 항목"));
    const rows = snapshot.sources.filter((source) => source.sourceUrl).sort((a, b) => sourceGroupRank(a.sourceId) - sourceGroupRank(b.sourceId)).map((source) => `<tr><td><span class="source-group">${esc(sourceGroup(source.sourceId))}</span></td><th scope="row">${esc(source.sourceLabel || source.sourceId)}</th><td>${esc(sourceItems(source.sourceId))}</td><td><a href="${esc(source.sourceUrl)}" target="_blank" rel="noreferrer">공식 페이지 ↗</a></td><td>${esc(source.sourceContractVersion || "버전 미기록")}</td><td>${esc(sourceMethod(source.sourceId))}</td><td>${esc(dateOnly(latestDate(source.sourceFetchedAt, source.sourceLastVerifiedAt)))}</td></tr>`).join("");
    return `<section class="provenance"><div class="section-heading"><div><h2>출처와 데이터 상태</h2></div><span>${esc(snapshot.schemaVersion)}</span></div><div class="source-table-wrap"><table class="source-table"><caption class="sr-only">데이터별 출처와 수집 상태</caption><thead><tr><th>그룹</th><th>데이터명</th><th>수집 항목</th><th>출처</th><th>수집 소스</th><th>수집 방법</th><th>최근 수집 일자</th></tr></thead><tbody>${rows}<tr><td><span class="source-group">지역 정보</span></td><th scope="row">지도 경계</th><td>시도·시군구 경계 도형</td><td><a href="${esc(geometry.boundaryReference.sourceUrl)}" target="_blank" rel="noreferrer">공식 원본 ↗</a></td><td>${esc(geometry.boundaryReference.sourceName)}</td><td>경계 파일 생성·코드 조인</td><td>${esc(boundaryDate)}</td></tr></tbody></table></div></section>`;
  }
  function bind() {
    document.querySelectorAll("[data-map-metric]").forEach((button) => { button.onclick = () => { state.mapMetric = button.dataset.mapMetric; render(); }; });
    document.querySelectorAll("[data-trend-size]").forEach((button) => { button.onclick = () => { const size = button.dataset.trendSize; document.documentElement.dataset.trendSize = size; try { localStorage.setItem("kiip-trend-size", size); } catch (error) { /* private mode 등 */ } }; });
    document.querySelectorAll("[data-province]").forEach((shape) => { const open = () => { state.province = shape.dataset.province; state.municipality = null; render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    document.querySelectorAll("[data-municipality]").forEach((shape) => { const open = () => { state.municipality = shape.dataset.municipality; const region = findMunicipalityRegion(state.province, state.municipality); if (region) state.regionKey = regionKey(region); render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    const back = document.querySelector("#map-back"); if (back) back.onclick = () => { state.province = null; state.municipality = null; render(); };
    document.querySelectorAll("[data-trend-preset]").forEach((button) => { button.onclick = () => { const preset = button.dataset.trendPreset; if (preset === "all") { state.trendStartYear = null; state.trendEndYear = null; } else { const fullEnd = Number(button.dataset.trendFullEnd); state.trendStartYear = fullEnd - (Number(preset) - 1); state.trendEndYear = fullEnd; } render(); }; });
    const trendStartInput = document.querySelector("#trend-start-input"); if (trendStartInput) trendStartInput.onchange = (event) => { state.trendStartYear = Number(event.currentTarget.value) || null; render(); };
    const trendEndInput = document.querySelector("#trend-end-input"); if (trendEndInput) trendEndInput.onchange = (event) => { state.trendEndYear = Number(event.currentTarget.value) || null; render(); };
    // 드래그 중에는 render()가 매번 트랙·핸들 DOM을 통째로 새로 만들기 때문에, 핸들
    // 자신에게 setPointerCapture를 걸면 첫 pointermove 직후 캡처가 끊긴다(캡처 대상
    // 엘리먼트가 문서에서 사라지면 스펙상 캡처가 자동 해제됨). render()가 절대 갈아
    // 끼우지 않는 document.documentElement에 캡처를 걸어 드래그 내내 유지되게 한다.
    const trendYearFromTrack = (clientX) => {
      const track = document.querySelector(".trend-range-track");
      if (!track) return null;
      const fullStart = Number(track.dataset.fullStart);
      const fullEnd = Number(track.dataset.fullEnd);
      if (fullEnd <= fullStart) return fullStart;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return fullStart;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(fullStart + fraction * (fullEnd - fullStart));
    };
    const trendStartHandle = document.querySelector("#trend-range-handle-start");
    if (trendStartHandle) {
      trendStartHandle.onpointerdown = (event) => {
        document.documentElement.setPointerCapture(event.pointerId);
        document.documentElement.onpointermove = (moveEvent) => { if (moveEvent.buttons !== 1) return; const year = trendYearFromTrack(moveEvent.clientX); if (year === null) return; state.trendStartYear = year; render(); };
        document.documentElement.onpointerup = (upEvent) => { document.documentElement.releasePointerCapture(upEvent.pointerId); document.documentElement.onpointermove = null; document.documentElement.onpointerup = null; };
      };
      trendStartHandle.onkeydown = (event) => { const value = Number(trendStartHandle.dataset.value); const max = Number(trendStartHandle.getAttribute("aria-valuemax")); const min = Number(trendStartHandle.getAttribute("aria-valuemin")); if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); state.trendStartYear = Math.max(min, value - 1); render(); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); state.trendStartYear = Math.min(max, value + 1); render(); } };
    }
    const trendEndHandle = document.querySelector("#trend-range-handle-end");
    if (trendEndHandle) {
      trendEndHandle.onpointerdown = (event) => {
        document.documentElement.setPointerCapture(event.pointerId);
        document.documentElement.onpointermove = (moveEvent) => { if (moveEvent.buttons !== 1) return; const year = trendYearFromTrack(moveEvent.clientX); if (year === null) return; state.trendEndYear = year; render(); };
        document.documentElement.onpointerup = (upEvent) => { document.documentElement.releasePointerCapture(upEvent.pointerId); document.documentElement.onpointermove = null; document.documentElement.onpointerup = null; };
      };
      trendEndHandle.onkeydown = (event) => { const value = Number(trendEndHandle.dataset.value); const max = Number(trendEndHandle.getAttribute("aria-valuemax")); const min = Number(trendEndHandle.getAttribute("aria-valuemin")); if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); state.trendEndYear = Math.max(min, value - 1); render(); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); state.trendEndYear = Math.min(max, value + 1); render(); } };
    }
    // 이슈 #112: 요약 탭에서 지역/품목을 클릭해 지자체별 조회로 이동할 때 그 지역의
    // 시/도 아코디언을 자동으로 펼치지 않는다 — 전체 시/도 목록이 평소 상태(접힘)
    // 그대로 보이게 한다. 좌측 목록에서 직접 아코디언을 펼치는 클릭(data-region-group)은
    // 그대로 유지된다.
    document.querySelectorAll("[data-open-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.openRegion; state.itemId = button.dataset.openItem; state.tab = "regions"; render(); }; });
    document.querySelectorAll("[data-region-group]").forEach((button) => { button.onclick = () => { const province = button.dataset.regionGroup; state.selectedRegionProvince = province; state.expandedRegionProvince = state.expandedRegionProvince === province ? null : province; state.regionKey = ""; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-province-tab]").forEach((button) => { button.onclick = () => { const province = button.dataset.provinceTab; state.selectedRegionProvince = province; state.expandedRegionProvince = province; state.regionKey = ""; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.region; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-region-item]").forEach((button) => { button.onclick = () => { state.itemId = button.dataset.regionItem; render(); }; });
    document.querySelectorAll("[data-kipris-application]").forEach((button) => { button.onclick = () => { const applicationNumber = button.dataset.kiprisApplication; navigator.clipboard?.writeText(applicationNumber).catch(() => {}); window.open(kiprisSearchUrl(applicationNumber), "kipris-search", "width=1100,height=800,noopener,noreferrer"); }; });
    bindSearchInput("#region-search", "query");
    bindSearchInput("#item-search", "itemQuery");
    document.querySelectorAll("[data-category-filter]").forEach((button) => { button.onclick = () => { state.categoryFilter = button.dataset.categoryFilter; render(); }; });
  }
  function render() {
    nav();
    document.querySelector("#app").innerHTML = state.tab === "summary" ? summaryScreen() : state.tab === "applications" ? applicationsScreen() : state.tab === "regions" ? regionsScreen() : state.tab === "items" ? itemsScreen() : state.tab === "strategy" ? strategyScreen() : state.tab === "compare" ? compareScreen() : dataScreen();
    bind();
  }

  try { const savedTrendSize = localStorage.getItem("kiip-trend-size"); if (["s", "m", "l"].includes(savedTrendSize)) document.documentElement.dataset.trendSize = savedTrendSize; } catch (error) { /* private mode 등 */ }
  document.querySelector("#generated").textContent = `마지막 업데이트 ${date(dashboardUpdatedAt)}`;
  document.querySelector("#scope-label").textContent = scopeLabel;
  document.querySelector("#snapshot-id").textContent = `Snapshot ${snapshot.snapshotId} · 업데이트 ${date(dashboardUpdatedAt)}`;
  document.querySelector("#brand-home").onclick = () => { state.tab = "summary"; render(); };
  render();
}
