"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type Metric = { value: number | null; availability: "available" | "preview" | "blocked"; partial?: boolean; status: string; rationale?: string | null; blockingIssue?: string | null; calculatedAt?: string | null };
type TrademarkExample = { title: string | null; applicationNumber: string | null; applicationDate: string | null; applicant?: string | null; applicationStatus: string | null; statusCategory?: string | null; applicantRegionMatch?: string | null; niceClass?: string | null; goodsMatchMethod: string; goodsReviewRequired: boolean; goodsEvidence: { classCode?: string | null; designatedProductName?: string | null }[] };
type VerifiedRegistrationExamples = { schemaVersion: string; verifiedAt: string; sourceUrl: string; entries: { region: string; specialtyId: string | null; itemName: string; query: string; examples: TrademarkExample[] }[] };
type ItemVerdict = { source: string; method: string | null; confidence: number | null };
type ItemCategory = { code: string; label: string };
type RegionalEvidence = { region: string; sido: string; sigungu: string; sourceItemName: string; referenceYear: number; evidenceType: string; evidenceStrength: string; regionalMetricEligible: boolean; regionalMetricValidatedAt?: string | null };
type ItemBriefingEvidence = { uniqueTrademarkCount?: number | null; registrationRate?: number | null; localApplicantShare?: number | null };
type ItemBriefing = { templateVersion: string | null; isGapAlert: boolean; sentences: string[]; evidence: ItemBriefingEvidence | null };
type NationwideFlowStage = { count: number; topRegion: string | null; topApplicant: string | null; examples?: { representative: string[]; unusual: string[] } | null; classes?: { classCode: string; count: number; share: number }[] | null; topRegions?: { region: string; count: number; share: number }[] | null };
type NationwideFlow = { totalCount: number; stages: { raw: NationwideFlowStage; processed: NationwideFlowStage; service: NationwideFlowStage } };
type Item = { specialtyId: string | null; itemName: string | null; noticeName: string | null; niceClass: string | null; sources?: string[]; matchingBasis?: string | null; category?: ItemCategory | null; regionalSpecialtyCropBadge?: { tier: string; officialItemName: string; referenceYear: number } | null; businessFlow?: NationwideFlow | null; dataState: string; itemVerdict?: ItemVerdict; trademarkExamples?: TrademarkExample[]; regionalEvidence?: RegionalEvidence[]; applicationYearCounts?: Record<string, number> | null; registrationYearCounts?: Record<string, number> | null; briefing?: ItemBriefing | null; metrics: { uniqueTrademarkCount: Metric; nationwideSearchTrademarkCount?: Metric; registeredTrademarkCount: Metric; registrationRate: Metric; localApplicantShare: Metric; confirmedGoodsMatchCount: Metric; goodsReviewCandidateCount: Metric; gapScore: Metric } };
type Region = { regionCode: string | null; regionCodeStatus: string; region: string; sido: string | null; sigungu: string | null; dataState: string; items: Item[] };
type Source = { sourceId: string; sourceLabel: string | null; sourceContractVersion: string | null; sourceFetchedAt: string | null; sourceUrl: string | null; sourceLastVerifiedAt: string | null };
type PipelineStatus = { stage: string; inputScope: string; rowCounts: { total: number; searchable: number; complete: number; partial: number; error: number; skipped: number }; uniqueQueryCounts: { total: number | null; complete: number | null; partial: number | null }; nationwideCandidates: { uniqueTrademarkCount: number; returnedHitCount: number; duplicateHitCount: number }; applicantRegionVerification: { inside: number; outside: number; unverified: number; verifiedCount: number; rate: number | null; regionalAttributionCounts?: { inside: number; outside: number; unverified: number }; unit?: string }; regionalMetricGate: { availableRegionItemCount: number; blockedRegionItemCount: number; coverageThreshold?: number; policy: string }; collectionExperiment: { queryHitCap: number | null; serializationFailureObservedAtOrAbove: number | null; outputShape: string } };
type Snapshot = { schemaVersion: string; snapshotId: string; mode: "sample" | "full"; generatedAt: string; versions?: Record<string, string | null>; map?: { availability: string; blockingReason?: string | null }; coverage: { targetRegionCount: number | null; observedRegionCount: number; regionItemCount: number; catalogItemCount?: number; nationwideCatalogItemCount?: number; completeQueryCount: number; partialQueryCount: number; errorQueryCount: number; skippedQueryCount?: number; unit?: string }; pipelineStatus?: PipelineStatus; regions: Region[]; sources: Source[]; warnings: string[] };
type ProvinceShape = { name: string; d: string; labelX: number; labelY: number };
type MunicipalityShape = { name: string; d: string; labelX: number; labelY: number };
type MapGeometry = { schemaVersion: string; viewBox: string; boundaryReference: { sourceName: string; sourceUrl: string; sourceBasis: string; status: string; warning: string }; provinces: ProvinceShape[]; municipalities: Record<string, { viewBox: string; items: MunicipalityShape[] }> };
type Tab = "summary" | "applications" | "regions" | "items" | "strategy" | "compare" | "data";
type MapMetric = "trademarks" | "registration" | "coverage" | "applicationCoverage";
type SpecialtyCoverage = { total: number; decided: number; applied: number; pending: number; rate: number | null };
type PositionedMapLabel = { name: string; displayName: string; x: number; y: number; targetX: number; targetY: number; leader: boolean };

const STATE_LABELS: Record<string, string> = { complete_nonzero: "현황 확인", complete_zero: "검색 결과 없음", partial: "검토중", error: "확인 오류", skipped: "분류 확인 필요", not_collected: "확인 전", complete: "집계 완료" };
// 이슈 #116(2026-09-01): "전국 지역 비교"·"지역 상세"·"품목별 조회"를 하나의
// "지역·품목별 조회" 탭으로 합치고, 탭 안에서 지역별/품목별을 토글로 고른다.
const EXPLORE_TABS: Tab[] = ["applications", "regions", "items"];
const PRIMARY_NAV: { key: Tab; label: string }[] = [
  { key: "summary", label: "요약" },
  { key: "applications", label: "지역·품목별 조회" },
  { key: "strategy", label: "비즈니스 전략" },
  { key: "compare", label: "특화작목 비교" },
  { key: "data", label: "데이터 개요" },
];
const MAP_LABELS: Record<MapMetric, string> = { coverage: "특산품 수", trademarks: "상표 건수", applicationCoverage: "출원율", registration: "등록률" };
const MAP_DESCRIPTIONS: Record<MapMetric, string> = {
  trademarks: "검색 수집이 완료된 항목에서, 출원인 주소가 해당 지역으로 확인된 고유 상표 출원 건수입니다.",
  registration: "지도에 포함된 지역 주소 일치 출원 중 등록 상태인 건의 비율입니다(등록 ÷ 출원).",
  coverage: "현재 스냅샷에 수집된 지역×특산품 수입니다.",
  applicationCoverage: "이 지역에서 수집된 전체 특산품 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 아직 지역별 집계가 안 끝난 품목도 전체 분모에 포함하므로, 데이터가 쌓일수록 값이 올라갈 수 있습니다.",
};

function number(value: number | null | undefined) { return typeof value === "number" ? value.toLocaleString("ko-KR") : "—"; }
function percent(value: number | null | undefined) { return typeof value === "number" ? `${Math.round(value * 100)}%` : "—"; }
function date(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록"; }
function dateOnly(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록"; }
function latestDate(...values: (string | null | undefined)[]) {
  return values.filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}
function sourceMethod(sourceId: string) {
  if (sourceId === "admin_codes") return "공식 파일 내려받기·정규화";
  if (sourceId === "gi" || sourceId.includes("specialties")) return "공식 목록 스냅샷·보완 수집";
  if (sourceId === "nongsaro") return "농사로 API(XML)";
  if (sourceId === "nongsaro_area_brand") return "농사로 API(XML)·출원번호 대조";
  if (sourceId === "kipris_trademark") return "KIPRISPlus API·단어 검색";
  if (sourceId === "kipris_trademark_applicant") return "KIPRISPlus API·출원인 주소 조회";
  if (sourceId === "ip_registry") return "공공데이터 API(JSON)·등록원부 보완";
  if (sourceId === "kipo_notice_goods") return "공식 고시상품명칭 파일 대조";
  return "공식 소스 스냅샷";
}
function sourceGroup(sourceId: string) {
  if (sourceId === "admin_codes") return "지역 정보";
  if (sourceId.includes("kipris") || sourceId === "ip_registry" || sourceId === "kipo_notice_goods" || sourceId === "nongsaro_area_brand") return "상표 정보";
  return "특산품 현황";
}
// 이슈 #116(2026-08-26): 출처 표 그룹 순서는 가나다순이 아니라 특산품 현황 → 상표 정보 →
// 지역 정보 순으로 보여달라는 요청 — 데이터 파이프라인 단계(수집 → 매칭 → 지역 조인) 순서와
// 맞춘 것이라 고정 순위표로 정렬한다.
const SOURCE_GROUP_ORDER: Record<string, number> = { "특산품 현황": 0, "상표 정보": 1, "지역 정보": 2 };
function sourceGroupRank(sourceId: string) { return SOURCE_GROUP_ORDER[sourceGroup(sourceId)] ?? 99; }
function sourceItems(sourceId: string) {
  const labels: Record<string, string> = {
    admin_codes: "법정동 코드·행정구역명", gi: "농산물 지리적표시", nongsaro: "지역 특산물",
    nfqs_quality_cert: "인증 수산물(전국)", kofpi_forest_product: "임산물 품목",
    rda_regional_specialty_crops: "도별 지역특화작목 69개",
    kipris_trademark: "상표 출원·상태·일자", kipris_trademark_applicant: "출원인 주소",
    ip_registry: "등록번호·등록일·지정상품", kipo_notice_goods: "고시상품명칭·NICE류",
    nongsaro_area_brand: "지역 브랜드·출원번호"
  };
  return labels[sourceId] || (sourceId.includes("specialties") ? "지역·품목·원문 명칭" : "원천 제공 항목");
}
function snapshotUpdatedAt(snapshot: Snapshot) {
  return latestDate(
    snapshot.generatedAt,
    ...snapshot.sources.flatMap((source) => [source.sourceFetchedAt, source.sourceLastVerifiedAt]),
    ...snapshot.regions.flatMap((region) => region.items.flatMap((item) => Object.values(item.metrics).map((metric) => metric.calculatedAt))),
  );
}
// 원천 특산품명은 감사·검색 근거로 그대로 보존하고, 화면에서는 지역·브랜드 수식어를
// 걷어낸 원물명을 쓴다(#116). 사용자가 직접 지적한 원주 목록만 정확 매핑하며 임의의
// 접두어 추정은 하지 않는다.
const ITEM_DISPLAY_ALIASES: Record<string, string> = {
  "치악산 배": "배",
  "치악산 한우": "한우",
  "치악산 복숭아": "복숭아",
  "큰송이 버섯": "버섯",
  "치악산 사과": "사과",
  "조엄고구마": "고구마",
  "쌀토토미": "쌀",
  "치악산토종다래": "다래",
};
function displayItemName(value: string | null | undefined) { const name = value?.trim() || ""; return ITEM_DISPLAY_ALIASES[name] || name; }
// 이슈 #117: 특화작목명의 괄호 부기(예: "토마토(완숙토마토)", "딸기(수출형)")를 화면에서 지운다.
function stripParens(value: string) { return value.replace(/\s*[（(][^）)]*[）)]\s*/g, "").trim() || value.trim(); }
function itemName(item: Item) { return displayItemName(item.itemName || item.noticeName) || "미지정 품목"; }
// 이슈 #112: 지자체/품목 목록을 리스트 대신 출원건수 기반 태그 클라우드로 보여달라는
// 요청. 글자 크기 비교는 막대그래프보다 부정확하다는 점을 감안해(글자 수가 다른
// 단어끼리는 왜곡될 수 있음), 크기 폭을 좁게(12~24px) 잡고 면적에 가깝게 느껴지도록
// 제곱근 스케일을 쓴다. 정확한 값은 title(hover)과 클릭 시 상세 화면에서 확인한다.
function wordCloudFontSize(value: number, max: number) {
  const MIN_PX = 12;
  const MAX_PX = 24;
  if (!max || value <= 0) return MIN_PX;
  const ratio = Math.sqrt(Math.min(1, value / max));
  return Math.round(MIN_PX + (MAX_PX - MIN_PX) * ratio);
}
// 이슈 #112 후속: 태그 클라우드를 더 컬러풀하게 해달라는 요청. dataviz 스킬의 6가지
// 팔레트 검증(node validate_palette.js)을 거쳐 고른 4색이다 — 흰 배경 텍스트 기준
// WCAG 4.5:1을 넘도록 어둡게 조정한 뒤, 태그가 자유롭게 줄바꿈되어 어느 두 태그든
// 이웃할 수 있는 상황(all-pairs)에서도 색맹 시뮬레이션 상 구분 가능한 조합만 남겼다
// (documented 8색 팔레트를 그대로 어둡게 하면 5색 이상에서 실패해, 통과하는 4색으로
// 제한). 값(면적/글자 크기)과 무관하게 이름 해시로 고정 배정해 리렌더링에도 안 바뀐다.
const WORD_CLOUD_PALETTE = ["#2876d4", "#cd4d10", "#008856", "#4a3aa7"];
function wordCloudColor(seed: string) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  return WORD_CLOUD_PALETTE[hash % WORD_CLOUD_PALETTE.length];
}
// 이슈 #116: 연도별 출원·등록 추이 그래프. registrationYearCounts는 KIPRIS 검색 결과의
// 실제 등록일자(hit.registrationDate)를 연도별로 집계한 값이다(출원일 기준 근사치 아님).
function sumYearCounts(items: Item[], field: "applicationYearCounts" | "registrationYearCounts") {
  const totals: Record<number, number> = {};
  for (const item of items) {
    const counts = item[field];
    if (!counts) continue;
    for (const [year, value] of Object.entries(counts)) {
      const y = Number(year);
      if (Number.isFinite(y)) totals[y] = (totals[y] || 0) + value;
    }
  }
  return totals;
}
const TREND_CHART = { width: 960, height: 220, padLeft: 46, padRight: 16, padTop: 14, padBottom: 28 };
function trendScales(startYear: number, endYear: number, maxValue: number) {
  const { width, height, padLeft, padRight, padTop, padBottom } = TREND_CHART;
  const span = Math.max(1, endYear - startYear);
  const x = (year: number) => padLeft + ((year - startYear) / span) * (width - padLeft - padRight);
  const baseY = height - padBottom;
  const y = (value: number) => baseY - (Math.max(0, value) / Math.max(1, maxValue)) * (height - padTop - padBottom);
  return { x, y, baseY };
}
function trendLinePath(years: number[], totals: Record<number, number>, scales: ReturnType<typeof trendScales>) {
  return years.map((year, index) => `${index === 0 ? "M" : "L"}${scales.x(year).toFixed(1)},${scales.y(totals[year] || 0).toFixed(1)}`).join("");
}
function trendYearLabels(years: number[]) {
  if (years.length <= 12) return years;
  const step = Math.ceil(years.length / 6);
  return years.filter((_, index) => index % step === 0 || index === years.length - 1);
}
function trendHandlePercent(year: number, fullStart: number, fullEnd: number) {
  if (fullEnd <= fullStart) return 0;
  return ((year - fullStart) / (fullEnd - fullStart)) * 100;
}
function trendYearAtPointer(clientX: number, track: HTMLElement, fullStart: number, fullEnd: number) {
  if (fullEnd <= fullStart) return fullStart;
  const rect = track.getBoundingClientRect();
  if (rect.width === 0) return fullStart;
  const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(fullStart + fraction * (fullEnd - fullStart));
}

function clampTrendRange(startYear: number | null, endYear: number | null, fullStart: number, fullEnd: number) {
  const start = Math.max(fullStart, Math.min(startYear ?? fullStart, fullEnd));
  const end = Math.max(start, Math.min(endYear ?? fullEnd, fullEnd));
  return { start, end };
}

function TrendRangeControl({ idPrefix, fullStart, fullEnd, start, end, onStartChange, onEndChange }: { idPrefix: string; fullStart: number; fullEnd: number; start: number; end: number; onStartChange: (year: number) => void; onEndChange: (year: number) => void }) {
  const setStart = (year: number) => onStartChange(Math.max(fullStart, Math.min(year, end)));
  const setEnd = (year: number) => onEndChange(Math.max(start, Math.min(year, fullEnd)));
  return <>
    <div className="trend-controls">
      <div className="trend-range-inputs">
        <label><span className="sr-only">시작 연도</span>{start}<input id={`${idPrefix}-start-input`} type="number" min={fullStart} max={end} aria-label="시작 연도" value={start} onChange={(event) => setStart(Number(event.target.value) || fullStart)} /></label>
        <span>~</span>
        <label><span className="sr-only">끝 연도</span>{end}<input id={`${idPrefix}-end-input`} type="number" min={start} max={fullEnd} aria-label="끝 연도" value={end} onChange={(event) => setEnd(Number(event.target.value) || fullEnd)} /></label>
      </div>
    </div>
    <div className="trend-range-slider"><span className="trend-range-label">{fullStart}년 – {fullEnd}년 중 {start}년 – {end}년 선택</span>
      <div className="trend-range-track">
        <div className="trend-range-fill" style={{ left: `${trendHandlePercent(start, fullStart, fullEnd)}%`, right: `${100 - trendHandlePercent(end, fullStart, fullEnd)}%` }} />
        <button type="button" id={`${idPrefix}-range-handle-start`} className="trend-range-handle trend-range-handle-start" role="slider" aria-label="시작 연도 조절" aria-valuemin={fullStart} aria-valuemax={end} aria-valuenow={start} style={{ left: `${trendHandlePercent(start, fullStart, fullEnd)}%` }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.buttons !== 1 || !event.currentTarget.parentElement) return; setStart(trendYearAtPointer(event.clientX, event.currentTarget.parentElement, fullStart, fullEnd)); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); setStart(start - 1); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); setStart(start + 1); } }} />
        <button type="button" id={`${idPrefix}-range-handle-end`} className="trend-range-handle trend-range-handle-end" role="slider" aria-label="끝 연도 조절" aria-valuemin={start} aria-valuemax={fullEnd} aria-valuenow={end} style={{ left: `${trendHandlePercent(end, fullStart, fullEnd)}%` }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.buttons !== 1 || !event.currentTarget.parentElement) return; setEnd(trendYearAtPointer(event.clientX, event.currentTarget.parentElement, fullStart, fullEnd)); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); setEnd(end - 1); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); setEnd(end + 1); } }} />
      </div>
    </div>
  </>;
}

// 이슈 #116(2026-08-26): 품목별 조회에 광역 단위 출원 비중 원그래프 추가 요청 — 상위 4개 광역 +
// "기타"로 묶어 conic-gradient 도넛을 그리고, 색상만으로 구분하지 않도록 범례에 지역명·비율을 함께 적는다.
function provinceShareSegments(counts: Record<string, number>) {
  const entries = Object.entries(counts).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return { segments: [] as { name: string; value: number; pct: number }[], total: 0 };
  const top = entries.slice(0, 4);
  const restTotal = entries.slice(4).reduce((sum, [, value]) => sum + value, 0);
  const rows: [string, number][] = restTotal > 0 ? [...top, ["기타", restTotal]] : top;
  return { segments: rows.map(([name, value]) => ({ name, value, pct: value / total })), total };
}
function shareSegmentColor(name: string) { return name === "기타" ? PROVINCE_ETC_COLOR : provinceColor(name); }
function shareConicGradient(segments: { name: string; pct: number }[]) {
  let acc = 0;
  const stops = segments.map((segment) => {
    const start = (acc * 360).toFixed(1);
    acc += segment.pct;
    return `${shareSegmentColor(segment.name)} ${start}deg ${(acc * 360).toFixed(1)}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}
function ProvinceShareDonut({ counts, label }: { counts: Record<string, number>; label: string }) {
  const { segments, total } = provinceShareSegments(counts);
  if (!total) return <div className="item-share empty"><p className="empty">아직 지역 확인 출원이 없습니다.</p></div>;
  return <div className="item-share">
    <div className="item-share-donut" style={{ background: shareConicGradient(segments) }} role="img" aria-label={`${label} 광역 단위 출원 비중`} />
    <ul className="item-share-legend">{segments.map((segment) => <li key={segment.name}><i style={{ background: shareSegmentColor(segment.name) }} /><span className="item-share-region">{displayRegionName(segment.name)}</span><b>{percent(segment.pct)}</b></li>)}</ul>
  </div>;
}

const CATEGORY_SHARE_COLORS = ["#0f5fa6", "#d97706", "#11865b", "#7c3aed", "#c2416c", "#0e7490", "#6b7f18", "#64748b"];
function categoryShareColor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return CATEGORY_SHARE_COLORS[hash % CATEGORY_SHARE_COLORS.length];
}
function categoryShareSegments(items: Item[], field: "uniqueTrademarkCount" | "registeredTrademarkCount") {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const metric = item.metrics[field];
    if (metric.availability !== "available" || !metric.value) continue;
    const label = item.category?.label || "기타";
    counts[label] = (counts[label] || 0) + metric.value;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko-KR"));
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const top = entries.slice(0, 5);
  const rest = entries.slice(5).reduce((sum, [, value]) => sum + value, 0);
  const rows = rest > 0 ? [...top, ["기타 유형", rest] as [string, number]] : top;
  return { total, segments: rows.map(([name, value]) => ({ name, value, pct: total ? value / total : 0 })) };
}
function CategoryShareDonut({ items, field, label }: { items: Item[]; field: "uniqueTrademarkCount" | "registeredTrademarkCount"; label: string }) {
  const { total, segments } = categoryShareSegments(items, field);
  if (!total) return <div className="item-share empty"><p className="empty">표시할 {label} 데이터가 없습니다.</p></div>;
  const gradient = segments.reduce<{ stops: string[]; cursor: number }>((state, segment) => {
    const start = state.cursor;
    const end = start + segment.pct * 360;
    return { cursor: end, stops: [...state.stops, `${categoryShareColor(segment.name)} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`] };
  }, { stops: [], cursor: 0 }).stops.join(", ");
  return <div className="item-share category-share"><div className="item-share-donut" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={`특산품 유형별 ${label} 비중`} /><ul className="item-share-legend">{segments.map((segment) => <li key={segment.name}><i style={{ background: categoryShareColor(segment.name) }} /><span className="item-share-region">{segment.name}</span><b>{percent(segment.pct)}</b></li>)}</ul></div>;
}
// 이슈 #116(2026-09-01): 지자체별 조회에서 추이 그래프 크기를 사용자가 조절하고
// 싶다는 요청. 세 단계(작게/보통/크게)를 :root의 data-trend-size로 저장하고 CSS가
// province-detail-cols 그리드 비율을 바꾼다. localStorage에 남겨 새로고침에도 유지.
const TREND_SIZES: { key: string; label: string }[] = [
  { key: "s", label: "작게" },
  { key: "m", label: "보통" },
  { key: "l", label: "크게" },
];
function applyTrendSize(key: string) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.trendSize = key;
  try { localStorage.setItem("kiip-trend-size", key); } catch { /* private mode 등 */ }
}
function TrendSizeControl() {
  return <div className="trend-size-control" role="group" aria-label="추이 그래프 크기">
    <span>그래프 크기</span>
    {TREND_SIZES.map((size) => <button type="button" key={size.key} data-trend-size={size.key} onClick={() => applyTrendSize(size.key)}>{size.label}</button>)}
  </div>;
}
// 이슈 #118: 요약·지역·품목 화면에서 출원·등록 추이 그래프를 같은 모양으로 부각한다.
// prominent=true면 -compact 축소를 빼고 큰 카드로 그린다.
function RegionTrend({ region, heading = "연도별 출원·등록 추이", subtitle, prominent = false, adjustable = false, emptyLabel = "이 지역은 아직 연도별 데이터가 없습니다." }: { region: Pick<Region, "region" | "items">; heading?: string; subtitle?: string; prominent?: boolean; adjustable?: boolean; emptyLabel?: string }) {
  const wrapClass = prominent ? "trend-chart trend-chart-prominent region-trend" : "trend-chart trend-chart-compact region-trend";
  const trendSubtitle = subtitle || `${region.region} 전체 특산품 · 연도별`;
  const applicationTotals = sumYearCounts(region.items, "applicationYearCounts");
  const registrationTotals = sumYearCounts(region.items, "registrationYearCounts");
  const allYears = [...new Set([...Object.keys(applicationTotals), ...Object.keys(registrationTotals)])]
    .map(Number)
    .sort((a, b) => a - b);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<number | null>(null);
  if (allYears.length === 0) return <section className={wrapClass}><div className="section-heading"><div><h2>{heading}</h2></div><span>{region.region}</span></div><p className="empty">{emptyLabel}</p></section>;
  const fullStart = allYears[0];
  const fullEnd = allYears[allYears.length - 1];
  const { start, end } = clampTrendRange(adjustable ? selectedStart : null, adjustable ? selectedEnd : null, fullStart, fullEnd);
  const years: number[] = [];
  for (let year = start; year <= end; year++) years.push(year);
  const max = Math.max(1, ...years.map((year) => Math.max(applicationTotals[year] || 0, registrationTotals[year] || 0)));
  const scale = trendScales(start, end, max);
  return <section className={wrapClass}><div className="section-heading"><div><h2>{heading}</h2></div><span>{trendSubtitle}</span></div>
    {adjustable && <TrendRangeControl idPrefix="summary-trend" fullStart={fullStart} fullEnd={fullEnd} start={start} end={end} onStartChange={setSelectedStart} onEndChange={setSelectedEnd} />}
    <svg className="trend-svg" viewBox={`0 0 ${TREND_CHART.width} ${TREND_CHART.height}`} role="img" aria-label={`${region.region} ${start}년부터 ${end}년까지 출원·등록 추이`}>
      {[0, 0.5, 1].map((fraction) => { const value = Math.round(max * fraction); const yPos = scale.y(value); return <g key={fraction}><line x1={TREND_CHART.padLeft} x2={TREND_CHART.width - TREND_CHART.padRight} y1={yPos} y2={yPos} className="trend-gridline" /><text x={TREND_CHART.padLeft - 7} y={yPos} className="trend-axis-label trend-axis-y">{number(value)}</text></g>; })}
      <path d={`${trendLinePath(years, applicationTotals, scale)}L${scale.x(end).toFixed(1)},${scale.baseY}L${scale.x(start).toFixed(1)},${scale.baseY}Z`} className="trend-area" />
      <path d={trendLinePath(years, registrationTotals, scale)} className="trend-line trend-line-registered" />
      <path d={trendLinePath(years, applicationTotals, scale)} className="trend-line trend-line-application" />
      {years.map((year) => <circle key={`application-${year}`} cx={scale.x(year)} cy={scale.y(applicationTotals[year] || 0)} r="2.8" className="trend-point trend-point-application"><title>{year}년 출원 {number(applicationTotals[year] || 0)}건</title></circle>)}
      {years.map((year) => <circle key={`registration-${year}`} cx={scale.x(year)} cy={scale.y(registrationTotals[year] || 0)} r="2.8" className="trend-point trend-point-registered"><title>{year}년 등록 {number(registrationTotals[year] || 0)}건</title></circle>)}
      {trendYearLabels(years).map((year) => <text key={year} x={scale.x(year)} y={TREND_CHART.height - 5} className="trend-axis-label trend-axis-x">{year}</text>)}
    </svg>
    <p className="trend-legend"><span className="trend-legend-swatch trend-legend-application" />출원<span className="trend-legend-swatch trend-legend-registered" />등록</p>
  </section>;
}
// item.noticeName은 고시명칭이 확정 안 된 행에도 채워져 있다(③ 검색에 쓴 원물명 검색어를
// 그대로 담음 — 04-analyze-brand/lib/analyzer.js entryDimensions 참고). matchingBasis가
// notice_name_and_nice_class일 때만 실제로 지식재산처 고시상품명칭 사전과 대조해 확정된
// 값이므로, "고시명칭"이라는 라벨은 이 조건을 거친 값에만 붙여야 한다 — 아니면 원물명이나
// (검토대기 상태에서 상표 검색에 쓰인) 임의 검색어를 마치 공식 분류인 것처럼 보여주게 된다.
// 2026-08-20: raw_item_goods_matched(원물명 + 등록원부 지정상품 정규화 일치 + 출원인
// 주소 지역 일치로 AI가 검토·확정한 항목)는 고시명칭 사전 매칭과 판정 근거는 다르지만,
// 화면에서는 구분 없이 동일한 "확인 특산품"으로 취급한다(사용자 결정). 판단 근거는
// matchingBasis 값과 metrics.*.rationale에만 남기고 UI 텍스트로는 노출하지 않는다.
const OFFICIAL_MATCHING_BASES = new Set(["notice_name_and_nice_class", "raw_item_goods_matched"]);
function officialNoticeName(item: Item): string | null {
  return item.matchingBasis && OFFICIAL_MATCHING_BASES.has(item.matchingBasis) ? item.noticeName : null;
}
function noticeBasis(item: Item) { const name = officialNoticeName(item); return name ? `고시명칭 ${name}` : "고시명칭 미확정"; }
// 신선한/미가공 접두어는 품목 자체가 아니라 매칭 규칙이 붙인 수식어라, 품목별 조회처럼
// 여러 지역을 하나의 품목으로 묶어 보여줄 때는 "신선한 사과"가 아니라 "사과"로
// 표시한다(02-normalize-items/lib/ruleNormalizer.js의 접두어 화이트리스트와 동일 어휘).
const DISPLAY_PREFIXES = ["신선한 ", "미가공 "];
function officialItemLabel(item: Item): string | null {
  const name = officialNoticeName(item);
  if (!name) return null;
  const prefix = DISPLAY_PREFIXES.find((candidate) => name.startsWith(candidate));
  return displayItemName(prefix ? name.slice(prefix.length) : name);
}
// 2026-08-19 데이터 감사 직후 한동안 matchingBasis=raw_item_name_unclassified인
// 검토대기 원물명·상호(예: "꿀다림 데일리허니", "왕곡한과")를 지역별 출원 탭·지자체 상세
// 품목 탭 모두에서 숨겼으나, 사용자 재지적(2026-08-21): 고시명칭 매칭 여부는 판정 기준의
// 하나일 뿐이고 원물명 그대로라고 특산품이 아닌 것은 아니며, 사전에 없다고 억지로
// 고시명칭화할 것도 아니다. 이제 두 목록 모두 region.items 전체를 그대로 보여준다(별도
// 표시 없이 동일하게). officialRegionItems는 기본 선택 우선순위(공식 특산품을 먼저
// 보여주되, 없으면 원물로 대체)에만 쓴다.
function officialRegionItems(region: Region): Item[] {
  return region.items.filter((item) => officialItemLabel(item));
}
function specialtyCoverage(regions: Region[]): SpecialtyCoverage {
  let total = 0;
  let decided = 0;
  let applied = 0;
  regions.forEach((region) => region.items.forEach((item) => {
    total += 1;
    if (item.metrics.uniqueTrademarkCount.availability !== "available") return;
    decided += 1;
    if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) applied += 1;
  }));
  // 2026-08-21 사용자 재확인: 분모는 고시명칭 확인 완료분이 아니라 스냅샷에 수집된
  // 지역×특산품 전체다(현재 전국 1,692개). 아직 명칭·지역별 집계 확인이 덜 끝난
  // 품목도 분모에 포함하고, 지역 주소 일치 출원이 확인될 때만 분자에 더한다. 따라서
  // 초기 출원율은 낮게 보이고 후속 확인이 진행되면서 올라가는 것이 의도한 동작이다.
  return { total, decided, applied, pending: total - decided, rate: total ? applied / total : null };
}
// 2026-08-21: 서울·세종은 경기도에 둘러싸여 있어 화살표(연결선)로 라벨을 빼서
// 보여줬는데, 오히려 경기도 라벨이 서울 자리와 겹쳐 어색하다는 지적(사용자) — 화살표
// 없이 경기도 라벨만 살짝 우측 아래로 옮기고, 서울·세종은 제자리에 그대로 표시한다.
const NATIONAL_LABEL_OFFSETS: Record<string, { x: number; y: number }> = {
  경기도: { x: 20, y: 38 },
};
function displayRegionName(name: string) {
  return name.replace("전남광주통합특별시", "전남·광주 통합권역");
}
// 이슈 #116(2026-09-01): 화면의 광역자치단체 나열 순서를 가나다순이 아니라 행정표준코드
// 순서(서울→…→제주)로 통일한다. 통합권역은 전라남도 다음, "전국" 의사 지역은 맨 끝.
const PROVINCE_ORDER = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충청북", "충청남", "전북", "전라남", "경상북", "경상남", "제주"];
function provinceRank(name: string) {
  if (/전남.*광주|광주.*전남/.test(name)) return PROVINCE_ORDER.indexOf("전라남") + 0.5;
  if (name === "전국" || name.startsWith("전국 ")) return 99;
  const index = PROVINCE_ORDER.findIndex((prefix) => name.startsWith(prefix));
  return index === -1 ? 50 : index;
}
// 이슈 #119: 광역 단위 출원 비중 도넛 등에서 차트마다 같은 지역이 다른 색으로 나와
// 헷갈린다는 지적 — 광역자치단체별 색을 고정 배정해 모든 차트에서 동일하게 쓴다.
const PROVINCE_COLORS: Record<string, string> = {
  서울: "#2f6fed", 부산: "#e8590c", 대구: "#c2255c", 인천: "#0ca678", 광주: "#7048e8",
  대전: "#1098ad", 울산: "#f59f00", 세종: "#66a80f", 경기: "#1c7ed6", 강원: "#37b24d",
  충청북: "#f76707", 충청남: "#9c36b5", 전북: "#d6336c", 전라남: "#0c8599",
  경상북: "#5c940d", 경상남: "#e64980", 제주: "#4263eb",
};
const PROVINCE_ETC_COLOR = "#98a2b3";
function provinceColor(name: string) {
  if (/전남.*광주|광주.*전남/.test(name)) return "#087f5b";
  const key = PROVINCE_ORDER.find((prefix) => name.startsWith(prefix));
  return (key && PROVINCE_COLORS[key]) || PROVINCE_ETC_COLOR;
}
function compareProvince(a: string, b: string) {
  return provinceRank(a) - provinceRank(b) || displayRegionName(a).localeCompare(displayRegionName(b), "ko-KR");
}
function positionedMapLabels(shapes: (ProvinceShape | MunicipalityShape)[], municipality: boolean): PositionedMapLabel[] {
  return shapes.map((shape) => {
    const offset = municipality ? undefined : NATIONAL_LABEL_OFFSETS[shape.name];
    return {
      name: shape.name,
      displayName: displayRegionName(shape.name),
      x: shape.labelX + (offset?.x || 0),
      y: shape.labelY + (offset?.y || 0),
      targetX: shape.labelX,
      targetY: shape.labelY,
      leader: false,
    };
  });
}
// 2026-08-19 방향 전환: 지역 확인이 안 끝난 상표를 지역 수치처럼 보여주지 않는다
// (전국 키워드 검색은 그 지역과 무관한 값이 대부분 섞여 부풀려 보인다). 지도·지역별
// 조회·지역 상세는 지역 귀속이 확정된 값만 쓰고, 확정 전은 "집계 대기"로 표시한다.
// 품목별 조회 카드에서만 "지역 확인 전 전국 검색 후보 N건은 확정 수치에 포함하지
// 않았습니다"처럼 별도 참고용으로 tradeDisplay를 쓴다 — 확정치와 절대 합산하지 않는다.
function tradeDisplay(item: Item): { value: number | null; provisional: boolean } {
  const metric = item.metrics.uniqueTrademarkCount;
  if (metric.availability === "available") return { value: metric.value, provisional: false };
  const nationwide = item.metrics.nationwideSearchTrademarkCount;
  return typeof nationwide?.value === "number" ? { value: nationwide.value, provisional: true } : { value: null, provisional: false };
}
function regionKey(region: Region) { return region.regionCode || region.region; }
// 이슈 #116/#119: 등록 사례에서 KIPRIS로 "검색된 결과"를 바로 보고 싶다는 요청.
// searchResult.do는 tab·queryText만 주면 검색을 실행하지 않고 상세검색 창만 연다(#116
// 재지적 "검색창만 나온다"). searchResult.js의 온로드 로직을 보면, tab 파라미터 없이
// searchKind=keywordSearch(2025-05-20 추가된 지식재산처 연계용)일 때만 queryText를
// 검색식(expression)으로 넣어 doSearch를 실행한다. searchRight=ktm(국내상표), 검색식은
// 출원번호 필드 AN=[번호] 완전일치. 클립보드 복사는 형식이 또 바뀔 때를 위한 보조 장치.
function kiprisSearchUrl(applicationNumber: string) {
  const digits = String(applicationNumber).replace(/\D/g, "");
  return `https://www.kipris.or.kr/khome/search/searchResult.do?searchKind=keywordSearch&searchRight=ktm&queryText=${encodeURIComponent(`AN=[${digits}]`)}`;
}
function openKiprisPopup(applicationNumber: string) { navigator.clipboard?.writeText(applicationNumber).catch(() => {}); window.open(kiprisSearchUrl(applicationNumber), "kipris-search", "popup,width=1180,height=900,noopener"); }
// 이슈 #116(2026-08-26): 출원번호 앞 2자리로 지리적표시 단체표장(44)·증명표장(48)을 구분해달라는 요청.
const GI_MARK_LABELS: Record<string, string> = { "44": "GI 단체표장", "48": "GI 증명표장" };
function giMarkLabel(applicationNumber?: string | null) { return applicationNumber ? GI_MARK_LABELS[applicationNumber.slice(0, 2)] || null : null; }
function fill(value: number | null, max: number) { if (value === null) return "#e3e6ec"; const ratio = Math.max(0.12, Math.min(1, max ? value / max : 0)); return `color-mix(in srgb, #0f5fa6 ${Math.round(24 + ratio * 68)}%, #e9eef4)`; }
// 2026-08-21: 출원율을 텍스트로만 보여주지 말고 큰 숫자 + 원형 게이지로 한눈에
// 보여달라는 요청(사용자) — 지도 옆 요약 패널과 지역별 출원율 탭 양쪽에서 공유한다.
function RateRing({ value, label = "출원율", size = 128, strokeWidth = 12 }: { value: number | null; label?: string; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = value === null ? 0 : Math.max(0, Math.min(1, value));
  const offset = circumference * (1 - ratio);
  const center = size / 2;
  return (
    <svg className="rate-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${percent(value)}`}>
      <circle className="rate-ring-track" cx={center} cy={center} r={radius} strokeWidth={strokeWidth} fill="none" />
      {value !== null && <circle className="rate-ring-fill" cx={center} cy={center} r={radius} strokeWidth={strokeWidth} fill="none" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`} />}
      <text className="rate-ring-label" x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">{percent(value)}</text>
    </svg>
  );
}
// 이슈 #116(2026-08-26) 사용자 재요청: 비즈니스 전략 문장이 그냥 줄글이라 가독성이
// 떨어진다는 지적 — 상태 아이콘·배지, 근거 수치(고유 상표·등록률·지역외 비중)를 문장 위에
// 먼저 보여주는 요약 스탯 줄, 문장별 도트 마커로 시각적 앵커를 추가했다.
// 이슈 #116/#74/#110(2026-08-31 확대): 품목명을 전국·전류로 검색해 원물→가공품→서비스 단계별
// 상표 활동을 보여준다. 지역 통계와는 완전히 분리된 참고 지표이며, 단계별 "건수"는 176개
// 품목 전부에 붙지만 topRegion/topApplicant(지역 관련 필드)는 원물 단계 상위 출원인이
// 생산자형으로 확인된 품목(rawSignalConfidence=producer_confirmed, 39/176)에서만 값이 채워지고
// 나머지는 null이라 화면에 지역 클러스터 문장이 뜨지 않는다(scripts/attachNationwideBusinessFlow.js).
// 근사치라는 caveat는 GitHub 이슈·코드 주석에만 남기고 화면에는 "AI 판정" 같은 표시를
// 노출하지 않는다(사용자 결정, 2026-08-27).
const FLOW_STAGE_LABELS: Record<"raw" | "processed" | "service", string> = { raw: "원물", processed: "가공품", service: "서비스·확장" };
const FLOW_STAGE_HINTS: Record<"raw" | "processed" | "service", string> = { raw: "산지·1차 생산 단계 상표", processed: "가공식품·음료·화장품 등", service: "유통·체험·관광·식음 서비스류" };
// 이슈 #119: 단계별 주요 상품류 — NICE 13판 대분류 이름(자주 나오는 것만).
const NICE_CLASS_LABELS: Record<string, string> = { "29": "가공식품(29)", "30": "곡물·커피·조미(30)", "31": "원물·농수산물(31)", "32": "음료·맥주(32)", "33": "주류(33)", "35": "도소매·광고(35)", "39": "운송·유통(39)", "40": "재료가공(40)", "41": "교육·체험(41)", "43": "식음·숙박(43)", "44": "농업 서비스(44)", "45": "기타 서비스(45)" };
const niceClassLabel = (code: string) => NICE_CLASS_LABELS[code] || `${code}류`;
function NationwideFlowCard({ flow, itemLabel, origins }: { flow: NationwideFlow; itemLabel: string; origins?: string[] }) {
  const { raw, processed, service } = flow.stages;
  const classified = raw.count + processed.count + service.count;
  const flowPercent = (value: number) => classified ? `${Math.round(value / classified * 100)}%` : "—";
  const clusterNote = raw.topRegion && (processed.topRegion || service.topRegion) &&
    (processed.topRegion !== raw.topRegion || service.topRegion !== raw.topRegion)
    ? `${raw.topRegion}에서 원물 활동이 가장 활발하고, ${[processed.topRegion, service.topRegion].filter((region) => region && region !== raw.topRegion)[0]}에서 가공·서비스 활동이 두드러집니다.`
    : null;
  // 이슈 #116(2026-09-01): 어디까지 확장 가능한지 보이도록 단계별 비중(분류 가능 건 기준)과
  // 단계 성격을 함께 표시한다. 단계별 대표·특이 지정상품 예시는 상표 단어검색 API에 지정상품이
  // 없어 별도 등록원부 수집(analyzeNationwideFlow.js 재실행)이 끝난 뒤 붙인다.
  const furthestStage = service.count > 0 ? "서비스·확장까지" : processed.count > 0 ? "가공품까지" : "원물 단계";
  const hasExamples = (["raw", "processed", "service"] as const).some((key) => flow.stages[key].examples && (flow.stages[key].examples!.representative.length || flow.stages[key].examples!.unusual.length));
  return (
    <section className="nationwide-flow-card">
      <div className="section-heading"><div><h2>{itemLabel} 비즈니스 확장 흐름</h2></div><span>전국 상표 검색 · 참고 지표</span></div>
      <p className="nationwide-flow-reach">현재 <strong>{furthestStage}</strong> 상표 활동이 확인됩니다 · 전체 {number(flow.totalCount)}건 중 단계 분류 가능 {number(classified)}건</p>
      <div className="nationwide-flow-stages">
        {(["raw", "processed", "service"] as const).map((key, index) => { const stage = flow.stages[key]; return <Fragment key={key}>
          {index > 0 && <i className="nationwide-flow-arrow" aria-hidden="true">→</i>}
          <div className={`nationwide-flow-stage nationwide-flow-stage-${key}`}>
            <span>{FLOW_STAGE_LABELS[key]}</span>
            <strong>{number(stage.count)}건</strong>
            <small className="nationwide-flow-share">전체의 {flowPercent(stage.count)}</small>
            <small className="nationwide-flow-hint">{FLOW_STAGE_HINTS[key]}</small>
            {stage.classes && stage.classes.length > 0 && <small className="nationwide-flow-eg"><b>주요 상품류</b> {stage.classes.slice(0, 3).map((row) => `${niceClassLabel(row.classCode)} ${Math.round(row.share * 100)}%`).join(" · ")}</small>}
            {stage.topRegions && stage.topRegions.length > 0 ? <small className="nationwide-flow-eg"><b>상위 지역</b> {stage.topRegions.slice(0, 3).map((row) => `${row.region} ${Math.round(row.share * 100)}%`).join(" · ")}</small> : stage.topRegion && <small className="nationwide-flow-region">{stage.topRegion}</small>}
            {stage.examples && stage.examples.representative.length > 0 && <small className="nationwide-flow-eg"><b>대표</b> {stage.examples.representative.join(", ")}</small>}
            {stage.examples && stage.examples.unusual.length > 0 && <small className="nationwide-flow-eg"><b>이색</b> {stage.examples.unusual.join(", ")}</small>}
          </div>
        </Fragment>; })}
      </div>
      {origins && origins.length > 0 && <p className="nationwide-flow-origins"><strong>주요 원산지</strong> {origins.map(displayRegionName).join(", ")}</p>}
      {clusterNote && <p className="nationwide-flow-note">{clusterNote}</p>}
      <p className="nationwide-flow-caveat">{hasExamples ? "상품류·상위 지역은 상위 출원인 기준 근사치입니다. 지정상품 텍스트 대조는 등록원부 보강 후 반영됩니다." : "단계별 상품류·상위 지역·상표명 예시는 전국 흐름 재수집 후 채워집니다."}</p>
    </section>
  );
}
function BusinessStrategyCard({ briefing, title, footer }: { briefing: ItemBriefing; title: string; footer?: ReactNode }) {
  const evidence = briefing.evidence;
  const hasStats = evidence && (
    typeof evidence.uniqueTrademarkCount === "number" ||
    typeof evidence.registrationRate === "number" ||
    typeof evidence.localApplicantShare === "number"
  );
  return (
    <section className={briefing.isGapAlert ? "business-strategy alert" : "business-strategy"}>
      <div className="strategy-head">
        <div className="strategy-head-title">
          <span className="strategy-status-icon" aria-hidden="true">{briefing.isGapAlert ? "!" : "✓"}</span>
          <strong>{title}</strong>
        </div>
        <span className="strategy-status-badge">{briefing.isGapAlert ? "공백 알림" : "양호"}</span>
      </div>
      {hasStats && <div className="strategy-stat-row">
        {typeof evidence?.uniqueTrademarkCount === "number" && <div className="strategy-stat"><span>고유 상표</span><strong>{number(evidence.uniqueTrademarkCount)}건</strong></div>}
        {typeof evidence?.registrationRate === "number" && <div className="strategy-stat"><span>등록률</span><strong>{percent(evidence.registrationRate)}</strong></div>}
        {typeof evidence?.localApplicantShare === "number" && <div className="strategy-stat"><span>지역 출원인 비중</span><strong>{percent(evidence.localApplicantShare)}</strong></div>}
      </div>}
      <ul className="business-strategy-list">{briefing.sentences.map((sentence, index) => <li key={index}>{sentence}</li>)}</ul>
      <p className="business-strategy-note">⑤·⑥단계 분석 결과에서 고정 템플릿으로 생성한 문장입니다({briefing.templateVersion || "버전 미기록"}).{footer}</p>
    </section>
  );
}
// 2026-08-21: 지역별 출원 탭 특산품 목록에 출원 여부를 색으로 구분해 보여준다(사용자
// 요청) — 출원 확인은 색이 있게, 미확인은 색이 없게. 단, 법정동코드가 미해결인
// 지역(대전 등 5개 광역시·전남광주통합)은 지역 매칭 자체가 안 되는 경우라 "미출원"로
// 단정하면 안 되므로 별도로 "구분 정보 없음"으로 표시한다(지역명을 못 찾은 것과
// 실제 출원이 없는 것을 구분해 달라는 요청).
function specialtyFilingStatus(item: Item): { label: string; filed: boolean } {
  const metric = item.metrics.uniqueTrademarkCount;
  const value = metric.value || 0;
  if (metric.availability === "available" && value > 0) {
    return { label: `출원 확인 · ${number(value)}건${metric.partial ? "+" : ""}`, filed: true };
  }
  return { label: "미출원(검토중)", filed: false };
}
function regionalMetricPendingReason(item: Item) {
  if (item.dataState === "partial") return "검색 결과의 수집 상한에 도달하여 추가 확인이 필요합니다.";
  if (item.dataState === "error") return "검색 결과를 확인하지 못했습니다.";
  if (item.dataState === "skipped") return "품목 분류 확인이 필요해 지역별 현황에서 제외했습니다.";
  if (item.dataState === "not_collected") return "상표 출원 현황 확인 전입니다.";
  return "지역별 출원 현황을 추가로 확인하고 있습니다.";
}

export default function Dashboard({ snapshot, geometry, registrationExamples }: { snapshot: Snapshot; geometry: MapGeometry; registrationExamples: VerifiedRegistrationExamples }) {
  const defaultRegionProvince = [...new Set(snapshot.regions.map((region) => region.sido).filter((sido): sido is string => Boolean(sido) && sido !== "전국"))].sort(compareProvince)[0] || null;
  const [tab, setTab] = useState<Tab>("summary");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("kiip-trend-size"); } catch { /* private mode 등 */ }
    if (saved && TREND_SIZES.some((size) => size.key === saved)) document.documentElement.dataset.trendSize = saved;
  }, []);
  // 이슈 #119: 탭 이동 후 브라우저 뒤로가기를 누르면 대시보드를 완전히 벗어나던 문제 —
  // 탭 전환마다 history 항목을 쌓아 뒤로가기가 직전 탭(없으면 요약)으로 돌아가게 한다.
  useEffect(() => {
    try { window.history.replaceState({ kiipTab: "summary" }, ""); } catch { /* noop */ }
    const onPop = (event: PopStateEvent) => setTab(((event.state as { kiipTab?: Tab } | null)?.kiipTab) || "summary");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const current = (window.history.state as { kiipTab?: Tab } | null)?.kiipTab || "summary";
    if (current !== tab) { try { window.history.pushState({ kiipTab: tab }, ""); } catch { /* noop */ } }
  }, [tab]);
  const [query, setQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedItemName, setSelectedItemName] = useState("");
  const [strategyItem, setStrategyItem] = useState("");
  const [regionQuery, setRegionQuery] = useState("");
  // 이슈 #116: 품목별 조회에서 목록의 다른 품목을 고르면 오른쪽 상세가 바뀌는데,
  // 스크롤 위치가 이전 상세를 읽던 자리(중간·하단)에 그대로 남아 새 상세의 맨 위가
  // 안 보인다. 상세 패널로 scrollIntoView는 짧은 상세일 때 스크롤 여유가 없어 오히려
  // 패널이 화면 하단에 걸리므로, 화면 최상단으로 올려 새 상세를 처음부터 보게 한다.
  const selectItemAndScroll = (name: string) => { setSelectedItemName(name); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [selectedRegionProvince, setSelectedRegionProvince] = useState<string | null>(defaultRegionProvince);
  const [expandedRegionProvince, setExpandedRegionProvince] = useState<string | null>(null);
  const [selectedRegionCode, setSelectedRegionCode] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [mapMetric, setMapMetric] = useState<MapMetric>("coverage");
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string | null>(null);
  const [trendStartYear, setTrendStartYear] = useState<number | null>(null);
  const [trendEndYear, setTrendEndYear] = useState<number | null>(null);

  const regionalRegions = useMemo(() => snapshot.regions.filter((region) => region.sido !== "전국"), [snapshot.regions]);
  const totals = useMemo(() => snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { acc.availableItems += 1; acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; } acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0, availableItems: 0 }), [snapshot.regions]);
  const sourceLine = [...new Set(snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean))].join(" · ");
  const dashboardUpdatedAt = snapshotUpdatedAt(snapshot);
  const provinceStats = useMemo(() => {
    const stats = new Map<string, { trademarks: number; registered: number; verified: number; totalItems: number; decidedItems: number; appliedItems: number }>();
    regionalRegions.forEach((region) => {
      const name = region.sido || region.region;
      const current = stats.get(name) || { trademarks: 0, registered: 0, verified: 0, totalItems: 0, decidedItems: 0, appliedItems: 0 };
      region.items.forEach((item) => {
        const official = Boolean(officialItemLabel(item));
        current.totalItems += 1;
        if (item.metrics.uniqueTrademarkCount.availability === "available") {
          current.decidedItems += 1;
          if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) current.appliedItems += 1;
        }
        // 지역 단위 상표 집계(trademarks/verified/registered)는 고시명칭이 확정된
        // 공식 특산품만 포함한다. matchingBasis=raw_item_name_unclassified인 검토대기
        // 원물명·상호(예: "꿀다림 데일리허니", "왕곡한과")는 uniqueTrademarkCount가
        // available이어도 지역 상표 건수 합계에 섞이면 안 된다(2026-08-19 데이터 감사).
        if (official && item.metrics.uniqueTrademarkCount.availability === "available") {
          current.verified += 1;
          current.trademarks += item.metrics.uniqueTrademarkCount.value || 0;
          current.registered += item.metrics.registeredTrademarkCount.value || 0;
        }
      });
      stats.set(name, current);
    });
    return stats;
  }, [regionalRegions]);
  const provinceCompositionRows = [...provinceStats.entries()]
    .filter(([, stat]) => stat.trademarks > 0)
    .sort((a, b) => b[1].trademarks - a[1].trademarks)
    .slice(0, 10);
  const provinceCompositionMax = Math.max(1, ...provinceCompositionRows.map(([, stat]) => stat.trademarks));
  const mapMax = mapMetric === "registration" || mapMetric === "applicationCoverage" ? 1 : Math.max(1, ...[...provinceStats.values()].map((stat) => mapMetric === "trademarks" ? stat.trademarks : stat.totalItems));
  const filteredRegions = useMemo(() => { const keyword = query.trim().toLocaleLowerCase("ko-KR"); return !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => `${itemName(item)} ${item.noticeName || ""}`.toLocaleLowerCase("ko-KR").includes(keyword))); }, [query, snapshot.regions]);
  const groupedRegions = useMemo(() => {
    const groups = new Map<string, Region[]>();
    filteredRegions.forEach((region) => {
      const province = region.sido || region.region;
      const rows = groups.get(province) || [];
      rows.push(region);
      groups.set(province, rows);
    });
    return [...groups.entries()]
      .map(([province, regions]) => ({ province, regions: regions.sort((a, b) => (a.sigungu || a.region).localeCompare(b.sigungu || b.region, "ko-KR")) }))
      .sort((a, b) => compareProvince(a.province, b.province));
  }, [filteredRegions]);
  const selectedRegion = snapshot.regions.find((region) => regionKey(region) === selectedRegionCode);
  // 고시명칭 매칭 여부는 판정 기준의 하나일 뿐이라, 특정 품목(specialtyId)이 지정된
  // 경우 미분류 원물명이라도 그 품목을 그대로 보여준다(사용자 지적, 2026-08-21). 기본
  // 선택값만 공식 특산품을 우선한다.
  const selectedRegionItems = selectedRegion ? selectedRegion.items : [];
  const selectedRegionOfficialItems = selectedRegion ? officialRegionItems(selectedRegion) : [];
  const selectedItem = selectedRegionItems.find((item) => item.specialtyId === selectedItemId) || selectedRegionOfficialItems[0] || selectedRegionItems[0];
  // 이슈 #116(2026-08-26): 지자체별 조회 화면 좌측 아코디언과 별개로, 광역자치단체를
  // 상단 탭으로도 바로 고를 수 있게 해달라는 요청 — 검색어와 무관하게 항상 전체 광역 목록을 보여준다.
  const allProvinces = useMemo(() => [...new Set(snapshot.regions.map((region) => region.sido || region.region))].sort(compareProvince), [snapshot.regions]);
  // 이슈 #119: 지역별 모드에서도 품목별 모드의 카테고리 칩처럼 17개 시도를 바로 고를 수
  // 있는 목록을 보여준다("지역을 누르면 16대 행정구역명칭이 아래 나오던 게 안나와").
  const provinceFilterList = useMemo(() => allProvinces.filter((province) => province !== "전국"), [allProvinces]);
  const activeRegionProvince = groupedRegions.some((group) => group.province === selectedRegionProvince) ? selectedRegionProvince : groupedRegions[0]?.province || null;
  const activeProvinceRegions = groupedRegions.find((group) => group.province === activeRegionProvince)?.regions || [];
  const itemRows = useMemo(() => {
    const rows = new Map<string, { name: string; category: ItemCategory | null; searchTerms: string[]; trademarks: number; trademarksDisplay: number; hasProvisional: boolean; registered: number; available: number; availableRegions: string[]; regions: string[]; regionCounts: Record<string, number>; provinceCounts: Record<string, number>; matchedItems: Item[]; states: string[] }>();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, category: item.category || null, searchTerms: [], trademarks: 0, trademarksDisplay: 0, hasProvisional: false, registered: 0, available: 0, availableRegions: [], regions: [], regionCounts: {}, provinceCounts: {}, matchedItems: [], states: [] };
      row.searchTerms.push(...[item.itemName, item.noticeName, name].filter((value): value is string => Boolean(value)));
      const trade = tradeDisplay(item);
      if (trade.value !== null) { row.trademarksDisplay += trade.value; if (trade.provisional) row.hasProvisional = true; }
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.available += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; if (!row.availableRegions.includes(region.region)) row.availableRegions.push(region.region); row.regionCounts[region.region] = (row.regionCounts[region.region] || 0) + (item.metrics.uniqueTrademarkCount.value || 0); const province = region.sido || region.region; row.provinceCounts[province] = (row.provinceCounts[province] || 0) + (item.metrics.uniqueTrademarkCount.value || 0); }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      row.matchedItems.push(item);
      row.states.push(item.dataState);
      rows.set(name, row);
    }));
    const keyword = itemQuery.trim().toLocaleLowerCase("ko-KR");
    // 정렬은 확정 건수(trademarks) 기준으로 한다 — 전국 검색까지 섞은 trademarksDisplay로
    // 정렬하면 지역 확인이 안 된 노이즈가 큰 품목이 상위 100개 컷에서 확정 데이터를
    // 밀어낼 수 있다(2026-08-19 결정).
    return [...rows.values()]
      .filter((row) => !keyword || row.searchTerms.some((term) => term.toLocaleLowerCase("ko-KR").includes(keyword)) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword)))
      .filter((row) => !categoryFilter || row.category?.code === categoryFilter)
      .sort((a, b) => b.trademarks - a.trademarks);
  }, [itemQuery, categoryFilter, snapshot.regions]);
  // 이슈 #109(품목 카테고리화): 실제로 데이터에 등장하는 유형만 필터 버튼으로 보여준다.
  const availableCategories = useMemo(() => {
    const seen = new Map<string, string>();
    snapshot.regions.forEach((region) => region.items.forEach((item) => { if (item.category) seen.set(item.category.code, item.category.label); }));
    return [...seen.entries()].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  }, [snapshot.regions]);
  const comparisonRows = useMemo(() => [...provinceStats.keys()].map((province) => {
    const regions = snapshot.regions.filter((region) => (region.sido || region.region) === province);
    const coverage = specialtyCoverage(regions);
    const names = [...new Set(regions.flatMap((region) => region.items.map(officialItemLabel).filter((name): name is string => Boolean(name))))].sort((a, b) => a.localeCompare(b, "ko-KR"));
    const cropGroups = new Map<string, { tier: string; items: Item[] }>();
    regions.forEach((region) => region.items.forEach((item) => {
      const badge = item.regionalSpecialtyCropBadge;
      if (!badge) return;
      const current = cropGroups.get(badge.officialItemName) || { tier: badge.tier, items: [] };
      current.items.push(item);
      cropGroups.set(badge.officialItemName, current);
    }));
    const policyCrops = [...cropGroups.entries()].map(([name, group]) => {
      const decided = group.items.some((item) => item.metrics.uniqueTrademarkCount.availability === "available");
      const applications = group.items.reduce((sum, item) => item.metrics.uniqueTrademarkCount.availability === "available" ? sum + (item.metrics.uniqueTrademarkCount.value || 0) : sum, 0);
      return { name, displayName: stripParens(name), tier: group.tier, decided, applications, applied: applications > 0 };
    }).sort((a, b) => a.tier.localeCompare(b.tier, "ko-KR") || a.name.localeCompare(b.name, "ko-KR"));
    const policyApplicationsTotal = policyCrops.reduce((sum, crop) => sum + crop.applications, 0);
    const policyDecided = policyCrops.filter((crop) => crop.decided).length;
    const policyApplied = policyCrops.filter((crop) => crop.applied).length;
    // 이슈 #117(2026-08-26 샘플 참고): 정책 지정 개수 대비 비율만으로는 "이 도가 실제로
    // 무엇을 브랜드로 밀고 있는가"가 안 보인다 — 도별 대표작목(1개, 최우선 지정)이 실제
    // 등록 상표 활동에서도 상위권인지를 직접 대조한다. 등록 기준(출원보다 엄격한 실제
    // 브랜드 완성 신호)으로 도 전체 품목을 집계해 TOP5를 뽑고, 대표작목이 그 안에 있는지로
    // "일치/불일치"를 판정한다. 샘플과 달리 채소를 임의로 빼지 않고 벼/쌀도 통합하지
    // 않는다(정책적 예외를 만들지 않고 있는 그대로 비교) — 대신 대표작목이 여러 지역
    // 데이터에 걸쳐 있을 수 있어 지역 간 동일 품목은 등록 건수를 합산한다.
    const registeredByName = new Map<string, number>();
    regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name || item.metrics.registeredTrademarkCount.availability !== "available") return;
      registeredByName.set(name, (registeredByName.get(name) || 0) + (item.metrics.registeredTrademarkCount.value || 0));
    }));
    const topRegisteredItems = [...registeredByName.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    const flagshipCrop = policyCrops.find((crop) => crop.tier === "대표작목") || null;
    const flagshipRank = flagshipCrop ? topRegisteredItems.findIndex((row) => row.name === flagshipCrop.name) : -1;
    const flagshipMatch = flagshipRank >= 0;
    return { province, coverage, names, policyCrops, policyApplicationsTotal, policyDecided, policyApplied, policyRate: policyCrops.length ? policyApplied / policyCrops.length : null, topRegisteredItems, flagshipCrop, flagshipMatch, flagshipRank };
  // 이슈 #117: 표는 지역(행정표준코드) 순서로 정렬한다.
  }).filter((row) => row.policyCrops.length > 0).sort((a, b) => compareProvince(a.province, b.province)), [provinceStats, snapshot.regions]);
  // 검토가 덜 끝난 상태에서도 전체 목록을 다 보여주기보다, 상표 출원 건수가 많은
  // 순으로 상위 100개만 우선 보여준다(2026-08-19 결정).
  const ITEM_ROW_LIMIT = 100;
  const visibleItemRows = itemRows.slice(0, ITEM_ROW_LIMIT);
  // 이슈 #119(품목별 조회 개편): 한 화면에 여러 품목 상세를 펼치지 않고, 왼쪽 목록에서
  // 하나를 고르면 오른쪽에 그 품목만 상세로 보여준다. 선택이 현재 목록에서 빠지면
  // 목록 첫 항목으로 되돌린다.
  const selectedItemRow = visibleItemRows.find((row) => row.name === selectedItemName) || visibleItemRows[0] || null;
  // 이슈 #112: 요약 탭에서 특정 지역/품목을 클릭해 "지자체별 조회"로 이동하면, 그
  // 지역의 시/도 아코디언이 자동으로 펼쳐지면서 사실상 그 지역만 디폴트로 보이는
  // 것처럼 느껴진다는 지적 — 이동 시에는 자동으로 펼치지 않고 전체 시/도 목록이
  // 평소 상태(접힘) 그대로 보이게 한다. 좌측 목록에서 직접 아코디언을 펼치는 클릭은
  // 그대로 유지된다(province-toggle의 별도 onClick).
  // 이슈 #116: 지역·품목을 새로 고르면 상세가 바뀌는데 스크롤이 이전 상세를 읽던 자리
  // (비즈니스 흐름·등록 사례 등 하단)에 남아, 특히 데이터가 없는 품목은 빈 화면 하단만
  // 보인다. 선택할 때마다 화면 최상단으로 올려 "이 지역의 대표 특산품"부터 보이게 한다.
  const scrollTop = () => { if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };
  // 지역을 드릴다운할 때 좌측 아코디언·광역 탭바가 실제 선택 지역의 시도를 가리키도록
  // selectedRegionProvince/expandedRegionProvince도 함께 맞춘다(요약 mini-list·지도·
  // 특산품별 목록에서 바로 들어올 때 엉뚱한 시도가 활성으로 남던 문제).
  function chooseRegion(region: Region) {
    const province = region.sido || region.region;
    setSelectedRegionProvince(province);
    setExpandedRegionProvince(province);
    setSelectedRegionCode(regionKey(region));
    setSelectedItemId(officialRegionItems(region)[0]?.specialtyId || "");
    scrollTop();
  }
  function chooseRegionItem(id: string) { setSelectedItemId(id); scrollTop(); }
  function regionTrademarkValue(region: Region | undefined) { if (!region) return null; const verified = region.items.filter((item) => officialItemLabel(item) && item.metrics.uniqueTrademarkCount.availability === "available"); return verified.length ? verified.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0) : null; }
  function regionMapValue(region: Region | undefined, metric: MapMetric = mapMetric) { if (!region) return null; const available = region.items.filter((item) => officialItemLabel(item) && item.metrics.uniqueTrademarkCount.availability === "available"); const trademarks = available.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0); const registered = available.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0); if ((metric === "trademarks" || metric === "registration") && available.length === 0) return null; if (metric === "trademarks") return trademarks; if (metric === "registration") return trademarks ? registered / trademarks : 0; const coverage = specialtyCoverage([region]); if (metric === "coverage") return coverage.total; return coverage.rate; }
  function mapValue(name: string, metric: MapMetric = mapMetric) { const stat = provinceStats.get(name); if (!stat) return null; if (metric === "trademarks") return stat.verified ? stat.trademarks : null; if (metric === "registration") return stat.verified && stat.trademarks ? stat.registered / stat.trademarks : null; if (metric === "coverage") return stat.totalItems; return stat.totalItems ? stat.appliedItems / stat.totalItems : null; }
  function mapMetricValueLabel(value: number | null, metric: MapMetric = mapMetric) { if (value === null) return "데이터 없음"; if (metric === "registration" || metric === "applicationCoverage") return percent(value); return `${number(value)}${metric === "trademarks" ? "건" : "개 품목"}`; }
  function mapValueLabel(name: string, metric: MapMetric = mapMetric) { return mapMetricValueLabel(mapValue(name, metric), metric); }
  function openProvince(name: string) { setSelectedProvince(name); setSelectedMunicipality(null); }
  // 이슈 #80/#113: 지도 경계는 2026-08-24부터 vuski/admdongkor(2026-07-01 기준,
  // 군위군의 경북→대구 편입 등 최신 행정구역 변경이 반영됨)로 바뀌어 군위군 같은
  // 불일치는 더 이상 발생하지 않는다. 다만 지도 도형은 여전히 제3자가 재배포하는
  // 참고용 데이터라 향후 개편에서 또 어긋날 수 있으므로, sido까지 정확히 일치하는
  // 지역이 없으면 시군구명만으로도 찾는 안전망은 남겨둔다.
  function findMunicipalityRegion(province: string | null, name: string) {
    return snapshot.regions.find((region) => region.sido === province && region.sigungu === name)
      || snapshot.regions.find((region) => region.sigungu === name);
  }
  function openMunicipality(name: string) { setSelectedMunicipality(name); const match = findMunicipalityRegion(selectedProvince, name); if (match) chooseRegion(match); }

  // 2026-08-21: 대전·대구·부산·울산·인천광역시, 전남광주통합특별시는 원본 소스(농사로)에
  // 구/군 정보가 아예 없어 시 전체로만 특산품이 잡힌다(region.sigungu === region.sido).
  // 특정 구를 클릭해도 이 "미분류" 행까지 걸러버리면 실제로 있는 데이터가 빈 화면으로
  // 보인다 — 어떤 구를 눌러도 시 전체 미분류 항목은 계속 보여준다(사용자 요청).
  // 이슈 #117 코멘트(2026-09-03) 조사 중 발견: #137 운영 파이프라인 통합 이후 스냅샷에서
  // 구·군 데이터가 없는 행의 sigungu 표현이 region.sigungu === region.sido(예전 방식)에서
  // sigungu: null(현재 방식, 도 단위 RDA 배정 포함)로 바뀌어 있었다 — 원래 조건은 이제 어떤
  // 행에도 안 걸린다. 두 표현을 모두 인식하도록 넓힌다.
  const isUnclassifiedRegion = (region: Region) => !region.sigungu || region.sigungu === region.sido;
  // 이슈 #117 코멘트(2026-09-03): 경기도처럼 실제 시군구 데이터(가평군 등)가 있는 도에
  // RDA 지역특화작목 도 단위 배정(#117)으로 시군구 미지정 행("경기도" 자체)이 하나 더
  // 생기면서, 특정 시군구(가평군)를 골라도 이 도 단위 행이 OR 조건으로 계속 끼어들어
  // "가평군"과 "경기도"가 나란히 같은 급의 카드로 보이는 문제가 있었다. isUnclassifiedRegion
  // 폴백은 원래 대전·대구·부산 등 그 도시 전체가 구·군 데이터 자체가 없는 경우(시군구를
  // 아무리 눌러도 실제 매칭 행이 없어 빈 화면이 되는 것을 막기 위함)만을 위한 것이었으므로,
  // 실제 시군구 데이터가 있는 도에서는 이 폴백을 끈다.
  const provinceHasRealMunicipalities = selectedProvince ? regionalRegions.some((region) => region.sido === selectedProvince && !isUnclassifiedRegion(region)) : false;
  // 이슈 #116(2026-09-01): 전국 단위 카탈로그(sido="전국", 지역 없는 인증 수산물·임산물
  // 132건)를 지도·요약의 "특산품 수" 모집단에 넣지 않는다 — hero·데이터 개요는 이미
  // regionItemCount(지역 귀속 행)를 쓰는데 이 지도 카운터만 snapshot.regions 전체를 세서
  // 1,937 대 1,805로 어긋나 있었다. 모집단을 regionalRegions 하나로 통일한다.
  const visibleRegions = selectedProvince ? regionalRegions.filter((region) => (region.sido || region.region) === selectedProvince && (!selectedMunicipality || region.sigungu === selectedMunicipality || (isUnclassifiedRegion(region) && !provinceHasRealMunicipalities))) : regionalRegions;
  const nationalSpecialtyCoverage = specialtyCoverage(regionalRegions);
  const nationalTrendItems = useMemo(() => regionalRegions.flatMap((region) => region.items), [regionalRegions]);
  const visibleSpecialtyCoverage = specialtyCoverage(visibleRegions);
  // 2026-08-24(이슈 #111): 고시명칭 확정 여부로 미리보기를 걸러내면, 지역 특산품 수(예: 6개)와
  // 미리보기에 뜨는 개수(예: 2개)가 안 맞아 보인다는 지적. 고시명칭 매칭은 판정 기준의
  // 하나일 뿐 특산품 여부와 무관하다는 원칙(coverage-specialty-list와 동일)을 여기도 적용해
  // 지역의 전체 품목을 보여주되, 상표명은 여전히 안 보여준다 — label은 특산품명(고시명칭 또는
  // 원물명)만 쓰고 개별 상표명은 지역 상세에서 검색 근거와 함께 확인한다.
  const visibleItems = visibleRegions.flatMap((region) => region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) })));
  const visibleTrademarkCount = visibleItems.reduce((sum, { item }) => item.metrics.uniqueTrademarkCount.availability === "available" ? sum + (item.metrics.uniqueTrademarkCount.value || 0) : sum, 0);
  const visibleRegisteredCount = visibleItems.reduce((sum, { item }) => item.metrics.registeredTrademarkCount.availability === "available" ? sum + (item.metrics.registeredTrademarkCount.value || 0) : sum, 0);
  const visibleRegistrationRate = visibleTrademarkCount ? visibleRegisteredCount / visibleTrademarkCount : null;
  const visibleInsightItems = [...visibleItems].sort((a, b) => {
    if (mapMetric === "registration") return (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0);
    if (mapMetric === "coverage") return `${a.region.region} ${a.label}`.localeCompare(`${b.region.region} ${b.label}`, "ko-KR");
    return (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0);
  });
  const insightListLabel = mapMetric === "coverage" ? "수집 특산품 예시" : mapMetric === "trademarks" ? "상표 출원 상위 특산품" : mapMetric === "registration" ? "등록 상위 특산품" : "특산품별 출원 확인 현황";
  function insightItemValue(item: Item) {
    const available = item.metrics.uniqueTrademarkCount.availability === "available";
    const filed = item.metrics.uniqueTrademarkCount.value || 0;
    if (mapMetric === "coverage") return "수집 항목";
    if (!available) return "지역별 집계 대기";
    if (mapMetric === "trademarks") return `상표 ${number(filed)}건`;
    if (mapMetric === "registration") return filed ? `등록 ${number(item.metrics.registeredTrademarkCount.value || 0)}건 · ${percent(item.metrics.registrationRate.value)}` : "등록 대상 출원 없음";
    return filed > 0 ? `출원 확인 · ${number(filed)}건` : "미출원(검토중)";
  }
  const RANKING_LIMIT = 10;
  const rankingCandidates = regionalRegions.flatMap((region) => region.items.flatMap((item) => {
    const label = officialItemLabel(item);
    return label ? [{ region, item, label }] : [];
  }));
  const applicationRankingRows = [...rankingCandidates]
    .filter(({ item }) => item.metrics.uniqueTrademarkCount.availability === "available")
    .sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
  const registrationRankingRows = [...rankingCandidates]
    .filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available")
    .sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0));
  const municipalityGeometry = selectedProvince ? geometry.municipalities[selectedProvince] : null;
  const municipalityMapMax = mapMetric === "registration" || mapMetric === "applicationCoverage" ? 1 : municipalityGeometry ? Math.max(1, ...municipalityGeometry.items.map((shape) => regionMapValue(findMunicipalityRegion(selectedProvince, shape.name)) || 0)) : 1;
  const activeMapViewBox = municipalityGeometry?.viewBox || geometry.viewBox;
  const activeMapShapes = municipalityGeometry?.items || geometry.provinces;
  const activeMapLabels = positionedMapLabels(activeMapShapes, Boolean(municipalityGeometry));
  const coverageAreaRegions = selectedProvince
    ? snapshot.regions.filter((region) => region.sido === selectedProvince && (!selectedMunicipality || region.sigungu === selectedMunicipality || (isUnclassifiedRegion(region) && !provinceHasRealMunicipalities)))
    : regionalRegions;
  const coverageArea = specialtyCoverage(coverageAreaRegions);
  const coverageAreaName = selectedMunicipality || selectedProvince || "전국";
  const coverageAreaDisplayName = displayRegionName(coverageAreaName);
  const coverageBreakdown = (selectedProvince
    ? coverageAreaRegions.map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region }))
    : [...provinceStats.keys()].map((province) => ({ key: province, label: province, regions: snapshot.regions.filter((region) => region.sido === province), region: null })))
    .map((row) => ({
      ...row,
      coverage: specialtyCoverage(row.regions),
      items: row.regions.flatMap((region) => region.items.map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) }))),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  const coverageListedItemCount = coverageBreakdown.reduce((sum, row) => sum + row.items.length, 0);
  // 이슈 #117 코멘트(2026-09-03): 도 단위 시군구 미지정 행("경기도" 자체)과 실제 시군구
  // 카드(가평군 등)를 나란한 카드로 보여주면 헷갈린다는 지적 — 도 단위 항목은 별도 표시,
  // 실제 시군구 카드는 토글(펼치기) 뒤로 숨긴다.
  type CoverageRow = (typeof coverageBreakdown)[number];
  function coverageCard(row: CoverageRow) {
    return <article className={selectedMunicipality && row.label === selectedMunicipality ? "coverage-region-card selected" : "coverage-region-card"} key={row.key}><div className="coverage-region-head"><div><strong>{displayRegionName(row.label)}</strong><small>특산품 {number(row.coverage.total)}개</small></div><div className="coverage-region-summary"><span>출원 확인 특산품 {number(row.coverage.applied)}개</span><b>{percent(row.coverage.rate)}</b></div>{!selectedProvince && <button type="button" onClick={() => openProvince(row.label)}>지도에서 보기</button>}</div><div className="coverage-specialty-list">{row.items.map(({ region, item, label }) => { const status = specialtyFilingStatus(item); return <button type="button" key={`${regionKey(region)}-${item.specialtyId}`} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span>{selectedProvince ? label : `${region.sigungu || region.region} / ${label}`}{item.regionalSpecialtyCropBadge && <em className={`crop-badge crop-badge-${item.regionalSpecialtyCropBadge.tier}`}>{item.regionalSpecialtyCropBadge.tier}</em>}</span><small className={`specialty-status ${status.filed ? "filed" : "unfiled"}`}>{status.label}</small></button>; })}</div></article>;
  }
  const trendItems = coverageAreaRegions.flatMap((region) => region.items);
  const trendApplicationTotals = sumYearCounts(trendItems, "applicationYearCounts");
  const trendRegisteredTotals = sumYearCounts(trendItems, "registrationYearCounts");
  const trendAllYears = [...new Set([...Object.keys(trendApplicationTotals), ...Object.keys(trendRegisteredTotals)])].map(Number).sort((a, b) => a - b);
  const trendFullStart = trendAllYears[0] ?? new Date().getFullYear();
  const trendFullEnd = trendAllYears[trendAllYears.length - 1] ?? new Date().getFullYear();
  // 지역을 바꾸면 이전 지역의 시작 연도가 새 지역 범위보다 앞설 수 있다. 양 끝을 현재
  // 데이터 범위에 모두 고정해 핸들이 트랙 바깥(음수 %)으로 사라지지 않게 한다(#136).
  const { start: trendStart, end: trendEnd } = clampTrendRange(trendStartYear, trendEndYear, trendFullStart, trendFullEnd);
  const trendYears: number[] = [];
  for (let year = trendStart; year <= trendEnd; year++) trendYears.push(year);
  const trendMax = Math.max(1, ...trendYears.map((year) => Math.max(trendApplicationTotals[year] || 0, trendRegisteredTotals[year] || 0)));
  const trendScale = trendScales(trendStart, trendEnd, trendMax);
  const trendHasData = trendAllYears.length > 0;
  const pipeline = snapshot.pipelineStatus;
  const scopeLabel = snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터";
  const gateTotal = pipeline ? pipeline.regionalMetricGate.availableRegionItemCount + pipeline.regionalMetricGate.blockedRegionItemCount : snapshot.coverage.regionItemCount;
  const uniqueSpecialtyCount = useMemo(() => new Set(snapshot.regions.flatMap((region) => region.items.map((item) => itemName(item)))).size, [snapshot.regions]);
  // 이슈 #116(2026-08-26): 품목별 비즈니스 확장 전략을 위한 별도 메뉴. 전체 품목 확장 전
  // 이슈 #119(2026-09-02): 대표 샘플을 1+1건만 보여주던 걸 공백 알림·양호 각 5건씩
  // 최대 10건으로 늘린다. 품목이 겹치지 않게 품목명 기준으로 중복을 뺀다.
  const BRIEFING_SAMPLE_LIMIT = 5;
  const briefingSamples = useMemo(() => {
    const alertRows: { region: Region; item: Item }[] = [];
    const okRows: { region: Region; item: Item }[] = [];
    const seen = new Set<string>();
    outer: for (const region of regionalRegions) {
      for (const item of region.items) {
        if (!item.briefing?.sentences.length) continue;
        const key = officialItemLabel(item) || itemName(item);
        if (seen.has(key)) continue;
        if (item.briefing.isGapAlert && alertRows.length < BRIEFING_SAMPLE_LIMIT) { alertRows.push({ region, item }); seen.add(key); }
        else if (!item.briefing.isGapAlert && okRows.length < BRIEFING_SAMPLE_LIMIT) { okRows.push({ region, item }); seen.add(key); }
        if (alertRows.length >= BRIEFING_SAMPLE_LIMIT && okRows.length >= BRIEFING_SAMPLE_LIMIT) break outer;
      }
    }
    return [...alertRows, ...okRows];
  }, [regionalRegions]);
  // 이슈 #116(2026-09-01): 지역·품목별 조회 탭 안의 지역별/품목별 토글.
  const goExplore = (mode: "region" | "item") => { setTab(mode === "item" ? "items" : "applications"); setSelectedRegionCode(""); setSelectedItemId(""); };
  const exploreSubnav = (mode: "region" | "item") => <div className="explore-subnav" role="tablist" aria-label="지역·품목별 조회 전환">
    <button type="button" role="tab" aria-selected={mode === "region"} className={mode === "region" ? "active" : ""} onClick={() => goExplore("region")}>지역별</button>
    <button type="button" role="tab" aria-selected={mode === "item"} className={mode === "item" ? "active" : ""} onClick={() => goExplore("item")}>품목별</button>
  </div>;
  // 이슈 #116(2026-09-01)·#119: "비즈니스 전략에서 주요 품목별로 조회" — 드롭다운의 주요
  // 샘플 외에 나머지 품목도 이름을 직접 입력해 찾을 수 있게, 브리핑·흐름이 없는 품목도
  // 그룹을 만들어 둔다(화면에서 "데이터 없음"으로 안내).
  const strategyItemGroups = useMemo(() => {
    const groups = new Map<string, { name: string; flow: NationwideFlow | null; briefings: { region: Region; item: Item }[]; originRows: { region: string; apps: number; badge: boolean }[] }>();
    for (const region of regionalRegions) {
      for (const item of region.items) {
        const name = officialItemLabel(item);
        if (!name) continue;
        const group = groups.get(name) || { name, flow: null, briefings: [], originRows: [] };
        if (!group.flow && item.businessFlow) group.flow = item.businessFlow;
        if (item.briefing?.sentences.length) group.briefings.push({ region, item });
        // 이슈 #119: "주요 원산지" — 이 품목을 특산품으로 수집한 지역. 지역 주소 일치 출원이
        // 많거나 지리적표시·특화작목 배지가 있는 지역을 우선한다.
        const apps = item.metrics.uniqueTrademarkCount.availability === "available" ? item.metrics.uniqueTrademarkCount.value || 0 : 0;
        const badge = Boolean(item.regionalSpecialtyCropBadge) || (item.regionalEvidence?.some((evidence) => evidence.regionalMetricEligible) ?? false);
        group.originRows.push({ region: region.region, apps, badge });
        groups.set(name, group);
      }
    }
    return [...groups.values()].map((group) => ({
      ...group,
      origins: [...group.originRows].sort((a, b) => Number(b.badge) - Number(a.badge) || b.apps - a.apps || a.region.localeCompare(b.region, "ko-KR")).slice(0, 3).map((row) => row.region),
    })).sort((a, b) => b.briefings.length - a.briefings.length || a.name.localeCompare(b.name, "ko-KR"));
  }, [regionalRegions]);
  // 드롭다운은 브리핑·흐름이 있는 "주요 샘플"만, 직접 입력(datalist)은 전체 품목.
  const strategySampleGroups = useMemo(() => strategyItemGroups.filter((group) => group.flow || group.briefings.length), [strategyItemGroups]);
  // #136: 잘 보이지 않는 select 대신 첫 화면에서 바로 누를 수 있는 주요 특산품 토글을 둔다.
  // 지역별 브리핑이 많은 품목을 우선하고, 동률이면 전국 흐름 건수로 정렬한다.
  const strategyFeaturedGroups = useMemo(() => [...strategySampleGroups]
    .sort((a, b) => b.briefings.length - a.briefings.length || (b.flow?.totalCount || 0) - (a.flow?.totalCount || 0) || a.name.localeCompare(b.name, "ko-KR"))
    .slice(0, 12), [strategySampleGroups]);
  const selectedStrategyGroup = strategyItemGroups.find((group) => group.name === strategyItem) || null;
  return <main className="shell">
    <header className="topbar" id="top"><button className="brand brand-button" type="button" onClick={() => setTab("summary")} aria-label="지역 특산품-상표 분석·정책지원 플랫폼 홈"><img className="brand-mark" src="/images/kiip-logo-mark.png" alt="KIIP" width={36} height={24} /><span><strong>지역 특산품-상표 분석·정책지원 플랫폼</strong></span></button><div className="snapshot-meta"><span className="sample-badge">{scopeLabel}</span><span>마지막 업데이트 {date(dashboardUpdatedAt)}</span></div></header>
    <nav className="primary-tabs" aria-label="대시보드 화면">{PRIMARY_NAV.map(({ key, label }) => { const active = tab === key || (key === "applications" && EXPLORE_TABS.includes(tab)); return <button type="button" key={key} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => { if (key === "applications" && EXPLORE_TABS.includes(tab)) return; setTab(key); }}>{label}</button>; })}</nav>

    {tab === "summary" && <>
      {/* 이슈 #116(2026-09-01): 요약 상단의 전체 폭 지표 바를 지도 옆 왼쪽 열로 옮긴다 —
          "전국 특산품 수" 카드가 그 지표 바와 겹쳐 보인다는 지적. 지도 지표 토글에 연동되는
          출원율·등록률 링만 왼쪽 열에 남기고, 특산품 수·상표 건수 단독 카드는 뺀다. */}
      <section className="summary-row" aria-label="핵심 지표·지도·출원 랭킹">
        <aside className="map-insight">
          <section className="metrics metrics-inset" aria-label="핵심 지표"><article><span>전국 특산품 수</span><strong>{number(nationalSpecialtyCoverage.total)}</strong><small>{snapshot.coverage.observedRegionCount}개 지역 · 지역×특산품 수집 항목</small></article><article><span>특산품 출원율</span><strong>{percent(nationalSpecialtyCoverage.rate)}</strong><small>출원 확인 {number(nationalSpecialtyCoverage.applied)}개</small></article><article><span>출원인 주소 확보율</span><strong>{pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>{pipeline ? `확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역별 출원 수 표시 가능</span><strong>{pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>지역×특산품 집계 가능 항목</small></article></section>
          <h2>{displayRegionName(selectedMunicipality || selectedProvince || "전국")} · {MAP_LABELS[mapMetric]}</h2>
          {mapMetric === "applicationCoverage" && <div className="rate-hero"><RateRing value={visibleSpecialtyCoverage.rate} label="출원율" /><div className="rate-hero-detail"><span>특산품 출원율</span><small>수집 특산품 {number(visibleSpecialtyCoverage.total)}개 중 출원 확인 {number(visibleSpecialtyCoverage.applied)}개{visibleSpecialtyCoverage.pending ? ` · 집계 대기 ${number(visibleSpecialtyCoverage.pending)}개` : ""}</small></div></div>}
          {mapMetric === "registration" && <div className="rate-hero"><RateRing value={visibleRegistrationRate} label="등록률" /><div className="rate-hero-detail"><span>상표 등록률</span><small>지역 주소 일치 출원 {number(visibleTrademarkCount)}건 중 등록 {number(visibleRegisteredCount)}건</small></div></div>}
          {selectedProvince && !provinceHasRealMunicipalities && visibleRegions.some(isUnclassifiedRegion) && <p className="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 {displayRegionName(selectedProvince)} 전체로만 집계됩니다. 지도에서 특정 구·군을 눌러도 같은 목록이 표시됩니다.</p>}
          <div className="mini-list-heading"><strong>{insightListLabel}</strong><span>최대 5개</span></div>
          <div className="mini-list">{visibleInsightItems.slice(0, 5).map(({ region, item, label }) => <button type="button" key={`${regionKey(region)}-${item.specialtyId}`} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span><strong>{region.sigungu || region.region} / {label}</strong><small>{noticeBasis(item)}{item.niceClass ? ` · NICE ${item.niceClass}류` : ""}</small></span><b>{insightItemValue(item)}</b></button>)}{visibleInsightItems.length === 0 && <p className="empty">이 지역에는 수집된 특산품이 없습니다.</p>}</div>
        </aside>
        <div className="map-card"><div className="map-heading"><div><h2>{selectedProvince ? `${displayRegionName(selectedProvince)} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span className="reference-chip" title={`지도 도형은 ${geometry.boundaryReference.sourceName} 제공 경계(${geometry.boundaryReference.sourceBasis})를 참고용으로 씁니다 — 제3자가 재배포하는 데이터라 향후 행정구역 개편이 지도 도형에 늦게 반영될 수 있으며, 클릭하면 항상 실제(현재) 행정구역 데이터로 연결됩니다.`}>참고 경계 · {geometry.boundaryReference.sourceBasis.match(/\d{4}-\d{2}-\d{2}/)?.[0] || geometry.boundaryReference.sourceName}</span></div>
          <div className="map-toolbar"><div className="map-metrics">{(Object.keys(MAP_LABELS) as MapMetric[]).map((key) => <button type="button" key={key} className={mapMetric === key ? "active" : ""} onClick={() => setMapMetric(key)} title={MAP_DESCRIPTIONS[key]} aria-label={`${MAP_LABELS[key]}: ${MAP_DESCRIPTIONS[key]}`}>{MAP_LABELS[key]}</button>)}</div>{selectedProvince && <button className="map-back" type="button" onClick={() => { setSelectedProvince(null); setSelectedMunicipality(null); }}>← 전국</button>}</div>
          <p className="map-metric-description"><strong>{MAP_LABELS[mapMetric]}</strong><span>{MAP_DESCRIPTIONS[mapMetric]}</span></p>
          <div className="map-stage"><svg className="korea-map" viewBox={activeMapViewBox} role="img" aria-label={selectedProvince ? `${selectedProvince} 시군구 지도` : "대한민국 시도 지도"}>{municipalityGeometry ? <>
             {municipalityGeometry.items.map((shape) => { const match = findMunicipalityRegion(selectedProvince, shape.name); const statValue = regionMapValue(match); const active = selectedMunicipality === shape.name; return <path key={`${shape.name}-shape`} d={shape.d} className={active ? "map-shape selected" : "map-shape"} style={{ fill: fill(statValue, municipalityMapMax) }} tabIndex={0} role="button" aria-label={`${shape.name} ${mapMetricValueLabel(statValue)}`} onClick={() => openMunicipality(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openMunicipality(shape.name); }}><title>{shape.name} · {mapMetricValueLabel(statValue)}</title></path>; })}
          </> : <>
             {geometry.provinces.map((shape) => <path key={`${shape.name}-shape`} d={shape.d} className={selectedProvince === shape.name ? "map-shape selected" : "map-shape"} style={{ fill: fill(mapValue(shape.name), mapMax) }} tabIndex={0} role="button" aria-label={`${shape.name} ${mapValueLabel(shape.name)}`} onClick={() => openProvince(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProvince(shape.name); }}><title>{shape.name} · {mapValueLabel(shape.name)}</title></path>)}
          </>}{activeMapLabels.map((label) => label.leader ? <g className="map-region-label map-region-label-callout" key={`${label.name}-label`}><polyline points={`${label.targetX},${label.targetY} ${(label.targetX + label.x) / 2},${(label.targetY + label.y) / 2} ${label.x + 22},${label.y + 4}`} /><text x={label.x} y={label.y} className="map-label map-label-province">{label.displayName}</text></g> : <text key={`${label.name}-label`} x={label.x} y={label.y} className={municipalityGeometry ? "map-label map-label-municipality" : "map-label map-label-province"}>{label.displayName}</text>)}</svg></div>
          <div className="map-legend"><span><i className="legend-swatch no-data" />데이터 없음</span><span><i className="legend-swatch low" />낮음</span><span><i className="legend-swatch high" />높음</span><strong>{MAP_LABELS[mapMetric]} 기준</strong></div>
        </div>
        <div className="ranking-columns" aria-label="지역 주소 일치 출원·등록 랭킹">
         <div className="ranking-stack">
          <div className="ranking"><div className="section-heading"><div><h2>지역·대표 특산품 출원 랭킹</h2></div><span>TOP {RANKING_LIMIT}</span></div><div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>출원 확인</th></tr></thead><tbody>{applicationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => <tr key={`app-${regionKey(region)}-${item.specialtyId || index}`}><td>{index + 1}</td><td>{region.region}</td><td title={officialNoticeName(item) ? `고시명칭 ${item.noticeName}${item.niceClass ? ` · NICE ${item.niceClass}류` : ""}` : undefined}>{label}</td><td>{number(item.metrics.uniqueTrademarkCount.value)}건</td></tr>)}</tbody></table></div></div>
          <div className="ranking"><div className="section-heading"><div><h2>지역·대표 특산품 등록 랭킹</h2></div><span>TOP {RANKING_LIMIT}</span></div><div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>등록 완료</th></tr></thead><tbody>{registrationRankingRows.slice(0, RANKING_LIMIT).map(({ region, item, label }, index) => <tr key={`reg-${regionKey(region)}-${item.specialtyId || index}`}><td>{index + 1}</td><td>{region.region}</td><td title={officialNoticeName(item) ? `고시명칭 ${item.noticeName}${item.niceClass ? ` · NICE ${item.niceClass}류` : ""}` : undefined}>{label}</td><td>{number(item.metrics.registeredTrademarkCount.value)}건</td></tr>)}</tbody></table></div></div>
         </div>
        </div>
      </section>
      {/* 이슈 #118: 요약 화면에 전국 출원·등록 추이 그래프를 부각한다. */}
      <RegionTrend region={{ region: "전국", items: nationalTrendItems }} heading="전국 연도별 출원·등록 추이" subtitle="전국 · 실제 출원일자·등록일자 기준" prominent adjustable emptyLabel="아직 연도별 출원 데이터가 수집되지 않았습니다." />
    </>}

    {tab === "applications" && <section className="screen-section coverage-screen">
      {exploreSubnav("region")}
      <div className="province-tabbar region-quick-filter" role="group" aria-label="시도 바로가기">
        <button type="button" className={!selectedProvince ? "active" : ""} onClick={() => { setSelectedProvince(null); setSelectedMunicipality(null); }}>전국</button>
        {provinceFilterList.map((name) => <button type="button" key={name} className={selectedProvince === name ? "active" : ""} onClick={() => openProvince(name)}>{displayRegionName(name)}</button>)}
      </div>
      <label className="search-field explore-search"><span className="sr-only">지역 또는 품목 검색</span><input type="search" value={regionQuery} onChange={(event) => setRegionQuery(event.target.value)} placeholder="지역 또는 품목 검색" /></label>
      <p className="screen-note">전국 16개 시도의 상표 출원·등록·추이를 한눈에 비교합니다. 위 시도 목록·지도·아래 목록에서 지역이나 품목을 누르면 그 지역 상세로 들어갑니다.</p>
      {selectedProvince && !provinceHasRealMunicipalities && coverageAreaRegions.some(isUnclassifiedRegion) && <p className="unclassified-note">이 지역은 구·군별 정보가 없는 원본 자료라, 특산품이 {displayRegionName(selectedProvince)} 전체로만 집계됩니다.</p>}
      <div className={selectedProvince ? "applications-compact-row solo" : "applications-compact-row"}>
      {!selectedProvince && <section className="province-composition"><div className="section-heading"><div><h2>광역별 상표 출원·등록 구성</h2></div><span>지역 주소 일치 출원 상위 10개</span></div><div className="composition-list">{provinceCompositionRows.map(([province, stat], index) => <button type="button" key={province} onClick={() => openProvince(province)}><span className="composition-rank">{index + 1}</span><strong>{displayRegionName(province)}</strong><span className="composition-bar"><i style={{ width: `${stat.trademarks / provinceCompositionMax * 100}%` }}><b style={{ width: `${stat.trademarks ? stat.registered / stat.trademarks * 100 : 0}%` }} /></i></span><small>출원 {number(stat.trademarks)} · 등록 {number(stat.registered)}</small></button>)}</div><p className="composition-legend"><i />출원 <b />등록</p></section>}
      <section className="trend-chart"><div className="section-heading"><div><h2>연도별 출원·등록 추이</h2></div><span>{coverageAreaDisplayName} · 실제 출원일자·등록일자 기준</span></div>
        {trendHasData ? <>
          <div className="trend-controls">
            <div className="trend-range-inputs"><label><span className="sr-only">시작 연도</span>{trendStart}<input type="number" aria-label="시작 연도" value={trendStart} onChange={(event) => setTrendStartYear(Number(event.target.value) || trendFullStart)} /></label><span>~</span><label><span className="sr-only">끝 연도</span>{trendEnd}<input type="number" aria-label="끝 연도" value={trendEnd} onChange={(event) => setTrendEndYear(Number(event.target.value) || trendFullEnd)} /></label></div>
          </div>
          <div className="trend-range-slider"><span className="trend-range-label">{trendFullStart}년 – {trendFullEnd}년 중 {trendStart}년 – {trendEnd}년 선택</span>
            <div className="trend-range-track">
              <div className="trend-range-fill" style={{ left: `${trendHandlePercent(trendStart, trendFullStart, trendFullEnd)}%`, right: `${100 - trendHandlePercent(trendEnd, trendFullStart, trendFullEnd)}%` }} />
              <button type="button" className="trend-range-handle trend-range-handle-start" role="slider" aria-label="시작 연도 조절" aria-valuemin={trendFullStart} aria-valuemax={trendEnd} aria-valuenow={trendStart} style={{ left: `${trendHandlePercent(trendStart, trendFullStart, trendFullEnd)}%` }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.buttons !== 1 || !event.currentTarget.parentElement) return; setTrendStartYear(trendYearAtPointer(event.clientX, event.currentTarget.parentElement, trendFullStart, trendFullEnd)); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); setTrendStartYear(Math.max(trendFullStart, trendStart - 1)); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); setTrendStartYear(Math.min(trendEnd, trendStart + 1)); } }} />
              <button type="button" className="trend-range-handle trend-range-handle-end" role="slider" aria-label="끝 연도 조절" aria-valuemin={trendStart} aria-valuemax={trendFullEnd} aria-valuenow={trendEnd} style={{ left: `${trendHandlePercent(trendEnd, trendFullStart, trendFullEnd)}%` }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.buttons !== 1 || !event.currentTarget.parentElement) return; setTrendEndYear(trendYearAtPointer(event.clientX, event.currentTarget.parentElement, trendFullStart, trendFullEnd)); }} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); setTrendEndYear(Math.max(trendStart, trendEnd - 1)); } else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); setTrendEndYear(Math.min(trendFullEnd, trendEnd + 1)); } }} />
            </div>
          </div>
          <svg className="trend-svg" viewBox={`0 0 ${TREND_CHART.width} ${TREND_CHART.height}`} role="img" aria-label={`${trendStart}년부터 ${trendEnd}년까지 연도별 출원·등록 건수 추이`}>
            {[0, 0.5, 1].map((fraction) => { const value = Math.round(trendMax * fraction); const yPos = trendScale.y(value); return <g key={fraction}><line x1={TREND_CHART.padLeft} x2={TREND_CHART.width - TREND_CHART.padRight} y1={yPos} y2={yPos} className="trend-gridline" /><text x={TREND_CHART.padLeft - 8} y={yPos} className="trend-axis-label trend-axis-y">{number(value)}</text></g>; })}
            <path d={`${trendLinePath(trendYears, trendApplicationTotals, trendScale)}L${trendScale.x(trendEnd).toFixed(1)},${trendScale.baseY}L${trendScale.x(trendStart).toFixed(1)},${trendScale.baseY}Z`} className="trend-area" />
            <path d={trendLinePath(trendYears, trendRegisteredTotals, trendScale)} className="trend-line trend-line-registered" />
            <path d={trendLinePath(trendYears, trendApplicationTotals, trendScale)} className="trend-line trend-line-application" />
            {trendYears.map((year) => <circle key={`app-${year}`} cx={trendScale.x(year)} cy={trendScale.y(trendApplicationTotals[year] || 0)} r={2.6} className="trend-point trend-point-application"><title>{year}년 출원 {number(trendApplicationTotals[year] || 0)}건</title></circle>)}
            {trendYears.map((year) => <circle key={`reg-${year}`} cx={trendScale.x(year)} cy={trendScale.y(trendRegisteredTotals[year] || 0)} r={2.6} className="trend-point trend-point-registered"><title>{year}년 등록 {number(trendRegisteredTotals[year] || 0)}건</title></circle>)}
            {trendYearLabels(trendYears).map((year) => <text key={`label-${year}`} x={trendScale.x(year)} y={TREND_CHART.height - 6} className="trend-axis-label trend-axis-x">{year}</text>)}
          </svg>
          <p className="trend-legend"><span className="trend-legend-swatch trend-legend-application" />출원<span className="trend-legend-swatch trend-legend-registered" />등록(등록원부 보강 완료 건)</p>
        </> : <p className="empty">이 범위는 아직 연도별 출원 데이터가 수집되지 않았습니다.</p>}
      </section>
      <section className="coverage-map-card">
        <div className="map-heading"><div><h2>{selectedProvince ? `${displayRegionName(selectedProvince)} 시군구 출원율` : "전국 시도별 출원율"}</h2></div><div className="coverage-map-actions">{selectedProvince && <button className="map-back" type="button" onClick={() => { setSelectedProvince(null); setSelectedMunicipality(null); }}>← 전국</button>}</div></div>
        <p className="map-metric-description"><strong>특산품 출원율</strong><span>지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수 · 명칭 확인·집계 대기도 분모에 포함합니다.</span></p>
        <div className="map-stage coverage-map-stage"><svg className="korea-map coverage-map" viewBox={activeMapViewBox} role="img" aria-label={selectedProvince ? `${selectedProvince} 시군구별 특산품 출원율 지도` : "대한민국 시도별 특산품 출원율 지도"}>{municipalityGeometry ? <>
          {municipalityGeometry.items.map((shape) => { const match = findMunicipalityRegion(selectedProvince, shape.name); const value = regionMapValue(match, "applicationCoverage"); const active = selectedMunicipality === shape.name; return <path key={`${shape.name}-coverage-shape`} d={shape.d} className={active ? "map-shape selected" : "map-shape"} style={{ fill: fill(value, 1) }} tabIndex={0} role="button" aria-label={`${shape.name} 특산품 출원율 ${mapMetricValueLabel(value, "applicationCoverage")}`} onClick={() => openMunicipality(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openMunicipality(shape.name); }}><title>{shape.name} · 특산품 출원율 {mapMetricValueLabel(value, "applicationCoverage")}</title></path>; })}
        </> : <>
          {geometry.provinces.map((shape) => { const value = mapValue(shape.name, "applicationCoverage"); return <path key={`${shape.name}-coverage-shape`} d={shape.d} className="map-shape" style={{ fill: fill(value, 1) }} tabIndex={0} role="button" aria-label={`${shape.name} 특산품 출원율 ${mapMetricValueLabel(value, "applicationCoverage")}`} onClick={() => openProvince(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProvince(shape.name); }}><title>{shape.name} · 특산품 출원율 {mapMetricValueLabel(value, "applicationCoverage")}</title></path>; })}
        </>}{activeMapLabels.map((label) => label.leader ? <g className="map-region-label map-region-label-callout" key={`${label.name}-coverage-label`}><polyline points={`${label.targetX},${label.targetY} ${(label.targetX + label.x) / 2},${(label.targetY + label.y) / 2} ${label.x + 22},${label.y + 4}`} /><text x={label.x} y={label.y} className="map-label map-label-province">{label.displayName}</text></g> : <text key={`${label.name}-coverage-label`} x={label.x} y={label.y} className={municipalityGeometry ? "map-label map-label-municipality" : "map-label map-label-province"}>{label.displayName}</text>)}</svg></div>
        <div className="coverage-legend" aria-label="출원율 색상 범례"><span>0%</span><i /><span>25%</span><span>50%</span><span>75%</span><span>100%</span><b>회색은 데이터 없음</b></div>
        <p className="map-warning">{selectedProvince ? "특산품·상표 데이터 유무와 관계없이 모든 시군구 지명을 표시합니다. 지역을 선택하면 아래 목록도 함께 좁혀집니다." : "특산품·상표 데이터가 없는 시도도 지명은 표시하며 회색으로 구분합니다. 시도를 선택하면 시군구 지도로 전환됩니다."}</p>
      </section>
      <aside className="coverage-insight"><h2>{coverageAreaDisplayName}</h2><div className="rate-hero"><RateRing value={coverageArea.rate} /><div className="rate-hero-detail"><span>특산품 출원율</span><small>전체 수집 {number(coverageArea.total)}개 중 출원 확인 {number(coverageArea.applied)}개{coverageArea.pending ? ` · 집계 대기 ${number(coverageArea.pending)}개` : ""}</small></div></div><dl className="coverage-insight-stats"><div><dt>선택 범위</dt><dd>{selectedMunicipality ? `${displayRegionName(selectedProvince || "")} 내 시군구` : selectedProvince ? "시군구별 특산품 항목 합산" : "전국 시군구별 특산품 항목 합산"}</dd></div><div><dt>전체 수집 특산품</dt><dd>{number(coverageArea.total)}개</dd></div><div><dt>출원 확인 특산품</dt><dd>{number(coverageArea.applied)}개</dd></div></dl></aside>
      </div>
      <section className="coverage-directory"><div className="section-heading coverage-directory-heading"><div><span className="coverage-directory-region">{coverageAreaDisplayName}</span><h2>특산품별 출원 현황</h2></div><span>특산품 {number(coverageListedItemCount)}개 · 출원 확인 {number(coverageArea.applied)}개 · 출원율 {percent(coverageArea.rate)}</span></div>
        {/* 이슈 #117 코멘트(2026-09-03): 도를 클릭하면 시군구 목록이 나오기 전에 그 도 전체의
            특산품 유형별 출원·등록 비중을 원그래프로 먼저 보여준다. 시군구 상세로 이미 들어간
            뒤(municipality 선택)에는 도 전체 비중이 아니라 그 시군구 항목만 봐야 하므로 뺀다. */}
        {selectedProvince && !selectedMunicipality && <section className="province-category-shares coverage-category-shares"><div className="section-heading"><div><h2>특산품 유형별 출원·등록 비중</h2></div><span>{coverageAreaDisplayName} 전체 · 지역 주소 일치 기준</span></div><div className="province-category-share-grid"><article><h3>출원 비중</h3><CategoryShareDonut items={coverageAreaRegions.flatMap((region) => region.items)} field="uniqueTrademarkCount" label="출원" /></article><article><h3>등록 비중</h3><CategoryShareDonut items={coverageAreaRegions.flatMap((region) => region.items)} field="registeredTrademarkCount" label="등록" /></article></div></section>}
        {(() => {
          const key = regionQuery.trim().toLocaleLowerCase("ko-KR");
          const rows = key ? coverageBreakdown.filter((row) => displayRegionName(row.label).toLocaleLowerCase("ko-KR").includes(key) || row.items.some(({ label }) => label.toLocaleLowerCase("ko-KR").includes(key))) : coverageBreakdown;
          if (rows.length === 0) return <p className="empty">&ldquo;{regionQuery}&rdquo; 검색 결과가 없습니다.</p>;
          if (!selectedProvince) return <div className="coverage-region-grid">{rows.map((row) => coverageCard(row))}</div>;
          // 도 단위 시군구 미지정 행("경기도" 자체)은 실제 시군구 카드와 분리해서 보여준다.
          const unclassifiedRows = rows.filter((row) => row.region && isUnclassifiedRegion(row.region));
          const municipalityRows = rows.filter((row) => !(row.region && isUnclassifiedRegion(row.region)));
          return <>
            {!selectedMunicipality && unclassifiedRows.length > 0 && <div className="coverage-region-grid coverage-unclassified-grid">{unclassifiedRows.map((row) => <article className="coverage-region-card unclassified" key={row.key}><div className="coverage-region-head"><div><strong>{displayRegionName(row.label)} 전체(시군구 미지정)</strong><small>특산품 {number(row.coverage.total)}개</small></div><div className="coverage-region-summary"><span>출원 확인 특산품 {number(row.coverage.applied)}개</span><b>{percent(row.coverage.rate)}</b></div></div><div className="coverage-specialty-list">{row.items.map(({ region, item, label }) => { const status = specialtyFilingStatus(item); return <button type="button" key={`${regionKey(region)}-${item.specialtyId}`} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span>{label}{item.regionalSpecialtyCropBadge && <em className={`crop-badge crop-badge-${item.regionalSpecialtyCropBadge.tier}`}>{item.regionalSpecialtyCropBadge.tier}</em>}</span><small className={`specialty-status ${status.filed ? "filed" : "unfiled"}`}>{status.label}</small></button>; })}</div></article>)}</div>}
            {selectedMunicipality
              ? <div className="coverage-region-grid">{municipalityRows.map((row) => coverageCard(row))}</div>
              : municipalityRows.length > 0 && <details className="coverage-municipality-toggle"><summary><span>시군구별 보기</span><small>{municipalityRows.length}곳 · 클릭하면 펼쳐집니다</small></summary><div className="coverage-region-grid">{municipalityRows.map((row) => coverageCard(row))}</div></details>}
          </>;
        })()}
      </section>
    </section>}

    {tab === "regions" && <section className="screen-section region-detail-screen">
      {exploreSubnav("region")}
      <button type="button" className="drill-back" onClick={() => setTab("applications")}>← 전국 시도 비교로</button>
      <p className="screen-note">선택한 지역의 특산품·상표를 시도 → 시군구 → 품목 순으로 파고듭니다. 다른 시도를 눌러 바로 이동할 수도 있습니다.</p>
      <nav className="province-tabbar" aria-label="광역자치단체 바로가기">{allProvinces.map((province) => <button type="button" key={province} className={activeRegionProvince === province ? "active" : ""} onClick={() => { setSelectedRegionProvince(province); setExpandedRegionProvince(province); setSelectedRegionCode(""); setSelectedItemId(""); scrollTop(); }}>{displayRegionName(province)}</button>)}</nav>
      <section className="workspace" aria-label="지역별 상세 조회">
        <aside className="region-panel">
          <div className="panel-heading"><div><h2>지자체 목록</h2></div><span>시도 {groupedRegions.length}곳 · 시군구 {filteredRegions.length}곳</span></div>
          <label className="search-field"><span className="sr-only">지역 또는 품목 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역 또는 품목 검색" /></label>
          <div className="province-list">{groupedRegions.map(({ province, regions }) => {
            const expanded = Boolean(query.trim()) || expandedRegionProvince === province;
            const coverage = specialtyCoverage(regions);
            return <section className="province-group" key={province}>
              <button type="button" className="province-toggle" aria-expanded={expanded} onClick={() => { setSelectedRegionProvince(province); setExpandedRegionProvince((current) => current === province ? null : province); setSelectedRegionCode(""); setSelectedItemId(""); }}>
                <span><strong>{displayRegionName(province)}</strong><small>시군구 {regions.length}곳 · 특산품 {coverage.total}개</small></span><b aria-hidden="true">{expanded ? "−" : "+"}</b>
              </button>
              {expanded && <div className="region-list municipality-list">{regions.map((region) => { const count = regionTrademarkValue(region); const rowCoverage = specialtyCoverage([region]); return <button type="button" key={regionKey(region)} className={selectedRegion && regionKey(selectedRegion) === regionKey(region) ? "region-button active" : "region-button"} onClick={() => chooseRegion(region)}><span><strong>{region.sigungu && region.sigungu !== region.sido ? region.sigungu : "시도 전체"}</strong><small>특산품 {rowCoverage.total}개 · 출원 확인 {rowCoverage.applied}개 · 출원율 {percent(rowCoverage.rate)}<br />{count === null ? "지역 출원 현황 검토중" : `지역 주소 일치 출원 ${number(count)}건`}</small></span><span className={`state state-${region.dataState}`}>{STATE_LABELS[region.dataState] || region.dataState}</span></button>; })}</div>}
            </section>;
          })}{groupedRegions.length === 0 && <p className="empty">검색 결과가 없습니다.</p>}</div>
        </aside>
        {selectedRegion
          ? <RegionDetail region={selectedRegion} item={selectedItem} onItem={chooseRegionItem} verifiedExamples={registrationExamples.entries.find((entry) => entry.region === selectedRegion.region && entry.specialtyId === selectedItem?.specialtyId)?.examples || []} />
          : activeRegionProvince
            ? <ProvinceDetail province={activeRegionProvince} regions={activeProvinceRegions} onRegion={chooseRegion} />
            : <div className="detail-panel"><p className="empty">조회할 광역자치단체를 선택하세요.</p></div>}
      </section>
    </section>}

    {tab === "items" && <section className="screen-section">
      {exploreSubnav("item")}
      <div className="item-category-filter region-quick-filter" role="group" aria-label="품목 유형 필터"><button type="button" className={categoryFilter === "" ? "active" : ""} onClick={() => setCategoryFilter("")}>전체</button>{availableCategories.map((category) => <button type="button" key={category.code} className={categoryFilter === category.code ? "active" : ""} onClick={() => setCategoryFilter(category.code)}>{category.label}</button>)}</div>
      <label className="search-field explore-search"><span className="sr-only">품목 또는 지역 검색</span><input type="search" value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder="품목명 또는 지역명 검색" /></label>
      <p className="screen-note">품목별 확인 지역과 상표 출원·등록 현황을 제공합니다. {itemRows.length > ITEM_ROW_LIMIT ? `상표 출원 건수 상위 ${ITEM_ROW_LIMIT}개 표시 · 전체 ${itemRows.length}개` : `검색 결과 ${itemRows.length}개`}</p>
      <div className="item-screen">
        <div className="item-reading-guide"><strong>수치 구분</strong><span><b>지역 확인 출원</b> 출원인 주소가 해당 지역과 일치</span><span><b>전국 검색</b> 아직 지역 확인 전인 별도 모집단</span></div>
        <div className="item-explorer">
          <aside className="item-list-panel">
            <div className="item-list-head"><strong>{categoryFilter ? (availableCategories.find((category) => category.code === categoryFilter)?.label || "품목") : "전체 품목"}</strong><span>{itemRows.length}개</span></div>
            <ul className="item-list">
              {visibleItemRows.map((row) => { const decidedRegions = row.availableRegions.length; return <li key={row.name}>
                <button type="button" className={selectedItemRow?.name === row.name ? "active" : ""} onClick={() => selectItemAndScroll(row.name)}>
                  <span className="item-list-name">{row.name}</span>
                  <span className="item-list-meta">{row.category ? `${row.category.label} · ` : ""}{row.regions.length}개 지역</span>
                  <b>{decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</b>
                </button>
              </li>; })}
              {visibleItemRows.length === 0 && <li className="empty">검색 결과가 없습니다.</li>}
            </ul>
          </aside>
          <div className="item-detail-panel">{selectedItemRow ? (() => { const row = selectedItemRow; const decidedRegions = row.availableRegions.length; const pendingRegions = Math.max(0, row.regions.length - decidedRegions); const nationwideOnly = Math.max(0, row.trademarksDisplay - row.trademarks); const registrationRate = decidedRegions && row.trademarks ? row.registered / row.trademarks : null;
            // 이슈 #116(2026-09-01): 마스터-디테일 개편(29fb843) 때 빠진 비즈니스 확장 흐름·전략
            // 카드를 되살린다. 흐름은 품목 단위 전국 지표라 대표 항목 하나에서, 브리핑은 공백
            // 알림을 우선해 뽑는다.
            const flowItem = row.matchedItems.find((entry) => entry.businessFlow);
            const briefingItem = row.matchedItems.find((entry) => entry.briefing?.isGapAlert && entry.briefing.sentences.length) || row.matchedItems.find((entry) => entry.briefing?.sentences.length);
            return <>
            <div className="item-card-head"><div><h2>{row.name}</h2><small>{row.category ? `${row.category.label} · ` : ""}{row.regions.length}개 지역에서 확인</small></div><span className={pendingRegions === 0 ? "item-status complete" : decidedRegions ? "item-status partial" : "item-status pending"}>{pendingRegions === 0 ? "전체 지역 판정 완료" : decidedRegions ? "일부 지역 판정" : "지역 집계 대기"}</span></div>
            <details className="item-regions-detail"><summary>전체 {row.regions.length}개 지역 보기</summary><div className="region-chips word-cloud" aria-label="지역 · 출원건수 기준 글자 크기">{[...row.regions].sort((a, b) => (row.regionCounts[b] || 0) - (row.regionCounts[a] || 0)).map((region) => { const value = row.regionCounts[region] || 0; const max = Math.max(1, ...Object.values(row.regionCounts)); return <span key={region} style={{ fontSize: `${wordCloudFontSize(value, max)}px`, color: wordCloudColor(region) }} title={`${region} · 출원 ${number(value)}건`}>{region}</span>; })}</div></details>
            <div className="item-card-metrics"><div><span>지역 확인 출원</span><strong>{decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>판정 완료 {decidedRegions}/{row.regions.length}개 지역</small></div><div><span>등록 완료</span><strong>{decidedRegions ? `${number(row.registered)}건` : "—"}</strong><small>확인 출원 중 등록 완료</small></div><div><span>등록률</span><strong className={registrationRate !== null && registrationRate >= 0.5 ? "rate-high" : undefined}>{registrationRate !== null ? percent(registrationRate) : decidedRegions ? "계산 불가" : "—"}</strong><small>{registrationRate !== null ? `${number(row.registered)}/${number(row.trademarks)}` : "지역 확인 후 계산"}</small></div></div>
            {decidedRegions > 0 && <>
              <RegionTrend region={{ region: row.name, items: row.matchedItems }} heading="연도별 출원·등록 추이" subtitle={`${row.name} · 전체 지역 합계`} prominent emptyLabel="이 품목은 아직 연도별 데이터가 없습니다." />
              <div className="item-share-block"><div className="section-heading"><div><h2>광역 단위 출원 비중</h2></div></div><ProvinceShareDonut counts={row.provinceCounts} label={row.name} /></div>
            </>}
            {nationwideOnly > 0 && <p className="provisional-note">지역 확인 전 전국 검색 후보 {number(nationwideOnly)}건은 위 확정 수치에 포함하지 않았습니다.</p>}
            {flowItem?.businessFlow && <NationwideFlowCard flow={flowItem.businessFlow} itemLabel={row.name} origins={[...row.regions].sort((a, b) => (row.regionCounts[b] || 0) - (row.regionCounts[a] || 0)).slice(0, 3)} />}
            {briefingItem?.briefing && <BusinessStrategyCard briefing={briefingItem.briefing} title={`${row.name} 비즈니스 확장 전략`} />}
          </>; })() : <p className="empty">왼쪽 목록에서 품목을 선택하세요.</p>}</div>
        </div>
        <details className="method-note"><summary>품목명 집계 기준 보기</summary><p>고시명칭·NICE류가 확정된 품목만 공식 명칭으로 묶습니다. 아직 고시명칭이 확정되지 않은 원물명은 지역별 상세 화면에 원문 그대로 보존합니다.</p></details>
      </div>
    </section>}

    {tab === "strategy" && <section className="screen-section strategy-screen">
      <p className="screen-note">⑤·⑥단계 분석에서 생성되는 품목별 비즈니스 확장 전략 브리핑입니다. 주요 샘플은 아래에서 고르고, 나머지 품목은 이름을 직접 입력해 찾을 수 있습니다.</p>
      <div className="strategy-item-selector">
        <div className="strategy-featured"><span>주요 특산품</span><div className="strategy-featured-options" role="group" aria-label="주요 특산품 바로 선택">
          <button type="button" className={!strategyItem ? "active" : ""} onClick={() => setStrategyItem("")}>대표 사례</button>
          {strategyFeaturedGroups.map((group) => <button type="button" key={group.name} className={strategyItem === group.name ? "active" : ""} onClick={() => setStrategyItem(group.name)}>{group.name}{group.briefings.length ? <small>{group.briefings.length}개 지역</small> : null}</button>)}
        </div></div>
        <label><span>품목 직접 입력</span>
          <input type="search" list="strategy-item-list" value={strategyItem} placeholder="품목명 입력" onChange={(event) => setStrategyItem(event.target.value)} />
          <datalist id="strategy-item-list">{strategyItemGroups.map((group) => <option key={group.name} value={group.name} />)}</datalist>
        </label>
      </div>
      {strategyItem && !selectedStrategyGroup && <p className="empty">&ldquo;{strategyItem}&rdquo; 품목을 찾지 못했습니다. 고시명칭이 확정된 품목명으로 입력해 주세요.</p>}
      {selectedStrategyGroup ? <>
        {!selectedStrategyGroup.flow && selectedStrategyGroup.briefings.length === 0 && <p className="empty">이 품목은 아직 비즈니스 확장 흐름·브리핑 데이터가 없습니다.</p>}
        {selectedStrategyGroup.flow && <NationwideFlowCard flow={selectedStrategyGroup.flow} itemLabel={selectedStrategyGroup.name} origins={selectedStrategyGroup.origins} />}
        <div className="strategy-sample-list">{[...selectedStrategyGroup.briefings.filter(({ item }) => item.briefing?.isGapAlert), ...selectedStrategyGroup.briefings.filter(({ item }) => !item.briefing?.isGapAlert)].slice(0, 6).map(({ region, item }) => item.briefing && <BusinessStrategyCard
          key={`${regionKey(region)}-${item.specialtyId}`}
          briefing={item.briefing}
          title={`${region.region} · ${itemName(item)}`}
          footer={<> <button type="button" className="strategy-jump-link" onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}>지자체별 조회에서 자세히 보기 →</button></>}
        />)}</div>
        {selectedStrategyGroup.briefings.length === 0 && <p className="empty">이 품목은 아직 지역별 브리핑이 없습니다.</p>}
        {selectedStrategyGroup.briefings.length > 6 && <p className="screen-note">지역별 브리핑 {selectedStrategyGroup.briefings.length}건 중 6건 표시.</p>}
      </> : <>
        {briefingSamples.length === 0 && <p className="empty">아직 표시할 샘플이 없습니다.</p>}
        <div className="strategy-sample-list">{briefingSamples.map(({ region, item }) => item.briefing && <BusinessStrategyCard
          key={`${regionKey(region)}-${item.specialtyId}`}
          briefing={item.briefing}
          title={`${region.region} · ${itemName(item)}`}
          footer={<> <button type="button" className="strategy-jump-link" onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}>지자체별 조회에서 자세히 보기 →</button></>}
        />)}</div>
      </>}
    </section>}

    {tab === "compare" && <section className="screen-section">
      <p className="screen-note">농촌진흥청이 2025년에 지정한 9개 도·69개 특화작목과 지역 주소 일치 상표 현황을 비교합니다.</p>
      <div className="compare-banner"><span>공식 원본 반영 완료</span><strong>대표작목 9 · 집중육성작목 18 · 자체육성작목 42</strong><p>모든 작목을 공식 지정 범위인 도 단위 특산품으로 수집했습니다. 시군구는 원본에 없으므로 임의로 배분하지 않습니다.</p></div>
      {/* 이슈 #117: "등급별 특화작목 출원 현황"을 먼저, 대표작목 대조를 뒤로. */}
      <section className="compare-region-section"><div className="compare-section-head"><div><span>69개 전체 상세</span><h2>등급별 특화작목 출원 현황</h2></div><p>상표 출원건수는 각 특화작목의 원물명 검색 기준 지역 주소 일치 출원 합계, 출원 비율은 출원이 1건 이상 확인된 작목 비율입니다.</p></div>
        <div className="compare-region-table"><div className="compare-region-head"><span>지역</span><span>대표작목</span><span>자체육성작목</span><span>집중육성작목</span><span>상표 출원건수<small>원물 기준</small></span><span>출원 비율</span><span title="지역 특화작목 중 지역별 상표 집계를 완료한 작목 수">수집 진행</span></div>
          {comparisonRows.map(({ province, policyCrops, policyApplicationsTotal, policyDecided, policyApplied, policyRate }) => {
            const byTier = (tier: string) => policyCrops.filter((crop) => crop.tier === tier);
            const tierCell = (tier: string) => { const crops = byTier(tier); return crops.length === 0 ? <span className="compare-tier-empty">—</span> : <span className="compare-tier-crops">{crops.map((crop) => <em key={crop.name} className={crop.applied ? "filed" : crop.decided ? "unfiled" : "pending"}>{crop.displayName}</em>)}</span>; };
            return <div className="compare-region-row" key={province}>
              <strong>{displayRegionName(province)}</strong>
              {tierCell("대표작목")}
              {tierCell("자체육성작목")}
              {tierCell("집중육성작목")}
              <b>{number(policyApplicationsTotal)}건</b>
              <div className="compare-region-rate"><b>{percent(policyRate)}</b><small>{policyApplied}/{policyCrops.length}작목</small></div>
              <span className={policyDecided === policyCrops.length ? "compare-complete" : "compare-waiting"}>{policyDecided}/{policyCrops.length}{policyDecided === policyCrops.length ? " 완료" : ""}</span>
            </div>;
          })}</div></section>
      <section className="compare-flagship-section"><div className="compare-section-head"><div><span>대표작목 우선순위 대조</span><h2>도별 대표작목 vs 실제 등록 상표 TOP5</h2></div><p>도 대표작목(농촌진흥청 지정 1개)이 그 도의 <b>등록 완료</b> 상표 상위 5개 품목 안에 실제로 있는지 대조합니다. 출원 중인 건은 포함하지 않습니다.</p></div>
        <div className="compare-flagship-table">
          <div className="compare-flagship-head"><span>도</span><span>대표작목(정책 지정)</span><span>실제 등록 상표 TOP5</span><span>일치</span></div>
          {comparisonRows.filter((row) => row.flagshipCrop).map(({ province, flagshipCrop, topRegisteredItems, flagshipMatch, flagshipRank }) => <div className="compare-flagship-row" key={province}>
            <strong>{displayRegionName(province)}</strong>
            <div className="compare-flagship-name">{stripParens(flagshipCrop!.name)}</div>
            <ol className="compare-top5-list">
              {topRegisteredItems.length === 0 && <li className="empty">등록 상표 없음</li>}
              {topRegisteredItems.map((row, index) => <li key={row.name} className={row.name === flagshipCrop!.name ? "match" : undefined}>{index + 1}. {stripParens(row.name)} <b>{number(row.count)}건</b></li>)}
            </ol>
            <span className={flagshipMatch ? "compare-flagship-match" : "compare-flagship-mismatch"}>{flagshipMatch ? `일치 · ${flagshipRank + 1}위` : "불일치"}</span>
          </div>)}
        </div>
        <p className="compare-flagship-note">9개 도 중 {comparisonRows.filter((row) => row.flagshipMatch).length}개 도에서 대표작목과 실제 등록 상표를 주도하는 품목이 일치합니다. 나머지 도는 정책상 육성 중인 작목과 실제 브랜드 출원을 주도하는 품목이 다르다는 뜻입니다 — 특화작목이 아직 상표 등록으로 이어지지 않았거나, 쌀·소고기 같은 범용 품목이 여전히 지역 브랜드 활동을 주도하고 있을 수 있습니다.</p>
      </section>
      <div className="compare-sources"><article><span>공식 근거</span><strong>농촌진흥청 2025년도 지역특화작목 현황</strong><p>제1차 종합계획(2021~2025) 종료 시점의 69개 배정을 사용합니다.</p></article><article><span>지역 판정</span><strong>출원인 주소를 도 단위로 대조</strong><p>검색 상한에 도달한 품목은 0건으로 확정하지 않고 집계 대기로 표시합니다.</p></article></div>
    </section>}

    {tab === "data" && pipeline && <section className="screen-section data-overview">
      <section className="criteria" aria-label="판정 기준과 매칭 방법">
        <strong className="criteria-title">판정 기준과 매칭 방법</strong>
        <div className="criteria-line">
          <span title="등록원부 지정상품명이 고시상품명칭과 일치하거나 품목명을 포함한 사례만 상세 화면에 표시합니다."><b>품목</b> 지정상품명 확인</span>
          <span title="국토교통부 전국 법정동 코드를 기준으로 시·군·구를 완전 일치시킵니다."><b>지역</b> 법정동코드 완전일치</span>
          <span title="검색·집계 키는 고시명칭과 NICE류이며 서비스류는 포함하지 않습니다."><b>검색</b> KIPRIS 고시명칭·NICE류</span>
          <span title="등록은 권리자 주소, 출원은 출원인정보 API 주소가 해당 지역으로 확인된 건만 집계합니다."><b>지역 출원</b> 출원인·권리자 주소 일치</span>
          <span title="주소 미확보 건은 지역 귀속에서 제외하며 확보율을 참고 지표로 함께 제공합니다."><b>주소</b> 확보율은 참고 지표</span>
        </div>
        <span className="criteria-source" title={sourceLine}>출처 {snapshot.sources.length}개</span>
      </section>
      <p className="screen-note">수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다.</p>
      <div className="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>{number(pipeline.rowCounts.total)}</strong><small>지역-특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>{number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역-품목 조합{snapshot.coverage.regionItemCount > pipeline.rowCounts.total ? ` · 복수 품목 행 분리 +${number(snapshot.coverage.regionItemCount - pipeline.rowCounts.total)}` : ""}</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>{number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>{number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 전국 고유 후보</small></article><i>→</i><article className="flow-highlight"><span>05 · 지역별 집계</span><strong>{number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>지역 출원 수 표시 가능 항목</small></article></div>
      <div className="data-summary-grid"><article className="data-summary-card"><h2>특산물 데이터</h2><div className="data-stat"><strong>{number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div className="data-stat"><strong>{number(snapshot.coverage.regionItemCount)}개</strong><span>지역-품목 조합</span></div><div className="data-stat"><strong>{number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p className="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article className="data-summary-card"><h2>상표 매칭 결과</h2><div className="match-bars"><div><span>특산품 출원율 <b>{percent(nationalSpecialtyCoverage.rate)}</b></span><em><i style={{ width: `${Math.round((nationalSpecialtyCoverage.rate || 0) * 100)}%` }} /></em><small>출원 확인 {number(nationalSpecialtyCoverage.applied)} / 전체 수집 특산품 {number(nationalSpecialtyCoverage.total)}(지역별 집계 완료 {number(nationalSpecialtyCoverage.decided)})</small></div><div><span>고유 상표 주소 확보 <b>{number(pipeline.applicantRegionVerification.verifiedCount)}건</b></span><em><i style={{ width: `${Math.round((pipeline.applicantRegionVerification.rate || 0) * 100)}%` }} /></em><small>전국 고유 후보 중 {percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>지역별 출원 수 표시 가능 <b>{number(pipeline.regionalMetricGate.availableRegionItemCount)}개</b></span><em><i style={{ width: `${Math.round(pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal) * 100)}%` }} /></em><small>전체 {number(gateTotal)}개 지역-품목 중 {percent(pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal))}</small></div></div><p className="match-explanation">특산품 출원율은 현재 수집된 지역×특산품 전체 중 지역 주소 일치 출원이 1건 이상 확인된 항목의 비율입니다. 전체 {number(nationalSpecialtyCoverage.total)}개 중 명칭 확인이나 지역별 집계가 덜 끝난 항목도 분모에 포함하며, 출원이 확인될 때만 분자에 더합니다 — 후속 확인이 진행되면 값이 올라갈 수 있습니다.</p></article></div>
      <div className="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>특산품 출원율 = 지역 주소 일치 출원이 확인된 특산품 수 ÷ 수집된 전체 특산품 수</b>입니다. 명칭 확인이나 지역별 집계가 아직 끝나지 않은 항목도 분모에 포함하고 분자에는 넣지 않습니다. <b>{number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 출원번호 중복을 제거한 전국 검색 후보이며, 등록 비율은 지역 주소 일치 출원 중 등록 상태인 건의 비율로 별도 계산합니다. 검색이 부분 수집 상태인 품목은 0건으로 확정하지 않고 <b>지역별 집계 대기</b>로 표시합니다.</p></div>
      <section className="provenance"><div className="section-heading"><div><h2>출처와 데이터 상태</h2></div><span>{snapshot.schemaVersion}</span></div><div className="source-table-wrap"><table className="source-table"><caption className="sr-only">데이터별 출처와 수집 상태</caption><thead><tr><th>그룹</th><th>데이터명</th><th>수집 항목</th><th>출처</th><th>수집 소스</th><th>수집 방법</th><th>최근 수집 일자</th></tr></thead><tbody>{snapshot.sources.filter((source) => source.sourceUrl).sort((a, b) => sourceGroupRank(a.sourceId) - sourceGroupRank(b.sourceId)).map((source) => <tr key={source.sourceId}><td><span className="source-group">{sourceGroup(source.sourceId)}</span></td><th scope="row">{source.sourceLabel || source.sourceId}</th><td>{sourceItems(source.sourceId)}</td><td><a href={source.sourceUrl || "#"} target="_blank" rel="noreferrer">공식 페이지 ↗</a></td><td>{source.sourceContractVersion || "버전 미기록"}</td><td>{sourceMethod(source.sourceId)}</td><td>{dateOnly(latestDate(source.sourceFetchedAt, source.sourceLastVerifiedAt))}</td></tr>)}<tr><td><span className="source-group">지역 정보</span></td><th scope="row">지도 경계</th><td>시도·시군구 경계 도형</td><td><a href={geometry.boundaryReference.sourceUrl} target="_blank" rel="noreferrer">공식 원본 ↗</a></td><td>{geometry.boundaryReference.sourceName}</td><td>경계 파일 생성·코드 조인</td><td>{geometry.boundaryReference.sourceBasis.match(/\d{4}/)?.[0] || "미기록"}</td></tr></tbody></table></div></section>
    </section>}

    <footer><div className="footer-brand"><img className="footer-logo" src="/images/kiip-logo-lockup.png" alt="한국지식재산연구원 Korea Institute of Intellectual Property" height={26} /><span>지역 특산품-상표 분석·정책지원 플랫폼</span></div><span>Snapshot {snapshot.snapshotId} · 업데이트 {date(dashboardUpdatedAt)}</span></footer>
  </main>;
}

function ProvinceDetail({ province, regions, onRegion }: { province: string; regions: Region[]; onRegion: (region: Region) => void }) {
  const coverage = specialtyCoverage(regions);
  const items = regions.flatMap((region) => region.items);
  const municipalityRegions = regions.filter((region) => region.sigungu && region.sigungu !== region.sido);
  const availableItems = items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available");
  const applications = availableItems.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0);
  const registrations = availableItems.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0);
  return <div className="detail-panel province-detail">
    <div className="detail-heading"><div><p className="eyebrow">광역 기본 보기</p><h2>{displayRegionName(province)}</h2><p>광역 전체와 시군구 {municipalityRegions.length}곳의 특산품·상표 현황 합계</p></div><span className="state">광역 집계</span></div>
    <TrendSizeControl />
    <div className="province-detail-cols">
      <RegionTrend region={{ region: province, items }} />
      <div className="detail-grid province-summary-grid">
        <article><span>전체 수집 특산품</span><strong>{number(coverage.total)}개</strong><small>시군구별 지역×품목 합계</small></article>
        <article><span>출원 확인 특산품</span><strong>{number(coverage.applied)}개</strong><small>전체 특산품 출원율 {percent(coverage.rate)}</small></article>
        <article><span>지역 주소 일치 출원</span><strong>{number(applications)}건</strong><small>등록 완료 {number(registrations)}건</small></article>
      </div>
    </div>
    <section className="province-category-shares"><div className="section-heading"><div><h2>특산품 유형별 출원·등록 비중</h2></div><span>광역 전체 · 지역 주소 일치 기준</span></div><div className="province-category-share-grid"><article><h3>출원 비중</h3><CategoryShareDonut items={items} field="uniqueTrademarkCount" label="출원" /></article><article><h3>등록 비중</h3><CategoryShareDonut items={items} field="registeredTrademarkCount" label="등록" /></article></div></section>
    <details className="province-municipalities"><summary><span>세부 시군구 보기</span><small>{municipalityRegions.length}곳 · 클릭하면 품목별 상세로 전환</small></summary><div>{municipalityRegions.length ? municipalityRegions.map((region) => { const rowCoverage = specialtyCoverage([region]); return <button type="button" key={regionKey(region)} onClick={() => onRegion(region)}><strong>{region.sigungu}</strong><small>특산품 {rowCoverage.total}개 · 출원 확인 {rowCoverage.applied}개</small></button>; }) : <p className="empty">시군구 단위로 구분된 원본 자료가 없습니다.</p>}</div></details>
  </div>;
}

function RegionDetail({ region, item, onItem, verifiedExamples }: { region: Region; item: Item | undefined; onItem: (id: string) => void; verifiedExamples: TrademarkExample[] }) {
  const heading = <div className="detail-heading"><div><h2>{region.region}</h2><p>법정동코드 {region.regionCode || "미확정"}</p></div><span className={`state state-${region.dataState}`}>{STATE_LABELS[region.dataState] || region.dataState}</span></div>;
  if (!item) {
    return <div className="detail-panel">
      {heading}
      <div className="item-tabs" role="tablist" aria-label={`${region.region} 특산품`} />
      <p className="empty">이 지역에는 등록된 특산품 데이터가 없습니다.</p>
    </div>;
  }
  const regionGoodsConfirmed = item.matchingBasis === "raw_item_goods_matched";
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
  const itemTabsMaxTrademarks = Math.max(1, ...region.items.map((row) => row.metrics.uniqueTrademarkCount.value || 0));
  return <div className="detail-panel">
    {heading}
    <RegionTrend region={region} heading="지역 연도별 출원·등록 추이" subtitle={`${region.region} 전체 특산품 · 연도별`} prominent />
    <div className="item-tabs word-cloud" role="tablist" aria-label={`${region.region} 특산품 · 출원건수 기준 글자 크기`}>{region.items.map((row) => { const value = row.metrics.uniqueTrademarkCount.value || 0; return <button type="button" role="tab" aria-selected={item.specialtyId === row.specialtyId} key={row.specialtyId || row.itemName} onClick={() => onItem(row.specialtyId || "")} style={{ fontSize: `${wordCloudFontSize(value, itemTabsMaxTrademarks)}px`, color: item.specialtyId === row.specialtyId ? undefined : wordCloudColor(row.specialtyId || itemName(row)) }} title={`${itemName(row)} · 출원 ${number(value)}건`}>{itemName(row)}</button>; })}</div>
    <div className="item-title"><div><span>이 지역의 대표 특산품</span><h3>{itemName(item)}{item.regionalSpecialtyCropBadge && <em className={`crop-badge crop-badge-${item.regionalSpecialtyCropBadge.tier}`}>{item.regionalSpecialtyCropBadge.tier} · {item.regionalSpecialtyCropBadge.referenceYear}</em>}</h3><small>{noticeBasis(item)}</small></div><span className="class-chip">{item.niceClass ? `NICE ${item.niceClass}` : "NICE 분류 미확정"}</span></div>
    <div className="metric-reading-note"><strong>출원 건수 기준</strong><p><b>{region.sigungu || region.region} {itemName(item)} 출원</b>은 출원인 주소가 {region.region}으로 확인된 고유 출원 수입니다. 전국 검색 후보나 주소가 확인되지 않은 출원은 포함하지 않습니다.</p></div>
    {item.regionalEvidence?.length ? <div className="metric-reading-note"><strong>공식 생산 주산지 근거</strong><p>{item.regionalEvidence.map((evidence) => `${evidence.region} (${evidence.referenceYear})`).join(", ")} · 임산물생산조사 기준입니다. {item.regionalEvidence.some((evidence) => evidence.regionalMetricEligible) ? "출원인 주소를 주산지와 대조해 지역 상표 통계에 반영했습니다." : "검색 범위가 완료된 뒤 지역 상표 통계에 반영합니다."}</p></div> : null}
    <div className="detail-grid">
      <article><span>{region.sigungu || region.region} {itemName(item)} 출원</span><strong>{regionalAvailable ? `${number(localCount)}건${regionalPartial ? "+" : ""}` : "지역별 집계 대기"}</strong><small>{regionalAvailable ? (regionalPartial ? `출원인 주소가 ${region.region}으로 확인된 최소값 — 전국 검색이 상한에 도달해 더 있을 수 있습니다` : `출원인 주소가 ${region.region}으로 확인된 고유 출원`) : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${pendingReason}`}</small></article>
      <article><span>등록 건수</span><strong>{regionalAvailable ? `${number(registeredCount)}건` : "지역별 집계 대기"}</strong><small>{regionalAvailable ? localCount ? `출원 ${number(localCount)}건 중 등록 ${number(registeredCount)}건 · 등록률 ${percent(item.metrics.registrationRate.value)}` : "출원 0건 · 등록률 계산 불가" : "지역 출원 건수가 확인된 뒤 계산합니다."}</small></article>
      <article><span>출원 여부</span><strong>{regionalAvailable ? localCount > 0 ? "출원 확인" : "출원 없음" : "집계 대기"}</strong><small>{regionalAvailable ? localCount > 0 ? `특산품 출원율 계산에서 출원 확인 1개로 집계` : "전체 특산품 수에는 포함되며 출원 확인 수에는 포함되지 않음" : "전체 특산품 수에는 포함되며 출원 확인 전까지 분자에는 넣지 않습니다"}</small></article>
    </div>
    {item.businessFlow && <NationwideFlowCard flow={item.businessFlow} itemLabel={itemName(item) || "이 품목"} />}
    {item.briefing && item.briefing.sentences.length > 0 && <BusinessStrategyCard briefing={item.briefing} title="비즈니스 확장 전략" />}
    <section className="trademark-examples"><div className="example-heading"><strong>{itemName(item)} 등록 사례</strong><span>등록 {number(registeredCount)}건 중 사례 {number(registeredExamples.length)}건</span></div>{registeredExamples.length ? <div className="example-list">{registeredExamples.map((example, index) => <article key={example.applicationNumber || `${example.title}-${index}`}><div><strong>{example.title || "상표명 미기록"}</strong><small>{[example.applicationNumber, example.applicant, example.niceClass ? `${example.niceClass}류` : null].filter(Boolean).join(" · ")}</small></div><span className="goods-chip">등록</span>{giMarkLabel(example.applicationNumber) && <span className="gi-mark-chip">{giMarkLabel(example.applicationNumber)}</span>}{example.goodsEvidence.length > 0 && <p>지정상품: {example.goodsEvidence.map((row) => `${row.designatedProductName || "명칭 미기록"}${row.classCode ? ` (${row.classCode}류)` : ""}`).join(", ")}</p>}<small className="example-region-note">지역 주소 일치</small>{example.applicationNumber && <button type="button" className="kipris-link" title={`KIPRIS에서 이 상표(출원번호 ${example.applicationNumber})의 검색 결과를 새 창으로 엽니다`} onClick={() => openKiprisPopup(example.applicationNumber as string)}>KIPRIS에서 결과 보기 ↗</button>}</article>)}</div> : <p className="empty">등록 항목이 확인되지 않았습니다.</p>}</section>
  </div>;
}
