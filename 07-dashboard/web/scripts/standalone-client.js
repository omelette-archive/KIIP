/* eslint-disable @typescript-eslint/no-unused-vars -- embedded and invoked by dashboard.html */
function dashboardClient(snapshot, geometry, registrationExamples) {
  const labels = { complete_nonzero: "현황 확인", complete_zero: "검색 결과 없음", partial: "검토중", error: "확인 오류", skipped: "분류 확인 필요", not_collected: "확인 전", complete: "집계 완료" };
  // 이슈 #116(2026-09-01): "전국 지역 비교"·"지역 상세"·"품목별 조회"를 하나의
  // "지역·품목별 조회" 탭으로 합치고, 탭 안에서 지역별/품목별을 토글로 고른다.
  // 2026-09-08(사용자): "지역 품목별 조회로 모두 들어가니 하위 탭이 생겨서 불편한 것 같아 —
  // 지역별 / 품목별 / 비즈니스 확장 경로 분석 탭을 다시 부활해 줘." #181에서 셋으로 접었던
  // 걸 되돌린다. 지역 상세(regions)만 지역별의 드릴다운이라 그 탭에 묶어 둔다. 특화작목
  // 대조는 #181이 지역별 화면 안으로 넣었고 사용자가 문제 삼지 않아 그대로 둔다.
  const EXPLORE_TABS = ["applications", "regions"];
  // 2026-09-08: 비즈니스 전략은 단위가 지역×품목이라 "지역·품목별 조회"의 하위 모드로
  // 내렸다(컨셉 4판 "하나의 대상 = 하나의 화면"). 최상위 탭 5개 → 4개.
  const PRIMARY_NAV = [["summary", "요약"], ["applications", "지역별 특산품 상표 현황"], ["items", "품목별 특산품 상표 현황"], ["strategy", "비즈니스 확장 경로 분석"], ["data", "데이터 개요"]];
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
  const state = { tab: "summary", query: "", regionQuery: "", itemQuery: "", categoryFilter: "", selectedItemName: "", strategySortKey: "verdict", strategySortDir: "desc", strategySelectedKey: "", strategyFilter: "", strategyItem: "", strategyItemQuery: "", strategyRegion: "", strategyShowAll: false, strategyPolicyOnly: false, selectedRegionProvince: firstRegionProvince, expandedRegionProvince: null, regionKey: "", itemId: "", mapMetric: "coverage", province: null, municipality: null, trendStartYear: null, trendEndYear: null, summaryTrendStartYear: null, summaryTrendEndYear: null, itemSort: "gap", itemShowAll: false, itemGapOnly: false, regionSort: "gap", categoryStatsPick: "", itemRegionPick: "", compareProvince: null, summaryRankingMetric: "application", leaderMonths: 3, leaderMetric: "application" };
  // 이슈 #136(2026-09-07): 탭 바·홈·"전국으로" 링크로 화면을 바꿀 때의 기본값 — 지도 지역
  // 선택과 화면별 검색·필터를 전국·검색 없음으로 되돌린다. 카드·지도·랭킹에서 특정 지역을
  // 눌러 들어가는 드릴다운 이동은 선택을 그대로 넘기므로 여기를 거치지 않는다.
  const resetScreenDefaults = () => { state.province = null; state.municipality = null; state.query = ""; state.regionQuery = ""; state.itemQuery = ""; state.categoryFilter = ""; state.selectedItemName = ""; };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
  const percent = (value) => typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
  // UI 검토(#136) 03번: CSV·엑셀 다운로드 경로가 한 곳도 없어 담당자가 화면을 캡처하거나
  // 손으로 옮겨 적는 수밖에 없었다. 화면에서 보이는 표를 그대로 CSV로 내려받는다(엑셀이
  // 한글을 깨지 않고 읽도록 UTF-8 BOM 포함). Dashboard.tsx와 같은 구조.
  const csvCellValue = (value) => { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const downloadCsv = (filenameBase, header, rows) => {
    const lines = [header, ...rows].map((row) => row.map(csvCellValue).join(","));
    const csv = `﻿${lines.join("\n")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filenameBase}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const csvDateStamp = (value) => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  };
  const csvDownloadButtonHtml = (exportKey) => `<button type="button" class="csv-download-button" data-csv-export="${esc(exportKey)}">CSV 다운로드</button>`;
  // 화면(html 문자열)을 만드는 함수들이 각자 만든 CSV 내보내기 함수를 이름으로 등록해 두면,
  // bind()에서 버튼 클릭 시 이름으로 찾아 실행한다(각 화면 함수 안의 지역 변수라 바깥에서
  // 직접 접근할 수 없다).
  let currentCsvExporters = {};
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
  // 이슈 #117: 특화작목명의 괄호 부기(예: "토마토(완숙토마토)")를 화면에서 지운다.
  const stripParens = (value) => String(value || "").replace(/\s*[（(][^）)]*[）)]\s*/g, "").trim() || String(value || "").trim();
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
  // 이슈 #118: 최근 출원·등록 동향 리더보드. Dashboard.tsx와 동일 로직. 월 단위 집계
  // (applicationMonthCounts/registrationMonthCounts, 키 YYYY-MM)는 전국 키워드 검색 결과
  // 전체 대상이라 지역 귀속 확인 건수와 다른 모집단이다(#50).
  const LEADER_WINDOWS = [[1, "최근 1개월"], [3, "최근 3개월"], [6, "최근 6개월"], [12, "최근 1년"]];
  const LEADER_LIMIT = 5;
  const leaderMinBase = (months) => Math.max(6, months * 2);
  const ymKey = (year, monthIndex0) => `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
  const leaderEndMonth = (generatedAt) => { const d = new Date(generatedAt); const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1); return { year: prev.getFullYear(), monthIndex0: prev.getMonth() }; };
  const monthWindowKeys = (end, months) => { const keys = []; for (let offset = months - 1; offset >= 0; offset--) { const d = new Date(end.year, end.monthIndex0 - offset, 1); keys.push(ymKey(d.getFullYear(), d.getMonth())); } return keys; };
  const sumMonthCounts = (counts, keys) => { if (!counts) return 0; let total = 0; for (const key of keys) total += counts[key] || 0; return total; };
  const monthRangeLabel = (keys) => { if (!keys.length) return ""; const fmt = (key) => { const [y, m] = key.split("-"); return `${y}.${m}`; }; return keys.length === 1 ? fmt(keys[0]) : `${fmt(keys[0])}–${fmt(keys[keys.length - 1])}`; };
  // UI 검토(3차, 2026-09-06) 시각화 교체안 "목록 행": 48×14px 스파크라인(축·격자선 없음,
  // 형태만 가볍게). React Dashboard.tsx의 sparklinePoints와 동일 로직.
  const SPARKLINE_WIDTH = 48;
  const SPARKLINE_HEIGHT = 14;
  const sparklinePoints = (items) => {
    const totals = sumYearCounts(items, "applicationYearCounts");
    const years = Object.keys(totals).map(Number).sort((a, b) => a - b);
    if (years.length < 2) return null;
    const values = years.map((year) => totals[year] || 0);
    const max = Math.max(1, ...values);
    const stepX = SPARKLINE_WIDTH / (years.length - 1);
    return values.map((value, index) => `${(index * stepX).toFixed(1)},${(SPARKLINE_HEIGHT - (value / max) * SPARKLINE_HEIGHT).toFixed(1)}`).join(" ");
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
  // UI 검토(3차, 2026-09-06) 시각화 교체안 "연도별 추이": 트레일링 5년 이동평균. 항상
  // 연속된 전체 캘린더 연도 배열(fullStart~fullEnd)로 계산해야, 보기 범위를 좁혀도
  // 그 이전 실제 이력을 반영한다(React Dashboard.tsx의 movingAverageSeries와 동일 로직).
  const TREND_MOVING_AVERAGE_WINDOW = 5;
  const movingAverageSeries = (totals, contiguousYears, windowSize) => {
    const result = {};
    for (let i = 0; i < contiguousYears.length; i++) {
      const windowStart = Math.max(0, i - windowSize + 1);
      const windowYears = contiguousYears.slice(windowStart, i + 1);
      const sum = windowYears.reduce((total, year) => total + (totals[year] || 0), 0);
      result[contiguousYears[i]] = sum / windowYears.length;
    }
    return result;
  };
  const trendPeakYear = (series, years) => {
    let peakYear = null;
    let peakValue = -Infinity;
    for (const year of years) {
      const value = series[year] || 0;
      if (value > peakValue) { peakValue = value; peakYear = year; }
    }
    return peakYear;
  };
  const trendHandlePercent = (year, fullStart, fullEnd) => {
    if (fullEnd <= fullStart) return 0;
    return ((year - fullStart) / (fullEnd - fullStart)) * 100;
  };
  // 이슈 #136(2026-09-07): 추이 그래프가 1954년부터 시작해 최근 데이터가 오른쪽 끝에
  // 몰려 보기 어렵다는 피드백. 슬라이더가 있는(adjustable) 그래프는 명시 선택이 없으면
  // 최근 20년을 기본 구간으로 열고, 슬라이더로 전체 구간까지 넓힐 수 있게 한다.
  // 이슈 #136(2026-09-07): 2000년 이전은 표본이 희박해 그래프 왼쪽이 바닥에 붙어 최근
  // 추세를 못 읽는다는 지적 반복 → 추이 그래프 표시 범위(슬라이더 하한 포함)를 2000년 고정,
  // 기본 구간도 2000년~최근 전체("그냥 2000년 이후만", 협업자 2026-09-07).
  const TREND_FLOOR_YEAR = 2000;
  const flooredTrendStart = (sortedYears) => {
    if (!sortedYears.length) return TREND_FLOOR_YEAR;
    const dataStart = sortedYears[0];
    const dataEnd = sortedYears[sortedYears.length - 1];
    return dataEnd >= TREND_FLOOR_YEAR ? Math.max(TREND_FLOOR_YEAR, dataStart) : dataStart;
  };
  const defaultTrendStart = (fullStart) => fullStart;
  const clampTrendRange = (startYear, endYear, fullStart, fullEnd, { recentDefault = false } = {}) => {
    const fallbackStart = recentDefault ? defaultTrendStart(fullStart) : fullStart;
    const start = Math.max(fullStart, Math.min(startYear ?? fallbackStart, fullEnd));
    const end = Math.max(start, Math.min(endYear ?? fullEnd, fullEnd));
    return { start, end };
  };
  // 이슈 #116(2026-09-01): 지자체별 조회 추이 그래프 크기 조절(작게/보통/크게).
  // :root[data-trend-size]에 저장하고 CSS가 province-detail-cols 비율을 바꾼다.
  const trendSizeControlHtml = `<div class="trend-size-control" role="group" aria-label="추이 그래프 크기"><span>그래프 크기</span><button type="button" data-trend-size="s">작게</button><button type="button" data-trend-size="m">보통</button><button type="button" data-trend-size="l">크게</button></div>`;
  // 이슈 #118: prominent=true면 -compact 축소 없이 큰 카드로. 요약·지역·품목에서 공통 사용.
  const regionTrendHtml = (region, heading = "연도별 출원·등록 추이", subtitle, options = {}) => {
    // 이슈 #136 코멘트(2026-09-03) 09번: region.region은 원본 시도명을 그대로 이어붙인
    // 값이라(예: "전남광주통합특별시 영광군") displayRegionName의 통합권역 표기 치환을
    // 안 거친다 — 화면에 그대로 노출하면 같은 지역이 다른 화면 표기와 달라 보인다.
    const displayName = displayRegionName(region.region);
    const wrapClass = options.prominent ? "trend-chart trend-chart-prominent region-trend" : "trend-chart trend-chart-compact region-trend";
    const emptyLabel = options.emptyLabel || "이 지역은 아직 연도별 데이터가 없습니다.";
    const trendSubtitle = subtitle || `${displayName} 전체 특산품 · 연도별`;
    const applicationTotals = sumYearCounts(region.items, "applicationYearCounts");
    const registrationTotals = sumYearCounts(region.items, "registrationYearCounts");
    const allYears = [...new Set([...Object.keys(applicationTotals), ...Object.keys(registrationTotals)])].map(Number).sort((a, b) => a - b);
    if (!allYears.length) return `<section class="${wrapClass}"><div class="section-heading"><div><h2>${esc(heading)}</h2></div><span>${esc(displayName)}</span></div><p class="empty">${esc(emptyLabel)}</p></section>`;
    const fullStart = flooredTrendStart(allYears), fullEnd = allYears[allYears.length - 1];
    const range = clampTrendRange(options.adjustable ? state.summaryTrendStartYear : null, options.adjustable ? state.summaryTrendEndYear : null, fullStart, fullEnd, { recentDefault: options.adjustable });
    const start = range.start, end = range.end;
    const years = [];
    for (let year = start; year <= end; year++) years.push(year);
    const max = Math.max(1, ...years.map((year) => Math.max(applicationTotals[year] || 0, registrationTotals[year] || 0)));
    const scale = trendScales(start, end, max);
    // UI 검토(3차, 2026-09-06) 시각화 교체안 "연도별 추이": 5년 이동평균을 주 시각으로.
    const fullYearsContiguous = [];
    for (let year = allYears[0]; year <= fullEnd; year++) fullYearsContiguous.push(year);
    const applicationMA = movingAverageSeries(applicationTotals, fullYearsContiguous, TREND_MOVING_AVERAGE_WINDOW);
    const registrationMA = movingAverageSeries(registrationTotals, fullYearsContiguous, TREND_MOVING_AVERAGE_WINDOW);
    const mostRecentYear = years[years.length - 1];
    const applicationPeakYear = trendPeakYear(applicationMA, years);
    const registrationPeakYear = trendPeakYear(registrationMA, years);
    const applicationMarkerYears = [...new Set([applicationPeakYear, mostRecentYear].filter((year) => year !== null && year !== undefined))];
    const registrationMarkerYears = [...new Set([registrationPeakYear, mostRecentYear].filter((year) => year !== null && year !== undefined))];
    const controls = options.adjustable ? `<div class="trend-controls"><div class="trend-range-inputs"><label><span class="sr-only">시작 연도</span>${start}<input type="number" id="summary-trend-start-input" min="${fullStart}" max="${end}" aria-label="시작 연도" value="${start}"></label><span>~</span><label><span class="sr-only">끝 연도</span>${end}<input type="number" id="summary-trend-end-input" min="${start}" max="${fullEnd}" aria-label="끝 연도" value="${end}"></label></div></div><div class="trend-range-slider"><span class="trend-range-label">${fullStart}년 – ${fullEnd}년 중 ${start}년 – ${end}년 선택</span><div class="trend-range-track" id="summary-trend-range-track" data-full-start="${fullStart}" data-full-end="${fullEnd}"><div class="trend-range-fill" style="left:${trendHandlePercent(start, fullStart, fullEnd)}%;right:${100 - trendHandlePercent(end, fullStart, fullEnd)}%"></div><button type="button" id="summary-trend-range-handle-start" class="trend-range-handle trend-range-handle-start" role="slider" aria-label="시작 연도 조절" aria-valuemin="${fullStart}" aria-valuemax="${end}" aria-valuenow="${start}" data-value="${start}" style="left:${trendHandlePercent(start, fullStart, fullEnd)}%"></button><button type="button" id="summary-trend-range-handle-end" class="trend-range-handle trend-range-handle-end" role="slider" aria-label="끝 연도 조절" aria-valuemin="${start}" aria-valuemax="${fullEnd}" aria-valuenow="${end}" data-value="${end}" style="left:${trendHandlePercent(end, fullStart, fullEnd)}%"></button></div></div>` : "";
    // UI 검토(3차, 2026-09-06) 시각화 교체안 "값 확인": 값 표 토글 + CSV(이 컴포넌트는
    // 여러 화면에서 재사용되지만, 한 화면엔 한 인스턴스만 보이므로 exporter 키는 공용).
    currentCsvExporters.regionTrend = () => downloadCsv(`${displayName}_연도별출원등록추이_${csvDateStamp(dashboardUpdatedAt)}`, ["연도", "출원", "등록"], years.map((year) => [year, applicationTotals[year] || 0, registrationTotals[year] || 0]));
    const valueTableHtml = `<details class="trend-value-table-toggle"><summary><span>값 표로 보기</span>${csvDownloadButtonHtml("regionTrend")}</summary><div class="trend-value-table-wrap"><table class="trend-value-table"><thead><tr><th scope="col">연도</th><th scope="col">출원</th><th scope="col">등록</th></tr></thead><tbody>${years.map((year) => `<tr><td>${year}</td><td>${number(applicationTotals[year] || 0)}</td><td>${number(registrationTotals[year] || 0)}</td></tr>`).join("")}</tbody></table></div></details>`;
    const peakLabelHtml = applicationPeakYear !== null && applicationPeakYear !== mostRecentYear
      ? `<text x="${scale.x(applicationPeakYear)}" y="${Math.max(11, scale.y(applicationMA[applicationPeakYear] || 0) - 22)}" class="trend-marker-label trend-marker-label-application" text-anchor="middle">정점 ${applicationPeakYear}</text>`
      : "";
    const recentLabelHtml = mostRecentYear !== undefined
      ? `<text x="${scale.x(mostRecentYear)}" y="${Math.max(11, scale.y(applicationMA[mostRecentYear] || 0) - 8)}" class="trend-marker-label trend-marker-label-application" text-anchor="end">${applicationPeakYear === mostRecentYear ? "정점·최근 " : "최근 "}${number(applicationTotals[mostRecentYear] || 0)}건</text>`
      : "";
    return `<section class="${wrapClass}"><div class="section-heading"><div><h2>${esc(heading)}</h2></div><span>${esc(trendSubtitle)}</span></div>${controls}<svg class="trend-svg" viewBox="0 0 ${TREND_CHART.width} ${TREND_CHART.height}" role="img" aria-label="${esc(displayName)} ${start}년부터 ${end}년까지 출원·등록 추이(5년 이동평균)">${[0, 0.25, 0.5, 0.75, 1].map((fraction) => { const value = Math.round(max * fraction); const yPos = scale.y(value); return `<g><line x1="${TREND_CHART.padLeft}" x2="${TREND_CHART.width - TREND_CHART.padRight}" y1="${yPos}" y2="${yPos}" class="trend-gridline" /><text x="${TREND_CHART.padLeft - 7}" y="${yPos}" class="trend-axis-label trend-axis-y">${number(value)}</text></g>`; }).join("")}<path d="${trendLinePath(years, applicationMA, scale)}L${scale.x(end).toFixed(1)},${scale.baseY}L${scale.x(start).toFixed(1)},${scale.baseY}Z" class="trend-area" /><path d="${trendLinePath(years, registrationTotals, scale)}" class="trend-line trend-line-raw trend-line-registered-raw" /><path d="${trendLinePath(years, applicationTotals, scale)}" class="trend-line trend-line-raw trend-line-application-raw" /><path d="${trendLinePath(years, registrationMA, scale)}" class="trend-line trend-line-registered" /><path d="${trendLinePath(years, applicationMA, scale)}" class="trend-line trend-line-application" />${applicationMarkerYears.map((year) => `<circle cx="${scale.x(year)}" cy="${scale.y(applicationMA[year] || 0)}" r="3.4" class="trend-point trend-point-application"><title>${year}년 출원 ${number(applicationTotals[year] || 0)}건(5년 평균 ${number(Math.round(applicationMA[year] || 0))}건)${year === applicationPeakYear ? " · 정점" : ""}${year === mostRecentYear ? " · 최근" : ""}</title></circle>`).join("")}${registrationMarkerYears.map((year) => `<circle cx="${scale.x(year)}" cy="${scale.y(registrationMA[year] || 0)}" r="3.4" class="trend-point trend-point-registered"><title>${year}년 등록 ${number(registrationTotals[year] || 0)}건(5년 평균 ${number(Math.round(registrationMA[year] || 0))}건)${year === registrationPeakYear ? " · 정점" : ""}${year === mostRecentYear ? " · 최근" : ""}</title></circle>`).join("")}${peakLabelHtml}${recentLabelHtml}${trendYearLabels(years).map((year) => `<text x="${scale.x(year)}" y="${TREND_CHART.height - 5}" class="trend-axis-label trend-axis-x">${year}</text>`).join("")}</svg><p class="trend-legend"><span class="trend-legend-swatch trend-legend-application"></span>출원(5년 평균)<span class="trend-legend-swatch trend-legend-registered"></span>등록(5년 평균)<span class="trend-legend-swatch trend-legend-swatch-raw"></span>연도별 실제값</p>${valueTableHtml}</section>`;
  };
  // 이슈 #116(2026-08-26): 품목별 조회 광역 단위 출원 비중 원그래프 — 상위 4개 광역 + 기타.
  // 이슈 #119: 차트마다 같은 지역이 다른 색으로 나와 헷갈린다는 지적 — 광역별 색을 고정 배정.
  const PROVINCE_COLORS = {
    서울: "#2f6fed", 부산: "#e8590c", 대구: "#c2255c", 인천: "#0ca678", 광주: "#7048e8",
    대전: "#1098ad", 울산: "#f59f00", 세종: "#66a80f", 경기: "#1c7ed6", 강원: "#37b24d",
    충청북: "#f76707", 충청남: "#9c36b5", 전북: "#d6336c", 전라남: "#0c8599",
    경상북: "#5c940d", 경상남: "#e64980", 제주: "#4263eb",
  };
  const PROVINCE_ETC_COLOR = "#98a2b3";
  const provinceColor = (name) => {
    if (name === "기타") return PROVINCE_ETC_COLOR;
    if (/전남.*광주|광주.*전남/.test(name)) return "#087f5b";
    const key = PROVINCE_ORDER.find((prefix) => name.startsWith(prefix));
    return (key && PROVINCE_COLORS[key]) || PROVINCE_ETC_COLOR;
  };
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
    const stops = segments.map((segment) => {
      const start = (acc * 360).toFixed(1);
      acc += segment.pct;
      return `${provinceColor(segment.name)} ${start}deg ${(acc * 360).toFixed(1)}deg`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }
  // UI 검토(3차, 2026-09-06) 시각화 교체안: "경북 21% · 전남광주 19% · ..." 식 다섯 줄
  // 텍스트 대신 14px 높이 100% 스택 바 한 줄 + 상위 3개만 인라인 라벨로 압축.
  function shareDonutHtml(counts, label) {
    const { segments, total } = provinceShareSegments(counts);
    if (!total) return '<div class="item-share empty"><p class="empty">아직 지역 확인 출원이 없습니다.</p></div>';
    const bar = segments.map((segment) => `<span class="item-share-bar-segment" style="width:${percent(segment.pct)};background:${provinceColor(segment.name)}" title="${esc(`${displayRegionName(segment.name)} ${percent(segment.pct)}`)}"></span>`).join("");
    const topSegments = segments.slice(0, 3);
    const restCount = segments.length - topSegments.length;
    const legend = topSegments.map((segment) => `<li><i style="background:${provinceColor(segment.name)}"></i>${esc(displayRegionName(segment.name))} ${percent(segment.pct)}</li>`).join("")
      + (restCount > 0 ? `<li class="item-share-bar-more">외 ${restCount}개 지역</li>` : "");
    const summary = esc(segments.map((segment) => `${displayRegionName(segment.name)} ${percent(segment.pct)}`).join(", "));
    return `<div class="item-share-bar-wrap"><div class="item-share-bar" role="img" aria-label="${esc(label)} 광역 단위 출원 비중: ${summary}">${bar}</div><ul class="item-share-bar-legend">${legend}</ul></div>`;
  }
  // 12개 카테고리마다 고정 색(2026-09-07 피드백: 해시 색 배정은 충돌이 잦아 한 지역에서
  // 여러 유형이 같은 파란색으로 나왔다). Dashboard.tsx CATEGORY_SHARE_COLOR_BY_LABEL과 동일.
  const CATEGORY_SHARE_COLOR_BY_LABEL = { "곡물": "#caa02c", "채소": "#4a9d4e", "과일": "#e0533b", "특용작물": "#8b5cf6", "임산물": "#127a68", "축산물": "#9c4a1e", "수산물": "#2f6fe0", "가공식품": "#d63384", "주류": "#0f9bd0", "화훼": "#d02fb8", "공예품": "#5b7186", "기타": "#94a3b8" };
  const CATEGORY_SHARE_FALLBACK = ["#caa02c", "#4a9d4e", "#e0533b", "#8b5cf6", "#127a68", "#9c4a1e", "#2f6fe0", "#d63384", "#0f9bd0", "#d02fb8", "#5b7186", "#94a3b8"];
  const categoryShareColor = (name) => { if (CATEGORY_SHARE_COLOR_BY_LABEL[name]) return CATEGORY_SHARE_COLOR_BY_LABEL[name]; if (name === "기타 유형") return CATEGORY_SHARE_COLOR_BY_LABEL["기타"]; let hash = 0; for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) >>> 0; return CATEGORY_SHARE_FALLBACK[hash % CATEGORY_SHARE_FALLBACK.length]; };
  function categoryShareDonutHtml(items, field, label) {
    const counts = {};
    items.forEach((item) => { const metric = item.metrics[field]; if (metric.availability !== "available" || !metric.value) return; const category = item.category?.label || "기타"; counts[category] = (counts[category] || 0) + metric.value; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko-KR"));
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return `<div class="item-share empty"><p class="empty">표시할 ${esc(label)} 데이터가 없습니다.</p></div>`;
    const top = entries.slice(0, 5), rest = entries.slice(5).reduce((sum, [, value]) => sum + value, 0);
    const segments = (rest > 0 ? [...top, ["기타 유형", rest]] : top).map(([name, value]) => ({ name, value, pct: value / total }));
    let acc = 0;
    const gradient = segments.map((segment) => { const start = acc * 360; acc += segment.pct; return `${categoryShareColor(segment.name)} ${start.toFixed(1)}deg ${(acc * 360).toFixed(1)}deg`; }).join(", ");
    const legend = segments.map((segment) => `<li><i style="background:${categoryShareColor(segment.name)}"></i><span class="item-share-region">${esc(segment.name)}</span><b>${percent(segment.pct)}</b></li>`).join("");
    return `<div class="item-share category-share"><div class="item-share-donut" style="background:conic-gradient(${gradient})" role="img" aria-label="특산품 유형별 ${esc(label)} 비중"></div><ul class="item-share-legend">${legend}</ul></div>`;
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
  // 이슈 #136(2026-09-07): 비즈니스 전략 표의 전국 검색 건수와 "전국 대비" 비중.
  // 분모(전국 검색)는 지역 귀속 검증 전 후보라 확정 수치와 다른 모집단 — 합산하지 않는다.
  // 검색 상한(cap 1,800)에 걸린 품목은 전국 검색 값이 잘린 수치라 "1,800건+"로 적고,
  // 그 값을 분모로 쓴 비중은 실제보다 크게 나오므로 "n% 이하"로 적는다.
  const nationwideReach = (item) => {
    const raw = item.metrics.nationwideSearchTrademarkCount?.value;
    const count = typeof raw === "number" ? raw : null;
    const capped = Boolean(item.outputHitCap);
    const local = item.metrics.uniqueTrademarkCount;
    const share = local.availability === "available" && typeof local.value === "number" && count !== null && count > 0 ? local.value / count : null;
    return { count, share, capped };
  };
  const nationwideCountLabel = (count, capped) => count === null ? "—" : `${number(count)}건${capped ? "+" : ""}`;
  const nationwideShareLabel = (share, capped) => share === null ? "—" : capped ? `${percent(share)} 이하` : percent(share);
  const regionKey = (region) => region.regionCode || region.region;
  // 이슈 #116/#119: searchResult.do는 tab·queryText만으로는 검색을 실행하지 않고 상세검색
  // 창만 연다("검색창만 나온다" 재지적). tab 없이 searchKind=keywordSearch(지식재산처
  // 연계용)일 때만 queryText가 검색식(expression)으로 들어가 doSearch가 실행된다.
  // searchRight=ktm(국내상표), 검색식은 출원번호 완전일치 AN=[번호].
  const kiprisSearchUrl = (applicationNumber) => `https://www.kipris.or.kr/khome/search/searchResult.do?searchKind=keywordSearch&searchRight=ktm&queryText=${encodeURIComponent(`AN=[${String(applicationNumber).replace(/\D/g, "")}]`)}`;
  // 2026-09-08 정정: 44는 단체표장 전체이고 지리적 표시 단체표장을 "포함"할 뿐이다(보고서 Ⅲ장 1.2.4).
  const MARK_TYPE_LABELS = { "40": "일반상표", "44": "단체표장", "48": "증명표장" };
  const MARK_TYPE_HINT = "출원번호 앞 두 자리로 판별한 표장 종류입니다. 44·48은 지리적 표시 단체표장·증명표장을 포함하지만, 지리적표시 여부 자체는 개별 확인이 필요합니다.";
  // 2026-09-08(사용자): 원물이냐 가공품이냐는 류가 아니라 지정상품명으로 갈린다 —
  // 31류라도 「사과나무종자」는 원물이 아니고, 29류 「소고기」는 가공품이 아니다.
  const RAW_GOODS_WORDS = ["신선한", "미가공", "무가공", "살아있는", "생물", "원물"];
  const PROCESSED_GOODS_WORDS = [
    "가공", "건조", "냉동", "삶은", "찐", "구운", "볶은", "훈제", "절임", "김치", "장아찌", "피클",
    "말랭이", "가루", "분말", "캡슐", "엑기스", "농축", "추출", "진액", "즙", "액",
    "차(茶)", "차", "주스", "음료", "에이드", "식초", "식혜", "잼", "정과", "조청", "청",
    "막걸리", "소주", "와인", "청주", "탁주", "동동주", "약주", "발효주", "리큐르", "브랜디", "주(酒)",
    "빵", "떡", "과자", "쿠키", "파이", "스낵", "냉면", "국수", "면", "밥", "죽", "통조림",
    "소스", "드레싱", "젓갈", "육포", "밀키트", "차농축액", "화장품", "비누", "로션", "크림", "에센스",
  ];
  const goodsStageOf = (designatedProductName) => {
    const name = String(designatedProductName || "").replace(/\([^)]*\)/g, "");
    if (!name.trim()) return null;
    if (PROCESSED_GOODS_WORDS.some((word) => name.includes(word))) return "processed";
    if (RAW_GOODS_WORDS.some((word) => name.includes(word))) return "raw";
    return null;
  };
  const goodsStageLabel = (evidence) => {
    const stages = new Set((evidence || []).map((row) => goodsStageOf(row.designatedProductName)).filter(Boolean));
    const hasService = (evidence || []).some((row) => Number(row.classCode) >= 35);
    const parts = [];
    if (stages.has("raw")) parts.push("원물");
    if (stages.has("processed")) parts.push("가공품");
    if (hasService) parts.push("서비스");
    return parts.length ? parts.join("·") : null;
  };
  // 컨설팅 보고서 Ⅲ장 4.2의 진단을 화면 지표로. "행위(35류 이상)는 보호되는데 물건(1~34류)은
  // 보호되지 않는" 상태를 출원 건수만으로는 못 잡는다. 지정상품은 5.5%만 확보돼 나머지는
  // "권리 내용 미확인"으로 남긴다 — 미확인 자체가 실사 대상이라는 뜻이다.
  const rightsStatusOf = (item) => {
    const metric = item.metrics.uniqueTrademarkCount;
    if (metric.availability !== "available") return { key: "pending", label: "집계 대기", note: "지역 귀속 확인이 끝나면 판정합니다" };
    if (!(metric.value || 0)) return { key: "none", label: "무권리", note: "지역 주소가 확인된 출원이 없습니다 — 권리화 1순위" };
    const classes = (item.trademarkExamples || [])
      .flatMap((example) => (example.goodsEvidence || []).map((row) => Number(row.classCode)))
      .filter((code) => Number.isFinite(code) && code > 0);
    if (!classes.length) return { key: "unknown", label: "권리 내용 미확인", note: "출원은 있으나 지정상품이 확인되지 않았습니다 — KIPRIS로 실사 필요" };
    const hasGoods = classes.some((code) => code <= 34);
    const hasService = classes.some((code) => code >= 35);
    if (!hasGoods && hasService) return { key: "service-only", label: "행위만 보호", note: "서비스업(35류 이상)만 확인되고 상품 류가 없습니다 — 제품에 붙일 권리가 없습니다" };
    return { key: "goods", label: hasService ? "상품류·서비스류 보유" : "상품류 보유", note: "확인된 지정상품에 상품 류(1~34류)가 있습니다" };
  };
  const markTypeOf = (applicationNumber) => applicationNumber ? MARK_TYPE_LABELS[applicationNumber.slice(0, 2)] || null : null;
  // 일반상표(40)는 대다수라 칩으로 달면 정보가 되지 않는다 — 단체·증명표장만 남긴다.
  const giMarkLabel = (applicationNumber) => { const label = markTypeOf(applicationNumber); return label && label !== "일반상표" ? label : null; };
  // trademarkExamples는 최근 10건 표본이므로 "표본에서 확인된 수"로만 쓴다.
  // 2026-09-08(사용자): "지리적표시권, 지리적표시 단체표장, 지리적표시 증명표장 보유 여부는
  // 확인이 안되나? 같이 보여주면 좋은데" — 셋은 근거도 제도도 다르므로 한 줄에 나란히 두되
  // 출처를 각각 밝힌다.
  //
  //  ① 지리적표시 등록 : 농수산물 품질관리법. 농관원·산림청·수산물품질관리원이 등록하며
  //                      상표권이 아니다. 그 GI 목록에서 수집된 품목인지로 판정한다.
  //  ② 단체표장(44)   : 상표법. 출원번호 앞 두 자리로 판정.
  //  ③ 증명표장(48)   : 상표법. 같음.
  //
  // ②·③은 trademarkExamples(표본)에서만 세므로 하한이다. ①은 품목이 GI 목록에 있다는
  // 뜻이지 이 지역이 그 등록권자라는 뜻은 아니다 — 문구로 못박는다.
  const GI_REGISTRY_SOURCES = new Set(["nfqs_geographical_indication", "naqs_gi_specialties", "jeju_naqs_gi_specialties"]);
  const giRegistryHit = (item) => (item.sources || []).some((source) => GI_REGISTRY_SOURCES.has(source));
  function giHoldingsHtml(item, examples) {
    const registry = giRegistryHit(item);
    const collective = examples.filter((example) => String(example.applicationNumber || "").startsWith("44")).length;
    const certification = examples.filter((example) => String(example.applicationNumber || "").startsWith("48")).length;
    const cell = (label, held, detail, hint) =>
      `<em class="gi-holding ${held ? "held" : "none"}" title="${esc(hint)}"><b>${esc(label)}</b><span>${esc(detail)}</span></em>`;
    return `<div class="gi-holdings-row"><strong>지리적표시</strong><span class="gi-holdings">`
      + cell("지리적표시 등록", registry, registry ? "품목 등록됨" : "미확인",
             "농수산물 품질관리법에 따른 지리적표시 등록(농관원·산림청·수산물품질관리원). 상표권이 아닙니다. 이 품목이 GI 목록에 있다는 뜻이며, 이 지역이 등록권자라는 뜻은 아닙니다.")
      + cell("단체표장", collective > 0, collective > 0 ? `${number(collective)}건` : "없음",
             "상표법상 지리적표시 단체표장 — 출원번호 44로 시작합니다. 이 지역 주소로 확인된 출원 표본에서만 센 값이라 하한입니다.")
      + cell("증명표장", certification > 0, certification > 0 ? `${number(certification)}건` : "없음",
             "상표법상 지리적표시 증명표장 — 출원번호 48로 시작합니다. 이 지역 주소로 확인된 출원 표본에서만 센 값이라 하한입니다.")
      + `</span><small>등록은 농수산물 품질관리법(상표권 아님), 단체·증명표장은 상표법 — 서로 다른 제도입니다</small></div>`;
  }
  const markTypeBreakdown = (examples) => {
    const counts = new Map();
    for (const example of examples) { const label = markTypeOf(example.applicationNumber) || "기타"; counts.set(label, (counts.get(label) || 0) + 1); }
    const order = ["일반상표", "단체표장", "증명표장", "기타"];
    return [...counts.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  };
  const markTypeChipClass = (label) => label === "단체표장" ? "collective" : label === "증명표장" ? "certification" : label === "일반상표" ? "plain" : "other";
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
  // 이슈 #117 코멘트(2026-09-03) 조사 중 발견: #137 운영 파이프라인 통합 이후 스냅샷에서
  // 구·군 데이터가 없는 행의 sigungu 표현이 region.sigungu === region.sido(예전 방식)에서
  // sigungu: null(현재 방식, 도 단위 RDA 배정 포함)로 바뀌어 있었다 — 원래 조건은 이제 어떤
  // 행에도 안 걸린다. 두 표현을 모두 인식하도록 넓힌다.
  const isUnclassifiedRegion = (region) => !region.sigungu || region.sigungu === region.sido;
  // 이슈 #117 코멘트(2026-09-03): 경기도처럼 실제 시군구 데이터(가평군 등)가 있는 도에
  // RDA 지역특화작목 도 단위 배정(#117)으로 시군구 미지정 행("경기도" 자체)이 하나 더
  // 생기면, isUnclassifiedRegion 폴백(원래 대전·대구·부산 등 그 도시 전체가 구·군 데이터
  // 자체가 없는 경우만을 위한 것)이 실제 시군구를 골라도 계속 끼어들어 "가평군"과 "경기도"가
  // 나란한 카드로 보이게 한다. 실제 시군구 데이터가 있는 도에서는 이 폴백을 끈다.
  const provinceHasRealMunicipalities = (province) => province ? regionalRegions.some((region) => region.sido === province && !isUnclassifiedRegion(region)) : false;
  // UI 검토(#136) 13번: 연속 선형 스케일은 값이 낮은 쪽에 몰린 실제 분포에서 여러 지역이
  // 같은 색으로 뭉쳤다(명도 폭 0.31~0.64 관측) — 분위수(quantile) 5단계로 바꿔 상대 순위로
  // 색을 정한다. React(Dashboard.tsx)와 같은 구조.
  const QUANTILE_FILL_MIXES = [24, 42, 58, 75, 92];
  const quantileBreaks = (values, bucketCount = QUANTILE_FILL_MIXES.length) => {
    const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
    if (!sorted.length) return [];
    const breaks = [];
    for (let i = 1; i < bucketCount; i++) {
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * (i / bucketCount)));
      breaks.push(sorted[idx]);
    }
    return breaks;
  };
  const quantileBucket = (value, breaks) => { let bucket = 0; for (const cutoff of breaks) if (value > cutoff) bucket++; return bucket; };
  const fill = (value, breaks) => {
    if (value === null) return "#e3e6ec";
    const bucket = breaks.length ? quantileBucket(value, breaks) : 0;
    const mix = QUANTILE_FILL_MIXES[Math.min(bucket, QUANTILE_FILL_MIXES.length - 1)];
    return `color-mix(in srgb, #0f5fa6 ${mix}%, #e9eef4)`;
  };
  // UI 검토(3차, 2026-09-06) N1: 분위 경계를 만들 수 없으면(breaks=[]) 칸마다 "최고"만
  // 반복돼 의미가 없다 — 이 경우는 범례 칸 자체를 감춘다("데이터 없음" 칩만 남는다).
  // UI 검토(3차, 2026-09-06) 시각화 교체안 "지도 범례": 상한값만 나열하지 않고 각 칸을
  // 양끝 구간으로 표기(예: "23~41개"). 첫 칸은 상한만, 마지막 칸은 그 앞 경계부터 "이상".
  const quantileLegendHtml = (breaks, formatter) => breaks.length === 0 ? "" : QUANTILE_FILL_MIXES.map((mix, index) => `<span><i class="legend-swatch" style="background:color-mix(in srgb, #0f5fa6 ${mix}%, #e9eef4)"></i>${index < breaks.length ? (index === 0 ? `~${esc(formatter(breaks[index]))}` : `${esc(formatter(breaks[index - 1]))}~${esc(formatter(breaks[index]))}`) : `${esc(formatter(breaks[breaks.length - 1]))} 이상`}</span>`).join("");
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
  const FLOW_STAGE_HINTS = { raw: "산지·1차 생산 단계 상표", processed: "가공식품·음료·화장품 등", service: "유통·체험·관광·식음 서비스류" };
  // 이슈 #119: 단계별 주요 상품류 이름(자주 나오는 NICE 13판 대분류만).
  // 2026-09-08: 확장 경로 보고서가 스냅샷에 실제로 나타나는 류를 모두 이름으로 부른다.
  const NICE_CLASS_LABELS = { "1": "화학·비료(1)", "2": "페인트·염료(2)", "3": "화장품·세제(3)", "5": "건강기능식품·의약(5)", "7": "농기계(7)", "9": "전자·앱(9)", "10": "의료기기(10)", "14": "귀금속(14)", "15": "악기(15)", "16": "인쇄물·문구(16)", "18": "가죽제품(18)", "20": "가구·목재(20)", "21": "주방·생활용품(21)", "24": "직물(24)", "25": "의류(25)", "28": "완구·스포츠(28)", "29": "가공식품(29)", "30": "곡물·커피·조미(30)", "31": "원물·농수산물(31)", "32": "음료·맥주(32)", "33": "주류(33)", "34": "담배(34)", "35": "도소매·광고(35)", "36": "금융(36)", "39": "운송·유통(39)", "40": "재료가공(40)", "41": "교육·체험(41)", "42": "연구·기술(42)", "43": "식음·숙박(43)", "44": "농업 서비스(44)", "45": "기타 서비스(45)" };
  const niceClassLabel = (code) => NICE_CLASS_LABELS[code] || `${code}류`;
  // 이슈 #119(협업자 2026-09-02): 단계별 상위 5개 지역 출원 점유율을 원그래프로. topRegions는
  // 상위 출원인 주소 기준 근사치라 합이 1이 아닐 수 있어 보이는 항목 안에서 정규화해 각을
  // 나누고 원래 점유율은 범례에 그대로 적는다. StageRegionDonut(Dashboard.tsx)과 동일.
  const stageRegionDonutHtml = (stage, label) => {
    const rows = (Array.isArray(stage.topRegions) ? stage.topRegions : []).slice(0, 5).filter((row) => row.count > 0);
    if (rows.length === 0) return `<article class="flow-region-donut empty"><h4>${esc(label)}</h4><p class="empty">상위 지역 데이터가 없습니다.</p></article>`;
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    let cursor = 0;
    const stops = rows.map((row) => {
      const start = cursor * 360;
      cursor += total ? row.count / total : 0;
      return `${provinceColor(row.region)} ${start.toFixed(1)}deg ${(cursor * 360).toFixed(1)}deg`;
    }).join(", ");
    const legend = rows.map((row) => `<li><i style="background:${provinceColor(row.region)}"></i><span class="item-share-region">${esc(displayRegionName(row.region))}</span><b>${percent(row.share)}</b></li>`).join("");
    return `<article class="flow-region-donut"><h4>${esc(label)}<small>상위 ${rows.length}개 지역</small></h4><div class="flow-region-donut-body"><div class="item-share-donut" style="background:conic-gradient(${stops})" role="img" aria-label="${esc(label)} 단계 상위 지역 출원 점유율"></div><ul class="item-share-legend">${legend}</ul></div></article>`;
  };
  // 컨설팅 보고서 Ⅲ장 4.1의 밸류체인 4단계와 단계별 상품류. 위 raw/processed/service는
  // 상표명 텍스트 기준 근사치이고 이쪽은 상품류(NICE) 기준이라 값이 일치하지 않는다.
  // 2026-09-08 정정(사용자): 29·30·31류는 지정상품에 따라 원물일 수도 가공품일 수도 있다.
  // 류로 확실히 갈리는 건 제품(1~34류)과 서비스·확산(35류 이상)뿐이다.
  const REPORT_CHAIN = [
    { key: "goods", label: "제품", test: (code) => code >= 1 && code <= 34, hint: "1~34류" },
    { key: "service", label: "서비스·확산", test: (code) => code >= 35, hint: "35류 이상" },
  ];
  const reportChainBuckets = (flow) => {
    const byClass = new Map();
    for (const key of ["raw", "processed", "service"]) {
      for (const row of flow.stages[key].classes || []) byClass.set(row.classCode, (byClass.get(row.classCode) || 0) + row.count);
    }
    const buckets = REPORT_CHAIN.map((bucket) => {
      const entries = [...byClass.entries()].filter(([code]) => bucket.test(Number(code)));
      return { ...bucket, count: entries.reduce((sum, [, count]) => sum + count, 0), hitClasses: entries.sort((a, b) => b[1] - a[1]).map(([code]) => code) };
    });
    const max = Math.max(1, ...buckets.map((b) => b.count));
    const leader = [...buckets].sort((a, b) => b.count - a.count)[0];
    return { buckets, max, leader: leader && leader.count > 0 ? leader : null };
  };
  const reportChainHtml = (flow) => {
    const chain = reportChainBuckets(flow);
    if (!chain.leader) return "";
    const rows = chain.buckets.map((bucket) => `<span class="report-chain-label">${esc(bucket.label)}<small>${esc(bucket.hint)}</small></span><span class="report-chain-track"><i style="width:${Math.round(bucket.count / chain.max * 100)}%"></i></span><span class="report-chain-value">${bucket.count ? number(bucket.count) : "—"}</span>`).join("");
    return `<div class="report-chain"><div class="report-chain-head"><strong>보고서 밸류체인 기준 상품류 활동</strong><span>기축 <b>${esc(chain.leader.label)}</b> · ${esc(chain.leader.hitClasses.slice(0, 4).join("·"))}류</span></div><div class="report-chain-rows">${rows}</div><p class="report-chain-caveat">전국 검색 결과의 상품류 분포입니다. <b>제품(1~34류)과 서비스·확산(35류 이상)</b>은 류로 갈리지만, 원물과 가공품은 같은 류 안에서도 지정상품에 따라 갈리므로(예: 31류 「신선한 사과」는 원물, 29류 「사과말랭이」는 가공품) 아래 등록 사례의 지정상품에서 확인하십시오. 단계별 상위 5개 류만 집계돼 하한이고, 한 상표가 여러 류를 가지면 류마다 셉니다.</p></div>`;
  };
  const nationwideFlowCardHtml = (flow, itemLabel, origins) => {
    const { raw, processed, service } = flow.stages;
    const classified = raw.count + processed.count + service.count;
    const flowPct = (value) => classified ? `${Math.round(value / classified * 100)}%` : "—";
    const otherRegion = [processed.topRegion, service.topRegion].filter((region) => region && region !== raw.topRegion)[0];
    const clusterNote = raw.topRegion && otherRegion
      ? `<p class="nationwide-flow-note">${esc(raw.topRegion)}에서 원물 활동이 가장 활발하고, ${esc(otherRegion)}에서 가공·서비스 활동이 두드러집니다.</p>`
      : "";
    // 이슈 #116(2026-09-01): 어디까지 확장 가능한지 보이도록 단계별 비중(분류 가능 건 기준)과
    // 단계 성격을 함께 표시한다. 단계별 대표·특이 지정상품 예시는 상표 단어검색 API에 지정상품이
    // 없어 별도 등록원부 수집이 끝난 뒤 붙인다(analyzeNationwideFlow.js 재실행 필요).
    const furthestStage = service.count > 0 ? "서비스·확장까지" : processed.count > 0 ? "가공품까지" : "원물 단계";
    const hasExamples = ["raw", "processed", "service"].some((key) => { const eg = flow.stages[key].examples; return eg && ((eg.representative || []).length || (eg.unusual || []).length); });
    const hasDesignatedGoods = ["raw", "processed", "service"].some((key) => flow.stages[key].examples && flow.stages[key].examples.source === "designated_goods");
    const stagesHtml = ["raw", "processed", "service"].map((key, index) => {
      const stage = flow.stages[key]; const eg = stage.examples;
      const classesHtml = Array.isArray(stage.classes) && stage.classes.length ? `<small class="nationwide-flow-eg"><b>주요 상품류</b> ${esc(stage.classes.slice(0, 3).map((row) => `${niceClassLabel(row.classCode)} ${Math.round(row.share * 100)}%`).join(" · "))}</small>` : "";
      const regionsHtml = Array.isArray(stage.topRegions) && stage.topRegions.length
        ? `<small class="nationwide-flow-eg"><b>상위 지역</b> ${esc(stage.topRegions.slice(0, 3).map((row) => `${row.region} ${Math.round(row.share * 100)}%`).join(" · "))}</small>`
        : (stage.topRegion ? `<small class="nationwide-flow-region">${esc(stage.topRegion)}</small>` : "");
      return `${index > 0 ? '<i class="nationwide-flow-arrow" aria-hidden="true">→</i>' : ""}<div class="nationwide-flow-stage nationwide-flow-stage-${key}"><span>${FLOW_STAGE_LABELS[key]}</span><strong>${number(stage.count)}건</strong><small class="nationwide-flow-share">전체의 ${flowPct(stage.count)}</small><small class="nationwide-flow-hint">${FLOW_STAGE_HINTS[key]}</small>${classesHtml}${regionsHtml}${eg && (eg.representative || []).length ? `<small class="nationwide-flow-eg"><b>${eg.source === "designated_goods" ? "대표 지정상품" : "대표 상표명"}</b> ${esc(eg.representative.join(", "))}</small>` : ""}${eg && (eg.unusual || []).length ? `<small class="nationwide-flow-eg"><b>${eg.source === "designated_goods" ? "이색 지정상품" : "이색 상표명"}</b> ${esc(eg.unusual.join(", "))}</small>` : ""}</div>`;
    }).join("");
    const chainHtml = reportChainHtml(flow);
    // 이슈 #119(협업자 2026-09-02): "원물 → 가공품 → 서비스 단계별 상표출원 기준 Top 5 지역과
    //  출원 점유율(특산품 관리 지역 고려하지 않고) 보여줘. (원 그래프로 각각)"
    const donutsHtml = ["raw", "processed", "service"].some((key) => (Array.isArray(flow.stages[key].topRegions) ? flow.stages[key].topRegions : []).length > 0)
      ? `<div class="nationwide-flow-region-donuts">${["raw", "processed", "service"].map((key) => stageRegionDonutHtml(flow.stages[key], FLOW_STAGE_LABELS[key])).join("")}</div>`
      : "";
    const originsHtml = Array.isArray(origins) && origins.length ? `<p class="nationwide-flow-origins"><strong>주요 원산지</strong> ${esc(origins.map(displayRegionName).join(", "))}</p>` : "";
    return `<section class="nationwide-flow-card">
      <div class="section-heading"><div><h2>${esc(itemLabel)} 비즈니스 확장 흐름</h2></div><span>전국 상표 검색 · 참고 지표</span></div>
      <p class="nationwide-flow-reach">현재 <strong>${furthestStage}</strong> 상표 활동이 확인됩니다 · 전체 ${number(flow.totalCount)}건 중 단계 분류 가능 ${number(classified)}건</p>
      <div class="nationwide-flow-stages">${stagesHtml}</div>
      ${chainHtml}
      ${donutsHtml}
      ${originsHtml}
      ${clusterNote}
      <p class="nationwide-flow-caveat">${hasExamples ? (hasDesignatedGoods ? "상품류·상위 지역은 상위 출원인 기준 근사치입니다. 지정상품 예시는 각 단계 상위 출원의 실제 지정상품 명칭에서 뽑았습니다." : "상품류·상위 지역은 상위 출원인 기준 근사치입니다. 예시는 상표명 기준이며 지정상품 명칭 대조는 재수집 후 반영됩니다.") : "단계별 상품류·상위 지역·예시는 전국 흐름 재수집 후 채워집니다."}</p>
    </section>`;
  };
  // 이슈 #136(협업자 2026-09-06): 전국 흐름에서 규칙 파생한 확장 방향 제안. Dashboard.tsx
  // expansionSuggestions와 동일 로직. caveat 없이 조용히("AI 판정" 표기 금지).
  function expansionSuggestions(flow, opts) {
    opts = opts || {};
    const { raw, processed, service } = flow.stages;
    const out = [];
    const rawRegion = raw.topRegions && raw.topRegions[0] && raw.topRegions[0].region;
    const processedRegion = processed.topRegions && processed.topRegions[0] && processed.topRegions[0].region;
    const topRawClass = raw.classes && raw.classes[0];
    if (raw.count >= 20 && service.count / Math.max(1, raw.count) < 0.15) out.push({ kind: "service_gap", text: `서비스·확장 단계 상표가 원물 대비 ${Math.round(service.count / Math.max(1, raw.count) * 100)}%뿐입니다 — 체험·유통·식음(41·43·44류) 진출 여지가 큽니다.` });
    if (raw.count >= 30 && processed.count / Math.max(1, raw.count) < 0.3) out.push({ kind: "processed_gap", text: `가공품 브랜딩(${number(processed.count)}건)이 원물(${number(raw.count)}건)에 비해 적습니다 — 가공식품·음료류(29·30·32) 상표가 아직 미개척입니다.` });
    if (topRawClass && topRawClass.share > 0.6) out.push({ kind: "class_concentration", text: `원물 상표가 ${niceClassLabel(topRawClass.classCode)}에 ${Math.round(topRawClass.share * 100)}% 집중돼 있습니다 — 인접 상품류로 포트폴리오를 넓힐 여지가 있습니다.` });
    if (flow.hasRegionalSignal && rawRegion && processedRegion && rawRegion !== processedRegion) out.push({ kind: "cluster_split", text: `원물 상표 활동은 ${displayRegionName(rawRegion)}, 가공은 ${displayRegionName(processedRegion)}에서 두드러집니다 — 산지에서 가공 브랜드를 키울 때 산지 연계 스토리를 활용할 수 있습니다.` });
    if (opts.surging) out.push({ kind: "momentum", text: "최근 출원이 급증하는 품목입니다 — 선점 경쟁이 빨라지고 있어 조기 출원 전략이 필요합니다." });
    if (out.length === 0 && service.count > processed.count * 0.3) out.push({ kind: "balanced", text: "원물·가공·서비스 전 단계에 상표 활동이 고르게 있습니다 — 지역 특화 세부 상품류를 겨냥한 차별화가 다음 과제입니다." });
    return out.slice(0, 4);
  }
  const expansionSuggestionsHtml = (flow, itemLabel, surging) => {
    const s = expansionSuggestions(flow, { surging: surging });
    if (s.length === 0) return "";
    return `<section class="expansion-card"><div class="section-heading"><div><h2>${esc(itemLabel)} 확장 방향 제안</h2></div><span>전국 흐름 데이터 기반</span></div><ul class="expansion-list">${s.map((x) => `<li><span class="expansion-dot" aria-hidden="true"></span>${esc(x.text)}</li>`).join("")}</ul></section>`;
  };
  // 이슈 #116(2026-08-26) 사용자 재요청: 상태 아이콘·배지, 근거 수치 스탯 줄, 문장별 도트
  // 마커로 가독성을 높였다 — Dashboard.tsx의 BusinessStrategyCard와 동일 구조.
  // UI 검토(#136) 07번: "고유 상표 1건·등록률 100%는 공백 알림, 6건·등록률 17%는 양호"처럼
  // 배지 판정이 눈에 보이는 근거와 반대로 보인다는 지적 — 실제로는 출원 건수(5건 도달 시
  // 포화)와 등록률을 7:3 가중으로 종합한 결과라(05-detect-brand-gap/lib/scorer.js), 건수가
  // 적으면 등록률이 높아도 공백으로 판정될 수 있다. "AI 판정" 표시는 넣지 않되(사용자 지침),
  // 배지에 이 판정 기준을 그대로 풀어서 설명한다. 분모가 작을 때(5건 미만)는 100%·0% 같은
  // 백분율 대신 분수(N/M건) + "표본 적음" 표식을 덧붙인다.
  const SMALL_SAMPLE_TRADEMARK_COUNT = 5;
  const GAP_BADGE_CRITERIA = "상표 출원 건수(5건 도달 시 활동량 포화)와 등록률을 7:3 비율로 종합 평가합니다 — 출원 건수가 적으면 등록률이 높아도 공백 알림으로 표시될 수 있습니다.";
  const businessStrategyCardHtml = (briefing, title, footerHtml = "", nationwide = {}) => {
    const evidence = briefing.evidence || {};
    const uniqueCount = evidence.uniqueTrademarkCount;
    const isSmallSample = typeof uniqueCount === "number" && uniqueCount > 0 && uniqueCount < SMALL_SAMPLE_TRADEMARK_COUNT;
    const registeredCount = isSmallSample && typeof evidence.registrationRate === "number" ? Math.round(uniqueCount * evidence.registrationRate) : null;
    const registrationDisplay = isSmallSample && registeredCount !== null ? `${registeredCount}/${uniqueCount}건` : percent(evidence.registrationRate);
    const smallSampleMarkHtml = isSmallSample ? `<em class="small-sample-mark" title="${esc(`표본이 적어(고유 상표 ${SMALL_SAMPLE_TRADEMARK_COUNT}건 미만) 백분율보다 실제 건수로 보는 게 정확합니다.`)}">표본 적음</em>` : "";
    const stats = [
      typeof evidence.uniqueTrademarkCount === "number" ? `<div class="strategy-stat"><span>지역 확인 출원</span><strong>${number(evidence.uniqueTrademarkCount)}건</strong></div>` : "",
      // 이슈 #136(2026-09-07): 지역 건수만으로는 규모를 못 가늠해 전국 검색 건수·비중을 함께 둔다.
      typeof nationwide.count === "number" ? `<div class="strategy-stat"><span title="${esc(`같은 품목명의 전국 검색 결과 · 지역 확인 전 후보라 위 확정 건수와는 다른 모집단${nationwide.capped ? " · 검색 상한(1,800건)에 걸려 실제로는 더 많습니다" : ""}`)}">전국 검색</span><strong>${nationwideCountLabel(nationwide.count, nationwide.capped)}</strong></div>` : "",
      typeof nationwide.share === "number" ? `<div class="strategy-stat"><span title="${esc("지역 확인 출원 ÷ 전국 검색 결과")}">전국 대비</span><strong>${nationwideShareLabel(nationwide.share, nationwide.capped)}</strong></div>` : "",
      typeof evidence.registrationRate === "number" ? `<div class="strategy-stat"><span>등록률${smallSampleMarkHtml}</span><strong>${registrationDisplay}</strong></div>` : "",
      typeof evidence.localApplicantShare === "number" ? `<div class="strategy-stat"><span>지역 출원인 비중</span><strong>${percent(evidence.localApplicantShare)}</strong></div>` : "",
    ].join("");
    return `<section class="business-strategy${briefing.isGapAlert ? " alert" : ""}">
      <div class="strategy-head"><div class="strategy-head-title"><span class="strategy-status-icon" aria-hidden="true">${briefing.isGapAlert ? "!" : "✓"}</span><strong>${esc(title)}</strong></div><span class="strategy-status-badge" title="${esc(GAP_BADGE_CRITERIA)}">${briefing.isGapAlert ? "공백 알림" : "양호"}</span></div>
      ${stats ? `<div class="strategy-stat-row">${stats}</div>` : ""}
      <ul class="business-strategy-list">${briefing.sentences.map((sentence) => `<li>${esc(displayRegionName(sentence))}</li>`).join("")}</ul>
      ${footerHtml ? `<p class="business-strategy-footer">${footerHtml}</p>` : ""}
    </section>`;
  };
  // UI 검토(#136) 05번: "⑤·⑥단계 분석 결과에서..." 각주가 카드마다 반복돼 시각적 소음이
  // 컸고, 단계 번호·템플릿 ID는 정책 담당자의 언어가 아니었다. 카드 목록·화면당 한 번만,
  // 파이프라인 용어 없이 보여준다.
  const businessStrategyDisclaimerHtml = (templateVersion) => `<p class="business-strategy-disclaimer" title="${esc(`규칙 기반 자동 생성 문장(AI 미사용) · 버전 ${templateVersion || "미기록"}`)}">자동 생성 문장입니다 · 생성 규칙 보기</p>`;
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
  const sourceLine = [...new Set(snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean))].join(" · ");
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

  // UI 검토(#136) 14번: 상단 탭이 role·aria-selected·aria-controls 없는 일반 버튼이라
  // 스크린리더에 "탭"으로 전달되지 않았다 — role="tablist" 구조로 맞추고, 화살표 키로 탭 사이를 이동+활성화한다(automatic
  // activation, WAI-ARIA APG). React(Dashboard.tsx)와 같은 구조.
  function primaryTabsKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const lastIndex = PRIMARY_NAV.length - 1;
    const currentIndex = Math.max(0, PRIMARY_NAV.findIndex(([key]) => key === state.tab || (key === "applications" && EXPLORE_TABS.includes(state.tab))));
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
    else if (event.key === "ArrowLeft") nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    const nextKey = PRIMARY_NAV[nextIndex][0];
    state.tab = nextKey;
    render();
    requestAnimationFrame(() => document.getElementById(`primary-tab-${nextKey}`)?.focus());
  }
  function nav() {
    const tabsEl = document.querySelector("#primary-tabs");
    tabsEl.setAttribute("role", "tablist");
    tabsEl.onkeydown = primaryTabsKeyDown;
    tabsEl.innerHTML = PRIMARY_NAV.map(([key, label]) => { const active = state.tab === key || (key === "applications" && EXPLORE_TABS.includes(state.tab)); return `<button type="button" id="primary-tab-${key}" role="tab" aria-selected="${active}" aria-controls="primary-tabpanel-${key}" tabindex="${active ? 0 : -1}" data-tab="${key}" class="${active ? "active" : ""}">${label}</button>`; }).join("");
    // 이슈 #136(2026-09-07): 요약 지도와 지역별 조회가 state.province/municipality를 공유해,
    // 지역별 조회에서 경상남도를 보다가 요약 탭을 누르면 전국 현황 대신 경남 시군구 지도가
    // 그대로 남았다(반대 방향도 같다). 탭 바로 탭을 고르는 것은 그 화면을 처음부터 본다는
    // 뜻이므로 지역 선택도 검색·필터와 함께 기본값(전국)으로 되돌린다. 카드·지도·랭킹에서
    // 특정 지역을 눌러 들어가는 드릴다운은 지금처럼 선택을 그대로 넘긴다.
    document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { const next = button.dataset.tab; if (next === "applications" && EXPLORE_TABS.includes(state.tab)) return; if (next !== state.tab) resetScreenDefaults(); state.tab = next; render(); }; });
  }

  function summaryScreen() {
    // 이슈 #116(2026-09-01): 전국 단위 카탈로그(sido="전국")를 지도·요약 "특산품 수"
    // 모집단에서 제외해 hero·데이터 개요(regionItemCount)와 숫자를 통일한다.
    const visibleRegions = state.province ? regionalRegions.filter((region) => (region.sido || region.region) === state.province && (!state.municipality || region.sigungu === state.municipality || (isUnclassifiedRegion(region) && !provinceHasRealMunicipalities(state.province)))) : regionalRegions;
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
    const nationalBreaks = quantileBreaks(geometry.provinces.map((shape) => provinceValue(shape.name)));
    const municipalBreaks = municipal ? quantileBreaks(municipal.items.map((shape) => regionValue(findMunicipalityRegion(state.province, shape.name)))) : [];
    const RANKING_LIMIT = 10;
    // UI 검토(3차, 2026-09-06) N2: 기초자치단체와 광역 단위 시군구 미지정 항목을 같은
    // 순위표에 섞지 않는다 — 광역 단위 미지정 항목은 뺀다.
    const rankingCandidatesAll = regionalRegions.flatMap((region) => {
      if (isUnclassifiedRegion(region)) return [];
      return region.items.flatMap((item) => { const label = officialItemLabel(item); return label ? [{ region, item, label }] : []; });
    });
    // UI 검토(3차, 2026-09-06) S2: "지도 선택 → 우측 전체 갱신" — 지도에서 시도/시군구를
    // 고르면 랭킹도 그 범위로 좁혀진다.
    const rankingCandidates = state.municipality
      ? rankingCandidatesAll.filter(({ region }) => region.sigungu === state.municipality)
      : state.province
        ? rankingCandidatesAll.filter(({ region }) => region.sido === state.province)
        : rankingCandidatesAll;
    const applicationRankingRows = [...rankingCandidates].filter(({ item }) => item.metrics.uniqueTrademarkCount.availability === "available").sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
    const registrationRankingRows = [...rankingCandidates].filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available").sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0));
    currentCsvExporters.summaryApplicationRanking = () => downloadCsv(`지역대표특산품출원랭킹_${csvDateStamp(dashboardUpdatedAt)}`, ["순위", "지역", "대표 특산품", "출원 확인"], applicationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => [index + 1, displayRegionName(region.region), label, item.metrics.uniqueTrademarkCount.value ?? 0]));
    currentCsvExporters.summaryRegistrationRanking = () => downloadCsv(`지역대표특산품등록랭킹_${csvDateStamp(dashboardUpdatedAt)}`, ["순위", "지역", "대표 특산품", "등록 완료"], registrationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => [index + 1, displayRegionName(region.region), label, item.metrics.registeredTrademarkCount.value ?? 0]));
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = findMunicipalityRegion(state.province, shape.name); const value = regionValue(region); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, municipalBreaks)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(displayRegionName(shape.name))} ${mapValueLabel(value)}"><title>${esc(displayRegionName(shape.name))} · ${mapValueLabel(value)}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, nationalBreaks)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(displayRegionName(shape.name))} ${mapValueLabel(value)}"><title>${esc(displayRegionName(shape.name))} · ${mapValueLabel(value)}</title></path>`; }).join("");
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const shapeLabels = mapLabelMarkup(activeShapes, Boolean(municipal));
    // 이슈 #116(2026-09-01): 요약 상단의 전체 폭 지표 바를 없애고 왼쪽 열(지도 옆)로
    // 옮긴다 — "전국 특산품 수" 카드가 그 지표 바와 겹쳐 보인다는 지적. 지도 지표 토글에
    // 연동되는 출원율·등록률 링만 왼쪽 열에 남기고, 특산품 수·상표 건수 단독 카드는
    // 지표 바가 이미 보여주므로 뺀다.
    // 2026-09-08(사용자): "전국 특산품수에서 수집한 지역+품목 수를 top5 위에 적어줘 / 전국
    // 상표건수 Top5 위에 상표 수집건수 적어줘." 출원율·등록률에는 비율 고리가 있어 모집단이
    // 보이는데, 특산품 수·상표 건수는 상위 5개만 나열돼 "전체가 얼마인지"가 없었다.
    const insightHero = state.mapMetric === "applicationCoverage"
      ? `<div class="rate-hero">${rateRing(visibleSpecialtyCoverage.rate, "출원율")}<div class="rate-hero-detail"><span>특산품 출원율</span><small>수집 특산품 ${number(visibleSpecialtyCoverage.total)}개 중 출원 확인 ${number(visibleSpecialtyCoverage.applied)}개${visibleSpecialtyCoverage.pending ? ` · 집계 대기 ${number(visibleSpecialtyCoverage.pending)}개` : ""}</small></div></div>`
      : state.mapMetric === "registration"
        ? `<div class="rate-hero">${rateRing(visibleRegistrationRate, "등록률")}<div class="rate-hero-detail"><span>상표 등록률</span><small>지역 주소 일치 출원 ${number(visibleTrademarkCount)}건 중 등록 ${number(visibleRegisteredCount)}건</small></div></div>`
        : state.mapMetric === "coverage"
          ? `<div class="insight-total"><strong>${number(visibleSpecialtyCoverage.total)}</strong><span>지역 × 특산품</span><small>출원 확인 ${number(visibleSpecialtyCoverage.applied)}개 · 공백 ${number(Math.max(0, visibleSpecialtyCoverage.total - visibleSpecialtyCoverage.applied))}개${visibleSpecialtyCoverage.pending ? ` · 집계 대기 ${number(visibleSpecialtyCoverage.pending)}개` : ""}</small></div>`
          : state.mapMetric === "trademarks"
            ? `<div class="insight-total"><strong>${number(visibleTrademarkCount)}</strong><span>지역 확인 출원</span><small>등록 ${number(visibleRegisteredCount)}건 · 출원인 주소가 이 지역으로 확인된 고유 출원만 셉니다</small></div>`
            : "";
    const insightList = visibleInsightItems.slice(0, 5).map(({ region, item, label }) => `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span><strong>${esc(region.sigungu || displayRegionName(region.region))} / ${esc(label)}</strong><small>${esc(noticeBasis(item))}${item.niceClass ? ` · NICE ${esc(item.niceClass)}류` : ""}</small></span><b>${esc(insightItemValue(item))}</b></button>`).join("") || '<p class="empty">이 지역에는 수집된 특산품이 없습니다.</p>';
    // UI 검토(3차, 2026-09-06) S2: KPI 4장 → 2장. "전국 특산품 수"·"지역별 출원 수 표시
    // 가능"(항상 100%에 가까움)은 빼고, 나머지 둘은 완료율이 아니라 공백 중심으로.
    const metricsHtml = (() => {
        // 2026-09-08: 컨셉 4판의 대표 지표를 첫 화면으로. 공백(출원 0건)은 네 칸 중 첫 칸일
        // 뿐이고, 보고서가 지목한 "행위만 보호"는 그 지표로는 안 보인다.
        const tally = { none: 0, serviceOnly: 0, goods: 0, unknown: 0, total: 0 };
        for (const region of visibleRegions) {
          for (const item of region.items) {
            tally.total += 1;
            const key = rightsStatusOf(item).key;
            if (key === "none") tally.none += 1;
            else if (key === "service-only") tally.serviceOnly += 1;
            else if (key === "goods") tally.goods += 1;
            else tally.unknown += 1;
          }
        }
        const seg = (key, value) => value > 0 ? `<i class="seg seg-${key}" style="flex:${value}"></i>` : "";
        return `<section class="rights-board" aria-label="권리 상태">
          <div class="rights-board-head"><strong>${esc(displayRegionName(state.municipality || state.province || "전국"))} 권리 상태</strong><span>지역 × 특산품 ${number(tally.total)}개</span></div>
          <div class="rights-board-bar" role="img" aria-label="무권리 ${tally.none}개, 행위만 보호 ${tally.serviceOnly}개, 상품류 보유 ${tally.goods}개, 권리 내용 미확인 ${tally.unknown}개">${seg("none", tally.none)}${seg("service-only", tally.serviceOnly)}${seg("goods", tally.goods)}${seg("unknown", tally.unknown)}</div>
          <ul class="rights-board-legend">
            <li class="seg-none"><b>${number(tally.none)}</b><span>무권리</span><small>출원 0건 · 권리화 1순위</small></li>
            <li class="seg-service-only"><b>${number(tally.serviceOnly)}</b><span>행위만 보호</span><small>서비스류만 · 제품 권리 없음</small></li>
            <li class="seg-goods"><b>${number(tally.goods)}</b><span>상품류 보유</span><small>파는 물건에 권리 있음</small></li>
            <li class="seg-unknown"><b>${number(tally.unknown)}</b><span>권리 내용 미확인</span><small>지정상품 미확인 · 실사 필요</small></li>
          </ul>
          <p class="rights-board-note">출원 건수만으로는 &ldquo;상표는 있는데 정작 파는 물건에 권리가 없는&rdquo; 상태가 드러나지 않습니다. 지정상품의 상품류(1~34류)와 서비스류(35류 이상)로 갈라 네 칸으로 봅니다.</p>
        </section>`;
    })();
    // 2026-09-08(사용자): "요약 페이지에서 이건 좀 구석으로 보내줄래." 권리 상태 네 칸이
    // 좁은 좌측 사이드바 맨 위에 있어 세로로 길게 쌓이며 요약 첫 화면을 차지했다. 지표
    // 자체는 진단의 출발점이라 없애지 않고, 최근 동향 아래 전체 너비 띠로 내린다 —
    // 넓은 칸에서는 네 칸이 가로로 붙어 훨씬 짧아진다.
    return `<section class="summary-row" aria-label="핵심 지표·지도·출원 랭킹">
    <aside class="map-insight"><h2>${esc(displayRegionName(state.municipality || state.province || "전국"))} · ${esc(mapLabels[state.mapMetric])}</h2>${insightHero}${state.province && !provinceHasRealMunicipalities(state.province) && visibleRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다. 지도에서 특정 구·군을 눌러도 같은 목록이 표시됩니다.</p>` : ""}<div class="mini-list-heading"><strong>${esc(insightListLabel)}</strong><span>최대 5개</span></div><div class="mini-list">${insightList}</div></aside>
    <div class="map-card"><div class="map-heading"><div><h2>${state.province ? `${esc(displayRegionName(state.province))} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span class="reference-chip" title="${esc(`지도 도형은 ${geometry.boundaryReference.sourceName} 제공 경계(${geometry.boundaryReference.sourceBasis})를 참고용으로 씁니다 — 제3자가 재배포하는 데이터라 향후 행정구역 개편이 지도 도형에 늦게 반영될 수 있으며, 클릭하면 항상 실제(현재) 행정구역 데이터로 연결됩니다.`)}">참고 경계 · ${esc(geometry.boundaryReference.sourceBasis.match(/\d{4}-\d{2}-\d{2}/)?.[0] || geometry.boundaryReference.sourceName)}</span></div><div class="map-toolbar"><div class="map-metrics">${Object.entries(mapLabels).map(([key, label]) => `<button type="button" data-map-metric="${key}" class="${state.mapMetric === key ? "active" : ""}" title="${esc(mapDescriptions[key])}" aria-label="${esc(`${label}: ${mapDescriptions[key]}`)}">${label}</button>`).join("")}</div>${state.province ? '<button class="map-back" id="map-back" type="button">← 전국</button>' : ""}</div><p class="map-metric-description"><strong>${mapLabels[state.mapMetric]}</strong><span>${mapDescriptions[state.mapMetric]}</span></p><div class="map-stage"><svg class="korea-map" viewBox="${activeViewBox}" role="img" aria-label="${state.province ? `${esc(displayRegionName(state.province))} 시군구 지도` : "대한민국 시도 지도"}">${shapePaths}${shapeLabels}</svg></div><div class="map-legend quantile-legend"><span><i class="legend-swatch no-data"></i>데이터 없음</span>${quantileLegendHtml(municipal ? municipalBreaks : nationalBreaks, mapValueLabel)}<strong>${mapLabels[state.mapMetric]} 5분위</strong></div></div>
    <div class="ranking-columns" aria-label="지역 주소 일치 출원·등록 랭킹">
     <div class="ranking-stack">
      <div class="ranking">
        <div class="section-heading"><div><h2>${esc(displayRegionName(state.municipality || state.province || "전국"))} 대표 특산품 랭킹</h2></div><span>TOP ${RANKING_LIMIT}</span></div>
        <div class="ranking-metric-toggle" role="tablist" aria-label="출원·등록 전환">
          <button type="button" role="tab" aria-selected="${state.summaryRankingMetric !== "registration"}" data-summary-ranking-metric="application" class="${state.summaryRankingMetric !== "registration" ? "active" : ""}">출원</button>
          <button type="button" role="tab" aria-selected="${state.summaryRankingMetric === "registration"}" data-summary-ranking-metric="registration" class="${state.summaryRankingMetric === "registration" ? "active" : ""}">등록</button>
          ${state.summaryRankingMetric === "registration" ? csvDownloadButtonHtml("summaryRegistrationRanking") : csvDownloadButtonHtml("summaryApplicationRanking")}
        </div>
        <div class="ranking-table-wrap"><table class="ranking-table"><thead><tr><th scope="col">순위</th><th scope="col">지역</th><th scope="col">대표 특산품</th><th scope="col">${state.summaryRankingMetric === "registration" ? "등록 완료" : "출원 확인"}</th></tr></thead><tbody>${
          state.summaryRankingMetric === "registration"
            ? registrationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(displayRegionName(region.region))}</td><td${officialNoticeName(item) ? ` title="${esc(`고시명칭 ${item.noticeName}${item.niceClass ? ` · NICE ${item.niceClass}류` : ""}`)}"` : ""}>${esc(label)}</td><td>${number(item.metrics.registeredTrademarkCount.value)}건</td></tr>`).join("")
            : applicationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => `<tr><td>${index + 1}</td><td>${esc(displayRegionName(region.region))}</td><td${officialNoticeName(item) ? ` title="${esc(`고시명칭 ${item.noticeName}${item.niceClass ? ` · NICE ${item.niceClass}류` : ""}`)}"` : ""}>${esc(label)}</td><td>${number(item.metrics.uniqueTrademarkCount.value)}건</td></tr>`).join("")
        }${(state.summaryRankingMetric === "registration" ? registrationRankingRows : applicationRankingRows).length === 0 ? `<tr><td colspan="4" class="empty">이 범위에는 ${state.summaryRankingMetric === "registration" ? "등록" : "출원"} 확인 항목이 없습니다.</td></tr>` : ""}</tbody></table></div>
      </div>
     </div>
    </div>
    </section>
    <section class="summary-recent">
      <div class="section-heading"><div><h2>최근 동향</h2></div></div>
      <p class="leader-scope-note">전국 키워드 검색 기준 — 위 지도·랭킹의 <strong>지역 확인 건수와는 다른 모집단</strong>입니다.</p>
      ${regionTrendHtml({ region: "전국", items: regionalRegions.flatMap((region) => region.items) }, "연도별 출원·등록 추이", "전국 · 실제 출원일자·등록일자 기준", { prominent: true, adjustable: true, emptyLabel: "아직 연도별 출원 데이터가 수집되지 않았습니다." })}
      ${leaderboardHtml()}
    </section>
    ${metricsHtml}
    `;
  }

  // 이슈 #118: 최근 출원·등록 동향 리더보드. Dashboard.tsx의 leaderboard useMemo와 동일.
  function computeLeaderboard() {
    const end = leaderEndMonth(snapshot.generatedAt);
    const windowKeys = monthWindowKeys(end, state.leaderMonths);
    const priorEndDate = new Date(end.year, end.monthIndex0 - state.leaderMonths, 1);
    const priorKeys = monthWindowKeys({ year: priorEndDate.getFullYear(), monthIndex0: priorEndDate.getMonth() }, state.leaderMonths);
    const minBase = leaderMinBase(state.leaderMonths);
    const items = new Map();
    const cats = new Map();
    for (const region of regionalRegions) {
      for (const item of region.items) {
        const app = sumMonthCounts(item.applicationMonthCounts, windowKeys);
        const reg = sumMonthCounts(item.registrationMonthCounts, windowKeys);
        const priorApp = sumMonthCounts(item.applicationMonthCounts, priorKeys);
        const priorReg = sumMonthCounts(item.registrationMonthCounts, priorKeys);
        if (!app && !reg && !priorApp && !priorReg) continue;
        const label = officialItemLabel(item);
        if (label) {
          const row = items.get(label) || { name: label, category: item.category || null, app: 0, reg: 0, priorApp: 0, priorReg: 0 };
          row.app += app; row.reg += reg; row.priorApp += priorApp; row.priorReg += priorReg;
          if (!row.category && item.category) row.category = item.category;
          items.set(label, row);
        }
        if (item.category) {
          const cat = cats.get(item.category.label) || { label: item.category.label, code: item.category.code, app: 0, reg: 0, priorApp: 0, priorReg: 0 };
          cat.app += app; cat.reg += reg; cat.priorApp += priorApp; cat.priorReg += priorReg;
          cats.set(item.category.label, cat);
        }
      }
    }
    const itemList = [...items.values()];
    const metricValue = (row) => state.leaderMetric === "application" ? row.app : row.reg;
    const topItems = itemList.filter((row) => metricValue(row) > 0).sort((a, b) => metricValue(b) - metricValue(a) || a.name.localeCompare(b.name, "ko-KR")).slice(0, LEADER_LIMIT);
    const topCategories = [...cats.values()].filter((row) => metricValue(row) > 0).sort((a, b) => metricValue(b) - metricValue(a) || a.label.localeCompare(b.label, "ko-KR"));
    const categoryTotal = topCategories.reduce((sum, row) => sum + metricValue(row), 0);
    // 2026-09-09(사용자): "우측에 출원/등록 토글 누를 때 맨 처음 표는 출원 급증 품목 →
    // 등록 급증 품목으로 바뀌지 않네." 옆의 두 카드는 metricValue로 토글을 따랐는데 급증만
    // row.app에 박혀 있었다 — 등록으로 바꿔도 출원 급증이 그대로 떠 세 카드가 서로 다른
    // 기준을 말하고 있었다. priorReg는 이미 집계하고 있으므로 같은 방식으로 고른다.
    const surgingBy = (current, prior) => itemList
      .filter((row) => current(row) >= minBase && current(row) > prior(row))
      .map((row) => {
        const fresh = prior(row) < Math.max(1, minBase / 3);
        return { ...row, fresh, growth: fresh ? Infinity : current(row) / prior(row), delta: current(row) - prior(row), currentValue: current(row), priorValue: prior(row) };
      })
      .sort((a, b) => (b.growth - a.growth) || (b.delta - a.delta) || a.name.localeCompare(b.name, "ko-KR"))
      .slice(0, LEADER_LIMIT);
    const surging = state.leaderMetric === "application"
      ? surgingBy((row) => row.app, (row) => row.priorApp)
      : surgingBy((row) => row.reg, (row) => row.priorReg);
    // 확장 방향 제안의 "출원이 급증한다" 문구는 토글과 무관하게 출원 기준이어야 한다.
    const surgingApplications = surgingBy((row) => row.app, (row) => row.priorApp);
    const lifetime = new Map();
    for (const region of regionalRegions) {
      for (const item of region.items) {
        const label = officialItemLabel(item);
        if (!label) continue;
        const row = lifetime.get(label) || { name: label, category: item.category || null, lifeApp: 0, lifeReg: 0 };
        for (const v of Object.values(item.applicationYearCounts || {})) row.lifeApp += v;
        for (const v of Object.values(item.registrationYearCounts || {})) row.lifeReg += v;
        lifetime.set(label, row);
      }
    }
    // 등록 수가 출원 수를 넘는 행은 데이터 아티팩트라 등록률 순위에서 제외.
    const lifetimeRows = [...lifetime.values()].filter((row) => row.lifeApp >= 20 && row.lifeReg <= row.lifeApp).map((row) => ({ ...row, rate: row.lifeApp ? row.lifeReg / row.lifeApp : 0 }));
    const conversionHigh = [...lifetimeRows].sort((a, b) => b.rate - a.rate || b.lifeApp - a.lifeApp).slice(0, LEADER_LIMIT);
    const conversionLow = [...lifetimeRows].sort((a, b) => a.rate - b.rate || b.lifeApp - a.lifeApp).slice(0, LEADER_LIMIT);
    return { windowKeys, priorKeys, minBase, topItems, topCategories, categoryTotal, surging, surgingApplications, conversionHigh, conversionLow, itemCount: itemList.length };
  }
  // 이슈 #118: 별도 탭 대신 요약 "최근 동향" 묶음 안에 compact로.
  function leaderboardHtml() {
    const lb = computeLeaderboard();
    if (lb.itemCount === 0) return "";
    const metricWord = state.leaderMetric === "application" ? "출원" : "등록";
    const winStamp = `${lb.windowKeys[0]}_${lb.windowKeys[lb.windowKeys.length - 1]}`;
    currentCsvExporters.leaderItems = () => downloadCsv(`동향_품목${metricWord}_${winStamp}`, ["순위", "품목", "유형", metricWord], lb.topItems.map((row, index) => [index + 1, row.name, row.category?.label ?? "", state.leaderMetric === "application" ? row.app : row.reg]));
    currentCsvExporters.leaderCategories = () => downloadCsv(`동향_유형${metricWord}_${winStamp}`, ["순위", "유형", metricWord, "비중"], lb.topCategories.map((row, index) => { const value = state.leaderMetric === "application" ? row.app : row.reg; return [index + 1, row.label, value, lb.categoryTotal ? `${Math.round(value / lb.categoryTotal * 100)}%` : ""]; }));
    const controls = `<div class="leader-controls">
      <div class="leader-window" role="group" aria-label="기간 선택">${LEADER_WINDOWS.map(([months, label]) => `<button type="button" data-leader-window="${months}" class="${state.leaderMonths === months ? "active" : ""}">${label}</button>`).join("")}</div>
      <div class="leader-metric" role="group" aria-label="출원·등록 기준"><button type="button" data-leader-metric="application" aria-pressed="${state.leaderMetric === "application"}" class="${state.leaderMetric === "application" ? "active" : ""}">출원</button><button type="button" data-leader-metric="registration" aria-pressed="${state.leaderMetric === "registration"}" class="${state.leaderMetric === "registration" ? "active" : ""}">등록</button></div>
    </div>`;
    const tag = (cat) => cat ? `<em class="leader-tag">${esc(cat.label)}</em>` : "";
    const topValue = (row) => state.leaderMetric === "application" ? row.app : row.reg;
    const topMax = lb.topItems.length ? topValue(lb.topItems[0]) : 0;
    const itemsCard = `<article class="leader-card"><div class="leader-card-head"><h4>${metricWord} 많은 품목</h4><span class="leader-card-note">TOP ${LEADER_LIMIT}</span></div>${lb.topItems.length === 0 ? '<p class="empty">해당 기간 집계가 없습니다.</p>' : `<ol class="leader-list">${lb.topItems.map((row, index) => { const value = topValue(row); return `<li><button type="button" data-goto-item="${esc(row.name)}"><span class="leader-rank">${index + 1}</span><span class="leader-name">${esc(row.name)}${tag(row.category)}</span><span class="leader-bar"><i style="width:${topMax ? Math.max(4, value / topMax * 100) : 0}%"></i></span><b class="leader-val">${number(value)}</b><small class="leader-sub"></small></button></li>`; }).join("")}</ol>`}</article>`;
    const catsCard = `<article class="leader-card"><div class="leader-card-head"><h4>${metricWord} 많은 유형</h4><span class="leader-card-note">비중</span></div>${lb.topCategories.length === 0 ? '<p class="empty">해당 기간 집계가 없습니다.</p>' : `<ol class="leader-list">${lb.topCategories.slice(0, LEADER_LIMIT).map((row, index) => { const value = state.leaderMetric === "application" ? row.app : row.reg; const share = lb.categoryTotal ? value / lb.categoryTotal : 0; return `<li><button type="button" data-goto-category="${esc(row.code || "")}"><span class="leader-rank">${index + 1}</span><span class="leader-name">${esc(row.label)}</span><span class="leader-bar"><i style="width:${Math.max(4, share * 100)}%;background:${categoryShareColor(row.label)}"></i></span><b class="leader-val">${number(value)}</b><small class="leader-sub">${percent(share)}</small></button></li>`; }).join("")}</ol>`}</article>`;
    const surgeCard = `<article class="leader-card"><div class="leader-card-head"><h4>${metricWord} 급증 품목</h4><span class="leader-card-note">직전 기간 대비</span></div>${lb.surging.length === 0 ? `<p class="empty">뚜렷한 급증 품목이 없습니다(최소 ${metricWord} ${lb.minBase}건).</p>` : `<ol class="leader-list leader-list-surge">${lb.surging.map((row, index) => `<li><button type="button" data-goto-item="${esc(row.name)}"><span class="leader-rank">${index + 1}</span><span class="leader-name">${esc(row.name)}${tag(row.category)}</span><b class="leader-val">${number(row.priorValue)}→${number(row.currentValue)}</b><small class="leader-sub">${row.fresh ? '<em class="leader-fresh">신규</em>' : `<em class="leader-growth">×${row.growth >= 10 ? Math.round(row.growth) : row.growth.toFixed(1)}</em>`}</small></button></li>`).join("")}</ol>`}</article>`;
    const convRow = (row, index, low) => `<li><button type="button" data-goto-item="${esc(row.name)}"><span class="leader-rank">${index + 1}</span><span class="leader-name">${esc(row.name)}${tag(row.category)}</span><span class="leader-bar${low ? " leader-bar-low" : ""}"><i style="width:${Math.max(4, row.rate * 100)}%"></i></span><b class="leader-val">${percent(row.rate)}</b><small class="leader-sub">${number(row.lifeReg)}/${number(row.lifeApp)}</small></button></li>`;
    const highCard = `<article class="leader-card"><div class="leader-card-head"><h4>등록률 상위</h4><span class="leader-card-note">정착이 잘 되는 품목</span></div>${lb.conversionHigh.length === 0 ? '<p class="empty">누적 출원 20건 이상 품목이 없습니다.</p>' : `<ol class="leader-list">${lb.conversionHigh.map((row, index) => convRow(row, index, false)).join("")}</ol>`}</article>`;
    const lowCard = `<article class="leader-card"><div class="leader-card-head"><h4>등록률 하위</h4><span class="leader-card-note">전환이 안 되는 품목</span></div>${lb.conversionLow.length === 0 ? '<p class="empty">누적 출원 20건 이상 품목이 없습니다.</p>' : `<ol class="leader-list">${lb.conversionLow.map((row, index) => convRow(row, index, true)).join("")}</ol>`}</article>`;
    const methodNote = `<details class="method-note"><summary>집계 기준 · CSV</summary><p>품목 순위는 고시명칭 확정 품목만 묶고(품목별 조회와 동일), 유형 순위는 유형이 매겨진 품목행 전체가 대상입니다. 급증은 최근 ${esc(monthRangeLabel(lb.windowKeys))} 출원 합을 직전 같은 길이(${esc(monthRangeLabel(lb.priorKeys))}) 기간과 비교하며 최소 출원 ${lb.minBase}건 컷오프를 둡니다. 등록률 상·하위는 최근 창이 아니라 누적(연 단위) 출원·등록으로 계산합니다 — 창 안의 등록·출원은 서로 다른 시점의 상표라 비율로 쓰기 어렵기 때문입니다.</p><div class="leader-csv-row">${csvDownloadButtonHtml("leaderItems").replace("CSV 다운로드", "품목 순위 CSV")}${csvDownloadButtonHtml("leaderCategories").replace("CSV 다운로드", "유형 순위 CSV")}</div></details>`;
    return `<div class="summary-leaderboard">
      <div class="leader-subhead"><h3>품목·유형별 최근 순위</h3>${controls}</div>
      <div class="leader-grid leader-grid-primary">${surgeCard}${itemsCard}${catsCard}</div>
      <div class="leader-subhead leader-subhead-minor"><h3>출원 대비 등록 전환</h3><span>누적 기준 · 출원 20건 이상 · 브랜드 정착/보호 전략 검토</span></div>
      <div class="leader-grid leader-grid-secondary">${highCard}${lowCard}</div>
      ${methodNote}
    </div>`;
  }

  function applicationsScreen() {
    const municipal = state.province ? geometry.municipalities[state.province] : null;
    const activeViewBox = municipal?.viewBox || geometry.viewBox;
    const activeShapes = municipal?.items || geometry.provinces;
    const areaRegions = state.province ? regionalRegions.filter((region) => region.sido === state.province && (!state.municipality || region.sigungu === state.municipality || (isUnclassifiedRegion(region) && !provinceHasRealMunicipalities(state.province)))) : regionalRegions;
    const area = specialtyCoverage(areaRegions);
    const areaName = displayRegionName(state.municipality || state.province || "전국");
    const mapLabelsHtml = mapLabelMarkup(activeShapes, Boolean(municipal));
    const coverageNationalBreaks = quantileBreaks(geometry.provinces.map((shape) => provinceValue(shape.name, "applicationCoverage")));
    const coverageMunicipalBreaks = municipal ? quantileBreaks(municipal.items.map((shape) => regionValue(findMunicipalityRegion(state.province, shape.name), "applicationCoverage"))) : [];
    const shapePaths = municipal ? municipal.items.map((shape) => { const region = findMunicipalityRegion(state.province, shape.name); const value = regionValue(region, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape ${state.municipality === shape.name ? "selected" : ""}" style="fill:${fill(value, coverageMunicipalBreaks)}" tabindex="0" role="button" data-municipality="${esc(shape.name)}" aria-label="${esc(displayRegionName(shape.name))} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(displayRegionName(shape.name))} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("") : geometry.provinces.map((shape) => { const value = provinceValue(shape.name, "applicationCoverage"); return `<path d="${shape.d}" class="map-shape" style="fill:${fill(value, coverageNationalBreaks)}" tabindex="0" role="button" data-province="${esc(shape.name)}" aria-label="${esc(displayRegionName(shape.name))} 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}"><title>${esc(displayRegionName(shape.name))} · 특산품 출원율 ${mapValueLabel(value, "applicationCoverage")}</title></path>`; }).join("");
    const breakdown = (state.province ? areaRegions.map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region })) : [...provinceStats.keys()].map((province) => ({ key: province, label: province, regions: snapshot.regions.filter((region) => region.sido === province), region: null }))).map((row) => ({ ...row, coverage: specialtyCoverage(row.regions), items: row.regions.flatMap((region) => region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) }))) })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
    const listedItemCount = breakdown.reduce((sum, row) => sum + row.items.length, 0);
    // 이슈 #136(2026-09-07): 지자체 목록은 선택과 무관하게 "도 전체" 기준으로 만든다.
    // breakdown은 state.municipality로 이미 좁혀진 목록이라, 시군구를 하나 고르는 순간
    // 목록이 그 한 곳으로 줄어 다른 시군구로 옮겨갈 방법이 없었다.
    const provinceRows = state.province
      ? snapshot.regions.filter((region) => region.sido === state.province).map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region, coverage: specialtyCoverage([region]), items: region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) })) }))
      : [];
    const sortCoverageRows = (rows) => {
      const copy = [...rows];
      if (state.regionSort === "gap") copy.sort((a, b) => coverageGap(b.coverage) - coverageGap(a.coverage) || b.coverage.total - a.coverage.total || a.label.localeCompare(b.label, "ko-KR"));
      else if (state.regionSort === "coverage") copy.sort((a, b) => (b.coverage.rate ?? -1) - (a.coverage.rate ?? -1));
      else if (state.regionSort === "total") copy.sort((a, b) => b.coverage.total - a.coverage.total);
      else if (state.regionSort === "applied") copy.sort((a, b) => b.coverage.applied - a.coverage.applied);
      else copy.sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
      return copy;
    };
    currentCsvExporters.coverageDirectory = () => downloadCsv(`지역별집계_${areaName}_${csvDateStamp(dashboardUpdatedAt)}`, ["지역", "특산품 수", "출원 확인", "출원율"], breakdown.map((row) => [displayRegionName(row.label), row.coverage.total, row.coverage.applied, percent(row.coverage.rate)]));
    // 이슈 #117 코멘트(2026-09-03): 도 단위 시군구 미지정 행("경기도" 자체)과 실제 시군구
    // 카드(가평군 등)를 나란한 카드로 보여주면 헷갈린다는 지적 — 도 단위 항목은 별도 표시,
    // 실제 시군구 카드는 토글(펼치기) 뒤로 숨긴다.
    // UI 검토(#136) 01번: 특산품이 많은 카드(광역 전체 등)는 목록을 기본 접어 문서 높이·포커스
    // 요소 수를 줄인다(React 쪽과 동일한 임계값 20).
    const SPECIALTY_LIST_COLLAPSE_THRESHOLD = 20;
    const coverageCardHtml = (row) => {
      const specialtyButtonsHtml = row.items.map(({ region, item, label }) => { const status = specialtyFilingStatus(item); return `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span>${esc(state.province ? label : `${region.sigungu || displayRegionName(region.region)} / ${label}`)}</span><small class="specialty-status ${status.filed ? "filed" : "unfiled"}">${esc(status.label)}</small></button>`; }).join("");
      const specialtyListHtml = row.items.length > SPECIALTY_LIST_COLLAPSE_THRESHOLD
        ? `<details class="coverage-specialty-toggle"><summary><span>특산품 ${number(row.items.length)}개 보기</span><small>클릭하면 펼쳐집니다</small></summary><div class="coverage-specialty-list">${specialtyButtonsHtml}</div></details>`
        : `<div class="coverage-specialty-list">${specialtyButtonsHtml}</div>`;
      return `<article class="coverage-region-card ${state.municipality && row.label === state.municipality ? "selected" : ""}"><div class="coverage-region-head"><div><strong>${esc(displayRegionName(row.label))}</strong><small>특산품 ${number(row.coverage.total)}개</small></div><div class="coverage-region-summary">${coverageGap(row.coverage) ? `<span class="coverage-gap-flag" title="수집된 특산품 중 출원이 확인되지 않은 수">공백 ${number(coverageGap(row.coverage))}개</span>` : ""}<span>출원 확인 특산품 ${number(row.coverage.applied)}개</span><b>${percent(row.coverage.rate)}</b></div>${!state.province ? `<button type="button" data-province="${esc(row.label)}">지도에서 보기</button>` : ""}</div>${specialtyListHtml}</article>`;
    };
    // UI 검토(3차, 2026-09-06) S1: 전국 뷰(검색 없음) 전용 압축 목록 — 지역명·건수만, 특산품
    // 버튼은 그 도를 선택한 뒤에만 그린다(P2: 목록은 고르는 장치).
    const coverageListRowHtml = (row) => `<button type="button" class="coverage-region-list-row" data-province="${esc(row.label)}"><strong>${esc(displayRegionName(row.label))}</strong><span>특산품 ${number(row.coverage.total)}개</span>${coverageGap(row.coverage) ? `<span class="coverage-gap-flag" title="수집된 특산품 중 출원이 확인되지 않은 수">공백 ${number(coverageGap(row.coverage))}개</span>` : ""}<span>출원 확인 ${number(row.coverage.applied)}개</span><b>${percent(row.coverage.rate)}</b></button>`;
    const compositionRows = [...provinceStats.entries()].filter(([, stat]) => stat.trademarks > 0).sort((a, b) => b[1].trademarks - a[1].trademarks).slice(0, 10);
    const compositionMax = Math.max(1, ...compositionRows.map(([, stat]) => stat.trademarks));
    // 이슈 #119: 전국 지도는 요약 탭에 이미 있어(같은 selectedProvince 상태 공유) 이 화면의
    // 기본(전국) 뷰에서는 중복이라 뺀다 — 지도는 시도/시군구를 실제로 좁혀 볼 때만 보여주고,
    // 전국 비교는 구성 순위표를 중심으로 한다.
    const compositionHtml = state.province ? "" : `<section class="province-composition"><div class="section-heading"><div><h2>광역별 상표 출원·등록 구성</h2></div><span>지역 주소 일치 출원 상위 10개</span></div><div class="composition-list">${compositionRows.map(([province, stat], index) => `<button type="button" data-province="${esc(province)}"><span class="composition-rank">${index + 1}</span><strong>${esc(displayRegionName(province))}</strong><span class="composition-bar"><i style="width:${stat.trademarks / compositionMax * 100}%"><b style="width:${stat.trademarks ? stat.registered / stat.trademarks * 100 : 0}%"></b></i></span><small>출원 ${number(stat.trademarks)} · 등록 ${number(stat.registered)}</small></button>`).join("")}</div><p class="composition-legend"><i></i>출원 <b></b>등록</p><button type="button" class="strategy-jump-link composition-map-link" data-goto-tab="summary">지도로 보기(요약) →</button></section>`;
    const trendItems = areaRegions.flatMap((region) => region.items);
    const trendApplicationTotals = sumYearCounts(trendItems, "applicationYearCounts");
    const trendRegisteredTotals = sumYearCounts(trendItems, "registrationYearCounts");
    const trendAllYears = [...new Set([...Object.keys(trendApplicationTotals), ...Object.keys(trendRegisteredTotals)])].map(Number).sort((a, b) => a - b);
    const trendFullStart = trendAllYears.length ? flooredTrendStart(trendAllYears) : new Date().getFullYear();
    const trendFullEnd = trendAllYears[trendAllYears.length - 1] ?? new Date().getFullYear();
    // 다른 시도로 이동해도 이전 기간 값이 트랙 밖으로 벗어나지 않도록 현재 데이터 범위에 고정한다.
    const { start: trendStart, end: trendEnd } = clampTrendRange(state.trendStartYear, state.trendEndYear, trendFullStart, trendFullEnd, { recentDefault: true });
    const trendYears = [];
    for (let year = trendStart; year <= trendEnd; year++) trendYears.push(year);
    const trendMax = Math.max(1, ...trendYears.map((year) => Math.max(trendApplicationTotals[year] || 0, trendRegisteredTotals[year] || 0)));
    const trendScale = trendScales(trendStart, trendEnd, trendMax);
    const trendHasData = trendAllYears.length > 0;
    // UI 검토(3차, 2026-09-06) 시각화 교체안 "연도별 추이": 5년 이동평균을 주 시각으로.
    const trendFullYearsContiguous = [];
    for (let year = (trendAllYears[0] ?? trendFullStart); year <= trendFullEnd; year++) trendFullYearsContiguous.push(year);
    const trendApplicationMA = movingAverageSeries(trendApplicationTotals, trendFullYearsContiguous, TREND_MOVING_AVERAGE_WINDOW);
    const trendRegisteredMA = movingAverageSeries(trendRegisteredTotals, trendFullYearsContiguous, TREND_MOVING_AVERAGE_WINDOW);
    const trendMostRecentYear = trendYears[trendYears.length - 1];
    const trendApplicationPeakYear = trendPeakYear(trendApplicationMA, trendYears);
    const trendRegistrationPeakYear = trendPeakYear(trendRegisteredMA, trendYears);
    const trendApplicationMarkerYears = [...new Set([trendApplicationPeakYear, trendMostRecentYear].filter((year) => year !== null && year !== undefined))];
    const trendRegistrationMarkerYears = [...new Set([trendRegistrationPeakYear, trendMostRecentYear].filter((year) => year !== null && year !== undefined))];
    // UI 검토(3차, 2026-09-06) 시각화 교체안 "값 확인": 값 표 토글 + CSV.
    currentCsvExporters.applicationsTrend = () => downloadCsv(`${areaName}_연도별출원등록추이_${csvDateStamp(dashboardUpdatedAt)}`, ["연도", "출원", "등록"], trendYears.map((year) => [year, trendApplicationTotals[year] || 0, trendRegisteredTotals[year] || 0]));
    const trendValueTableHtml = `<details class="trend-value-table-toggle"><summary><span>값 표로 보기</span>${csvDownloadButtonHtml("applicationsTrend")}</summary><div class="trend-value-table-wrap"><table class="trend-value-table"><thead><tr><th scope="col">연도</th><th scope="col">출원</th><th scope="col">등록</th></tr></thead><tbody>${trendYears.map((year) => `<tr><td>${year}</td><td>${number(trendApplicationTotals[year] || 0)}</td><td>${number(trendRegisteredTotals[year] || 0)}</td></tr>`).join("")}</tbody></table></div></details>`;
    const trendChartHtml = trendHasData
      ? `<div class="trend-controls"><div class="trend-presets" role="group" aria-label="추이 그래프 기간 프리셋"><button type="button" data-trend-preset="all" class="${trendStart === trendFullStart && trendEnd === trendFullEnd ? "active" : ""}">전체</button><button type="button" data-trend-preset="5" data-trend-full-end="${trendFullEnd}" class="${trendStart === trendFullEnd - 4 && trendEnd === trendFullEnd ? "active" : ""}">최근 5년</button><button type="button" data-trend-preset="3" data-trend-full-end="${trendFullEnd}" class="${trendStart === trendFullEnd - 2 && trendEnd === trendFullEnd ? "active" : ""}">최근 3년</button><button type="button" data-trend-preset="1" data-trend-full-end="${trendFullEnd}" class="${trendStart === trendFullEnd && trendEnd === trendFullEnd ? "active" : ""}">최근 1년</button></div><div class="trend-range-inputs"><label><span class="sr-only">시작 연도</span>${trendStart}<input type="number" id="trend-start-input" aria-label="시작 연도" value="${trendStart}"></label><span>~</span><label><span class="sr-only">끝 연도</span>${trendEnd}<input type="number" id="trend-end-input" aria-label="끝 연도" value="${trendEnd}"></label></div></div><div class="trend-range-slider"><span class="trend-range-label">${trendFullStart}년 – ${trendFullEnd}년 중 ${trendStart}년 – ${trendEnd}년 선택</span><div class="trend-range-track" data-full-start="${trendFullStart}" data-full-end="${trendFullEnd}"><div class="trend-range-fill" style="left:${trendHandlePercent(trendStart, trendFullStart, trendFullEnd)}%;right:${100 - trendHandlePercent(trendEnd, trendFullStart, trendFullEnd)}%"></div><button type="button" id="trend-range-handle-start" class="trend-range-handle trend-range-handle-start" role="slider" aria-label="시작 연도 조절" aria-valuemin="${trendFullStart}" aria-valuemax="${trendEnd}" aria-valuenow="${trendStart}" data-value="${trendStart}" style="left:${trendHandlePercent(trendStart, trendFullStart, trendFullEnd)}%"></button><button type="button" id="trend-range-handle-end" class="trend-range-handle trend-range-handle-end" role="slider" aria-label="끝 연도 조절" aria-valuemin="${trendStart}" aria-valuemax="${trendFullEnd}" aria-valuenow="${trendEnd}" data-value="${trendEnd}" style="left:${trendHandlePercent(trendEnd, trendFullStart, trendFullEnd)}%"></button></div></div><svg class="trend-svg" viewBox="0 0 ${TREND_CHART.width} ${TREND_CHART.height}" role="img" aria-label="${trendStart}년부터 ${trendEnd}년까지 연도별 출원·등록 건수 추이(5년 이동평균)">${[0, 0.25, 0.5, 0.75, 1].map((fraction) => { const value = Math.round(trendMax * fraction); const yPos = trendScale.y(value); return `<g><line x1="${TREND_CHART.padLeft}" x2="${TREND_CHART.width - TREND_CHART.padRight}" y1="${yPos}" y2="${yPos}" class="trend-gridline" /><text x="${TREND_CHART.padLeft - 8}" y="${yPos}" class="trend-axis-label trend-axis-y">${number(value)}</text></g>`; }).join("")}<path d="${trendLinePath(trendYears, trendApplicationMA, trendScale)}L${trendScale.x(trendEnd).toFixed(1)},${trendScale.baseY}L${trendScale.x(trendStart).toFixed(1)},${trendScale.baseY}Z" class="trend-area" /><path d="${trendLinePath(trendYears, trendRegisteredTotals, trendScale)}" class="trend-line trend-line-raw trend-line-registered-raw" /><path d="${trendLinePath(trendYears, trendApplicationTotals, trendScale)}" class="trend-line trend-line-raw trend-line-application-raw" /><path d="${trendLinePath(trendYears, trendRegisteredMA, trendScale)}" class="trend-line trend-line-registered" /><path d="${trendLinePath(trendYears, trendApplicationMA, trendScale)}" class="trend-line trend-line-application" />${trendApplicationMarkerYears.map((year) => `<circle cx="${trendScale.x(year)}" cy="${trendScale.y(trendApplicationMA[year] || 0)}" r="3.4" class="trend-point trend-point-application"><title>${year}년 출원 ${number(trendApplicationTotals[year] || 0)}건(5년 평균 ${number(Math.round(trendApplicationMA[year] || 0))}건)${year === trendApplicationPeakYear ? " · 정점" : ""}${year === trendMostRecentYear ? " · 최근" : ""}</title></circle>`).join("")}${trendRegistrationMarkerYears.map((year) => `<circle cx="${trendScale.x(year)}" cy="${trendScale.y(trendRegisteredMA[year] || 0)}" r="3.4" class="trend-point trend-point-registered"><title>${year}년 등록 ${number(trendRegisteredTotals[year] || 0)}건(5년 평균 ${number(Math.round(trendRegisteredMA[year] || 0))}건)${year === trendRegistrationPeakYear ? " · 정점" : ""}${year === trendMostRecentYear ? " · 최근" : ""}</title></circle>`).join("")}${trendApplicationPeakYear !== null && trendApplicationPeakYear !== trendMostRecentYear ? `<text x="${trendScale.x(trendApplicationPeakYear)}" y="${Math.max(11, trendScale.y(trendApplicationMA[trendApplicationPeakYear] || 0) - 22)}" class="trend-marker-label trend-marker-label-application" text-anchor="middle">정점 ${trendApplicationPeakYear}</text>` : ""}${trendMostRecentYear !== undefined ? `<text x="${trendScale.x(trendMostRecentYear)}" y="${Math.max(11, trendScale.y(trendApplicationMA[trendMostRecentYear] || 0) - 8)}" class="trend-marker-label trend-marker-label-application" text-anchor="end">${trendApplicationPeakYear === trendMostRecentYear ? "정점·최근 " : "최근 "}${number(trendApplicationTotals[trendMostRecentYear] || 0)}건</text>` : ""}${trendYearLabels(trendYears).map((year) => `<text x="${trendScale.x(year)}" y="${TREND_CHART.height - 6}" class="trend-axis-label trend-axis-x">${year}</text>`).join("")}</svg><p class="trend-legend"><span class="trend-legend-swatch trend-legend-application"></span>출원(5년 평균)<span class="trend-legend-swatch trend-legend-registered"></span>등록(5년 평균, 등록원부 보강 완료 건)<span class="trend-legend-swatch trend-legend-swatch-raw"></span>연도별 실제값</p>${trendValueTableHtml}`
      : `<p class="empty">이 범위는 아직 연도별 출원 데이터가 수집되지 않았습니다.</p>`;
    // 이슈 #119: 지역별 모드에도 품목별 카테고리 칩처럼 시도 빠른 선택 목록 + 검색창.
    // 2026-09-08 요청: 선택 범위의 품목 유형별 출원 현황 분석. 출원율 분모는 수집 특산품
    // 전체(명칭 확인·집계 대기 포함), 등록률 분모는 지역 확인 출원 건수 — 모집단이 다르다.
    const categoryStats = (() => {
      const rows = new Map();
      for (const region of areaRegions) {
        for (const item of region.items) {
          const label = item.category?.label || "미분류";
          const row = rows.get(label) || { label, total: 0, applied: 0, pending: 0, trademarks: 0, registered: 0, noRights: 0, items: new Map() };
          row.total += 1;
          const metric = item.metrics.uniqueTrademarkCount;
          // 2026-09-08(사용자): "품목 클릭하면 세부품목별 비중도 나오면 좋겠는데" — 유형 안에서
          // 어떤 품목이 그 숫자를 만들고 있는지 같은 기준으로 쪼갠다. 한 품목이 여러 지역에
          // 걸쳐 있으면 지역 수만큼 행이 있으므로 품목명으로 묶어 합산한다.
          const itemLabel = item.noticeName || item.itemName || "이름 미확인";
          const detail = row.items.get(itemLabel) || { label: itemLabel, regions: 0, applied: 0, pending: 0, trademarks: 0, registered: 0, gaps: 0 };
          detail.regions += 1;
          if (metric.availability !== "available") { row.pending += 1; detail.pending += 1; }
          else if ((metric.value || 0) > 0) {
            row.applied += 1;
            row.trademarks += metric.value || 0;
            row.registered += item.metrics.registeredTrademarkCount.value || 0;
            detail.applied += 1;
            detail.trademarks += metric.value || 0;
            detail.registered += item.metrics.registeredTrademarkCount.value || 0;
          } else { row.noRights += 1; detail.gaps += 1; }
          row.items.set(itemLabel, detail);
          rows.set(label, row);
        }
      }
      return [...rows.values()]
        .map((row) => ({ ...row, coverageRate: row.total ? row.applied / row.total : null, registrationRate: row.trademarks ? row.registered / row.trademarks : null }))
        .sort((a, b) => b.total - a.total);
    })();
    // 유형 한 줄을 펼치면 그 유형의 품목을 출원 건수 순으로 보여 준다. 막대는 유형 안에서
    // 차지하는 비중이고, 출원이 0건인 품목은 건수 대신 공백 지역 수를 적는다 — 이 화면의
    // 목적이 공백 발굴이므로 0건을 빈칸으로 두지 않는다.
    const CATEGORY_DETAIL_LIMIT = 12;
    const categoryDetailHtml = (row) => {
      const items = [...row.items.values()].sort((a, b) => b.trademarks - a.trademarks || b.regions - a.regions || a.label.localeCompare(b.label, "ko-KR"));
      const shown = items.slice(0, CATEGORY_DETAIL_LIMIT);
      const rest = items.length - shown.length;
      const max = Math.max(1, ...items.map((entry) => entry.trademarks));
      const body = shown.map((entry) => {
        const share = row.trademarks ? entry.trademarks / row.trademarks : 0;
        return `<li><span class="category-detail-name">${esc(entry.label)}</span>`
          + `<span class="category-detail-bar"><i style="width:${Math.round(entry.trademarks / max * 100)}%"></i></span>`
          + `<span class="category-detail-value">${entry.trademarks ? `${number(entry.trademarks)}건 · ${percent(share)}` : `<em class="category-detail-gap">공백 ${number(entry.gaps || entry.regions)}개 지역</em>`}</span>`
          + `<small>${number(entry.regions)}개 지역${entry.registered ? ` · 등록 ${number(entry.registered)}건` : ""}${entry.pending ? ` · 집계 대기 ${number(entry.pending)}` : ""}</small></li>`;
      }).join("");
      return `<tr class="category-detail-row"><td colspan="8"><div class="category-detail">`
        + `<div class="category-detail-head"><strong>${esc(row.label)} 세부 품목</strong>`
        + `<span>품목 ${number(items.length)}개 · 지역 확인 출원 ${number(row.trademarks)}건 기준 비중</span></div>`
        + `<ol class="category-detail-list">${body}</ol>`
        + (rest > 0 ? `<p class="screen-note">출원 건수 상위 ${number(CATEGORY_DETAIL_LIMIT)}개 표시 · 나머지 ${number(rest)}개</p>` : "")
        + `</div></td></tr>`;
    };
    // 2026-09-09(사용자 A안): 확정 표에 없는 이름은 별도 제안 파일에서 유형을 가져오되
    // provisional로 표시된다. 검토 전 제안이 섞여 있다는 사실을 표 아래에 밝힌다 —
    // 숫자만 보고 확정 분류로 읽으면 안 된다.
    const provisionalCount = areaRegions.reduce((sum, region) =>
      sum + region.items.filter((item) => item.category && item.category.provisional).length, 0);
    const categoryStatsMaxRate = Math.max(0.01, ...categoryStats.map((row) => row.coverageRate || 0));
    currentCsvExporters.categoryStats = () => downloadCsv(`유형별출원현황_${areaName}_${csvDateStamp(dashboardUpdatedAt)}`, ["유형", "수집 특산품", "출원 확인", "무권리", "집계 대기", "출원율", "지역 확인 출원", "등록", "등록률"], categoryStats.map((row) => [row.label, row.total, row.applied, row.noRights, row.pending, row.coverageRate !== null ? percent(row.coverageRate) : "", row.trademarks, row.registered, row.registrationRate !== null ? percent(row.registrationRate) : ""]));
    const categoryStatsHtml = categoryStats.length > 1 ? `<section class="category-stats"><div class="section-heading"><div><span class="coverage-directory-region">${esc(areaName)}</span><h2>품목 유형별 출원 현황</h2></div><span>유형 ${categoryStats.length}개 · 특산품 ${number(area.total)}개</span>${csvDownloadButtonHtml("categoryStats")}</div><div class="category-stats-body"><div class="tablewrap-scroll"><table class="category-stats-table"><thead><tr><th scope="col">유형</th><th scope="col">수집</th><th scope="col">출원 확인</th><th scope="col">무권리</th><th scope="col">출원율</th><th scope="col">지역 확인 출원</th><th scope="col">등록</th><th scope="col">등록률</th></tr></thead><tbody>${categoryStats.map((row) => `<tr class="category-stats-row${state.categoryStatsPick === row.label ? " open" : ""}" data-category-detail="${esc(row.label)}" tabindex="0" role="button" aria-expanded="${state.categoryStatsPick === row.label}" title="${esc(`${row.label} · 수집 ${number(row.total)}개 중 출원 확인 ${number(row.applied)}개${row.pending ? ` · 집계 대기 ${number(row.pending)}개` : ""} — 누르면 세부 품목별 비중이 열립니다`)}"><th scope="row"><i class="category-caret" aria-hidden="true"></i>${esc(row.label)}</th><td class="num">${number(row.total)}</td><td class="num">${number(row.applied)}</td><td class="num">${row.noRights ? number(row.noRights) : "—"}</td><td class="rate"><span class="rate-bar"><i style="width:${Math.round((row.coverageRate || 0) / categoryStatsMaxRate * 100)}%"></i></span><b>${row.coverageRate !== null ? percent(row.coverageRate) : "—"}</b></td><td class="num">${row.trademarks ? number(row.trademarks) : "—"}</td><td class="num">${row.registered ? number(row.registered) : "—"}</td><td class="num">${row.registrationRate !== null ? percent(row.registrationRate) : "—"}</td></tr>${state.categoryStatsPick === row.label ? categoryDetailHtml(row) : ""}`).join("")}</tbody></table></div>${state.province && !state.municipality ? `<div class="category-stats-donuts"><div class="province-category-share-grid"><article><h3>출원 비중</h3>${categoryShareDonutHtml(areaRegions.flatMap((region) => region.items), "uniqueTrademarkCount", "출원")}</article><article><h3>등록 비중</h3>${categoryShareDonutHtml(areaRegions.flatMap((region) => region.items), "registeredTrademarkCount", "등록")}</article></div></div>` : ""}</div><p class="screen-note">출원율은 수집된 특산품 중 지역 주소 일치 출원이 1건 이상 확인된 비율(분모에 명칭 확인·집계 대기 포함), 등록률은 지역 확인 출원 중 등록 완료 비율입니다 — 분모가 다르므로 두 비율을 직접 비교하지 마십시오.${provisionalCount ? ` 유형 중 <b>${number(provisionalCount)}개 행은 검토 전 제안 분류</b>입니다 — 확정 표에 없는 이름이라 사람 검토 전입니다.` : ""}</p></section>` : "";
    // 2026-09-08: 광역 × 품목 유형 교차표(전국 뷰 전용). 색은 출원율 하나만 싣는
    // 순차 단일 색 5단계이고, 값은 칸 안에 "출원 확인/수집"으로도 적어 색만으로 읽히지 않게 한다.
    const COVERAGE_STEPS = [0.2, 0.4, 0.6, 0.8];
    const coverageStepOf = (rate) => rate === null ? -1 : COVERAGE_STEPS.filter((edge) => rate >= edge).length;
    const matrixHtml = (() => {
      if (state.province) return "";
      const categories = new Map();
      const byProvince = new Map();
      for (const region of regionalRegions) {
        const province = region.sido || region.region;
        for (const item of region.items) {
          const category = item.category?.label || "미분류";
          categories.set(category, (categories.get(category) || 0) + 1);
          if (!byProvince.has(province)) byProvince.set(province, new Map());
          const cell = byProvince.get(province).get(category) || { total: 0, applied: 0 };
          cell.total += 1;
          const metric = item.metrics.uniqueTrademarkCount;
          if (metric.availability === "available" && (metric.value || 0) > 0) cell.applied += 1;
          byProvince.get(province).set(category, cell);
        }
      }
      const columns = [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
      const rows = [...byProvince.entries()].map(([province, cells]) => {
        const total = [...cells.values()].reduce((sum, c) => sum + c.total, 0);
        const applied = [...cells.values()].reduce((sum, c) => sum + c.applied, 0);
        return { province, cells, total, applied, rate: total ? applied / total : null };
      }).sort((a, b) => b.total - a.total);
      if (rows.length < 2) return "";
      currentCsvExporters.provinceCategoryMatrix = () => downloadCsv(`광역별유형별출원율_${csvDateStamp(dashboardUpdatedAt)}`, ["광역", ...columns, "합계 출원율"], rows.map((row) => [displayRegionName(row.province), ...columns.map((column) => { const cell = row.cells.get(column); return cell ? `${cell.applied}/${cell.total}` : ""; }), row.rate !== null ? percent(row.rate) : ""]));
      const head = `<tr><th scope="col">광역</th>${columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}<th scope="col">전체</th></tr>`;
      const body = rows.map((row) => `<tr><th scope="row">${esc(displayRegionName(row.province))}</th>${columns.map((column) => {
        const cell = row.cells.get(column);
        const rate = cell && cell.total ? cell.applied / cell.total : null;
        const title = cell ? `${displayRegionName(row.province)} · ${column} — 수집 ${number(cell.total)}개 중 출원 확인 ${number(cell.applied)}개 (${percent(rate)})` : `${displayRegionName(row.province)} · ${column} — 수집된 특산품 없음`;
        return `<td class="matrix-cell step-${coverageStepOf(rate)}" title="${esc(title)}">${cell ? `${cell.applied}/${cell.total}` : "—"}</td>`;
      }).join("")}<td class="matrix-cell matrix-total step-${coverageStepOf(row.rate)}">${row.rate !== null ? percent(row.rate) : "—"}</td></tr>`).join("");
      const legend = ["0~20%", "20~40%", "40~60%", "60~80%", "80~100%"].map((label, index) => `<em class="step-${index}">${label}</em>`).join("");
      return `<section class="matrix-section"><div class="section-heading"><div><h2>광역 × 품목 유형 출원율</h2></div><span>색이 진할수록 출원율이 높습니다 · 칸의 숫자는 출원 확인 / 수집</span>${csvDownloadButtonHtml("provinceCategoryMatrix")}</div><div class="tablewrap-scroll"><table class="matrix-table"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="matrix-legend"><span>출원율</span>${legend}<b>칸이 비면 그 지역에 그 유형 특산품이 수집되지 않았다는 뜻입니다</b></p></section>`;
    })();
    const provinceFilterHtml = `<div class="province-tabbar region-quick-filter" role="group" aria-label="시도 바로가기"><button type="button" data-province-filter="" class="${state.province ? "" : "active"}">전국</button>${[...geometry.provinces].sort((a, b) => compareProvince(a.name, b.name)).map((shape) => `<button type="button" data-province-filter="${esc(shape.name)}" class="${state.province === shape.name ? "active" : ""}">${esc(displayRegionName(shape.name))}</button>`).join("")}</div>`;
    const regionSearchHtml = `<div class="item-search-row"><label class="search-field explore-search"><span class="sr-only">지역 또는 품목 검색</span><input type="search" id="region-directory-search" value="${esc(state.regionQuery)}" placeholder="지역 또는 품목 검색 · 엔터로 검색"></label><label class="item-sort-field"><span class="sr-only">정렬 기준</span><select id="region-sort-select">${[["gap", "공백 많은 순"], ["name", "가나다순"], ["coverage", "출원율순"], ["total", "특산품 수순"], ["applied", "출원 확인순"]].map(([value, label]) => `<option value="${value}"${state.regionSort === value ? " selected" : ""}>${label}</option>`).join("")}</select></label></div>`;
    return `<section class="screen-section coverage-screen"><div class="explore-toolbar">${regionSearchHtml}</div>${provinceFilterHtml}<p class="screen-note">전국 16개 시도의 상표 출원·등록·추이를 한눈에 비교합니다. 위 시도 목록·지도·아래 목록에서 지역이나 품목을 누르면 그 지역 상세로 들어갑니다.</p>
      ${state.province && !provinceHasRealMunicipalities(state.province) && areaRegions.some(isUnclassifiedRegion) ? `<p class="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 ${esc(displayRegionName(state.province))} 전체로만 집계됩니다.</p>` : ""}
      <aside class="coverage-insight coverage-insight-strip"><h2>${esc(areaName)}</h2><div class="rate-hero">${rateRing(area.rate)}<div class="rate-hero-detail"><span>특산품 출원율</span><small>전체 수집 ${number(area.total)}개 중 출원 확인 ${number(area.applied)}개${area.pending ? ` · 집계 대기 ${number(area.pending)}개` : ""}</small></div></div><dl class="coverage-insight-stats"><div><dt>선택 범위</dt><dd>${state.municipality ? `${esc(state.province)} 내 시군구` : state.province ? "시군구별 특산품 항목 합산" : "전국 시군구별 특산품 항목 합산"}</dd></div><div><dt>전체 수집 특산품</dt><dd>${number(area.total)}개</dd></div><div><dt>출원 확인 특산품</dt><dd>${number(area.applied)}개</dd></div></dl></aside>
      <div class="${state.province ? "applications-compact-row solo" : "applications-compact-row national"}">
      ${compositionHtml}
      <section class="trend-chart"><div class="section-heading"><div><h2>연도별 출원·등록 추이</h2></div><span>${esc(areaName)} · 실제 출원일자·등록일자 기준</span></div>${trendChartHtml}</section>
      ${state.province ? `<section class="coverage-map-card"><div class="map-heading"><div><h2>${esc(displayRegionName(state.province))} 시군구 출원율</h2></div><div class="coverage-map-actions"><button class="map-back" id="map-back" type="button">← 전국</button></div></div><p class="map-metric-description"><strong>특산품 출원율</strong><span>지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수 · 명칭 확인·집계 대기도 분모에 포함합니다.</span></p><div class="map-stage coverage-map-stage"><svg class="korea-map coverage-map" viewBox="${activeViewBox}" role="img" aria-label="${esc(displayRegionName(state.province))} 시군구별 특산품 출원율 지도">${shapePaths}${mapLabelsHtml}</svg></div><div class="coverage-legend quantile-legend">${quantileLegendHtml(municipal ? coverageMunicipalBreaks : coverageNationalBreaks, (value) => percent(value))}<b>회색은 데이터 없음</b></div><p class="map-warning">특산품·상표 데이터 유무와 관계없이 모든 시군구 지명을 표시합니다. 지역을 선택하면 아래 목록도 함께 좁혀집니다.</p></section>` : ""}
      
      </div>
      ${matrixHtml}
      ${categoryStatsHtml}
      ${compareEmbedHtml()}
      <section class="coverage-directory"><div class="section-heading coverage-directory-heading"><div><span class="coverage-directory-region">${esc(areaName)}</span><h2>지자체별 특산품 현황</h2></div><span>특산품 ${number(listedItemCount)}개 · 출원 확인 ${number(area.applied)}개 · 출원율 ${percent(area.rate)}</span>${csvDownloadButtonHtml("coverageDirectory")}</div>${
        // 이슈 #117 코멘트(2026-09-03): 도를 클릭하면 시군구 목록이 나오기 전에 그 도 전체의
        // 특산품 유형별 출원·등록 비중을 원그래프로 먼저 보여준다(시군구 상세로 이미
        // 들어간 뒤에는 뺀다).
        ""
      }${(() => {
        const key = state.regionQuery.trim().toLocaleLowerCase("ko-KR");
        const matchesQuery = (row) => displayRegionName(row.label).toLocaleLowerCase("ko-KR").includes(key) || row.items.some(({ label }) => label.toLocaleLowerCase("ko-KR").includes(key));
        if (!state.province) {
          const rows = sortCoverageRows(key ? breakdown.filter(matchesQuery) : breakdown);
          if (rows.length === 0) return `<p class="empty">&ldquo;${esc(state.regionQuery)}&rdquo; 검색 결과가 없습니다.</p>`;
          return key
            ? `<div class="coverage-region-grid">${rows.map((row) => coverageCardHtml(row)).join("")}</div>`
            : `<div class="coverage-region-list">${rows.map((row) => coverageListRowHtml(row)).join("")}</div>`;
        }
        // 이슈 #136(2026-09-07): 품목별 조회와 같은 마스터-디테일 — 왼쪽은 늘 보이는 지자체
        // 스크롤 목록, 오른쪽은 고른 지자체 하나의 특산품 목록. 도 단위 시군구 미지정
        // 행("경기도" 자체)은 시군구와 급이 다르므로 "도 전체" 자리에서 보여준다.
        const rows = key ? provinceRows.filter(matchesQuery) : provinceRows;
        if (rows.length === 0) return `<p class="empty">&ldquo;${esc(state.regionQuery)}&rdquo; 검색 결과가 없습니다.</p>`;
        const unclassifiedRows = rows.filter((row) => row.region && isUnclassifiedRegion(row.region));
        const municipalityRows = sortCoverageRows(rows.filter((row) => !(row.region && isUnclassifiedRegion(row.region))));
        const selectedRow = state.municipality ? municipalityRows.find((row) => row.label === state.municipality) || null : null;
        const provinceWide = specialtyCoverage(snapshot.regions.filter((region) => region.sido === state.province));
        const pickerHtml = `<li><button type="button" data-municipality-clear="1" class="${selectedRow ? "" : "active"}" title="${esc(displayRegionName(state.province))} 전체 합계"><span class="item-list-name">${esc(displayRegionName(state.province))} 전체</span><b>${percent(provinceWide.rate)}</b></button></li>`
          + municipalityRows.map((row) => `<li><button type="button" data-municipality="${esc(row.label)}" class="${selectedRow && selectedRow.key === row.key ? "active" : ""}" title="특산품 ${number(row.coverage.total)}개 · 출원 확인 ${number(row.coverage.applied)}개"><span class="item-list-name">${esc(displayRegionName(row.label))}</span><b>${percent(row.coverage.rate)}</b></button></li>`).join("")
          + (municipalityRows.length === 0 ? `<li class="empty">시군구 단위로 구분된 원본 자료가 없습니다.</li>` : "");
        const unclassifiedHtml = unclassifiedRows.length > 0
          ? `<div class="coverage-unclassified-grid">${unclassifiedRows.map((row) => `<article class="coverage-region-card unclassified"><div class="coverage-region-head"><div><strong>${esc(displayRegionName(row.label))} 전체(시군구 미지정)</strong><small>특산품 ${number(row.coverage.total)}개</small></div><div class="coverage-region-summary">${coverageGap(row.coverage) ? `<span class="coverage-gap-flag" title="수집된 특산품 중 출원이 확인되지 않은 수">공백 ${number(coverageGap(row.coverage))}개</span>` : ""}<span>출원 확인 특산품 ${number(row.coverage.applied)}개</span><b>${percent(row.coverage.rate)}</b></div></div><div class="coverage-specialty-list">${row.items.map(({ region, item, label }) => { const status = specialtyFilingStatus(item); return `<button type="button" data-open-region="${esc(regionKey(region))}" data-open-item="${esc(item.specialtyId || "")}"><span>${esc(label)}</span><small class="specialty-status ${status.filed ? "filed" : "unfiled"}">${esc(status.label)}</small></button>`; }).join("")}</div></article>`).join("")}</div>`
          : "";
        const detailHtml = selectedRow
          ? coverageCardHtml(selectedRow)
          : `${unclassifiedHtml}<p class="empty">왼쪽 목록에서 시군구를 고르면 그 지역 특산품 목록이 열립니다.</p>`;
        return `<div class="item-explorer coverage-explorer"><aside class="item-list-panel"><div class="item-list-head"><strong>${esc(displayRegionName(state.province))} 지자체</strong><span>시군구 ${municipalityRows.length}곳</span></div><ul class="item-list">${pickerHtml}</ul></aside><div class="item-detail-panel coverage-detail-panel">${detailHtml}</div></div>`;
      })()}</section></section>`;
  }

  function provinceDetail(province, regions) {
    const coverage = specialtyCoverage(regions);
    const items = regions.flatMap((region) => region.items);
    const municipalities = regions.filter((region) => region.sigungu && region.sigungu !== region.sido);
    const available = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
    const applications = available.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0);
    const registrations = available.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0);
    const municipalityHtml = municipalities.length ? municipalities.map((region) => { const rowCoverage = specialtyCoverage([region]); return `<button type="button" data-region="${esc(regionKey(region))}"><strong>${esc(region.sigungu)}</strong><small>특산품 ${rowCoverage.total}개 · 출원 확인 ${rowCoverage.applied}개</small></button>`; }).join("") : '<p class="empty">시군구 단위로 구분된 원본 자료가 없습니다.</p>';
    return `<div class="detail-panel province-detail"><div class="detail-heading"><div><p class="eyebrow">광역 기본 보기</p><h2>${esc(displayRegionName(province))}</h2><p>광역 전체와 시군구 ${municipalities.length}곳의 특산품·상표 현황 합계</p></div><span class="state">광역 집계</span></div>${trendSizeControlHtml}<div class="province-detail-cols">${regionTrendHtml({ region: province, items }, "연도별 출원·등록 추이", undefined, { adjustable: true })}<div class="detail-grid province-summary-grid"><article><span>전체 수집 특산품</span><strong>${number(coverage.total)}개</strong><small>광역·시군구 지역×품목 합계</small></article><article><span>출원 확인 특산품</span><strong>${number(coverage.applied)}개</strong><small>전체 특산품 출원율 ${percent(coverage.rate)}</small></article><article><span>지역 주소 일치 출원</span><strong>${number(applications)}건</strong><small>등록 완료 ${number(registrations)}건</small></article></div></div><section class="province-category-shares"><div class="section-heading"><div><h2>특산품 유형별 출원·등록 비중</h2></div><span>광역 전체 · 지역 주소 일치 기준</span></div><div class="province-category-share-grid"><article><h3>출원 비중</h3>${categoryShareDonutHtml(items, "uniqueTrademarkCount", "출원")}</article><article><h3>등록 비중</h3>${categoryShareDonutHtml(items, "registeredTrademarkCount", "등록")}</article></div></section><details class="province-municipalities"><summary><span>세부 시군구 보기</span><small>${municipalities.length}곳 · 클릭하면 품목별 상세로 전환</small></summary><div>${municipalityHtml}</div></details></div>`;
  }
  function regionDetail(region, item) {
    // 이슈 #136 코멘트(2026-09-03) 09번: region.region은 원본 시도명을 그대로 이어붙인
    // 값이라(예: "전남광주통합특별시 영광군") displayRegionName의 통합권역 표기 치환을
    // 안 거친다 — 화면에 그대로 노출하면 같은 지역이 다른 화면 표기와 달라 보인다.
    const displayName = displayRegionName(region.region);
    const heading = `<div class="detail-heading"><div><h2>${esc(displayName)}</h2><p>법정동코드 ${esc(region.regionCode || "미확정")}</p></div><span class="state state-${esc(region.dataState)}">${esc(labels[region.dataState] || region.dataState)}</span></div>`;
    if (!item) {
      return `<div class="detail-panel">${heading}<div class="item-tabs" role="tablist"></div><p class="empty">이 지역에는 등록된 특산품 데이터가 없습니다.</p></div>`;
    }
    const regionGoodsConfirmed = item.matchingBasis === "raw_item_goods_matched";
    const verifiedExamples = registrationExamples.entries.find((entry) => entry.region === region.region && entry.specialtyId === item.specialtyId)?.examples || [];
    const examples = [...verifiedExamples, ...(item.trademarkExamples || [])]
      .filter((example, index, rows) => rows.findIndex((row) => row.applicationNumber === example.applicationNumber) === index);
    // 2026-09-08(사용자 "표장은 예시로 최근 출원 10건만 보여주는 거야? 전체 지역에서?
    // 아님 지역별로?"): 예시 10건은 지역×품목 행마다 뽑지만, 후보 풀이 품목명으로 돌린
    // 전국 검색 결과라 지역 확인 건이 적으면 나머지 칸이 전국 공통으로 채워진다 —
    // 소고기는 34개 지역이 사실상 같은 32건을 돌려 보고 있었다. 그런 표본으로 표장 종류나
    // 지리적표시 보유를 세면 남의 지역 상표가 이 지역 것으로 잡힌다. 지역 귀속이 필요한
    // 집계는 inside만 쓴다(어제 지역 상표 패널을 고친 것과 같은 기준).
    const localExamples = examples.filter((example) => example.applicantRegionMatch === "inside");
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
      ${regionTrendHtml(region, "지역 연도별 출원·등록 추이", `${displayName} 전체 특산품 · 연도별`, { prominent: true })}
      <div class="item-tabs word-cloud" role="tablist" aria-label="${esc(displayName)} 특산품 · 출원건수 기준 글자 크기">${(() => { const max = Math.max(1, ...region.items.map((row) => row.metrics.uniqueTrademarkCount.value || 0)); return region.items.map((row) => { const value = row.metrics.uniqueTrademarkCount.value || 0; const selected = item.specialtyId === row.specialtyId; const colorStyle = selected ? "" : `;color:${wordCloudColor(row.specialtyId || itemName(row))}`; return `<button type="button" data-region-item="${esc(row.specialtyId || "")}" aria-selected="${selected}" style="font-size:${wordCloudFontSize(value, max)}px${colorStyle}" title="${esc(itemName(row))} · 출원 ${number(value)}건">${esc(itemName(row))}</button>`; }).join(""); })()}</div>
      <div class="item-title"><div><span>이 지역의 대표 특산품</span><h3>${esc(itemName(item))}${cropBadgeHtml(item, true)}</h3><small>${esc(noticeBasis(item))}</small></div><span class="class-chip">${item.niceClass ? `NICE ${esc(item.niceClass)}` : "NICE 분류 미확정"}</span></div>
      <div class="metric-reading-note"><strong>출원 건수 기준</strong><p><b>${esc(region.sigungu || displayName)} ${esc(itemName(item))} 출원</b>은 출원인 주소가 ${esc(displayName)}으로 확인된 고유 출원 수입니다. 전국 검색 후보나 주소가 확인되지 않은 출원은 포함하지 않습니다.</p></div>
      ${item.regionalEvidence?.length ? `<div class="metric-reading-note"><strong>공식 생산 주산지 근거</strong><p>${esc(item.regionalEvidence.map((evidence) => `${evidence.region} (${evidence.referenceYear})`).join(", "))} · 임산물생산조사 기준입니다. ${item.regionalEvidence.some((evidence) => evidence.regionalMetricEligible) ? "출원인 주소를 주산지와 대조해 지역 상표 통계에 반영했습니다." : "검색 범위가 완료된 뒤 지역 상표 통계에 반영합니다."}</p></div>` : ""}
      <div class="detail-grid">
        <article><span>${esc(region.sigungu || displayName)} ${esc(itemName(item))} 출원</span><strong>${regionalAvailable ? `${number(localCount)}건${regionalPartial ? "+" : ""}` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? (regionalPartial ? `출원인 주소가 ${esc(displayName)}으로 확인된 최소값 — 전국 검색이 상한에 도달해 더 있을 수 있습니다` : `출원인 주소가 ${esc(displayName)}으로 확인된 고유 출원`) : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${esc(pendingReason)}`}</small>${item.outputHitCap ? `<small class="output-hit-cap-note" title="전국 검색 결과가 저장 용량 한도를 넘어 일부만 저장했습니다. 실제로 확인된 전체 건수 중 이만큼만 상세 데이터로 보존합니다.">전국 검색 ${number(item.outputHitCap.collectedCount)}건 수집(저장 상한 ${number(item.outputHitCap.cap)}건)</small>` : ""}</article>
        <article><span>등록 건수</span><strong>${regionalAvailable ? `${number(registeredCount)}건` : "지역별 집계 대기"}</strong><small>${regionalAvailable ? localCount ? `출원 ${number(localCount)}건 중 등록 ${number(registeredCount)}건 · 등록률 ${percent(item.metrics.registrationRate.value)}` : "출원 0건 · 등록률 계산 불가" : "지역 출원 건수가 확인된 뒤 계산합니다."}</small></article>
        ${typeof item.metrics.localApplicantCount?.value === "number" ? `<article><span>권리주체</span><strong>${number(item.metrics.localApplicantCount.value)}곳</strong><small>${typeof item.metrics.producerApplicantShare?.value === "number" ? `생산자단체·지자체 ${percent(item.metrics.producerApplicantShare.value)}` : "지역 확인된 출원의 고유 출원인 수"}</small></article>` : ""}${(() => { const rights = rightsStatusOf(item); return `<article class="rights-status rights-status-${rights.key}"><span>권리 상태</span><strong>${esc(rights.label)}</strong><small>${esc(rights.note)}</small></article>`; })()}<article><span>출원 여부</span><strong>${regionalAvailable ? localCount > 0 ? "출원 확인" : "출원 없음" : "집계 대기"}</strong><small>${regionalAvailable ? localCount > 0 ? "특산품 출원율 계산에서 출원 확인 1개로 집계" : "전체 특산품 수에는 포함되며 출원 확인 수에는 포함되지 않음" : "전체 특산품 수에는 포함되며 출원 확인 전까지 분자에는 넣지 않습니다"}</small></article>
      </div>
      ${localExamples.length > 0 ? `<div class="mark-type-row" title="${esc(MARK_TYPE_HINT)}"><strong>표장 종류</strong><span class="mark-type-chips">${markTypeBreakdown(localExamples).map(([label, count]) => `<em class="mark-type-chip mark-type-${markTypeChipClass(label)}">${esc(label)} ${number(count)}</em>`).join("")}</span><small>이 지역 확인 출원 ${number(localExamples.length)}건 표본에서 확인 · 전체 건수가 아닙니다</small></div>` : examples.length > 0 ? `<div class="mark-type-row"><strong>표장 종류</strong><small>이 지역 주소로 확인된 출원이 표본에 없어 표장 종류를 셀 수 없습니다 — 표본 ${number(examples.length)}건은 전국 검색 후보라 이 지역 것이 아닙니다.</small></div>` : ""}${giHoldingsHtml(item, localExamples)}${item.businessFlow ? nationwideFlowCardHtml(item.businessFlow, itemName(item) || "이 품목") + expansionSuggestionsHtml(item.businessFlow, itemName(item) || "이 품목") : ""}
      ${item.briefing && item.briefing.sentences.length > 0 ? `${businessStrategyCardHtml(item.briefing, "비즈니스 확장 전략", "", nationwideReach(item))}${businessStrategyDisclaimerHtml(item.briefing.templateVersion)}` : ""}
      <section class="trademark-examples"><div class="example-heading"><strong>${esc(itemName(item))} 등록 사례</strong><span>등록 ${number(registeredCount)}건 중 사례 ${number(registeredExamples.length)}건</span></div>${registeredExamples.length ? `<div class="example-list">${registeredExamples.map((example) => `<article><div><strong>${esc(example.title || "상표명 미기록")}</strong><small>${[example.applicationNumber, example.applicant, example.niceClass ? `${example.niceClass}류` : null].filter(Boolean).map(esc).join(" · ")}</small></div><span class="goods-chip">등록</span>${giMarkLabel(example.applicationNumber) ? `<span class="gi-mark-chip">${esc(giMarkLabel(example.applicationNumber))}</span>` : ""}${goodsStageLabel(example.goodsEvidence) ? `<span class="goods-stage-chip" title="${esc("지정상품 명칭으로 판정한 밸류체인 단계입니다. 류가 아니라 지정상품 기준입니다.")}">${esc(goodsStageLabel(example.goodsEvidence))}</span>` : ""}${example.goodsEvidence.length > 0 ? `<p>지정상품: ${example.goodsEvidence.map((row) => `${esc(row.designatedProductName || "명칭 미기록")}${row.classCode ? ` (${esc(row.classCode)}류)` : ""}`).join(", ")}</p>` : ""}<small class="example-region-note">지역 주소 일치</small>${example.applicationNumber ? `<button type="button" class="kipris-link" title="KIPRIS에서 이 상표(출원번호 ${esc(example.applicationNumber)})의 검색 결과를 새 창으로 엽니다" data-kipris-application="${esc(example.applicationNumber)}">KIPRIS에서 결과 보기 ↗</button>` : ""}</article>`).join("")}</div>` : '<p class="empty">등록 항목이 확인되지 않았습니다.</p>'}</section>
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
    return `<section class="screen-section region-detail-screen"><div class="explore-toolbar"><button type="button" class="drill-back" data-goto-tab="applications">← 전국 시도 비교로</button></div><p class="screen-note">선택한 지역의 특산품·상표를 시도 → 시군구 → 품목 순으로 파고듭니다. 다른 시도를 눌러 바로 이동할 수도 있습니다.</p>${provinceTabbarHtml}<section class="workspace"><aside class="region-panel"><div class="panel-heading"><div><h2>지자체 목록</h2></div><span>시도 ${grouped.length}곳 · 시군구 ${rows.length}곳</span></div><label class="search-field"><span class="sr-only">지역 또는 품목 검색</span><input id="region-search" value="${esc(state.query)}" placeholder="지역 또는 품목 검색 · 엔터로 검색"></label><div class="province-list">${groupsHtml || '<p class="empty">검색 결과가 없습니다.</p>'}</div></aside>${detail}</section></section>`;
  }
  // 2026-09-08(사용자): "특산품의 상표 출원 공백을 발굴하기 위한 진단 목적에 맞게 결과
  // 정리해줘." 이 대시보드가 답해야 할 질문은 "무엇이 많은가"가 아니라 "무엇이 비어
  // 있는가"다. 두 목록의 기본 정렬을 공백 우선으로 바꾸고 공백 수를 목록에 적는다.
  //
  // 품목의 공백 = 그 품목이 있는 지역 중 "집계가 끝났는데 확인된 출원이 0건"인 지역 수.
  // 집계 대기 지역은 공백인지 아직 알 수 없으므로 세지 않는다.
  const itemGapRegions = (row) => row.availableRegions.filter((region) => !(row.regionCounts[region] > 0)).length;
  // 지역의 공백 = 수집된 특산품 중 출원이 확인되지 않은 수.
  const coverageGap = (coverage) => Math.max(0, coverage.total - coverage.applied);
  function itemRows() {
    const rows = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, category: item.category || null, searchTerms: [], trademarks: 0, trademarksDisplay: 0, hasProvisional: false, registered: 0, available: 0, availableRegions: [], regions: [], regionCounts: {}, provinceCounts: {}, matchedItems: [], regionItems: [] };
      row.searchTerms.push(item.itemName, item.noticeName, name);
      row.regionItems.push({ region, item });
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
      // 공백만 보기 — 집계가 끝난 지역 중 출원 0건인 곳이 하나라도 있는 품목.
      .filter((row) => !state.itemGapOnly || itemGapRegions(row) > 0)
      .sort((a, b) => b.trademarks - a.trademarks);
  }
  // 이슈 #109(품목 카테고리화): 실제로 데이터에 등장하는 유형만 필터 버튼으로 보여준다.
  function availableCategories() {
    const seen = new Map();
    snapshot.regions.forEach((region) => region.items.forEach((item) => { if (item.category) seen.set(item.category.code, item.category.label); }));
    return [...seen.entries()].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  }
  // 이슈 #119(품목별 조회 개편): 한 화면에 여러 품목 상세를 펼치지 않고, 왼쪽 목록에서
  // 하나를 고르면 오른쪽에 그 품목만 상세로 보여준다.
  // 2026-09-08 요청: 품목별 화면에서 지역 칩을 누르면 그 지역의 출원 상표를 바로 본다.
  const regionTrademarkPanelHtml = (row) => {
    const picked = (row.regionItems || []).filter((entry) => entry.region.region === state.itemRegionPick);
    if (!picked.length) return "";
    // 2026-09-08(사용자 "여기서 보여주는 상표가 해당 지역 출원건이 아닌 거 같아" /
    // "공백지역에서도 상표가 보여져"): trademarkExamples는 전국 검색 결과 표본이라 그 지역과
    // 무관한 출원이 섞여 있고, 같은 품목이면 여러 지역 행이 같은 표본을 그대로 공유한다 —
    // 울산 소고기와 청양 소고기가 같은 출원번호를 보여주고 있었고, 청양은 지역 확인 출원이
    // 0건인 공백인데도 10건이 떴다. 이 패널의 제목은 "지역 확인 출원"이므로 출원인 주소가
    // 그 지역으로 확인된 건(inside)만 남긴다. 두 모집단을 섞지 않는 것이 이 대시보드의 기본
    // 규칙이다(tradeDisplay 주석).
    const local = picked.reduce((sum, entry) => sum + (entry.item.metrics.uniqueTrademarkCount.value || 0), 0);
    const reg = picked.reduce((sum, entry) => sum + (entry.item.metrics.registeredTrademarkCount.value || 0), 0);
    const seen = new Set();
    const allExamples = picked.flatMap((entry) => entry.item.trademarkExamples || []).filter((example) => {
      const key = example.applicationNumber || example.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const examples = allExamples.filter((example) => example.applicantRegionMatch === "inside");
    const unrelatedCount = allExamples.length - examples.length;
    const listHtml = examples.length
      ? `<ul class="region-trademark-list">${examples.slice(0, 12).map((example) => {
          const mark = markTypeOf(example.applicationNumber);
          const goods = (example.goodsEvidence || []).slice(0, 3).map((g) => `${g.designatedProductName}${g.classCode ? ` (${g.classCode}류)` : ""}`).join(", ");
          return `<li><span class="region-trademark-name">${esc(example.title || "상표명 미기록")}</span>`
            + `<span class="region-trademark-status ${example.statusCategory === "registered" ? "registered" : "pending"}">${esc(example.applicationStatus || "상태 미기록")}</span>`
            + (mark && mark !== "일반상표" ? `<span class="gi-mark-chip">${esc(mark)}</span>` : "")
            + (goods ? `<small class="region-trademark-goods">${esc(goods)}</small>` : "")
            + (example.applicationNumber ? `<button type="button" class="kipris-link" data-kipris-application="${esc(example.applicationNumber)}">KIPRIS ↗</button>` : "")
            + `</li>`;
        }).join("")}</ul>`
      : local
        ? `<p class="empty">이 지역 확인 출원 ${number(local)}건이 있으나, 예시 표본(품목별 최근 ${number(allExamples.length)}건)에는 포함되지 않았습니다.</p>`
        : `<p class="empty"><b>이 지역 주소로 확인된 출원이 없습니다</b> — 공백 지역입니다.</p>`;
    return `<section class="region-trademark-panel"><div class="region-trademark-head">`
      + `<div><strong>${esc(displayRegionName(state.itemRegionPick))} · ${esc(row.name)}</strong>`
      + `<small>지역 확인 출원 ${number(local)}건 · 등록 ${number(reg)}건${local ? ` · 등록률 ${percent(reg / local)}` : ""}</small></div>`
      + `<button type="button" id="region-trademark-close" class="region-trademark-close">닫기</button></div>${listHtml}`
      + (examples.length > 12 ? `<p class="screen-note">예시 ${number(examples.length)}건 중 12건 표시</p>` : "")
      + (unrelatedCount ? `<p class="screen-note">같은 품목의 전국 검색 후보 ${number(unrelatedCount)}건은 출원인 주소가 이 지역으로 확인되지 않아 <b>표시하지 않습니다</b> — 다른 모집단입니다.</p>` : "")
      + `</section>`;
  };
  function itemDetailHtml(row) {
    if (!row) return '<p class="empty">왼쪽 목록에서 품목을 선택하세요.</p>';
    const decidedRegions = row.availableRegions.length;
    const pendingRegions = Math.max(0, row.regions.length - decidedRegions);
    const nationwideOnly = Math.max(0, row.trademarksDisplay - row.trademarks);
    const statusClass = pendingRegions === 0 ? "complete" : decidedRegions ? "partial" : "pending";
    const statusLabel = pendingRegions === 0 ? "전체 지역 판정 완료" : decidedRegions ? "일부 지역 판정" : "지역 집계 대기";
    const registrationRate = decidedRegions && row.trademarks ? row.registered / row.trademarks : null;
    // 2026-09-08(사용자 "이 중에 공백지역은 안 보이는 건가?"): 칩은 출원 건수로 크기만
    // 달랐고 0건 지역은 그냥 작은 칩이라, 진단의 핵심인 공백이 눈에 띄지 않았다. 집계가
    // 끝났는데 0건인 곳(공백)과 아직 집계 중인 곳(공백인지 알 수 없음)을 갈라 표시한다.
    const decidedSet = new Set(row.availableRegions);
    const chipRegions = [...row.regions].sort((a, b) => (row.regionCounts[b] || 0) - (row.regionCounts[a] || 0));
    const gapRegionCount = chipRegions.filter((region) => decidedSet.has(region) && !(row.regionCounts[region] > 0)).length;
    const pendingRegionCount = chipRegions.filter((region) => !decidedSet.has(region)).length;
    const chips = chipRegions.map((region) => {
      const value = row.regionCounts[region] || 0;
      const max = Math.max(1, ...Object.values(row.regionCounts));
      const pending = !decidedSet.has(region);
      const gap = !pending && value === 0;
      const state2 = pending ? " pending" : gap ? " gap" : "";
      const note = pending ? "집계 대기 — 공백인지 아직 알 수 없습니다" : gap ? "공백 — 확인된 출원이 없습니다" : `출원 ${number(value)}건`;
      // 공백·대기 칩은 건수로 크기를 줄이지 않는다 — 찾아야 할 대상이 가장 작게 보이면 안 된다.
      const size = gap || pending ? 15 : wordCloudFontSize(value, max);
      return `<button type="button" data-item-region="${esc(region)}" class="region-chip-button${state.itemRegionPick === region ? " active" : ""}${state2}" style="font-size:${size}px${gap || pending ? "" : `;color:${wordCloudColor(region)}`}" title="${esc(displayRegionName(region))} · ${esc(note)}">${esc(displayRegionName(region))}${gap ? '<i aria-hidden="true">공백</i>' : ""}</button>`;
    }).join("");
    const chipLegend = `${gapRegionCount ? `<em class="region-chip-tally gap">공백 ${number(gapRegionCount)}곳</em>` : ""}${pendingRegionCount ? `<em class="region-chip-tally pending">집계 대기 ${number(pendingRegionCount)}곳</em>` : ""}`;
    // 이슈 #116(2026-09-01): 마스터-디테일 개편(29fb843) 때 품목별 조회에서 빠진 비즈니스
    // 확장 흐름·전략 카드를 되살린다. 흐름은 품목 단위 전국 지표라 대표 항목 하나에서,
    // 브리핑은 공백 알림을 우선해 뽑는다.
    const flowItem = row.matchedItems.find((entry) => entry.businessFlow);
    const briefingItem = row.matchedItems.find((entry) => entry.briefing?.isGapAlert && entry.briefing.sentences?.length)
      || row.matchedItems.find((entry) => entry.briefing?.sentences?.length);
    const flowHtml = flowItem ? nationwideFlowCardHtml(flowItem.businessFlow, row.name, [...row.regions].sort((a, b) => (row.regionCounts[b] || 0) - (row.regionCounts[a] || 0)).slice(0, 3)) + expansionSuggestionsHtml(flowItem.businessFlow, row.name, computeLeaderboard().surgingApplications.some((s) => s.name === row.name)) : "";
    const briefingHtml = briefingItem ? `${businessStrategyCardHtml(briefingItem.briefing, `${row.name} 비즈니스 확장 전략`, "", nationwideReach(briefingItem))}${businessStrategyDisclaimerHtml(briefingItem.briefing.templateVersion)}` : "";
    return `<div class="item-card-head"><div><h2>${esc(row.name)}</h2><small>${row.category ? `${esc(row.category.label)} · ` : ""}${row.regions.length}개 지역에서 확인</small></div><span class="item-status ${statusClass}">${statusLabel}</span></div><details class="item-regions-detail" open><summary>전체 ${row.regions.length}개 지역 보기${chipLegend}<small>지역을 누르면 그 지역 출원 상표가 아래에 열립니다</small></summary><div class="region-chips word-cloud" aria-label="지역 · 출원건수 기준 글자 크기">${chips}</div></details>${regionTrademarkPanelHtml(row)}<div class="item-card-metrics"><div><span>지역 확인 출원</span><strong>${decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>판정 완료 ${decidedRegions}/${row.regions.length}개 지역</small></div><div><span>등록 완료</span><strong>${decidedRegions ? `${number(row.registered)}건` : "—"}</strong><small>확인 출원 중 등록 완료</small></div><div><span>등록률</span><strong class="${registrationRate !== null && registrationRate >= 0.5 ? "rate-high" : ""}">${registrationRate !== null ? percent(registrationRate) : decidedRegions ? "계산 불가" : "—"}</strong><small>${registrationRate !== null ? `${number(row.registered)}/${number(row.trademarks)}` : "지역 확인 후 계산"}</small></div></div>${flowHtml}${decidedRegions > 0 ? `${regionTrendHtml({ region: row.name, items: row.matchedItems }, "연도별 출원·등록 추이", `${row.name} · 전체 지역 합계`, { prominent: true, adjustable: true, emptyLabel: "이 품목은 아직 연도별 데이터가 없습니다." })}<div class="item-share-block"><div class="section-heading"><div><h2>광역 단위 출원 비중</h2></div></div>${shareDonutHtml(row.provinceCounts, row.name)}</div>` : ""}${nationwideOnly > 0 ? `<p class="provisional-note">지역 확인 전 전국 검색 후보 ${number(nationwideOnly)}건은 위 확정 수치에 포함하지 않았습니다.</p>` : ""}${briefingHtml}`;
  }
  function itemsScreen() {
    const rows = itemRows(); const ITEM_ROW_LIMIT = 100;
    // UI 검토(3차, 2026-09-06) S5: 정렬 기준 선택 + "전체 보기"로 285개 전체 도달 가능.
    const sortedRows = (() => {
      if (state.itemSort === "trademarks") return rows; // 이미 출원 건수 내림차순
      const copy = [...rows];
      // 공백이 같으면 여러 지역에 걸친 품목을 먼저 — 한 번의 권리화가 닿는 범위가 넓다.
      if (state.itemSort === "gap") copy.sort((a, b) => itemGapRegions(b) - itemGapRegions(a) || b.regions.length - a.regions.length || a.name.localeCompare(b.name, "ko-KR"));
      else if (state.itemSort === "regions") copy.sort((a, b) => b.regions.length - a.regions.length || b.trademarks - a.trademarks);
      else if (state.itemSort === "registrationRate") copy.sort((a, b) => (b.trademarks ? b.registered / b.trademarks : -1) - (a.trademarks ? a.registered / a.trademarks : -1) || b.trademarks - a.trademarks);
      else if (state.itemSort === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
      return copy;
    })();
    const visibleRows = state.itemShowAll ? sortedRows : sortedRows.slice(0, ITEM_ROW_LIMIT);
    const selected = visibleRows.find((row) => row.name === state.selectedItemName) || visibleRows[0] || null;
    const listHtml = visibleRows.map((row) => {
    const decidedRegions = row.availableRegions.length;
    const spark = sparklinePoints(row.matchedItems);
    const sparkHtml = spark ? `<svg class="item-list-spark" viewBox="0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}" aria-hidden="true"><polyline points="${spark}"></polyline></svg>` : "";
    const title = `${row.category ? `${esc(row.category.label)} · ` : ""}${row.regions.length}개 지역`;
    return `<li><button type="button" data-select-item="${esc(row.name)}" class="${selected && selected.name === row.name ? "active" : ""}" title="${title}"><span class="item-list-name">${esc(row.name)}</span>${sparkHtml}<b>${decidedRegions ? ((state.itemSort === "gap" || state.itemGapOnly || !row.trademarks) ? `<span class="item-list-gap">공백 ${number(itemGapRegions(row))}개 지역</span>` : `${number(row.trademarks)}건`) : "집계 대기"}</b></button></li>`;
  }).join("") || '<li class="empty">검색 결과가 없습니다.</li>';
    const categoryLabel = state.categoryFilter ? (availableCategories().find((category) => category.code === state.categoryFilter)?.label || "품목") : "전체 품목";
    // 이슈 #119: 품목별 조회를 지역별 조회와 같은 순서로 — 서브토글 → 유형 칩 → 검색창 → 설명 → 탐색.
    return `<section class="screen-section"><div class="explore-toolbar"><div class="item-search-row"><label class="search-field explore-search"><span class="sr-only">품목 또는 지역 검색</span><input type="search" id="item-search" value="${esc(state.itemQuery)}" placeholder="품목명 또는 지역명 검색 · 엔터로 검색"></label><label class="item-gap-filter" title="집계가 끝난 지역 중 확인된 출원이 0건인 곳이 있는 품목만"><input type="checkbox" id="item-gap-only"${state.itemGapOnly ? " checked" : ""}><span>공백만 보기</span></label><label class="item-sort-field"><span class="sr-only">정렬 기준</span><select id="item-sort-select">${[["gap", "공백 지역 많은 순"], ["trademarks", "출원 건수순"], ["regions", "지역 수순"], ["registrationRate", "등록률순"], ["name", "가나다순"]].map(([value, label]) => `<option value="${value}"${state.itemSort === value ? " selected" : ""}>${label}</option>`).join("")}</select></label></div></div><div class="item-category-filter region-quick-filter" role="group" aria-label="품목 유형 필터"><button type="button" data-category-filter="" class="${state.categoryFilter === "" ? "active" : ""}">전체</button>${availableCategories().map((category) => `<button type="button" data-category-filter="${esc(category.code)}" class="${state.categoryFilter === category.code ? "active" : ""}">${esc(category.label)}</button>`).join("")}</div><p class="screen-note">위에서 유형을 고르고 왼쪽 목록에서 품목을 선택하면 그 품목의 상세만 오른쪽에 나옵니다. ${!state.itemShowAll && rows.length > ITEM_ROW_LIMIT ? `상위 ${ITEM_ROW_LIMIT}개 표시 · 전체 ${rows.length}개` : `전체 ${rows.length}개`}</p><div class="item-screen"><div class="item-reading-guide"><strong>수치 구분</strong><span><b>지역 확인 출원</b> 출원인 주소가 해당 지역과 일치</span><span><b>전국 검색</b> 아직 지역 확인 전인 별도 모집단</span></div><div class="item-explorer"><aside class="item-list-panel"><div class="item-list-head"><strong>${esc(categoryLabel)}</strong><span>${rows.length}개</span></div><ul class="item-list">${listHtml}</ul>${!state.itemShowAll && rows.length > ITEM_ROW_LIMIT ? `<button type="button" id="item-show-all" class="item-list-show-all">전체 ${number(rows.length)}개 보기 →</button>` : ""}</aside><div class="item-detail-panel">${itemDetailHtml(selected)}</div></div><details class="method-note"><summary>품목명 집계 기준 보기</summary><p>고시명칭·NICE류가 확정된 품목만 공식 명칭으로 묶습니다. 아직 고시명칭이 확정되지 않은 원물명은 지역별 상세 화면에 원문 그대로 보존합니다.</p></details></div></section>`;
  }
  function dataScreen() {
    if (!pipeline) return '<section class="screen-section"><p class="empty">파이프라인 개요 데이터가 없습니다.</p></section>';
    const addressRate = Math.round((pipeline.applicantRegionVerification.rate || 0) * 100);
    const previewRate = pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal);
    return `<section class="screen-section data-overview">${criteriaHtml()}<div class="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>${number(pipeline.rowCounts.total)}</strong><small>지역-특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>${number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역-품목 조합</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>${number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 전국 고유 후보</small></article><i>→</i><article class="flow-highlight"><span>05 · 지역별 집계</span><strong>${number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>지역 출원 수 표시 가능 항목</small></article></div><div class="data-summary-grid"><article class="data-summary-card"><h2>특산물 데이터</h2><div class="data-stat"><strong>${number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div class="data-stat"><strong>${number(snapshot.coverage.regionItemCount)}개</strong><span>지역-품목 조합</span></div><div class="data-stat"><strong>${number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p class="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article class="data-summary-card"><h2>상표 매칭 결과</h2><div class="match-bars"><div><span>특산품 출원율 <b>${percent(nationalSpecialtyCoverage.rate)}</b></span><em><i style="width:${Math.round((nationalSpecialtyCoverage.rate || 0) * 100)}%"></i></em><small>출원 확인 ${number(nationalSpecialtyCoverage.applied)} / 전체 수집 특산품 ${number(nationalSpecialtyCoverage.total)}(지역별 집계 완료 ${number(nationalSpecialtyCoverage.decided)})</small></div><div><span>고유 상표 주소 확보 <b>${number(pipeline.applicantRegionVerification.verifiedCount)}건</b></span><em><i style="width:${addressRate}%"></i></em><small>전국 고유 후보 중 ${percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>지역별 출원 수 표시 가능 <b>${number(pipeline.regionalMetricGate.availableRegionItemCount)}개</b></span><em><i style="width:${Math.max(2, Math.round(previewRate * 100))}%"></i></em><small>전체 ${number(gateTotal)}개 지역-품목 중 ${percent(previewRate)}</small></div></div><p class="match-explanation">특산품 출원율은 현재 수집된 지역×특산품 전체 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 전체 ${number(nationalSpecialtyCoverage.total)}개 중 명칭 확인이나 지역별 집계가 덜 끝난 항목도 분모에 포함하며, 출원이 확인될 때만 분자에 더합니다 — 후속 확인이 진행되면 값이 올라갈 수 있습니다.</p></article></div><div class="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>특산품 출원율 = 지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수</b>입니다. 명칭 확인이나 지역별 집계가 아직 끝나지 않은 항목도 분모에 포함하고 분자에는 넣지 않습니다. <b>${number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 출원번호 중복을 제거한 전국 검색 후보이며, 등록 비율은 지역 주소 일치 출원 중 등록 상태인 건의 비율로 별도 계산합니다. 검색이 부분 수집 상태인 품목은 0건으로 확정하지 않고 <b>지역별 집계 대기</b>로 표시합니다.</p></div>${provenanceHtml()}</section>`;
  }

  // 2026-09-08(사용자): "빈칸에 검색할 때 스페이스 하지 말고 단어 넣고 엔터치면 검색이
  // 되었으면 좋겠어." 기존에는 한 글자마다 검색했다 — 한글은 oncompositionend가 음절이
  // 완성될 때마다 터지므로 「한라봉」을 치면 한·라·봉 세 번 전체 화면을 다시 그렸고,
  // 그때마다 입력칸이 새로 만들어져 커서를 되돌려 놓아야 했다(그래도 조합이 끊겼다).
  //
  // 이제 타이핑 중에는 화면을 건드리지 않고 입력값만 담아 두었다가, 엔터를 눌렀을 때만
  // 검색한다. 칸을 벗어날 때(blur)도 한 번 반영해, 엔터를 안 치고 다른 곳을 눌러도
  // 입력한 내용이 사라지지 않게 한다. 지우고 비우는 것도 검색이므로 빈 문자열도 반영한다.
  function bindSearchInput(selector, stateKey) {
    const input = document.querySelector(selector);
    if (!input) return;
    let pending = state[stateKey] || "";
    const commit = () => {
      if (state[stateKey] === pending) return;
      state[stateKey] = pending;
      // UI 검토(3차, 2026-09-06) S5: 검색어를 바꾸면 새 결과 기준으로 다시 상위 100개부터.
      if (stateKey === "itemQuery") state.itemShowAll = false;
      if (stateKey === "strategyFilter") state.strategyShowAll = false;
      render();
      const nextInput = document.querySelector(selector);
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(pending.length, pending.length);
      }
    };
    input.oninput = (event) => {
      pending = event.currentTarget.value;
      // 지우기(X 버튼·전체 삭제)는 엔터를 기다릴 이유가 없다 — 바로 되돌린다.
      if (pending === "") commit();
    };
    input.onkeydown = (event) => {
      // 한글 조합 중의 엔터는 후보 확정이지 검색 요청이 아니다.
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      pending = event.currentTarget.value;
      commit();
    };
    input.onblur = commit;
  }
  // UI 검토(3차, 2026-09-06) S3: 비즈니스 전략 — 브리핑이 있는 모든 지역×품목 조합을
  // 한 줄씩 담은 표(Dashboard.tsx의 strategyRows와 동일 구조). 행을 고르면 오른쪽에
  // 브리핑·근거가 열리고, 판정 배지는 열로 들어가 정렬 대상이 된다.
  function strategyRows() {
    const rows = [];
    for (const region of regionalRegions) {
      for (const item of region.items) {
        const policyBadge = item.regionalSpecialtyCropBadge;
        const noRights = rightsStatusOf(item).key === "none";
        // 정책 지정 작목 + 무권리는 브리핑이 없어도 후보 목록에 올린다(최우선).
        const topPriority = Boolean(policyBadge) && noRights;
        if (!item.briefing?.sentences?.length && !topPriority) continue;
        rows.push({
          key: `${regionKey(region)}::${item.specialtyId || itemName(item)}`,
          region,
          item,
          regionLabel: displayRegionName(region.region),
          itemLabel: officialItemLabel(item) || itemName(item),
          uniqueTrademarkCount: item.briefing?.evidence?.uniqueTrademarkCount ?? (noRights ? 0 : null),
          registrationRate: item.briefing?.evidence?.registrationRate ?? null,
          localApplicantShare: item.briefing?.evidence?.localApplicantShare ?? null,
          nationwideCount: nationwideReach(item).count,
          nationwideShare: nationwideReach(item).share,
          nationwideCapped: nationwideReach(item).capped,
          // 정책 지정 작목인데 지역 확인 출원이 0건이면 최우선 권리화 후보다.
          policyTier: policyBadge?.tier || null,
          isTopPriority: topPriority,
          isGapAlert: item.briefing?.isGapAlert ?? true,
        });
      }
    }
    return rows;
  }
  function strategyRowsFiltered(rows) {
    const query = state.strategyFilter.trim().toLowerCase();
    const searched = query ? rows.filter((row) => row.regionLabel.toLowerCase().includes(query) || row.itemLabel.toLowerCase().includes(query)) : rows;
    const filtered = state.strategyPolicyOnly ? searched.filter((row) => row.policyTier) : searched;
    const dir = state.strategySortDir === "asc" ? 1 : -1;
    const numeric = (value) => (value === null || value === undefined ? -Infinity : value);
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (state.strategySortKey === "verdict") cmp = (Number(a.isTopPriority) * 2 + Number(a.isGapAlert)) - (Number(b.isTopPriority) * 2 + Number(b.isGapAlert));
      else if (state.strategySortKey === "region") cmp = a.regionLabel.localeCompare(b.regionLabel, "ko-KR");
      else if (state.strategySortKey === "item") cmp = a.itemLabel.localeCompare(b.itemLabel, "ko-KR");
      else if (state.strategySortKey === "trademark") cmp = numeric(a.uniqueTrademarkCount) - numeric(b.uniqueTrademarkCount);
      else if (state.strategySortKey === "nationwide") cmp = numeric(a.nationwideCount) - numeric(b.nationwideCount);
      else if (state.strategySortKey === "nationwideShare") cmp = numeric(a.nationwideShare) - numeric(b.nationwideShare);
      else if (state.strategySortKey === "registration") cmp = numeric(a.registrationRate) - numeric(b.registrationRate);
      else if (state.strategySortKey === "share") cmp = numeric(a.localApplicantShare) - numeric(b.localApplicantShare);
      cmp *= dir;
      if (cmp !== 0) return cmp;
      return numeric(b.uniqueTrademarkCount) - numeric(a.uniqueTrademarkCount) || a.regionLabel.localeCompare(b.regionLabel, "ko-KR") || a.itemLabel.localeCompare(b.itemLabel, "ko-KR");
    });
  }
  const STRATEGY_COLUMNS = [["region", "지역"], ["item", "품목"], ["trademark", "지역 확인 출원"], ["nationwide", "전국 검색"], ["nationwideShare", "전국 대비"], ["registration", "등록률"], ["share", "지역 출원인 비중"], ["verdict", "판정"]];
  const STRATEGY_ROW_LIMIT = 100;
  // 다출원 특산품 토글에 올리는 개수(출원 많은 순).
  const STRATEGY_CHIP_LIMIT = 12;
  // #119: 비즈니스 전략 탭의 품목 중심 목록 — businessFlow가 붙은 품목만. Dashboard.tsx
  // strategyFlowRows와 동일.
  function strategyFlowRows() {
    const rows = new Map();
    for (const region of regionalRegions) {
      for (const item of region.items) {
        const name = officialItemLabel(item);
        if (!name) continue;
        const row = rows.get(name) || { name, category: item.category || null, flow: null, trademarks: 0, regions: [], regionCounts: {}, provinceCounts: {}, matchedItems: [] };
        if (!row.flow && item.businessFlow) row.flow = item.businessFlow;
        if (!row.category && item.category) row.category = item.category;
        if (item.metrics.uniqueTrademarkCount.availability === "available") {
          const value = item.metrics.uniqueTrademarkCount.value || 0;
          row.trademarks += value;
          row.regionCounts[region.region] = (row.regionCounts[region.region] || 0) + value;
          const province = region.sido || region.region;
          row.provinceCounts[province] = (row.provinceCounts[province] || 0) + value;
        }
        if (!row.regions.includes(region.region)) row.regions.push(region.region);
        row.matchedItems.push(item);
        rows.set(name, row);
      }
    }
    // 전국 흐름(businessFlow)이 아직 스냅샷에 없어도 화면을 막지 않는다 — 지금 있는
    // 데이터로 먼저 보여주고, 배치가 반영되면 단계별 카드가 그 위에 붙는다.
    return [...rows.values()].sort((a, b) => ((b.flow ? b.flow.totalCount : 0) - (a.flow ? a.flow.totalCount : 0)) || b.trademarks - a.trademarks);
  }
  // 2026-09-08(사용자): "쌀로 어디까지 비즈니스를 확장할 수 있을까? 토마토는? 이색적인
  // 비즈니스는? 서비스나 지역 창업은?" — 이 네 질문에 답하는 확장 경로 진단 보고서.
  //
  // 근거는 오직 스냅샷에 실제로 실린 지정상품이다. businessFlow(원물→가공품→서비스 배치)는
  // 아직 스냅샷에 0건이라 그 위에 세우면 전 품목이 빈칸이 된다. 대신 상표 출원의 지정상품
  // 상품류(NICE)를 쓴다 — "이 품목이 실제로 도달한 류"와 "같은 유형의 다른 특산품은
  // 도달했는데 이 품목은 비어 있는 류"의 차이가 곧 확장 여지다. 없는 걸 지어내지 않는다.
  const REPORT_SERVICE_FLOOR = 35;
  // 같은 색인을 전국(regionalRegions)으로도, 고른 시도의 행만으로도 만든다 —
  // 두 색인의 차이가 곧 "전국은 갔는데 이 지역은 아직"이다.
  // 「신선한 토마토」의 지정상품 문안은 「토마토」를 담고 있다 — 수식 접두어를 떼야 맞물린다.
  const TEMPLATE_SLOT = "{품목}";
  const bareItemName = (name) => String(name || "").replace(/^(신선한|미가공|말린|건조된|생)\s*/, "").replace(/\s+/g, "");
  function buildExpansionIndex(regions) {
    const byItem = new Map();     // 품목명 -> { category, classes: Map<류, {count, goods:Set}> }
    const byClass = new Map();    // 류 -> { items: Map<품목명, Set<지정상품>>, count }
    const byCategory = new Map(); // 유형코드 -> Map<류, Set<품목명>>
    const byTemplate = new Map(); // 류 -> Map<문안틀, Set<쓴 품목>>
    for (const region of regions) {
      for (const item of region.items) {
        const name = officialItemLabel(item);
        if (!name) continue;
        const entry = byItem.get(name) || { name, category: item.category || null, classes: new Map() };
        if (!entry.category && item.category) entry.category = item.category;
        for (const example of item.trademarkExamples || []) {
          for (const evidence of example.goodsEvidence || []) {
            const code = String(evidence.classCode || "").trim();
            const goods = String(evidence.designatedProductName || "").trim();
            if (!code || !Number.isFinite(Number(code))) continue;
            const own = entry.classes.get(code) || { count: 0, goods: new Set() };
            own.count += 1;
            if (goods) own.goods.add(goods);
            entry.classes.set(code, own);

            // 2026-09-08(사용자): "맞춤형 추천을 해줘야지.. 류에 해당하는 적절한 지정상품으로"
            // 남의 품목 지정상품을 예시로 보여 주는 대신, 그 문안에서 품목명만 빼내 틀로 만들고
            // 고른 품목 이름을 끼워 제안한다. 「가공된감」 → 「가공된{품목}」 → 「가공된수박」.
            // 지어낸 문구가 아니라 실제 등록된 표현을 그대로 옮겨 쓰는 것이다.
            const bare = bareItemName(name);
            if (bare && goods.includes(bare)) {
              const shape = goods.split(bare).join(TEMPLATE_SLOT);
              // 「{품목}」만 남는 틀은 정보가 없고, 괄호가 붙은 틀은 특정 지역·원료를 한정하는
              // 조건절이라(「생막걸리(강원도양구군에서재배된{품목}가함유된것에한함)」) 남의 품목에
              // 옮겨 붙일 수 없다.
              if (shape !== TEMPLATE_SLOT && !/[()（）[\]]/.test(shape)) {
                const perClass = byTemplate.get(code) || new Map();
                const users = perClass.get(shape) || new Set();
                users.add(bare);
                perClass.set(shape, users);
                byTemplate.set(code, perClass);
              }
            }

            const shared = byClass.get(code) || { items: new Map(), count: 0 };
            shared.count += 1;
            const bucket = shared.items.get(name) || new Set();
            if (goods) bucket.add(goods);
            shared.items.set(name, bucket);
            byClass.set(code, shared);
          }
        }
        byItem.set(name, entry);
      }
    }
    for (const entry of byItem.values()) {
      const code = entry.category ? entry.category.code : "";
      if (!code) continue;
      const map = byCategory.get(code) || new Map();
      for (const cls of entry.classes.keys()) {
        const names = map.get(cls) || new Set();
        names.add(entry.name);
        map.set(cls, names);
      }
      byCategory.set(code, map);
    }
    return { byItem, byClass, byCategory, byTemplate };
  }
  let nationalIndexCache = null;
  const expansionIndex = () => (nationalIndexCache = nationalIndexCache || buildExpansionIndex(regionalRegions));
  const provinceOf = (region) => region.sido || region.region;
  const strategyProvinces = () => [...new Set(regionalRegions.map(provinceOf))].sort((a, b) => a.localeCompare(b, "ko-KR"));
  // 받침이 있으면 "은", 없으면 "는". 보고서 첫 문장이 "쌀은(는)"으로 나오던 걸 없앤다.
  const hasFinalConsonant = (word) => {
    const code = String(word || "").trim().slice(-1).charCodeAt(0);
    if (!(code >= 0xac00 && code <= 0xd7a3)) return null;
    return (code - 0xac00) % 28 !== 0;
  };
  const withTopicJosa = (word) => `${word}${hasFinalConsonant(word) === false ? "는" : "은"}`;
  const withSubjectJosa = (word) => `${word}${hasFinalConsonant(word) === false ? "가" : "이"}`;
  // 지정상품이 품목명과 똑같은 행("담배" 류34 「담배」)은 확장 사례로서 아무것도 말해 주지
  // 않는다 — 가공·서비스로 넘어간 걸 보여 주는 행을 먼저 고른다.
  const normalizeGoods = (text) => String(text || "").replace(/[\s()（）]/g, "");
  const isTautology = (goods, itemName) => normalizeGoods(goods) === normalizeGoods(itemName);
  function goodsSample(set, n, itemName) {
    const all = [...set];
    const informative = itemName ? all.filter((g) => !isTautology(g, itemName)) : all;
    const pool = informative.length ? informative : all;
    return pool.sort((a, b) => a.length - b.length || a.localeCompare(b, "ko-KR")).slice(0, n);
  }
  // 한 상품류의 대표 사례를 고른다. 읽는 사람이 알고 싶은 건 "이 품목이 무엇으로 사업이
  // 됐는가"이므로, 서비스업(…업)과 가공품을 원물 나열보다 먼저 보여 준다. 품목명을 그대로
  // 옮겨 적은 행(「담배」→「담배및흡연용구」)은 확장 사례가 못 되니 가장 뒤로 민다.
  const BUSINESS_MARKERS = /(업|가공|제조|체험|판매|배달|음료|주스|막걸리|맥주|와인|차|빵|과자|잼|즙|진액|분말|가루|말랭이|절임|김치|장아찌|통조림|엑기스|화장품|비누)/;
  function showcaseScore(goods, itemName) {
    if (!goods) return -1;
    if (isTautology(goods, itemName)) return 0;
    const normalized = normalizeGoods(goods);
    const bare = normalizeGoods(itemName);
    let score = 1;
    if (BUSINESS_MARKERS.test(goods)) score += 3;
    if (bare && normalized.startsWith(bare) && normalized.length - bare.length <= 4) score -= 1;
    if (goods.length > 8) score += 1;
    return score;
  }
  function classShowcase(cell) {
    let best = null;
    for (const [name, goodsSet] of cell.items) {
      for (const goods of goodsSet) {
        const score = showcaseScore(goods, name);
        if (!best || score > best.score) best = { lead: name, goods, score };
      }
    }
    return best && best.score > 0 ? best : null;
  }
  // 지역을 고르면 ⑤절이 붙는다. 그 지역 행만으로 만든 색인과 전국 색인을 견주어
  // "전국 특산품은 도달했는데 이 지역은 아직 비어 있는 상품류"를 지역 공백으로 보여 주고,
  // 그 지역 다른 특산품의 서비스류 등록례를 지역 창업 선례로 붙인다.
  // 한 상품류에서 널리 쓰인 문안 틀에 이 품목 이름을 끼워 제안을 만든다. 여러 품목이 쓴
  // 틀일수록 그 류의 표준 표현에 가깝다.
  //
  // 한 품목만 쓴 틀은 그 품목에만 말이 되는 경우가 많아 옮겨 붙이면 헛소리가 된다
  // (「장뇌산삼주」→「장뇌수박」, 「도자기제접시」→「수박제접시」, 「담배대용품」→「수박대용품」).
  // 두 품목 이상이 실제로 쓴 틀만 제안한다 — 놓치는 제안이 생기더라도(40류 「{품목}가공업」은
  // 한 건뿐이라 빠진다) 말이 안 되는 제안을 내놓는 것보다 낫다. 제안이 하나도 없으면
  // 그 줄은 근거만 보여 준다.
  const SUGGEST_MIN_USERS = 2;
  function suggestGoods(index, code, itemName, limit) {
    const bare = bareItemName(itemName);
    const perClass = index.byTemplate.get(code);
    if (!bare || !perClass) return [];
    return [...perClass.entries()]
      .filter(([, users]) => users.size >= SUGGEST_MIN_USERS && !(users.size === 1 && users.has(bare)))
      .sort((a, b) => b[1].size - a[1].size || a[0].length - b[0].length)
      .slice(0, limit)
      .map(([shape]) => shape.split(TEMPLATE_SLOT).join(bare));
  }
  const suggestionHtml = (list) => list.length
    ? `<small class="expansion-suggest"><b>제안</b> ${list.map((text) => `「${esc(text)}」`).join(" · ")}</small>`
    : "";
  function regionSectionHtml(row, province, index) {
    const rows = regionalRegions.filter((region) => provinceOf(region) === province);
    if (!rows.length) return "";
    const local = buildExpansionIndex(rows);
    const entry = local.byItem.get(row.name);
    const localClasses = entry ? entry.classes : new Map();
    let filed = 0;
    let registered = 0;
    let pending = 0;
    for (const region of rows) {
      for (const item of region.items) {
        if (officialItemLabel(item) !== row.name) continue;
        const metric = item.metrics.uniqueTrademarkCount;
        if (metric.availability === "available") {
          filed += metric.value || 0;
          registered += item.metrics.registeredTrademarkCount.value || 0;
        } else pending += 1;
      }
    }
    const crop = rows.flatMap((region) => region.items)
      .find((item) => officialItemLabel(item) === row.name && item.regionalSpecialtyCropBadge);
    const nationalCodes = [...(index.byItem.get(row.name)?.classes.keys() || [])];
    const missing = nationalCodes.filter((code) => !localClasses.has(code)).sort((a, b) => Number(a) - Number(b));
    const localSvc = [...local.byClass.entries()]
      .filter(([code]) => Number(code) >= REPORT_SERVICE_FLOOR)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([code, cell]) => ({ code, show: classShowcase(cell) }))
      .filter((r) => r.show);

    const statusLine = filed
      ? `이 지역에서 <b>${esc(displayRegionName(province))} 주소로 확인된 ${esc(row.name)} 출원은 ${number(filed)}건</b>(등록 ${number(registered)}건)입니다.`
      : pending
        ? `이 지역의 ${esc(row.name)} 출원은 아직 집계 중입니다(대기 ${number(pending)}건).`
        : `이 지역에는 <b>주소가 확인된 ${esc(row.name)} 출원이 한 건도 없습니다</b> — 권리화 1순위입니다.`;
    const cropLine = crop
      ? `<p class="expansion-hint">농촌진흥청 <b>${esc(crop.tier)}</b> 지역특화작목(${esc(crop.officialItemName)} · ${number(crop.referenceYear)}년)이라 정책 연계 근거가 이미 있습니다.</p>`
      : "";
    const missingHtml = missing.length
      ? `<ol class="expansion-list">${missing.slice(0, 6).map((code) => `<li><span class="expansion-class">${esc(niceClassLabel(code))}</span><span class="expansion-why">전국에는 있고 이 지역엔 없음</span></li>`).join("")}</ol>`
      : `<p class="empty">${esc(withSubjectJosa(row.name))} 전국에서 도달한 상품류를 이 지역도 모두 갖고 있습니다.</p>`;
    const svcHtml = localSvc.length
      ? `<ol class="expansion-list svc">${localSvc.map((r) => `<li><span class="expansion-class">${esc(niceClassLabel(r.code))}</span><span class="expansion-why">이 지역 선례</span><small class="expansion-basis">근거 ${esc(r.show.lead)} 「${esc(r.show.goods)}」</small></li>`).join("")}</ol>`
      : `<p class="empty">이 지역 특산품 중 서비스류(35류 이상)를 확보한 사례가 아직 없습니다 — 지역 창업 영역이 통째로 비어 있습니다.</p>`;

    return `<article class="expansion-region"><h3>⑤ ${esc(displayRegionName(province))} 관점</h3>`
      + `<p class="expansion-hint">${statusLine}</p>${cropLine}`
      + `<h4>전국은 갔는데 이 지역은 아직</h4>${missingHtml}`
      + `<h4>이 지역의 서비스 · 창업 선례</h4>${svcHtml}</article>`;
  }
  function expansionReportHtml(row, province) {
    const index = expansionIndex();
    const entry = index.byItem.get(row.name);
    const own = entry ? entry.classes : new Map();
    const evidenceCount = [...own.values()].reduce((sum, c) => sum + c.count, 0);
    if (!evidenceCount) {
      return `<section class="expansion-report empty"><div class="section-heading"><div><h2>${esc(row.name)} 확장 경로 진단</h2></div><span>근거 부족</span></div>`
        + `<p class="empty">이 품목은 출원의 지정상품이 아직 한 건도 확인되지 않아 확장 경로를 진단할 수 없습니다. 지정상품 대조가 끝나면 자동으로 채워집니다.</p></section>`;
    }
    const ownCodes = [...own.keys()].sort((a, b) => Number(a) - Number(b));
    const productCodes = ownCodes.filter((c) => Number(c) < REPORT_SERVICE_FLOOR);
    const serviceCodes = ownCodes.filter((c) => Number(c) >= REPORT_SERVICE_FLOOR);

    // ① 지금 어디까지 갔나
    const heldHtml = ownCodes.map((code) => {
      const cell = own.get(code);
      const eg = goodsSample(cell.goods, 3, row.name);
      return `<li class="${Number(code) >= REPORT_SERVICE_FLOOR ? "svc" : "goods"}"><b>${esc(niceClassLabel(code))}</b><span>${number(cell.count)}건</span>${eg.length ? `<small>${eg.map(esc).join(" · ")}</small>` : ""}</li>`;
    }).join("");
    // 2026-09-08(사용자 "인삼소매업이 진짜 한 건도 출원이 없나?"): 없다고 단정할 근거가
    // 없다. 지정상품 근거는 고시명칭과 문자열이 겹치는 출원에만 붙어서(normalized_exact /
    // normalized_contains), 「신선한 인삼」은 「인삼소매업」을 구조적으로 못 잡는다. 확인된
    // 범위와 실제 보유 범위를 말로 구분한다.
    const reachLine = serviceCodes.length
      ? `제품 ${productCodes.length}개 류와 서비스·확산 ${serviceCodes.length}개 류에서 지정상품이 확인됐습니다.`
      : `제품 ${productCodes.length}개 류에서만 지정상품이 확인됐고, <b>서비스·확산(35류 이상)은 확인된 것이 없습니다</b>.`;

    // ② 같은 유형이 먼저 간 곳
    const catCode = entry.category ? entry.category.code : "";
    const catLabel = entry.category ? entry.category.label : "같은 유형";
    const peerMap = index.byCategory.get(catCode) || new Map();
    // 같은 유형 안에서 단 한 품목만 가진 류는 대개 분류 잡음이다(예: 쌀 상표 한 건이
    // 2류로 잡힌 것). 두 품목 이상이 확보한 류만 후보로 올리고, 그래도 세 줄이 안 되면
    // 전국 특산품 기준으로 채운 뒤 근거를 다르게 적는다.
    const peerRows = [...peerMap.entries()]
      .filter(([code, names]) => !own.has(code) && [...names].filter((n) => n !== row.name).length >= 2)
      .map(([code, names]) => {
        const peers = [...names].filter((n) => n !== row.name);
        const show = classShowcase(index.byClass.get(code)) || { lead: peers[0], goods: "" };
        return { code, scope: catLabel, peers: peers.length, lead: show.lead, goods: show.goods };
      })
      .sort((a, b) => b.peers - a.peers || Number(a.code) - Number(b.code));
    if (peerRows.length < 3) {
      const seen = new Set(peerRows.map((r) => r.code));
      const filler = [...index.byClass.entries()]
        .filter(([code, cell]) => !own.has(code) && !seen.has(code) && cell.items.size >= 2 && Number(code) < REPORT_SERVICE_FLOOR)
        .sort((a, b) => b[1].items.size - a[1].items.size)
        .slice(0, 3 - peerRows.length)
        .map(([code, cell]) => {
          const show = classShowcase(cell) || { lead: "", goods: "" };
          return { code, scope: "전국 특산품", peers: cell.items.size, lead: show.lead, goods: show.goods };
        });
      peerRows.push(...filler);
    }
    peerRows.splice(6);
    const peerHtml = peerRows.length
      ? `<ol class="expansion-list">${peerRows.map((r) => `<li><span class="expansion-class">${esc(niceClassLabel(r.code))}</span><span class="expansion-why">${esc(r.scope)} ${number(r.peers)}개 품목이 이미 확보</span>${suggestionHtml(suggestGoods(index, r.code, row.name, 3))}${r.goods ? `<small class="expansion-basis">근거 ${esc(r.lead)} 「${esc(r.goods)}」</small>` : ""}</li>`).join("")}</ol>`
      : `<p class="empty">같은 유형 품목들이 확보한 상품류를 이 품목도 모두 갖고 있습니다.</p>`;

    // ③ 이색 확장 사례 — 전국에서 도달한 품목이 가장 적은 류
    const rare = [...index.byClass.entries()]
      .filter(([code, cell]) => !own.has(code) && cell.items.size > 0)
      .map(([code, cell]) => ({ code, itemCount: cell.items.size, show: classShowcase(cell) }))
      // 「담배」가 34류에 「담배」로 등록된 것 같은 동어반복은 확장 사례가 못 된다.
      .filter((r) => r.show && r.show.goods && !isTautology(r.show.goods, r.show.lead))
      .sort((a, b) => a.itemCount - b.itemCount || Number(a.code) - Number(b.code))
      .slice(0, 5)
      .map((r) => ({ code: r.code, itemCount: r.itemCount, lead: r.show.lead, goods: r.show.goods }));
    const rareHtml = rare.length
      ? `<ol class="expansion-list rare">${rare.map((r) => `<li><span class="expansion-class">${esc(niceClassLabel(r.code))}</span><span class="expansion-why">전국 특산품 중 ${number(r.itemCount)}개 품목만 도달</span>${suggestionHtml(suggestGoods(index, r.code, row.name, 2))}${r.goods ? `<small class="expansion-basis">근거 ${esc(r.lead)} 「${esc(r.goods)}」</small>` : ""}</li>`).join("")}</ol>`
      : `<p class="empty">이 품목이 이미 대부분의 상품류에 도달해 있습니다.</p>`;

    // ④ 서비스·지역 창업
    const svcRows = [...index.byClass.entries()]
      .filter(([code]) => Number(code) >= REPORT_SERVICE_FLOOR && !own.has(code))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([code, cell]) => {
        const show = classShowcase(cell) || { lead: "", goods: "" };
        return { code, count: cell.count, lead: show.lead, goods: show.goods };
      });
    const svcHead = serviceCodes.length
      ? `이 품목은 ${serviceCodes.map((c) => esc(niceClassLabel(c))).join(" · ")}가 확인됐습니다. 남은 서비스 구간은 아래와 같습니다.`
      : `이 품목은 <b>서비스류 지정상품이 확인되지 않았습니다</b> — 없다는 증거가 아니라 위 단서대로 확인되지 않았다는 뜻입니다. 직판·체험·관광·가공 위탁 방향을 검토할 때 <b>선등록 여부를 먼저 조사</b>하십시오.`;
    const svcHtml = svcRows.length
      ? `<ol class="expansion-list svc">${svcRows.map((r) => `<li><span class="expansion-class">${esc(niceClassLabel(r.code))}</span><span class="expansion-why">전국 특산품 상표 ${number(r.count)}건이 이 구간에</span>${suggestionHtml(suggestGoods(index, r.code, row.name, 3))}${r.goods ? `<small class="expansion-basis">근거 ${esc(r.lead)} 「${esc(r.goods)}」</small>` : ""}</li>`).join("")}</ol>`
      : `<p class="empty">전국 특산품 상표에서도 아직 서비스류 사례가 확인되지 않았습니다.</p>`;

    return `<section class="expansion-report">
      <div class="section-heading"><div><h2>${province ? `${esc(displayRegionName(province))} · ` : ""}${esc(row.name)} 확장 경로 진단</h2></div><span>지정상품 ${number(evidenceCount)}건 근거${province ? " · 지역 관점 포함" : ""}</span></div>
      <p class="expansion-lede"><b>${esc(row.name)}</b>${esc(withTopicJosa(row.name).slice(row.name.length))} ${reachLine}</p>
      <p class="expansion-limit"><b>이 진단이 보는 범위</b> 지정상품 근거는 <b>고시명칭과 문자열이 맞물리는 출원</b>에만 붙습니다(정확 일치·부분 포함). 그래서 「신선한 인삼」은 「인삼소매업」(35류)을 잡아내지 못하고, 「신선한 곰취」는 「신선한곰취소매업」을 잡아냅니다 — 보이는 범위가 <b>이름 형태에 따라</b> 달라집니다. 아래에서 비어 있는 칸은 “권리가 없다”가 아니라 <b>“이 방법으로는 확인되지 않았다”</b>로 읽으십시오.</p>
      <div class="expansion-grid">
        <article><h3>① 지정상품이 확인된 범위</h3><ul class="expansion-held">${heldHtml}</ul></article>
        <article><h3>② 다음 확장 후보</h3><p class="expansion-hint">같은 유형의 다른 특산품이 이미 확보했는데 이 품목만 비어 있는 상품류입니다. 세 줄이 안 되면 전국 특산품 기준으로 채웁니다.</p>${peerHtml}</article>
        <article><h3>③ 이색 확장 사례</h3><p class="expansion-hint">전국 특산품 상표에서 도달한 품목이 가장 적은 상품류입니다 — 선례가 드문 만큼 차별화 여지도 큽니다.</p>${rareHtml}</article>
        <article><h3>④ 서비스 · 지역 창업</h3><p class="expansion-hint">${svcHead}</p>${svcHtml}</article>
        ${province ? regionSectionHtml(row, province, index) : ""}
      </div>
      <p class="expansion-caveat"><b>제안</b> 문안은 그 상품류에서 <b>두 개 이상의 품목이 실제로 쓴</b> 지정상품 표현에 이 품목 이름을 넣은 것입니다 — 등록 가능성을 보장하지 않으며 그대로 출원할 문안이 아니라 검토용 초안입니다. 이 진단은 스냅샷에 실린 <b>실제 출원의 지정상품</b>만으로 규칙에 따라 생성했습니다. 지정상품이 확인된 출원은 전체의 일부이고 그 일부도 고시명칭과 맞물린 것만이라, <b>실제 보유 범위는 여기 보이는 것보다 넓습니다</b>. 여기 나온 상품류는 <b>검토 출발점</b>입니다 — 실제 출원 가능 여부와 선등록 상표 저촉은 별도로 조사해야 합니다.</p>
    </section>`;
  }
  // 2026-09-08(사용자): "DB에서 분석하는 거 말고.. 예시로 딱 5개 품목만 샘플을 상상해서
  // 만들어주자." 지정상품 대조가 질의 류 안쪽만 남기는 구조라(evaluateGoods) 실제 집계로는
  // 확장 경로가 31류 한 칸으로 눌린다. 데이터가 갖춰졌을 때 이 화면이 무엇을 보여 주는지를
  // 다섯 품목으로 미리 그려 둔다.
  //
  // 이 다섯 건은 스냅샷에서 나온 값이 아니라 사람이 쓴 가상 예시다. 실제 집계와 절대 섞이지
  // 않도록 별도 섹션에 넣고, 모든 수치·문안에 예시 표시를 단다.
  const SAMPLE_EXPANSION_REPORTS = [
      {
          "name": "딸기",
          "region": "경상남도 진주시",
          "category": "과일",
          "lede": "원물(31류)만 확보했습니다. 딸기는 <b>디저트·체험</b>으로 값이 붙는 품목인데 그 갈래가 통째로 비어 있습니다.",
          "held": [
              {
                  "code": "31",
                  "count": 128,
                  "goods": [
                      "신선한딸기",
                      "미가공딸기"
                  ]
              }
          ],
          "next": [
              {
                  "code": "29",
                  "why": "같은 과일 11개 품목이 확보",
                  "suggest": [
                      "딸기잼",
                      "냉동딸기",
                      "건조딸기"
                  ]
              },
              {
                  "code": "30",
                  "why": "같은 과일 3개 품목이 확보",
                  "suggest": [
                      "딸기케이크",
                      "딸기초콜릿"
                  ]
              },
              {
                  "code": "32",
                  "why": "같은 과일 5개 품목이 확보",
                  "suggest": [
                      "딸기주스",
                      "딸기음료"
                  ]
              }
          ],
          "unusual": [
              {
                  "code": "3",
                  "why": "전국 특산품 중 2개 품목만 도달",
                  "suggest": [
                      "딸기추출물함유화장품"
                  ],
                  "note": "선별에서 빠지는 비품(못난이) 딸기가 원료가 됩니다 — 버리던 것을 파는 갈래."
              }
          ],
          "service": [
              {
                  "code": "41",
                  "why": "딸기는 체험 수요가 가장 큰 과일",
                  "suggest": [
                      "딸기따기체험농장운영업"
                  ]
              },
              {
                  "code": "43",
                  "why": "산지 디저트",
                  "suggest": [
                      "딸기디저트카페업"
                  ]
              },
              {
                  "code": "35",
                  "why": "산지 직판",
                  "suggest": [
                      "딸기소매업",
                      "딸기도매업"
                  ]
              }
          ],
          "regional": "진주는 시설재배가 몰려 있어 <b>겨울 체험 관광</b>과 맞물립니다. 농가마다 따로 체험장을 여는 대신 시 단위 <b>증명표장(48)</b>으로 위생·당도 기준을 걸고 개별 농가에 쓰게 하면, 확장과 품질 관리를 한 권리로 처리할 수 있습니다."
      },
      {
          "name": "인삼",
          "region": "충청남도 금산군",
          "category": "특용작물",
          "lede": "원물(31류)과 건강기능식품(5류)은 확보했으나, <b>마시고 먹는 형태</b>와 <b>파는 행위</b>가 비어 있습니다.",
          "held": [
              {
                  "code": "31",
                  "count": 42,
                  "goods": [
                      "신선한인삼",
                      "수삼",
                      "미가공인삼"
                  ]
              },
              {
                  "code": "5",
                  "count": 11,
                  "goods": [
                      "홍삼농축액",
                      "인삼성분함유건강기능식품"
                  ]
              }
          ],
          "next": [
              {
                  "code": "30",
                  "why": "같은 특용작물 9개 품목이 확보",
                  "suggest": [
                      "인삼차",
                      "홍삼정과",
                      "인삼분말"
                  ]
              },
              {
                  "code": "32",
                  "why": "같은 특용작물 4개 품목이 확보",
                  "suggest": [
                      "인삼음료",
                      "음료용인삼추출액"
                  ]
              },
              {
                  "code": "33",
                  "why": "전국 특산품 17개 품목이 확보",
                  "suggest": [
                      "인삼주",
                      "인삼막걸리"
                  ]
              }
          ],
          "unusual": [
              {
                  "code": "3",
                  "why": "전국 특산품 중 2개 품목만 도달",
                  "suggest": [
                      "인삼추출물함유화장품",
                      "인삼비누"
                  ],
                  "note": "K-뷰티 수출과 맞물리는 구간 — 원료 표시로 산지가 브랜드를 가져갈 수 있습니다."
              }
          ],
          "service": [
              {
                  "code": "35",
                  "why": "직판·유통 권리화의 출발점",
                  "suggest": [
                      "인삼소매업",
                      "인삼도매업"
                  ]
              },
              {
                  "code": "43",
                  "why": "산지 식당·카페",
                  "suggest": [
                      "인삼요리전문식당업",
                      "인삼차카페업"
                  ]
              },
              {
                  "code": "41",
                  "why": "체험·관광 연계",
                  "suggest": [
                      "인삼재배체험농장운영업"
                  ]
              }
          ],
          "regional": "금산 인삼시장 상인들이 개별 상표를 쓰고 있어 산지 이름이 분산됩니다. 40류 「인삼가공위탁업」을 묶은 <b>단체표장(44)</b>으로 공동 브랜드를 세우면 시장 전체가 하나의 산지 표시를 공유합니다."
      },
      {
          "name": "포도",
          "region": "충청북도 영동군",
          "category": "과일",
          "lede": "원물(31류)만 확보했습니다. 포도는 <b>주류(33류)</b>로 가는 길이 가장 뚜렷한 품목인데 그 칸이 비어 있습니다.",
          "held": [
              {
                  "code": "31",
                  "count": 111,
                  "goods": [
                      "신선한포도",
                      "미가공포도"
                  ]
              }
          ],
          "next": [
              {
                  "code": "33",
                  "why": "전국 특산품 17개 품목이 확보",
                  "suggest": [
                      "포도주",
                      "포도증류주"
                  ]
              },
              {
                  "code": "32",
                  "why": "같은 과일 5개 품목이 확보",
                  "suggest": [
                      "포도주스",
                      "음료용포도추출액"
                  ]
              },
              {
                  "code": "29",
                  "why": "같은 과일 11개 품목이 확보",
                  "suggest": [
                      "건포도",
                      "포도잼"
                  ]
              }
          ],
          "unusual": [
              {
                  "code": "3",
                  "why": "전국 특산품 중 2개 품목만 도달",
                  "suggest": [
                      "포도씨추출물함유화장품"
                  ],
                  "note": "와인 양조 부산물(씨·껍질)이 원료입니다 — 33류로 확장하면 자동으로 열리는 갈래."
              }
          ],
          "service": [
              {
                  "code": "43",
                  "why": "와이너리 식음",
                  "suggest": [
                      "와인전문식당업",
                      "포도디저트카페업"
                  ]
              },
              {
                  "code": "41",
                  "why": "양조 체험",
                  "suggest": [
                      "포도따기체험농장운영업",
                      "와인양조체험업"
                  ]
              },
              {
                  "code": "35",
                  "why": "직판",
                  "suggest": [
                      "포도소매업",
                      "포도주소매업"
                  ]
              }
          ],
          "regional": "영동은 와이너리가 여럿 모여 있어 <b>33류와 43·41류를 한 묶음</b>으로 잡아야 합니다. 개별 와이너리 상표만 있으면 「영동 와인」이라는 산지 이름은 누구의 것도 아닌 채로 남습니다 — 군 단위 단체표장이 그 자리를 채웁니다."
      },
      {
          "name": "생버섯",
          "region": "경기도 여주시",
          "category": "임산물",
          "lede": "원물(31류)만 확보했습니다. 버섯은 <b>말리면 값이 오르고</b> 추출하면 기능성으로 넘어가는데 둘 다 비어 있습니다.",
          "held": [
              {
                  "code": "31",
                  "count": 84,
                  "goods": [
                      "생버섯",
                      "신선한표고버섯"
                  ]
              }
          ],
          "next": [
              {
                  "code": "29",
                  "why": "같은 임산물 13개 품목이 확보",
                  "suggest": [
                      "건조버섯",
                      "버섯장아찌"
                  ]
              },
              {
                  "code": "30",
                  "why": "같은 임산물 3개 품목이 확보",
                  "suggest": [
                      "버섯차",
                      "버섯가루"
                  ]
              },
              {
                  "code": "32",
                  "why": "전국 특산품 12개 품목이 확보",
                  "suggest": [
                      "버섯음료",
                      "음료용버섯추출액"
                  ]
              }
          ],
          "unusual": [
              {
                  "code": "1",
                  "why": "전국 특산품 중 1개 품목만 도달",
                  "suggest": [
                      "버섯재배용배지"
                  ],
                  "note": "농자재 갈래 — 재배 기술을 파는 쪽이라 원물 시세와 무관한 매출이 됩니다."
              }
          ],
          "service": [
              {
                  "code": "35",
                  "why": "도시 근교 직판",
                  "suggest": [
                      "버섯소매업",
                      "버섯도매업"
                  ]
              },
              {
                  "code": "40",
                  "why": "건조·가공 위탁",
                  "suggest": [
                      "버섯가공위탁업",
                      "건버섯가공업"
                  ]
              },
              {
                  "code": "39",
                  "why": "신선 배송",
                  "suggest": [
                      "버섯정기배송업"
                  ]
              }
          ],
          "regional": "경기도는 <b>수도권 소비지와 붙어 있는 것</b>이 최대 강점입니다. 39류 「버섯정기배송업」과 35류를 함께 잡으면 산지가 유통 단계까지 브랜드를 유지할 수 있습니다 — 지금은 중간 유통이 그 값을 가져갑니다."
      },
      {
          "name": "고추",
          "region": "충청남도 청양군",
          "category": "채소",
          "lede": "원물(31류)만 확보했습니다. 고추는 <b>거의 전량이 가루·장으로 가공돼 팔리는데</b> 그 30류가 비어 있습니다.",
          "held": [
              {
                  "code": "31",
                  "count": 130,
                  "goods": [
                      "신선한고추",
                      "미가공고추"
                  ]
              }
          ],
          "next": [
              {
                  "code": "30",
                  "why": "같은 채소 6개 품목이 확보",
                  "suggest": [
                      "고춧가루",
                      "고추장",
                      "고추양념"
                  ]
              },
              {
                  "code": "29",
                  "why": "같은 채소 8개 품목이 확보",
                  "suggest": [
                      "건조고추",
                      "고추절임"
                  ]
              },
              {
                  "code": "32",
                  "why": "같은 채소 3개 품목이 확보",
                  "suggest": [
                      "음료용고추추출액"
                  ]
              }
          ],
          "unusual": [
              {
                  "code": "5",
                  "why": "전국 특산품 중 3개 품목만 도달",
                  "suggest": [
                      "캡사이신함유건강기능식품"
                  ],
                  "note": "매운맛 성분을 기능성으로 파는 갈래 — 원물 등급 밖 물량을 흡수합니다."
              }
          ],
          "service": [
              {
                  "code": "40",
                  "why": "건조·분쇄 위탁이 산지의 실질 사업",
                  "suggest": [
                      "고추건조가공업",
                      "고춧가루가공위탁업"
                  ]
              },
              {
                  "code": "35",
                  "why": "직판",
                  "suggest": [
                      "고춧가루소매업",
                      "고추도매업"
                  ]
              },
              {
                  "code": "43",
                  "why": "산지 식당",
                  "suggest": [
                      "고추요리전문식당업"
                  ]
              }
          ],
          "regional": "청양은 이름 자체가 품종명(청양고추)과 얽혀 <b>산지 표시가 보통명칭으로 흡수될 위험</b>이 가장 큰 사례입니다. 30류 「고춧가루」를 군 단위 <b>지리적표시 단체표장(44)</b>으로 먼저 잡아 두지 않으면, 어디서 난 고추든 청양이라 부르는 상태가 굳습니다."
      }
  ];
  function sampleSectionHtml(title, hint, rows, kind) {
    const list = rows.map((row) => `<li><span class="expansion-class">${esc(niceClassLabel(row.code))}</span>`
      + `<span class="expansion-why">${esc(row.why)}</span>`
      + `<small class="expansion-suggest"><b>제안</b> ${row.suggest.map((text) => `「${esc(text)}」`).join(" · ")}</small>`
      + `${row.note ? `<small class="expansion-basis">${esc(row.note)}</small>` : ""}</li>`).join("");
    return `<article><h3>${esc(title)}</h3><p class="expansion-hint">${esc(hint)}</p><ol class="expansion-list ${kind}">${list}</ol></article>`;
  }
  function sampleReportHtml(sample) {
    const held = sample.held.map((row) => `<li class="${Number(row.code) >= REPORT_SERVICE_FLOOR ? "svc" : "goods"}">`
      + `<b>${esc(niceClassLabel(row.code))}</b><span>${number(row.count)}건</span>`
      + `<small>${row.goods.map(esc).join(" · ")}</small></li>`).join("");
    return `<section class="expansion-report sample">
      <div class="section-heading"><div><h2>${esc(sample.name)} 확장 경로 진단<em class="sample-tag">예시</em></h2></div><span>${esc(sample.category)} · ${esc(sample.region)}</span></div>
      <p class="expansion-lede">${sample.lede}</p>
      <div class="expansion-grid">
        <article><h3>① 지정상품이 확인된 범위</h3><ul class="expansion-held">${held}</ul></article>
        ${sampleSectionHtml("② 다음 확장 후보", "같은 유형이 이미 확보했는데 이 품목만 비어 있는 상품류입니다.", sample.next, "")}
        ${sampleSectionHtml("③ 이색 확장 사례", "선례가 드문 만큼 차별화 여지도 큰 구간입니다.", sample.unusual, "rare")}
        ${sampleSectionHtml("④ 서비스 · 지역 창업", "제품이 아니라 파는 행위·체험에 붙이는 권리입니다(35류 이상).", sample.service, "svc")}
        <article class="expansion-region"><h3>⑤ ${esc(sample.region)} 관점</h3><p class="expansion-hint">${sample.regional}</p></article>
      </div>
    </section>`;
  }
  function sampleReportsHtml() {
    return `<details class="sample-reports"><summary><span>예시 보고서 ${number(SAMPLE_EXPANSION_REPORTS.length)}건 보기</span>`
      + `<small>${SAMPLE_EXPANSION_REPORTS.map((s) => esc(s.name)).join(" · ")}</small></summary>`
      + `<p class="sample-banner"><b>이 다섯 건은 데이터가 아닙니다.</b> 지정상품 대조가 질의한 상품류 안쪽만 남기는 구조라, 지금 집계로는 확장 경로가 원물 한 칸으로 눌립니다. 데이터가 갖춰졌을 때 이 화면이 무엇을 보여 주는지를 <b>사람이 손으로 쓴 가상 예시</b>입니다 — 건수·문안 모두 실제 출원 현황이 아니며 그대로 인용하면 안 됩니다.</p>`
      + SAMPLE_EXPANSION_REPORTS.map(sampleReportHtml).join("")
      + `</details>`;
  }
  function strategyFlowHtml() {
    const all = strategyFlowRows();
    const heading = `<div class="section-heading"><div><h2>품목별 비즈니스 확장 경로</h2></div><span>전국 상표DB 기준 · 지역 한정 아님</span></div><p class="screen-note">품목을 고르면 그 품목의 전국 상표 활동을 보여줍니다. 특정 지역의 현황이 아니라 전체 상표DB에서 탐색한 결과입니다. 전국 흐름 배치가 반영된 품목은 <strong>원물 → 가공품 → 서비스</strong> 단계별 <strong>지정상품</strong>과 확장 방향 제안까지 함께 나옵니다.</p>`;
    if (all.length === 0) return `${heading}<p class="empty">표시할 품목이 없습니다.</p>`;
    const keyword = state.strategyItemQuery.trim().toLocaleLowerCase("ko-KR");
    const filtered = keyword ? all.filter((row) => row.name.toLocaleLowerCase("ko-KR").includes(keyword) || (row.category?.label || "").toLocaleLowerCase("ko-KR").includes(keyword)) : all;
    const selected = filtered.find((row) => row.name === state.strategyItem) || filtered[0] || null;
    // 목록은 출원이 많은 순이다(strategyFlowRows). 무슨 기준의 토글인지 이름으로 밝힌다.
    const chips = `<div class="strategy-picker-group"><span class="strategy-picker-label">다출원 특산품 ${number(STRATEGY_CHIP_LIMIT)}선</span><div class="strategy-item-chips" role="group" aria-label="다출원 특산품 선택">${all.slice(0, STRATEGY_CHIP_LIMIT).map((row) => `<button type="button" data-strategy-item="${esc(row.name)}" class="${selected && selected.name === row.name ? "active" : ""}">${esc(row.name)}<small>${number(row.flow ? row.flow.totalCount : row.trademarks)}</small></button>`).join("")}</div></div>`;
    // 지역을 함께 고르면 보고서에 ⑤ 지역 관점 절이 붙는다.
    const regionPicker = `<label class="search-field strategy-region-select"><span class="sr-only">지역 선택</span><select id="strategy-region"><option value="">지역 선택 안 함 (전국 기준)</option>${strategyProvinces().map((province) => `<option value="${esc(province)}" ${state.strategyRegion === province ? "selected" : ""}>${esc(displayRegionName(province))}</option>`).join("")}</select></label>`;
    const picker = `<div class="strategy-item-picker">${chips}<div class="strategy-picker-inputs"><label class="search-field strategy-item-search"><span class="sr-only">품목 직접 검색</span><input type="search" id="strategy-item-search" value="${esc(state.strategyItemQuery)}" placeholder="품목명 직접 입력 · 전체 ${all.length}개 · 엔터로 검색"></label>${regionPicker}</div></div>`;
    const searchNote = keyword ? `<p class="screen-note">검색 결과 ${filtered.length}개${selected ? ` · ${esc(selected.name)} 표시 중` : ""}</p>` : "";
    if (!selected) return `${heading}${picker}${searchNote}<p class="empty">검색 결과가 없습니다.</p>`;
    const origins = [...selected.regions].sort((a, b) => (selected.regionCounts[b] || 0) - (selected.regionCounts[a] || 0)).slice(0, 3);
    const lb = computeLeaderboard();
    // 현재 main의 computeLeaderboard는 급증을 surging 하나로 돌려준다(가속/신규진입 분리는
    // #181 머지에서 되돌아갔다) — 그 API에 맞춘다.
    const surging = lb.surgingApplications.some((s) => s.name === selected.name);
    const briefingItem = selected.matchedItems.find((e) => e.briefing && e.briefing.isGapAlert && e.briefing.sentences.length) || selected.matchedItems.find((e) => e.briefing && e.briefing.sentences.length);
    const briefingHtml = briefingItem ? `${businessStrategyCardHtml(briefingItem.briefing, `${selected.name} 지역 브랜드 진단`)}${businessStrategyDisclaimerHtml(briefingItem.briefing.templateVersion)}` : "";
    // 협업자 요청(#116 2026-08-26): 전국 상표 중 지역별 출원 비중도 함께.
    const shareHtml = `<section class="item-share-block"><div class="section-heading"><div><h2>${esc(selected.name)} 광역 단위 출원 비중</h2></div><span>지역 주소 일치 출원 ${number(selected.trademarks)}건 기준</span></div>${shareDonutHtml(selected.provinceCounts, selected.name)}</section>`;
    const trendHtml = regionTrendHtml({ region: selected.name, items: selected.matchedItems }, "연도별 출원·등록 추이", `${selected.name} · 전체 지역 합계`, { prominent: true, emptyLabel: "이 품목은 아직 연도별 데이터가 없습니다." });
    const flowPartHtml = selected.flow
      ? `${nationwideFlowCardHtml(selected.flow, selected.name, origins)}${expansionSuggestionsHtml(selected.flow, selected.name, surging)}`
      : '<p class="strategy-flow-pending">이 품목은 전국 흐름(원물 → 가공품 → 서비스) 배치가 아직 반영되지 않아 단계별 지정상품·확장 방향 제안이 비어 있습니다. 아래 지역 확인 출원 현황은 지금 데이터입니다.</p>';
    return `${heading}${picker}${searchNote}${sampleReportsHtml()}<div class="strategy-flow-detail">${expansionReportHtml(selected, state.strategyRegion)}${flowPartHtml}${shareHtml}${trendHtml}${briefingHtml}</div>`;
  }

  function strategyScreen() {
    const rows = strategyRows();
    const flowHtml = strategyFlowHtml();
    if (rows.length === 0) return `<section class="screen-section strategy-screen">${flowHtml}<p class="screen-note">지역×품목 단위 비즈니스 확장 전략 브리핑입니다. 표에서 행을 고르면 오른쪽에 브리핑과 근거가 열립니다. <b>지역 확인 출원</b>은 출원인 주소가 그 지역과 일치한 확정 건수, <b>전국 검색</b>은 같은 품목명의 전국 검색 결과(지역 확인 전 후보)로 서로 다른 모집단이며, <b>전국 대비</b>는 두 값의 비율입니다.</p><p class="empty">아직 표시할 브리핑이 없습니다.</p></section>`;
    const filteredRows = strategyRowsFiltered(rows);
    const selected = filteredRows.find((row) => row.key === state.strategySelectedKey) || filteredRows[0] || null;
    // 528건 표를 한 번에 다 그리면 상세 패널이 축소 화면(1단 적층)에서 한참 아래로 밀린다.
    // S5(품목별 조회)와 같은 방식으로 상위 100건만 먼저 보여주고 "전체 보기"로 확장한다.
    const visibleRows = state.strategyShowAll ? filteredRows : filteredRows.slice(0, STRATEGY_ROW_LIMIT);
    currentCsvExporters.strategyTable = () => downloadCsv(`비즈니스전략_${csvDateStamp(dashboardUpdatedAt)}`, ["지역", "품목", "지역 확인 출원", "전국 검색", "전국 대비", "등록률", "지역 출원인 비중", "판정"], filteredRows.map((row) => [row.regionLabel, row.itemLabel, row.uniqueTrademarkCount, nationwideCountLabel(row.nationwideCount, row.nationwideCapped), nationwideShareLabel(row.nationwideShare, row.nationwideCapped), row.registrationRate !== null ? percent(row.registrationRate) : "", row.localApplicantShare !== null ? percent(row.localApplicantShare) : "", row.isGapAlert ? "공백 알림" : "양호"]));
    const headHtml = STRATEGY_COLUMNS.map(([key, label]) => `<th aria-sort="${state.strategySortKey !== key ? "none" : state.strategySortDir === "asc" ? "ascending" : "descending"}"><button type="button" data-strategy-sort="${key}" class="${state.strategySortKey === key ? "active" : ""}">${esc(label)}${state.strategySortKey === key ? `<span aria-hidden="true">${state.strategySortDir === "asc" ? " ▲" : " ▼"}</span>` : ""}</button></th>`).join("");
    const bodyRowsHtml = filteredRows.length === 0
      ? `<tr><td colspan="8" class="empty">검색 결과가 없습니다.</td></tr>`
      : visibleRows.map((row) => `<tr data-strategy-row="${esc(row.key)}" class="${selected?.key === row.key ? "active" : ""}" tabindex="0" role="button" aria-pressed="${selected?.key === row.key}"><td>${esc(row.regionLabel)}</td><td>${esc(row.itemLabel)}${row.policyTier ? `<em class="crop-badge crop-badge-${esc(row.policyTier)}" title="농촌진흥청 지역특화작목">${esc(row.policyTier)}</em>` : ""}</td><td>${row.uniqueTrademarkCount !== null ? `${number(row.uniqueTrademarkCount)}건` : "—"}</td><td class="strategy-nationwide"${row.nationwideCapped ? ` title="${esc("검색 상한(1,800건)에 걸려 실제 전국 건수는 이보다 많습니다")}"` : ""}>${nationwideCountLabel(row.nationwideCount, row.nationwideCapped)}</td><td class="strategy-nationwide"${row.nationwideCapped ? ` title="${esc("분모가 검색 상한에 걸려 실제 비중은 이보다 작습니다")}"` : ""}>${nationwideShareLabel(row.nationwideShare, row.nationwideCapped)}</td><td>${row.registrationRate !== null ? percent(row.registrationRate) : "—"}</td><td>${row.localApplicantShare !== null ? percent(row.localApplicantShare) : "—"}</td><td>${row.isTopPriority ? `<span class="strategy-table-badge priority" title="${esc("정책이 육성하기로 지정한 작목인데 지역 확인 출원이 0건입니다")}">최우선</span>` : `<span class="${row.isGapAlert ? "strategy-table-badge alert" : "strategy-table-badge"}">${row.isGapAlert ? "공백 알림" : "양호"}</span>`}</td></tr>`).join("");
    const showAllButtonHtml = !state.strategyShowAll && filteredRows.length > STRATEGY_ROW_LIMIT ? `<button type="button" id="strategy-show-all" class="item-list-show-all">전체 ${number(filteredRows.length)}건 보기 →</button>` : "";
    const countNoteHtml = !state.strategyShowAll && filteredRows.length > STRATEGY_ROW_LIMIT ? `상위 ${STRATEGY_ROW_LIMIT}건 표시 · 전체 ${filteredRows.length}건` : `전체 ${filteredRows.length}건`;
    const tableHtml = `<div class="strategy-table-wrap"><table class="strategy-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyRowsHtml}</tbody></table><p class="screen-note">${countNoteHtml} 중 행을 고르면 오른쪽에 상세가 열립니다.</p>${showAllButtonHtml}</div>`;
    const detailHtml = selected && !selected.item.briefing
      ? `<div class="strategy-no-briefing"><strong>${esc(selected.regionLabel)} · ${esc(selected.itemLabel)}</strong><p>정책이 육성하기로 지정한 작목인데 지역 주소가 확인된 상표 출원이 <b>0건</b>입니다. 자동 생성 브리핑은 출원 실적이 있는 품목에만 만들어지므로 아직 없습니다 — 권리화를 먼저 검토할 대상입니다.</p><button type="button" class="strategy-jump-link" data-open-region="${esc(regionKey(selected.region))}" data-open-item="${esc(selected.item.specialtyId || "")}">지자체별 조회에서 자세히 보기 →</button></div>`
      : selected

      ? `${businessStrategyCardHtml(selected.item.briefing, `${selected.regionLabel} · ${selected.itemLabel}`, `<button type="button" class="strategy-jump-link" data-open-region="${esc(regionKey(selected.region))}" data-open-item="${esc(selected.item.specialtyId || "")}">지자체별 조회에서 자세히 보기 →</button>`, { count: selected.nationwideCount, share: selected.nationwideShare, capped: selected.nationwideCapped })}${businessStrategyDisclaimerHtml(selected.item.briefing.templateVersion)}`
      : `<p class="empty">검색 결과가 없어 상세를 표시할 수 없습니다.</p>`;
    const toolbarHtml = `<div class="strategy-table-toolbar"><label class="strategy-filter-field"><span>지역·품목 검색</span><input type="search" id="strategy-filter-input" value="${esc(state.strategyFilter)}" placeholder="지역명 또는 품목명 · 엔터로 검색"></label><label class="strategy-policy-filter"><input type="checkbox" id="strategy-policy-only"${state.strategyPolicyOnly ? " checked" : ""}><span>특화작목만</span><b>${number(rows.filter((row) => row.isTopPriority).length)}건 최우선</b></label>${csvDownloadButtonHtml("strategyTable")}</div>`;
    return `<section class="screen-section strategy-screen">${flowHtml}<details class="strategy-table-toggle"><summary><span>지역×품목 공백 알림 표 전체 보기</span><small>${number(rows.length)}건</small></summary><p class="screen-note">지역×품목 단위 비즈니스 확장 전략 브리핑입니다. 표에서 행을 고르면 오른쪽에 브리핑과 근거가 열립니다. <b>지역 확인 출원</b>은 출원인 주소가 그 지역과 일치한 확정 건수, <b>전국 검색</b>은 같은 품목명의 전국 검색 결과(지역 확인 전 후보)로 서로 다른 모집단이며, <b>전국 대비</b>는 두 값의 비율입니다.</p>${toolbarHtml}<div class="strategy-table-layout">${tableHtml}<aside class="strategy-detail">${detailHtml}</aside></div></details></section>`;
  }
  // 2026-09-08: 특화작목 비교는 단위가 "도"라 지역별 화면에서 시도를 고른 것과 같은 단위다.
  // 최상위 탭에서 내려 지역별 화면 안에 끼워 넣는다(탭 4개 → 3개).
  function compareEmbedHtml() {
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
        return { name, displayName: stripParens(name), tier: group.tier, decided, applications, applied: applications > 0 };
      }).sort((a, b) => a.tier.localeCompare(b.tier, "ko-KR") || a.name.localeCompare(b.name, "ko-KR"));
      const policyApplicationsTotal = policyCrops.reduce((sum, crop) => sum + crop.applications, 0);
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
      return { province, policyCrops, policyApplicationsTotal, policyDecided, policyApplied, policyRate: policyCrops.length ? policyApplied / policyCrops.length : null, topRegisteredItems, flagshipCrop, flagshipMatch, flagshipRank };
    }).filter((row) => row.policyCrops.length > 0).sort((a, b) => compareProvince(a.province, b.province));
    const flagshipRowsHtml = comparisonRows.filter((row) => row.flagshipCrop).map(({ province, flagshipCrop, topRegisteredItems, flagshipMatch, flagshipRank }) => `<div class="compare-flagship-row"><strong>${esc(displayRegionName(province))}</strong><div class="compare-flagship-name">${esc(stripParens(flagshipCrop.name))}</div><ol class="compare-top5-list">${topRegisteredItems.length === 0 ? '<li class="empty">등록 상표 없음</li>' : topRegisteredItems.map((row, index) => `<li class="${row.name === flagshipCrop.name ? "match" : ""}">${index + 1}. ${esc(stripParens(row.name))} <b>${number(row.count)}건</b></li>`).join("")}</ol><span class="${flagshipMatch ? "compare-flagship-match" : "compare-flagship-mismatch"}">${flagshipMatch ? `일치 · ${flagshipRank + 1}위` : "불일치"}</span></div>`).join("");
    const flagshipMatchCount = comparisonRows.filter((row) => row.flagshipMatch).length;
    // 이슈 #117: 표 컬럼 — 지역 / 대표 / 자체육성 / 집중육성 / 출원건수(원물) / 출원 비율 / 상태
    const tierCellHtml = (crops) => crops.length === 0 ? '<span class="compare-tier-empty">—</span>' : `<span class="compare-tier-crops">${crops.map((crop) => `<em class="${crop.applied ? "filed" : crop.decided ? "unfiled" : "pending"}">${esc(crop.displayName)}</em>`).join("")}</span>`;
    const rowsHtml = comparisonRows.map(({ province, policyCrops, policyApplicationsTotal, policyDecided, policyApplied, policyRate }) => `<div class="compare-region-row"><strong>${esc(displayRegionName(province))}</strong>${tierCellHtml(policyCrops.filter((c) => c.tier === "대표작목"))}${tierCellHtml(policyCrops.filter((c) => c.tier === "자체육성작목"))}${tierCellHtml(policyCrops.filter((c) => c.tier === "집중육성작목"))}<b>${number(policyApplicationsTotal)}건</b><div class="compare-region-rate"><b>${percent(policyRate)}</b><small>${policyApplied}/${policyCrops.length}작목</small></div><span class="${policyDecided === policyCrops.length ? "compare-complete" : "compare-waiting"}">${policyDecided}/${policyCrops.length}${policyDecided === policyCrops.length ? " 완료" : ""}</span></div>`).join("");
    currentCsvExporters.compareRegion = () => downloadCsv(`특화작목비교_${csvDateStamp(dashboardUpdatedAt)}`, ["지역", "특화작목(대표)", "특화작목(자체육성)", "특화작목(집중육성)", "상표 출원건수(원물 기준)", "특화작물의 상표 출원 비율", "출원 확인 작목 수", "전체 작목 수", "집계상태"], comparisonRows.map((row) => { const byTier = (tier) => row.policyCrops.filter((crop) => crop.tier === tier).map((crop) => crop.displayName).join("·"); return [displayRegionName(row.province), byTier("대표작목"), byTier("자체육성작목"), byTier("집중육성작목"), row.policyApplicationsTotal, percent(row.policyRate), row.policyApplied, row.policyCrops.length, `${row.policyDecided}/${row.policyCrops.length}`]; }));
    currentCsvExporters.compareFlagship = () => downloadCsv(`대표작목TOP5대조_${csvDateStamp(dashboardUpdatedAt)}`, ["도", "대표작목(정책 지정)", "실제 등록 상표 TOP5", "일치 여부"], comparisonRows.filter((row) => row.flagshipCrop).map((row) => [displayRegionName(row.province), stripParens(row.flagshipCrop.name), row.topRegisteredItems.map((item, index) => `${index + 1}. ${stripParens(item.name)}(${item.count}건)`).join(" / ") || "등록 상표 없음", row.flagshipMatch ? `일치 · ${row.flagshipRank + 1}위` : "불일치"]));
    const regionSectionHtml = `<section class="compare-region-section"><div class="compare-section-head"><div><span>69개 전체 상세</span><h2>등급별 특화작목 출원 현황</h2></div><p>상표 출원건수는 각 특화작목의 원물명 검색 기준 지역 주소 일치 출원 합계, 특화작물의 상표 출원 비율은 출원이 1건 이상 확인된 작목 비율입니다.</p>${csvDownloadButtonHtml("compareRegion")}</div><div class="compare-region-table"><div class="compare-region-head"><span>지역</span><span>특화작목<small>대표</small></span><span>특화작목<small>자체육성</small></span><span>특화작목<small>집중육성</small></span><span>상표 출원건수<small>원물 기준</small></span><span>특화작물의<small>상표 출원 비율</small></span><span title="판정이 끝난 작목 수 / 전체 지정 작목 수">집계상태</span></div>${rowsHtml}</div><p class="compare-region-scroll-hint">← 표가 화면보다 넓습니다. 좌우로 스크롤하면 전체 열을 볼 수 있습니다(지역명 열은 고정).</p></section>`;
    const flagshipSectionHtml = `<section class="compare-flagship-section"><div class="compare-section-head"><div><span>대표작목 우선순위 대조</span><h2>도별 대표작목 vs 실제 등록 상표 TOP5</h2></div><p>도 대표작목(농촌진흥청 지정 1개)이 그 도의 <b>등록 완료</b> 상표 상위 5개 품목 안에 실제로 있는지 대조합니다. 출원 중인 건은 포함하지 않습니다.</p>${csvDownloadButtonHtml("compareFlagship")}</div><div class="compare-flagship-table"><div class="compare-flagship-head"><span>도</span><span>대표작목(정책 지정)</span><span>실제 등록 상표 TOP5</span><span>일치</span></div>${flagshipRowsHtml}</div><p class="compare-flagship-note">9개 도 중 ${flagshipMatchCount}개 도에서 대표작목과 실제 등록 상표를 주도하는 품목이 일치합니다. 나머지 도는 정책상 육성 중인 작목과 실제 브랜드 출원을 주도하는 품목이 다르다는 뜻입니다 — 특화작목이 아직 상표 등록으로 이어지지 않았거나, 쌀·소고기 같은 범용 품목이 여전히 지역 브랜드 활동을 주도하고 있을 수 있습니다.</p></section>`;
    // UI 검토(3차, 2026-09-06) S4: 9개 도 × 8개 열 넓은 표 대신, 도 스트립에서 하나를
    // 고르면 그 도만 상세로 보여준다(전체 표는 details 토글 뒤로).
    // 지역별 화면에서 시도를 이미 골랐으면 그 도로 고정한다(도 스트립은 그때 숨긴다).
    const pinned = state.province && comparisonRows.some((row) => row.province === state.province) ? state.province : null;
    const activeProvince = pinned || (state.compareProvince && comparisonRows.some((row) => row.province === state.compareProvince) ? state.compareProvince : comparisonRows[0]?.province || null);
    const activeRow = comparisonRows.find((row) => row.province === activeProvince) || null;
    const stripHtml = `<div class="compare-province-strip" role="group" aria-label="도 선택"${pinned ? " hidden" : ""}>${comparisonRows.map((row) => `<button type="button" data-compare-province="${esc(row.province)}" class="${activeProvince === row.province ? "active" : ""}"><strong>${esc(displayRegionName(row.province))}</strong><span class="${row.flagshipCrop ? (row.flagshipMatch ? "compare-strip-match" : "compare-strip-mismatch") : "compare-strip-none"}">${row.flagshipCrop ? (row.flagshipMatch ? "일치" : "불일치") : "대표작목 없음"}</span></button>`).join("")}</div>`;
    const detailHtml = activeRow ? `<div class="compare-province-detail"><div class="compare-section-head"><div><span>${activeRow.policyDecided}/${activeRow.policyCrops.length} 집계 완료</span><h2>${esc(displayRegionName(activeRow.province))} 특화작목 출원 현황</h2></div><p>상표 출원건수는 각 특화작목의 원물명 검색 기준 지역 주소 일치 출원 합계, 특화작물의 상표 출원 비율은 출원이 1건 이상 확인된 작목 비율입니다.</p></div><div class="compare-province-tiers"><div><span>특화작목<small>대표</small></span>${tierCellHtml(activeRow.policyCrops.filter((c) => c.tier === "대표작목"))}</div><div><span>특화작목<small>자체육성</small></span>${tierCellHtml(activeRow.policyCrops.filter((c) => c.tier === "자체육성작목"))}</div><div><span>특화작목<small>집중육성</small></span>${tierCellHtml(activeRow.policyCrops.filter((c) => c.tier === "집중육성작목"))}</div></div><div class="compare-province-stats"><div><span>상표 출원건수<small>원물 기준</small></span><b>${number(activeRow.policyApplicationsTotal)}건</b></div><div><span>특화작물의 상표 출원 비율</span><b>${percent(activeRow.policyRate)}</b><small>${activeRow.policyApplied}/${activeRow.policyCrops.length}작목</small></div></div>${activeRow.flagshipCrop ? `<div class="compare-province-flagship"><h3>대표작목 vs 실제 등록 상표 TOP5</h3><p><b>${esc(stripParens(activeRow.flagshipCrop.name))}</b>(대표작목)이 <b>등록 완료</b> 상표 상위 5개 품목 안에 실제로 있는지 대조합니다. 출원 중인 건은 포함하지 않습니다.</p><ol class="compare-top5-list">${activeRow.topRegisteredItems.length === 0 ? '<li class="empty">등록 상표 없음</li>' : activeRow.topRegisteredItems.map((row, index) => `<li class="${row.name === activeRow.flagshipCrop.name ? "match" : ""}">${index + 1}. ${esc(stripParens(row.name))} <b>${number(row.count)}건</b></li>`).join("")}</ol><span class="${activeRow.flagshipMatch ? "compare-flagship-match" : "compare-flagship-mismatch"}">${activeRow.flagshipMatch ? `일치 · ${activeRow.flagshipRank + 1}위` : "불일치"}</span></div>` : ""}</div>` : "";
    if (state.province && !comparisonRows.some((row) => row.province === state.province)) return "";
    return `<section class="compare-embed"><div class="section-heading"><div><h2>특화작목 대조</h2></div><span>농촌진흥청 2025년 지정 9개 도·69개 작목 vs 지역 주소 일치 상표</span></div><div class="compare-tier-tiles"><article class="compare-tier-tile crop-badge-대표작목"><span>대표작목</span><strong>9</strong></article><article class="compare-tier-tile crop-badge-집중육성작목"><span>집중육성작목</span><strong>18</strong></article><article class="compare-tier-tile crop-badge-자체육성작목"><span>자체육성작목</span><strong>42</strong></article></div><section class="compare-province-detail-section">${stripHtml}${detailHtml}</section><details class="compare-full-tables-toggle"><summary><span>9개 도 전체 표로 보기</span><small>클릭하면 펼쳐집니다</small></summary>${regionSectionHtml}${flagshipSectionHtml}</details><div class="compare-sources"><article><span>공식 근거</span><strong>농촌진흥청 2025년도 지역특화작목 현황</strong><p>제1차 종합계획(2021~2025) 종료 시점의 69개 배정을 사용합니다.</p></article><article><span>지역 판정</span><strong>출원인 주소를 도 단위로 대조</strong><p>검색 상한은 집계 대기로 구분합니다.</p></article></div></section>`;
  }

  // 데이터 개요 탭에서만 한 번 보여준다(2026-08-19: 요약 탭에 있을 필요가 없다는
  // 피드백에 따라 데이터 개요로 옮김. 그 전에는 모든 탭에 반복 노출하던 것을 정리했었음).
  function criteriaHtml() {
    const rows = [
      ["품목", "지정상품명 확인", '등록원부 지정상품명이 고시상품명칭과 일치하거나 품목명을 포함한 사례만 상세 화면에 표시합니다. NICE류만 일치하거나 검색어로만 포착된 후보는 확인 사례에 포함하지 않습니다. 대부분의 "출원 확인" 건수는 품목명 검색어와 출원인 주소까지 확인된 집계이며, 등록원부 지정상품 확인은 계속 보완 중입니다.'],
      ["지역", "법정동코드 완전일치", "국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만"],
      ["검색", "KIPRIS 고시명칭·NICE류", "검색·집계 키는 고시명칭 + NICE류이며, 상표명은 개별 사례로만 보존하고 집계 키로 쓰지 않음. 현재 수치는 각 특산품에 매핑된 고시상품 NICE류 기준입니다. 음식점업 43류·도소매업 35류 등 서비스류는 포함하지 않으며 후속 확장 검토 대상입니다."],
      ["지역 출원", "출원인·권리자 주소 일치", "등록 완료 건은 등록원부의 권리자 소재지, 출원만 된 건은 출원인정보 API의 출원인 소재지 기준입니다. 등록률은 그중 상표 상태가 등록 완료인 건수 ÷ 지역 주소 일치 출원 건수이며, 전국 검색 후보와 주소 미확보 건은 제외합니다."],
      ["주소", "확보율은 참고 지표", "주소가 확인된 건은 지역 귀속에 반영하고, 미확보 건도 원자료와 확보율을 함께 표시합니다. 공동출원인은 전원 일치가 원칙이나, 그중 영농조합·협동조합·지자체 등 지역 생산 주체가 해당 지역이면 인정합니다."],
    ];
    return `<section class="criteria" aria-label="판정 기준과 매칭 방법"><strong class="criteria-title">판정 기준과 매칭 방법</strong><div class="criteria-line">${rows.map(([label, value, note]) => `<span title="${esc(note)}"><b>${esc(label)}</b> ${esc(value)}</span>`).join("")}</div><span class="criteria-source" title="${esc(sourceLine)}">출처 ${snapshot.sources.length}개</span></section>`;
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
    return `<section class="provenance"><div class="section-heading"><div><h2>출처와 데이터 상태</h2></div><span>${esc(snapshot.schemaVersion)}</span></div><div class="source-table-wrap"><table class="source-table"><caption class="sr-only">데이터별 출처와 수집 상태</caption><thead><tr><th scope="col">그룹</th><th scope="col">데이터명</th><th scope="col">수집 항목</th><th scope="col">출처</th><th scope="col">수집 소스</th><th scope="col">수집 방법</th><th scope="col">최근 수집 일자</th></tr></thead><tbody>${rows}<tr><td><span class="source-group">지역 정보</span></td><th scope="row">지도 경계</th><td>시도·시군구 경계 도형</td><td><a href="${esc(geometry.boundaryReference.sourceUrl)}" target="_blank" rel="noreferrer">공식 원본 ↗</a></td><td>${esc(geometry.boundaryReference.sourceName)}</td><td>경계 파일 생성·코드 조인</td><td>${esc(boundaryDate)}</td></tr></tbody></table></div></section>`;
  }
  function bind() {
    const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
    // 지역 드릴다운 시 좌측 아코디언·광역 탭바가 그 지역의 시도를 가리키도록 맞춘다.
    const syncRegionProvince = (key) => { const r = snapshot.regions.find((row) => regionKey(row) === key); if (r) { const p = r.sido || r.region; state.selectedRegionProvince = p; state.expandedRegionProvince = p; } };
    document.querySelectorAll("[data-map-metric]").forEach((button) => { button.onclick = () => { state.mapMetric = button.dataset.mapMetric; render(); }; });
    document.querySelectorAll("[data-trend-size]").forEach((button) => { button.onclick = () => { const size = button.dataset.trendSize; document.documentElement.dataset.trendSize = size; try { localStorage.setItem("kiip-trend-size", size); } catch (error) { /* private mode 등 */ } }; });
    document.querySelectorAll("[data-province]").forEach((shape) => { const open = () => { state.province = shape.dataset.province; state.municipality = null; render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
    document.querySelectorAll("[data-municipality]").forEach((shape) => { const open = () => { state.municipality = shape.dataset.municipality; const region = findMunicipalityRegion(state.province, state.municipality); if (region) { state.regionKey = regionKey(region); syncRegionProvince(state.regionKey); } render(); }; shape.onclick = open; shape.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) open(); }; });
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
    // #136: 요약 화면의 전국 추이에도 동일한 직접 입력·양 끝 드래그 기간 조절을 제공한다.
    const summaryStartInput = document.querySelector("#summary-trend-start-input"); if (summaryStartInput) summaryStartInput.onchange = (event) => { state.summaryTrendStartYear = Number(event.currentTarget.value) || null; render(); };
    const summaryEndInput = document.querySelector("#summary-trend-end-input"); if (summaryEndInput) summaryEndInput.onchange = (event) => { state.summaryTrendEndYear = Number(event.currentTarget.value) || null; render(); };
    const summaryTrendYearFromTrack = (clientX) => {
      const track = document.querySelector("#summary-trend-range-track");
      if (!track) return null;
      const fullStart = Number(track.dataset.fullStart), fullEnd = Number(track.dataset.fullEnd);
      if (fullEnd <= fullStart) return fullStart;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return fullStart;
      return Math.round(fullStart + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (fullEnd - fullStart));
    };
    const bindSummaryHandle = (id, stateKey) => {
      const handle = document.querySelector(id);
      if (!handle) return;
      handle.onpointerdown = (event) => {
        document.documentElement.setPointerCapture(event.pointerId);
        document.documentElement.onpointermove = (moveEvent) => { if (moveEvent.buttons !== 1) return; const year = summaryTrendYearFromTrack(moveEvent.clientX); if (year === null) return; state[stateKey] = year; render(); };
        document.documentElement.onpointerup = (upEvent) => { document.documentElement.releasePointerCapture(upEvent.pointerId); document.documentElement.onpointermove = null; document.documentElement.onpointerup = null; };
      };
      handle.onkeydown = (event) => { const value = Number(handle.dataset.value), min = Number(handle.getAttribute("aria-valuemin")), max = Number(handle.getAttribute("aria-valuemax")); if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); state[stateKey] = Math.max(min, value - 1); render(); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); state[stateKey] = Math.min(max, value + 1); render(); } };
    };
    bindSummaryHandle("#summary-trend-range-handle-start", "summaryTrendStartYear");
    bindSummaryHandle("#summary-trend-range-handle-end", "summaryTrendEndYear");
    // 이슈 #112: 요약 탭에서 지역/품목을 클릭해 지자체별 조회로 이동할 때 그 지역의
    // 시/도 아코디언을 자동으로 펼치지 않는다 — 전체 시/도 목록이 평소 상태(접힘)
    // 그대로 보이게 한다. 좌측 목록에서 직접 아코디언을 펼치는 클릭(data-region-group)은
    // 그대로 유지된다.
    document.querySelectorAll("[data-goto-tab]").forEach((button) => { button.onclick = () => { const next = button.dataset.gotoTab; if (next !== state.tab) resetScreenDefaults(); state.tab = next; render(); }; });
    // 이슈 #118: 동향(리더보드) 컨트롤 + 항목 클릭 → 품목별 조회.
    document.querySelectorAll("[data-leader-window]").forEach((button) => { button.onclick = () => { state.leaderMonths = Number(button.dataset.leaderWindow); render(); }; });
    document.querySelectorAll("[data-leader-metric]").forEach((button) => { button.onclick = () => { state.leaderMetric = button.dataset.leaderMetric; render(); }; });
    document.querySelectorAll("[data-goto-item]").forEach((button) => { button.onclick = () => { state.itemQuery = ""; state.categoryFilter = ""; state.itemShowAll = true; state.selectedItemName = button.dataset.gotoItem; state.tab = "items"; render(); scrollTop(); }; });
    document.querySelectorAll("[data-goto-category]").forEach((button) => { button.onclick = () => { state.itemQuery = ""; state.selectedItemName = ""; state.categoryFilter = button.dataset.gotoCategory; state.tab = "items"; render(); scrollTop(); }; });

    // 이슈 #116: 지역·품목을 새로 고르면 상세가 바뀌는데 스크롤이 이전 상세를 읽던 자리에
    // 남는다(특히 데이터 없는 품목은 빈 화면 하단만). 선택 시 화면 최상단으로 올린다.
    document.querySelectorAll("[data-open-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.openRegion; state.itemId = button.dataset.openItem; state.tab = "regions"; syncRegionProvince(state.regionKey); render(); scrollTop(); }; });
    document.querySelectorAll("[data-region-group]").forEach((button) => { button.onclick = () => { const province = button.dataset.regionGroup; state.selectedRegionProvince = province; state.expandedRegionProvince = state.expandedRegionProvince === province ? null : province; state.regionKey = ""; state.itemId = ""; render(); }; });
    document.querySelectorAll("[data-province-tab]").forEach((button) => { button.onclick = () => { const province = button.dataset.provinceTab; state.selectedRegionProvince = province; state.expandedRegionProvince = province; state.regionKey = ""; state.itemId = ""; render(); scrollTop(); }; });
    document.querySelectorAll("[data-province-filter]").forEach((button) => { button.onclick = () => { state.province = button.dataset.provinceFilter || null; state.municipality = null; render(); scrollTop(); }; });
    document.querySelectorAll("[data-region]").forEach((button) => { button.onclick = () => { state.regionKey = button.dataset.region; state.itemId = ""; syncRegionProvince(state.regionKey); render(); scrollTop(); }; });
    document.querySelectorAll("[data-region-item]").forEach((button) => { button.onclick = () => { state.itemId = button.dataset.regionItem; render(); scrollTop(); }; });
    document.querySelectorAll("[data-kipris-application]").forEach((button) => { button.onclick = () => { const applicationNumber = button.dataset.kiprisApplication; navigator.clipboard?.writeText(applicationNumber).catch(() => {}); window.open(kiprisSearchUrl(applicationNumber), "kipris-search", "popup,width=1180,height=900,noopener"); }; });
    bindSearchInput("#region-search", "query");
    bindSearchInput("#region-directory-search", "regionQuery");
    // 유형 줄을 누르면 그 유형의 세부 품목 비중이 펼쳐진다(같은 줄을 다시 누르면 접힘).
    document.querySelectorAll("[data-category-detail]").forEach((tr) => {
      const toggle = () => { const label = tr.dataset.categoryDetail; state.categoryStatsPick = state.categoryStatsPick === label ? "" : label; render(); };
      tr.onclick = toggle;
      tr.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } };
    });
    bindSearchInput("#item-search", "itemQuery");
    document.querySelectorAll("[data-category-filter]").forEach((button) => { button.onclick = () => { state.categoryFilter = button.dataset.categoryFilter; state.selectedItemName = ""; state.itemShowAll = false; render(); }; });
    document.querySelectorAll("[data-item-region]").forEach((button) => { button.onclick = () => { const region = button.dataset.itemRegion; state.itemRegionPick = state.itemRegionPick === region ? "" : region; render(); }; });
    const regionTrademarkClose = document.querySelector("#region-trademark-close");
    if (regionTrademarkClose) regionTrademarkClose.onclick = () => { state.itemRegionPick = ""; render(); };
    const itemGapOnly = document.querySelector("#item-gap-only");
    if (itemGapOnly) itemGapOnly.onchange = () => { state.itemGapOnly = itemGapOnly.checked; state.selectedItemName = ""; render(); };
    const itemSortSelect = document.querySelector("#item-sort-select");
    if (itemSortSelect) itemSortSelect.onchange = (event) => { state.itemSort = event.currentTarget.value; render(); };
    // 이슈 #136(2026-09-07): 지역별 조회 정렬 + 지자체 목록의 "도 전체"(시군구 선택 해제).
    const policyOnly = document.querySelector("#strategy-policy-only");
    if (policyOnly) policyOnly.onchange = (event) => { state.strategyPolicyOnly = event.currentTarget.checked; render(); };
    const regionSortSelect = document.querySelector("#region-sort-select");
    if (regionSortSelect) regionSortSelect.onchange = (event) => { state.regionSort = event.currentTarget.value; render(); };
    document.querySelectorAll("[data-municipality-clear]").forEach((button) => { button.onclick = () => { state.municipality = null; render(); }; });
    const itemShowAllButton = document.querySelector("#item-show-all");
    if (itemShowAllButton) itemShowAllButton.onclick = () => { state.itemShowAll = true; render(); };
    document.querySelectorAll("[data-compare-province]").forEach((button) => { button.onclick = () => { state.compareProvince = button.dataset.compareProvince; render(); }; });
    document.querySelectorAll("[data-summary-ranking-metric]").forEach((button) => { button.onclick = () => { state.summaryRankingMetric = button.dataset.summaryRankingMetric; render(); }; });
    document.querySelectorAll("[data-select-item]").forEach((button) => { button.onclick = () => { state.selectedItemName = button.dataset.selectItem; render(); scrollTop(); }; });
    document.querySelectorAll("[data-strategy-row]").forEach((row) => {
      const select = () => { state.strategySelectedKey = row.dataset.strategyRow; render(); };
      row.onclick = select;
      row.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } };
    });
    const strategyShowAllButton = document.querySelector("#strategy-show-all");
    if (strategyShowAllButton) strategyShowAllButton.onclick = () => { state.strategyShowAll = true; render(); };
    document.querySelectorAll("[data-strategy-sort]").forEach((button) => { button.onclick = () => {
      const key = button.dataset.strategySort;
      if (state.strategySortKey === key) state.strategySortDir = state.strategySortDir === "asc" ? "desc" : "asc";
      else { state.strategySortKey = key; state.strategySortDir = key === "region" || key === "item" ? "asc" : "desc"; }
      render();
    }; });
    // UI 검토(#136) 03번: 각 화면 함수가 등록해 둔(currentCsvExporters) 내보내기 함수를
    // 버튼의 data-csv-export 이름으로 찾아 실행한다.
    document.querySelectorAll("[data-csv-export]").forEach((button) => { button.onclick = () => { currentCsvExporters[button.dataset.csvExport]?.(); }; });
    bindSearchInput("#strategy-filter-input", "strategyFilter");
    // 다출원 특산품 토글 · 품목 직접 입력 · 지역 선택(고르면 보고서에 ⑤ 지역 관점 절이 붙는다).
    document.querySelectorAll("[data-strategy-item]").forEach((button) => { button.onclick = () => { state.strategyItemQuery = ""; state.strategyItem = button.dataset.strategyItem; render(); }; });
    bindSearchInput("#strategy-item-search", "strategyItemQuery");
    const strategyRegionSelect = document.getElementById("strategy-region");
    if (strategyRegionSelect) strategyRegionSelect.onchange = () => { state.strategyRegion = strategyRegionSelect.value; render(); };
  }
  // UI 검토(#136, 2026-09-03) 02번: 탭과 지역·품목 선택을 아무리 바꿔도 주소창은 루트
  // 그대로였다(location.hash/search가 항상 빈 문자열) — 화면 상태를 링크로 공유·북마크할
  // 수 없고, 뒤로가기도 history.state에만 의존했다(#119 — 주소창은 안 바뀌어 실제로 다른
  // 화면을 봤다는 근거가 URL에 안 남음). 탭 전환마다 history 항목을 쌓던 그 로직을 확장해,
  // 화면과 관련된 선택값을 쿼리스트링(?tab=...&region=...&item=...)에도 반영한다.
  // React(Dashboard.tsx)의 NavParams와 같은 구조·필드명을 쓴다.
  const VALID_NAV_TABS = ["summary", "applications", "regions", "items", "strategy", "compare", "data"];
  const VALID_NAV_METRICS = ["trademarks", "registration", "coverage", "applicationCoverage"];
  // UI 검토(3차, 2026-09-06) N3: 지역별 화면의 연도 범위(state.trendStartYear/trendEndYear)는
  // 이 화면 안에 단일 인스턴스로 존재하는 공유 상태라 URL에 반영한다 — 요약·지역상세·
  // 품목상세의 추이(summaryTrendStartYear 등)는 여러 인스턴스가 동시에 있을 수 있어 뺀다.
  function parseNavParams(params) {
    const tabParam = params.get("tab");
    const metricParam = params.get("metric");
    const yearStartParam = Number(params.get("yearStart"));
    const yearEndParam = Number(params.get("yearEnd"));
    return {
      tab: VALID_NAV_TABS.includes(tabParam) ? tabParam : "summary",
      region: params.get("region"),
      municipality: params.get("municipality"),
      regionCode: params.get("regionCode") || "",
      item: params.get("item") || "",
      metric: VALID_NAV_METRICS.includes(metricParam) ? metricParam : "coverage",
      yearStart: Number.isFinite(yearStartParam) && params.get("yearStart") ? yearStartParam : null,
      yearEnd: Number.isFinite(yearEndParam) && params.get("yearEnd") ? yearEndParam : null,
    };
  }
  function currentNavParams() {
    return {
      tab: state.tab,
      region: state.tab === "regions" ? state.selectedRegionProvince : state.tab === "applications" ? state.province : null,
      municipality: state.tab === "applications" ? state.municipality : null,
      regionCode: state.tab === "regions" ? state.regionKey : "",
      item: state.tab === "regions" ? state.itemId : state.tab === "items" ? state.selectedItemName : state.tab === "strategy" ? state.strategySelectedKey : "",
      metric: state.tab === "summary" ? state.mapMetric : "coverage",
      yearStart: state.tab === "applications" ? state.trendStartYear : null,
      yearEnd: state.tab === "applications" ? state.trendEndYear : null,
    };
  }
  function navParamsToSearch(nav) {
    const params = new URLSearchParams();
    params.set("tab", nav.tab);
    if (nav.region) params.set("region", nav.region);
    if (nav.municipality) params.set("municipality", nav.municipality);
    if (nav.regionCode) params.set("regionCode", nav.regionCode);
    if (nav.item) params.set("item", nav.item);
    if (nav.metric !== "coverage") params.set("metric", nav.metric);
    if (nav.yearStart !== null && nav.yearStart !== undefined) params.set("yearStart", String(nav.yearStart));
    if (nav.yearEnd !== null && nav.yearEnd !== undefined) params.set("yearEnd", String(nav.yearEnd));
    return `?${params.toString()}`;
  }
  function applyNavToState(nav) {
    state.tab = nav.tab;
    // region/municipality는 URL 계약상 지역별 조회 탭의 상태다 — 다른 탭으로 복원할 때
    // 이전 지역 선택이 남아 요약이 전국이 아닌 지역 지도로 열리지 않도록 비운다(#136).
    if (nav.tab !== "applications") { state.province = null; state.municipality = null; }
    if (nav.tab === "applications") { state.province = nav.region; state.municipality = nav.municipality; state.trendStartYear = nav.yearStart ?? null; state.trendEndYear = nav.yearEnd ?? null; }
    else if (nav.tab === "regions") { if (nav.region) { state.selectedRegionProvince = nav.region; state.expandedRegionProvince = nav.region; } state.regionKey = nav.regionCode; state.itemId = nav.item; }
    else if (nav.tab === "items") state.selectedItemName = nav.item;
    else if (nav.tab === "strategy") state.strategySelectedKey = nav.item;
    else if (nav.tab === "summary") state.mapMetric = nav.metric;
  }
  // 최초 진입 시 URL을 읽어 화면 상태를 복원한다 — 아래 첫 render() 호출보다 먼저 실행돼야
  // 첫 화면부터 URL이 가리키는 상태로 그려진다.
  try {
    const initialParams = new URLSearchParams(location.search);
    if (initialParams.toString()) applyNavToState(parseNavParams(initialParams));
  } catch (error) { /* noop */ }
  let historyReady = false;
  function syncHistory() {
    const nav = currentNavParams();
    const search = navParamsToSearch(nav);
    if (!historyReady) { try { history.replaceState(nav, "", search); } catch (error) { /* noop */ } historyReady = true; return; }
    if (search === location.search) return;
    // 연도 범위 슬라이더는 드래그 중 포인터 이동마다 render()가 다시 불려 값이 계속
    // 바뀐다 — 그때마다 history 항목을 새로 쌓으면(pushState) 뒤로가기 한 번에 드래그
    // 중간값 하나만 되돌아가는 상황이 된다. 연도 범위만 바뀐 경우는 현재 항목을
    // 갱신(replaceState)하고, 탭·지역 등 실제 내비게이션은 그대로 pushState로 남긴다.
    const prevNav = history.state;
    const onlyYearChanged = Boolean(
      prevNav &&
      prevNav.tab === nav.tab &&
      prevNav.region === nav.region &&
      prevNav.municipality === nav.municipality &&
      prevNav.regionCode === nav.regionCode &&
      prevNav.item === nav.item &&
      prevNav.metric === nav.metric
    );
    try {
      if (onlyYearChanged) history.replaceState(nav, "", search);
      else history.pushState(nav, "", search);
    } catch (error) { /* noop */ }
  }
  window.addEventListener("popstate", (event) => {
    applyNavToState(event.state || { tab: "summary", region: null, municipality: null, regionCode: "", item: "", metric: "coverage", yearStart: null, yearEnd: null });
    render();
  });
  function render() {
    nav();
    const screenHtml = state.tab === "summary" ? summaryScreen() : state.tab === "applications" ? applicationsScreen() : state.tab === "regions" ? regionsScreen() : state.tab === "items" ? itemsScreen() : state.tab === "strategy" ? strategyScreen() : dataScreen();
    const primaryTabKey = ["regions", "items"].includes(state.tab) ? "applications" : state.tab;
    document.querySelector("#app").innerHTML = `<div role="tabpanel" id="primary-tabpanel-${primaryTabKey}" aria-labelledby="primary-tab-${primaryTabKey}">${screenHtml}</div>`;
    bind();
    syncHistory();
  }

  try { const savedTrendSize = localStorage.getItem("kiip-trend-size"); if (["s", "m", "l"].includes(savedTrendSize)) document.documentElement.dataset.trendSize = savedTrendSize; } catch (error) { /* private mode 등 */ }
  document.querySelector("#generated").textContent = `마지막 업데이트 ${date(dashboardUpdatedAt)}`;
  document.querySelector("#scope-label").textContent = scopeLabel;
  document.querySelector("#snapshot-id").textContent = `Snapshot ${snapshot.snapshotId} · 업데이트 ${date(dashboardUpdatedAt)}`;
  document.querySelector("#brand-home").onclick = () => { if (state.tab !== "summary") resetScreenDefaults(); state.tab = "summary"; render(); };
  // UI 검토(#136) 02번 보조: 지금 주소(위 URL 동기화로 현재 화면을 가리킴)를 바로 복사.
  const copyLinkButton = document.querySelector("#copy-link-button");
  if (copyLinkButton) copyLinkButton.onclick = () => {
    try {
      navigator.clipboard?.writeText(location.href);
      copyLinkButton.textContent = "복사됨";
      setTimeout(() => { copyLinkButton.textContent = "이 화면 링크 복사"; }, 1500);
    } catch (error) { /* noop */ }
  };
  render();
}
