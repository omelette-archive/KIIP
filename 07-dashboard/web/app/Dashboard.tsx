"use client";

import { useMemo, useState } from "react";

type Metric = { value: number | null; availability: "available" | "preview" | "blocked"; status: string; rationale?: string | null; blockingIssue?: string | null };
type TrademarkExample = { title: string | null; applicationNumber: string | null; applicationDate: string | null; applicationStatus: string | null; goodsMatchMethod: string; goodsReviewRequired: boolean; goodsEvidence: { classCode?: string | null; designatedProductName?: string | null }[] };
type ItemVerdict = { source: string; method: string | null; confidence: number | null };
type Item = { specialtyId: string | null; itemName: string | null; noticeName: string | null; niceClass: string | null; matchingBasis?: string | null; dataState: string; itemVerdict?: ItemVerdict; trademarkExamples?: TrademarkExample[]; metrics: { uniqueTrademarkCount: Metric; nationwideSearchTrademarkCount?: Metric; registeredTrademarkCount: Metric; registrationRate: Metric; localApplicantShare: Metric; confirmedGoodsMatchCount: Metric; goodsReviewCandidateCount: Metric; gapScore: Metric } };
type Region = { regionCode: string | null; regionCodeStatus: string; region: string; sido: string | null; sigungu: string | null; dataState: string; items: Item[] };
type Source = { sourceId: string; sourceLabel: string | null; sourceContractVersion: string | null; sourceFetchedAt: string | null; sourceUrl: string | null; sourceLastVerifiedAt: string | null };
type PipelineStatus = { stage: string; inputScope: string; rowCounts: { total: number; searchable: number; complete: number; partial: number; error: number; skipped: number }; uniqueQueryCounts: { total: number | null; complete: number | null; partial: number | null }; nationwideCandidates: { uniqueTrademarkCount: number; returnedHitCount: number; duplicateHitCount: number }; applicantRegionVerification: { inside: number; outside: number; unverified: number; verifiedCount: number; rate: number | null; regionalAttributionCounts?: { inside: number; outside: number; unverified: number }; unit?: string }; regionalMetricGate: { availableRegionItemCount: number; blockedRegionItemCount: number; coverageThreshold?: number; policy: string }; collectionExperiment: { queryHitCap: number | null; serializationFailureObservedAtOrAbove: number | null; outputShape: string } };
type Snapshot = { schemaVersion: string; snapshotId: string; mode: "sample" | "full"; generatedAt: string; versions?: Record<string, string | null>; map?: { availability: string; blockingReason?: string | null }; coverage: { targetRegionCount: number | null; observedRegionCount: number; regionItemCount: number; completeQueryCount: number; partialQueryCount: number; errorQueryCount: number; skippedQueryCount?: number; unit?: string }; pipelineStatus?: PipelineStatus; regions: Region[]; sources: Source[]; warnings: string[] };
type ProvinceShape = { name: string; d: string; labelX: number; labelY: number };
type MunicipalityShape = { name: string; d: string; labelX: number; labelY: number };
type MapGeometry = { schemaVersion: string; viewBox: string; boundaryReference: { sourceName: string; sourceUrl: string; sourceBasis: string; status: string; warning: string }; provinces: ProvinceShape[]; municipalities: Record<string, { viewBox: string; items: MunicipalityShape[] }> };
type Tab = "summary" | "regions" | "items" | "compare" | "data";
type MapMetric = "trademarks" | "registration" | "coverage" | "gap";

const STATE_LABELS: Record<string, string> = { complete_nonzero: "수집 완료", complete_zero: "결과 0건", partial: "부분 수집", error: "오류", skipped: "건너뜀", not_collected: "미수집", complete: "완료" };
const TAB_LABELS: Record<Tab, string> = { summary: "요약", regions: "지자체별 조회", items: "품목별 조회", compare: "특화작목 비교", data: "데이터 개요" };
const MAP_LABELS: Record<MapMetric, string> = { trademarks: "상표 건수", registration: "상표 등록률", coverage: "확인 특산품 수", gap: "상표 활용 여지" };
const MAP_DESCRIPTIONS: Record<MapMetric, string> = {
  trademarks: "검색 수집이 완료된 항목에서, 출원인 주소가 해당 지역으로 확인된 고유 상표 출원 건수입니다.",
  registration: "지도에 포함된 지역 주소 일치 출원 중 등록 상태인 건의 비율입니다(등록 ÷ 출원).",
  coverage: "현재 데이터에서 확인된 지역×특산품 항목 수입니다.",
  gap: "대표 특산품에 비해 지역 상표 활동이 적을수록 높게 표시됩니다.",
};

function number(value: number | null | undefined) { return typeof value === "number" ? value.toLocaleString("ko-KR") : "—"; }
function percent(value: number | null | undefined) { return typeof value === "number" ? `${Math.round(value * 100)}%` : "—"; }
function date(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미기록"; }
function compactDate(value: string | null | undefined) { return value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}` : value || "출원일 미기록"; }
function itemName(item: Item) { return item.itemName || item.noticeName || "미지정 품목"; }
// item.noticeName은 고시명칭이 확정 안 된 행에도 채워져 있다(③ 검색에 쓴 원물명 검색어를
// 그대로 담음 — 04-analyze-brand/lib/analyzer.js entryDimensions 참고). matchingBasis가
// notice_name_and_nice_class일 때만 실제로 지식재산처 고시상품명칭 사전과 대조해 확정된
// 값이므로, "고시명칭"이라는 라벨은 이 조건을 거친 값에만 붙여야 한다 — 아니면 원물명이나
// (검토대기 상태에서 상표 검색에 쓰인) 임의 검색어를 마치 공식 분류인 것처럼 보여주게 된다.
function officialNoticeName(item: Item): string | null {
  return item.matchingBasis === "notice_name_and_nice_class" ? item.noticeName : null;
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
  return prefix ? name.slice(prefix.length) : name;
}
function goodsMethod(method: string) { return ({ normalized_exact: "특산품 활용 확정", normalized_contains: "고시명칭 포함·인정", class_only: "NICE류 검토", mismatch: "지정상품 불일치", unverified: "미검증" } as Record<string, string>)[method] || method; }
function verdictTitle(verdict: ItemVerdict) { return `사람이 개별 승인하지 않고 규칙 기반 알고리즘이 자동 확정(${verdict.method || "algorithm"}, 신뢰도 ${verdict.confidence ?? "미기록"})`; }
function regionKey(region: Region) { return region.regionCode || region.region; }
function issueUrl(issue: string | null | undefined) { const match = issue?.match(/^#(\d+)$/); return match ? `https://github.com/omelette-archive/KIIP/issues/${match[1]}` : null; }
function fill(value: number | null, max: number) { if (value === null) return "#e5e1d7"; const ratio = Math.max(0.12, Math.min(1, max ? value / max : 0)); return `color-mix(in srgb, #1f6d56 ${Math.round(24 + ratio * 68)}%, #e7eee9)`; }
function regionalMetricPendingReason(item: Item) {
  if (item.dataState === "partial") return "상표 검색이 일부만 수집되어 지역별 집계를 아직 확정하지 않았습니다.";
  if (item.dataState === "error") return "상표 검색 오류로 지역별 집계를 아직 확정하지 않았습니다.";
  if (item.dataState === "skipped") return "검색 조건이 확정되지 않아 지역별 집계를 시작하지 않았습니다.";
  if (item.dataState === "not_collected") return "상표 검색 전이라 지역별 집계를 시작하지 않았습니다.";
  return "지역별 출원 집계에 필요한 데이터가 아직 준비되지 않았습니다.";
}

export default function Dashboard({ snapshot, geometry }: { snapshot: Snapshot; geometry: MapGeometry }) {
  const [tab, setTab] = useState<Tab>("summary");
  const [query, setQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [selectedRegionCode, setSelectedRegionCode] = useState(regionKey(snapshot.regions[0]));
  const [selectedItemId, setSelectedItemId] = useState("");
  const [mapMetric, setMapMetric] = useState<MapMetric>("trademarks");
  const [rankingLimit, setRankingLimit] = useState<10 | 50>(10);
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string | null>(null);

  const totals = useMemo(() => snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { acc.availableItems += 1; acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; } acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0, availableItems: 0 }), [snapshot.regions]);
  const sourceLine = snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean).join(" · ");
  const provinceStats = useMemo(() => {
    const stats = new Map<string, { trademarks: number; registered: number; verified: number; items: number; complete: number; total: number; gaps: number[] }>();
    snapshot.regions.forEach((region) => {
      const name = region.sido || region.region;
      const current = stats.get(name) || { trademarks: 0, registered: 0, verified: 0, items: 0, complete: 0, total: 0, gaps: [] };
      region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { current.verified += 1; current.trademarks += item.metrics.uniqueTrademarkCount.value || 0; current.registered += item.metrics.registeredTrademarkCount.value || 0; } current.items += 1; current.total += 1; if (item.dataState === "complete_nonzero" || item.dataState === "complete_zero") current.complete += 1; if (typeof item.metrics.gapScore.value === "number") current.gaps.push(item.metrics.gapScore.value); });
      stats.set(name, current);
    });
    return stats;
  }, [snapshot.regions]);
  const hasGap = [...provinceStats.values()].some((stat) => stat.gaps.length > 0);
  const mapMax = Math.max(1, ...[...provinceStats.values()].map((stat) => mapMetric === "trademarks" ? stat.trademarks : mapMetric === "registration" ? (stat.trademarks ? stat.registered / stat.trademarks : 0) : mapMetric === "coverage" ? stat.items : stat.gaps.length ? stat.gaps.reduce((a, b) => a + b, 0) / stat.gaps.length : 0));
  const filteredRegions = useMemo(() => { const keyword = query.trim().toLocaleLowerCase("ko-KR"); return !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => `${itemName(item)} ${item.noticeName || ""}`.toLocaleLowerCase("ko-KR").includes(keyword))); }, [query, snapshot.regions]);
  const selectedRegion = snapshot.regions.find((region) => regionKey(region) === selectedRegionCode) || filteredRegions[0] || snapshot.regions[0];
  const selectedItem = selectedRegion?.items.find((item) => item.specialtyId === selectedItemId) || selectedRegion?.items[0];
  const itemRows = useMemo(() => {
    const rows = new Map<string, { name: string; trademarks: number; registered: number; available: number; regions: string[]; states: string[] }>();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, trademarks: 0, registered: 0, available: 0, regions: [], states: [] };
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.available += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      row.states.push(item.dataState);
      rows.set(name, row);
    }));
    const keyword = itemQuery.trim().toLocaleLowerCase("ko-KR");
    return [...rows.values()].filter((row) => !keyword || row.name.toLocaleLowerCase("ko-KR").includes(keyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword))).sort((a, b) => b.trademarks - a.trademarks);
  }, [itemQuery, snapshot.regions]);

  function chooseRegion(region: Region) { setSelectedRegionCode(regionKey(region)); setSelectedItemId(region.items[0]?.specialtyId || ""); }
  function regionTrademarkValue(region: Region | undefined) { if (!region) return null; const verified = region.items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available"); return verified.length ? verified.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0) : null; }
  function regionMapValue(region: Region | undefined) { if (!region) return null; const available = region.items.filter((item) => item.metrics.uniqueTrademarkCount.availability === "available"); const trademarks = available.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0); const registered = available.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0); if ((mapMetric === "trademarks" || mapMetric === "registration") && available.length === 0) return null; if (mapMetric === "trademarks") return trademarks; if (mapMetric === "registration") return trademarks ? registered / trademarks : 0; if (mapMetric === "coverage") return region.items.length; const gaps = region.items.map((item) => item.metrics.gapScore.value).filter((value): value is number => typeof value === "number"); return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null; }
  function mapValue(name: string) { const stat = provinceStats.get(name); if (!stat) return null; if (mapMetric === "trademarks") return stat.verified ? stat.trademarks : null; if (mapMetric === "registration") return stat.verified && stat.trademarks ? stat.registered / stat.trademarks : null; if (mapMetric === "coverage") return stat.items; return stat.gaps.length ? stat.gaps.reduce((a, b) => a + b, 0) / stat.gaps.length : null; }
  function mapMetricValueLabel(value: number | null) { if (value === null) return "데이터 없음"; if (mapMetric === "registration") return percent(value); if (mapMetric === "gap") return `${Math.round(value)}점`; return `${number(value)}${mapMetric === "trademarks" ? "건" : "개 품목"}`; }
  function mapValueLabel(name: string) { return mapMetricValueLabel(mapValue(name)); }
  function openProvince(name: string) { setSelectedProvince(name); setSelectedMunicipality(null); }
  function openMunicipality(name: string) { setSelectedMunicipality(name); const match = snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === name); if (match) chooseRegion(match); }

  const visibleRegions = selectedProvince ? snapshot.regions.filter((region) => (region.sido || region.region) === selectedProvince && (!selectedMunicipality || region.sigungu === selectedMunicipality)) : snapshot.regions;
  // 지도 옆 미리보기는 상표명(예: 등록 브랜드 "임금님표쌀")이나 아직 고시명칭이 확정 안 된
  // 원문 표기가 아니라, 확정된 특산물 고시명칭만 보여준다. 원문 표기·상표 사례는 지역 상세와
  // "수집된 상표 예시"에서 별도로 확인한다.
  const visibleItems = visibleRegions.flatMap((region) => region.items.flatMap((item) => {
    const label = officialItemLabel(item);
    return label ? [{ region, item, label }] : [];
  })).sort((a, b) => (b.item.metrics.uniqueTrademarkCount.value || 0) - (a.item.metrics.uniqueTrademarkCount.value || 0));
  const rankingRows = snapshot.regions
    .flatMap((region) => region.items.flatMap((item) => {
      const label = officialItemLabel(item);
      return label ? [{ region, item, label }] : [];
    }))
    .filter(({ item }) => item.metrics.registeredTrademarkCount.availability === "available")
    .sort((a, b) => (b.item.metrics.registeredTrademarkCount.value || 0) - (a.item.metrics.registeredTrademarkCount.value || 0));
  const municipalityGeometry = selectedProvince ? geometry.municipalities[selectedProvince] : null;
  const municipalityMapMax = municipalityGeometry ? Math.max(1, ...municipalityGeometry.items.map((shape) => regionMapValue(snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === shape.name)) || 0)) : 1;
  const pipeline = snapshot.pipelineStatus;
  const isAlpha = pipeline?.stage === "alpha";
  const scopeLabel = isAlpha ? "알파 테스트 · 부분 수집" : snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터";
  const gateTotal = pipeline ? pipeline.regionalMetricGate.availableRegionItemCount + pipeline.regionalMetricGate.blockedRegionItemCount : snapshot.coverage.regionItemCount;
  const attributionCounts = pipeline?.applicantRegionVerification.regionalAttributionCounts || (pipeline ? { inside: pipeline.applicantRegionVerification.inside, outside: pipeline.applicantRegionVerification.outside, unverified: 0 } : { inside: 0, outside: 0, unverified: 0 });
  const attributionDecided = attributionCounts.inside + attributionCounts.outside;
  const attributionInsideRate = attributionCounts.inside / Math.max(1, attributionDecided);
  const uniqueSpecialtyCount = useMemo(() => new Set(snapshot.regions.flatMap((region) => region.items.map((item) => itemName(item)))).size, [snapshot.regions]);
  const trademarkShowcase = useMemo(() => {
    const rows: { region: Region; item: Item; example: TrademarkExample }[] = [];
    const applications = new Set<string>();
    const items = new Set<string>();
    const candidates = snapshot.regions.flatMap((region) => region.items.flatMap((item) => (item.trademarkExamples || []).filter((example) => example.title).map((example) => ({ region, item, example })))).sort((a, b) => (b.example.applicationDate || "").localeCompare(a.example.applicationDate || ""));
    for (const row of candidates) {
      const applicationKey = row.example.applicationNumber || row.example.title || "";
      const itemKey = itemName(row.item);
      if (!applicationKey || applications.has(applicationKey) || items.has(itemKey)) continue;
      applications.add(applicationKey);
      items.add(itemKey);
      rows.push(row);
      if (rows.length === 6) break;
    }
    return rows;
  }, [snapshot.regions]);

  return <main className="shell">
    <header className="topbar" id="top"><button className="brand brand-button" type="button" onClick={() => setTab("summary")} aria-label="지역 브랜드 인사이트 홈"><span className="brand-mark">K</span><span><strong>지역 브랜드 인사이트</strong><small>특산품 × 상표 근거 대시보드</small></span></button><div className="snapshot-meta"><span className="sample-badge">{scopeLabel}</span><span>마지막 생성 {date(snapshot.generatedAt)}</span></div></header>
    <nav className="primary-tabs" aria-label="대시보드 화면">{(Object.keys(TAB_LABELS) as Tab[]).map((key) => <button type="button" key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{TAB_LABELS[key]}</button>)}</nav>

    {tab === "summary" && <>
      <section className="criteria" aria-label="판정 기준과 매칭 방법">
        <div className="section-heading">
          <div><p className="eyebrow">HOW THIS IS BUILT</p><h2>판정 기준과 매칭 방법</h2></div>
          <span>현재 출처 {sourceLine}</span>
        </div>
        <div className="criteria-grid">
          <article><span>대표 특산품 판정</span><strong>GI 출처 또는 상표 출원 3건 이상</strong><small>#29 확정(2026-08-11) — GI 미등록이어도 출원 활동이 활발하면 대표로 인정(OR 조건)</small></article>
          <article><span>품목 매칭</span><strong>고시명칭 일치·포함</strong><small>지정상품명이 고시상품명칭과 일치하거나 포함되면 특산품 활용 출원으로 인정하고, NICE류만 일치하면 사람 검토로 분리합니다.</small></article>
          <article><span>지역 매칭</span><strong>법정동코드 완전일치</strong><small>국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만</small></article>
          <article><span>상표 검색</span><strong>KIPRIS 단어검색(고시명칭 기준)</strong><small>검색·집계 키는 고시명칭 + NICE류이며, 상표명은 개별 사례로만 보존하고 집계 키로 쓰지 않음</small></article>
          <article><span>지역 주소 일치 출원 / 그중 등록</span><strong>출원인 주소가 해당 지역으로 확인된 출원만</strong><small>등록 비율은 그중 등록 상태 건수 ÷ 지역 주소 일치 출원 건수입니다. 전국 검색 후보와 주소 미확보 건은 제외합니다.</small></article>
          <article><span>출원인 지역 매칭</span><strong>주소 확보율은 참고 지표</strong><small>주소가 확인된 건은 지역 귀속에 반영하고, 미확보 건도 원자료와 확보율을 함께 표시합니다. 부분 수집은 별도 상태로 구분합니다.</small></article>
        </div>
      </section>
      <section className="hero"><div><p className="eyebrow">LOCAL BRAND OBSERVATORY</p><h1>지역 특산품 상표 분석</h1><p className="hero-copy">지역별 특산품과 관련 상표 현황을 한눈에 확인합니다.</p></div><div className="hero-note"><span>DATA COVERAGE</span><strong>{snapshot.coverage.observedRegionCount}개 지역 · {snapshot.coverage.regionItemCount}개 지역×품목</strong><p>{isAlpha && pipeline ? `주소 확보율 ${percent(pipeline.applicantRegionVerification.rate)} · 확보된 값 기준으로 표시합니다.` : "현재 확인 가능한 데이터 범위입니다."}</p></div></section>
      <section className="metrics" aria-label="핵심 지표"><article><span>전국 검색 고유 상표 후보</span><strong>{pipeline ? number(pipeline.nationwideCandidates.uniqueTrademarkCount) : totals.availableItems ? number(totals.trademarks) : "집계 전"}</strong><small>출원번호 중복 제거 · 지역별 출원 수와는 다른 전국 검색 결과</small></article><article><span>출원인 주소 확보율</span><strong>{pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>{pipeline ? `고유 후보 중 확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역별 출원 수 표시 가능</span><strong>{pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>검색 수집이 완료된 지역×특산품 항목 수</small></article><article><span>고유 검색 조합</span><strong>{pipeline ? number(pipeline.uniqueQueryCounts.total) : snapshot.coverage.partialQueryCount > 0 ? "부분" : "완료"}</strong><small>{pipeline ? `완료 ${number(pipeline.uniqueQueryCounts.complete)} · 부분 ${number(pipeline.uniqueQueryCounts.partial)}` : `입력행 완료 ${snapshot.coverage.completeQueryCount} · 부분 ${snapshot.coverage.partialQueryCount}`}</small></article></section>
      <section className="map-workspace">
        <div className="map-card"><div className="map-heading"><div><p className="eyebrow">REGIONAL TRADEMARK MAP</p><h2>{selectedProvince ? `${selectedProvince} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span className="reference-chip">참고 경계 · 2013 KOSTAT</span></div>
          <div className="map-toolbar"><div className="map-metrics">{(Object.keys(MAP_LABELS) as MapMetric[]).map((key) => <button type="button" key={key} disabled={key === "gap" && !hasGap} className={mapMetric === key ? "active" : ""} onClick={() => setMapMetric(key)} title={key === "gap" && !hasGap ? `${MAP_DESCRIPTIONS[key]} 현재 산출 기준과 값이 준비되지 않아 표시할 수 없습니다.` : MAP_DESCRIPTIONS[key]} aria-label={`${MAP_LABELS[key]}: ${MAP_DESCRIPTIONS[key]}`}>{MAP_LABELS[key]}</button>)}</div>{selectedProvince && <button className="map-back" type="button" onClick={() => { setSelectedProvince(null); setSelectedMunicipality(null); }}>← 전국</button>}</div>
          <p className="map-metric-description"><strong>{MAP_LABELS[mapMetric]}</strong><span>{MAP_DESCRIPTIONS[mapMetric]}</span></p>
          <div className="map-stage"><svg className="korea-map" viewBox={municipalityGeometry?.viewBox || geometry.viewBox} role="img" aria-label={selectedProvince ? `${selectedProvince} 시군구 지도` : "대한민국 시도 지도"}>{municipalityGeometry ? <>
            {municipalityGeometry.items.map((shape) => { const match = snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === shape.name); const statValue = regionMapValue(match); const active = selectedMunicipality === shape.name; return <path key={`${shape.name}-shape`} d={shape.d} className={active ? "map-shape selected" : "map-shape"} style={{ fill: fill(statValue, municipalityMapMax) }} tabIndex={0} role="button" aria-label={`${shape.name} ${mapMetricValueLabel(statValue)}`} onClick={() => openMunicipality(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openMunicipality(shape.name); }}><title>{shape.name} · {mapMetricValueLabel(statValue)}</title></path>; })}
            {municipalityGeometry.items.map((shape) => <text key={`${shape.name}-label`} x={shape.labelX} y={shape.labelY} className="map-label map-label-municipality">{shape.name}</text>)}
          </> : <>
            {geometry.provinces.map((shape) => <path key={`${shape.name}-shape`} d={shape.d} className={selectedProvince === shape.name ? "map-shape selected" : "map-shape"} style={{ fill: fill(mapValue(shape.name), mapMax) }} tabIndex={0} role="button" aria-label={`${shape.name} ${mapValueLabel(shape.name)}`} onClick={() => openProvince(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProvince(shape.name); }}><title>{shape.name} · {mapValueLabel(shape.name)}</title></path>)}
            {geometry.provinces.map((shape) => <text key={`${shape.name}-label`} x={shape.labelX} y={shape.labelY} className="map-label map-label-province">{shape.name}</text>)}
          </>}</svg></div>
          <div className="map-legend"><span><i className="legend-swatch no-data" />데이터 없음</span><span><i className="legend-swatch low" />낮음</span><span><i className="legend-swatch high" />높음</span><strong>{MAP_LABELS[mapMetric]} 기준</strong></div><p className="map-warning">{geometry.boundaryReference.warning} 지도를 클릭하면 해당 지역의 특산품 목록과 상표 사례를 확인할 수 있습니다. 상표 활용 여지는 산출 기준과 값이 준비된 경우에만 활성화됩니다.</p>
        </div>
        <aside className="map-insight"><p className="eyebrow">SELECTED AREA</p><h2>{selectedMunicipality || selectedProvince || "전국"}</h2><p className="insight-summary">{selectedProvince ? `${visibleRegions.length}개 수집 지역, ${visibleItems.length}개 고시명칭 확인 특산품` : `${snapshot.coverage.observedRegionCount}개 관측 지역 · 고시명칭 확인 품목만 표시`}</p><div className="mini-list">{visibleItems.slice(0, 5).map(({ region, item, label }) => <button type="button" key={`${regionKey(region)}-${item.specialtyId}`} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span><strong>{region.sigungu || region.region} / {label}</strong><small>{noticeBasis(item)} · NICE {item.niceClass}류</small></span><b>{item.metrics.uniqueTrademarkCount.availability === "available" ? `지역 주소 일치 ${number(item.metrics.uniqueTrademarkCount.value)}건` : "지역별 집계 대기"}</b></button>)}{visibleItems.length === 0 && <p className="empty">이 지역에는 고시명칭이 확인된 특산품이 없습니다.</p>}</div><div className="insight-note"><strong>표시 원칙</strong><p>지도 옆에는 고시명칭·NICE류가 확인된 특산품명만 표시합니다. 미확정 원물 후보는 상세 조회에 보존하고, 개별 상표명은 상표 예시에서만 보여줍니다.</p></div></aside>
      </section>
      <section className="ranking" aria-label="지역 주소 일치 출원 중 등록 랭킹"><div className="section-heading"><div><p className="eyebrow">TRADEMARK RANKING</p><h2>지역×대표 특산품 · 등록 상태 출원 랭킹</h2></div><div className="ranking-toggle" role="group" aria-label="랭킹 표시 건수">{([10, 50] as const).map((limit) => <button type="button" key={limit} className={rankingLimit === limit ? "active" : ""} onClick={() => setRankingLimit(limit)}>TOP {limit}</button>)}</div></div><p className="ranking-note">출원인 주소가 해당 지역과 일치한 출원 가운데 등록 상태인 건수로 순위를 정합니다. 고시명칭·NICE류가 확인된 특산품명만 표시하고, 개별 상표명은 아래 상표 예시와 상세 화면에서 확인합니다.</p><div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>고시명칭·NICE</th><th>그중 등록</th></tr></thead><tbody>{rankingRows.slice(0, rankingLimit).map(({ region, item, label }, index) => <tr key={`${regionKey(region)}-${item.specialtyId || index}`}><td>{index + 1}</td><td>{region.region}</td><td>{label}</td><td>{item.noticeName} · {item.niceClass}류</td><td>{number(item.metrics.registeredTrademarkCount.value)}건</td></tr>)}</tbody></table></div></section>
      {trademarkShowcase.length > 0 && <section className="showcase" aria-label="수집된 상표 사례"><div className="section-heading"><div><p className="eyebrow">TRADEMARK EXAMPLES</p><h2>수집된 상표 예시</h2></div><span>최근 출원 · 품목별 1건</span></div><p className="showcase-intro">고시명칭으로 검색된 전국 후보이며, 해당 지역 출원으로 확정된 목록은 아닙니다.</p><div className="showcase-grid">{trademarkShowcase.map(({ region, item, example }) => <button type="button" key={example.applicationNumber || example.title} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span className="showcase-item">{itemName(item)} 검색 사례</span><strong>{example.title}</strong><small>{compactDate(example.applicationDate)} · {example.applicationStatus || "상태 미기록"}</small><span className="showcase-number">{example.applicationNumber || "출원번호 미기록"} →</span></button>)}</div></section>}
      {pipeline && <section className="pipeline-progress" aria-label="데이터 준비 상태"><div className="section-heading"><div><p className="eyebrow">DATA READINESS</p><h2>데이터 준비 상태</h2></div><span>수집·주소 확인 단위별 현황</span></div><div className="pipeline-grid"><article><span>지역×품목 입력행</span><strong>{number(pipeline.rowCounts.total)}행</strong><p>검색 가능 {number(pipeline.rowCounts.searchable)} · 건너뜀 {number(pipeline.rowCounts.skipped)}<br />완전 {number(pipeline.rowCounts.complete)} · 부분 {number(pipeline.rowCounts.partial)}</p></article><article><span>출원인 주소 확보</span><strong>{percent(pipeline.applicantRegionVerification.rate)}</strong><p>확보 {number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 {number(pipeline.applicantRegionVerification.unverified)}<br />전국 고유 상표 후보 기준</p></article><article><span>지역별 출원 수 준비 상태</span><strong>{number(pipeline.regionalMetricGate.blockedRegionItemCount)}개 집계 대기</strong><p>{(pipeline.regionalMetricGate.coverageThreshold ?? 1) < 1 ? `검색 수집률 ${percent(pipeline.regionalMetricGate.coverageThreshold)} 이상이고 오류·건너뜀이 없는 항목만 표시합니다. ` : "검색 수집이 완료된 항목만 표시합니다. "}대기 항목을 0건으로 간주하지 않습니다.</p></article><article className="pipeline-bottleneck"><span>다음 개선</span><strong>검색 조건 정밀화와 주소 보강 확대</strong><p>중복 검색 단위 분리와 부분 수집 재개는 반영했습니다. 남은 광범위 검색어를 좁히고 새 상표 후보의 주소를 증분 보강합니다.</p></article></div></section>}
    </>}

    {tab === "regions" && <section className="screen-section"><div className="screen-heading"><div><p className="eyebrow">LOCAL GOVERNMENT</p><h1>지자체별 조회</h1></div><p>지역 → 품목 → 근거 지표 순으로 확인합니다.</p></div><section className="workspace" aria-label="지역별 상세 조회"><aside className="region-panel"><div className="panel-heading"><div><p className="eyebrow">REGION INDEX</p><h2>수집 지역</h2></div><span>{filteredRegions.length}건</span></div><label className="search-field"><span className="sr-only">지역 또는 품목 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역 또는 품목 검색" /></label><div className="region-list">{filteredRegions.map((region) => { const count = regionTrademarkValue(region); return <button type="button" key={regionKey(region)} className={regionKey(selectedRegion) === regionKey(region) ? "region-button active" : "region-button"} onClick={() => chooseRegion(region)}><span><strong>{region.region}</strong><small>{region.items.length}개 품목 · {count === null ? "지역별 출원 집계 대기" : `주소 일치 출원 ${number(count)}건`}</small></span><span className={`state state-${region.dataState}`}>{STATE_LABELS[region.dataState] || region.dataState}</span></button>; })}{filteredRegions.length === 0 && <p className="empty">검색 결과가 없습니다.</p>}</div></aside><RegionDetail region={selectedRegion} item={selectedItem} onItem={setSelectedItemId} /></section></section>}

    {tab === "items" && <section className="screen-section"><div className="screen-heading"><div><p className="eyebrow">ITEM EXPLORER</p><h1>품목별 조회</h1></div><p>품목을 기준으로 지역과 상표 활동을 다시 묶었습니다.</p></div><div className="item-screen"><div className="item-screen-toolbar"><label><span className="sr-only">품목 검색</span><input value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder="품목 또는 지역 검색" /></label><span>{itemRows.length}개 품목</span></div><div className="item-table-explainer"><strong>표의 수치 읽는 법</strong><p><b>지역 주소 일치 출원</b>은 같은 품목의 각 확인 지역에서 출원인 주소가 그 지역으로 판정된 고유 출원을 합한 값입니다. <b>그중 등록</b>은 해당 출원 중 현재 등록 상태인 건수이며, <b>등록 비율 = 그중 등록 ÷ 지역 주소 일치 출원</b>입니다. 전국 검색 결과 전체가 아닙니다.</p><p><b>지역별 집계 대기</b>는 특산품명이 미확정이거나 상표가 0건이라는 뜻이 아닙니다. 이 표의 품목명은 이미 고시명칭·NICE류 확인을 마쳤고, 상표 검색이 일부만 수집된 경우 지역별 수치를 확정하지 않고 대기 상태로 표시합니다.</p></div><div className="item-table" role="table"><div className="item-table-head" role="row"><span>품목</span><span>특산품 확인 지역</span><span>지역 주소 일치 출원</span><span>그중 등록</span><span>등록 비율</span></div>{itemRows.map((row, index) => { const pending = row.regions.length - row.available; const basis = pending > 0 ? `확정 ${row.available}/${row.regions.length}개 지역 · ${pending}개 대기` : `${row.regions.length}개 지역 합계`; return <div className="item-table-row" role="row" key={row.name}><span><b>{String(index + 1).padStart(2, "0")}</b><strong>{row.name}</strong></span><span>{row.regions.join(", ")}</span><span className={row.available ? "metric-cell" : "metric-cell pending-value"}><strong>{row.available ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>{row.available ? basis : `${row.regions.length}개 지역 검색 부분 수집`}</small></span><span className={row.available ? "metric-cell" : "metric-cell pending-value"}><strong>{row.available ? `${number(row.registered)}건` : "집계 대기"}</strong><small>{row.available ? "위 출원 중 등록 상태" : "지역 출원 수 확정 후 계산"}</small></span><span className={row.available ? "metric-cell" : "metric-cell pending-value"}><strong>{row.available ? row.trademarks ? percent(row.registered / row.trademarks) : "계산 불가" : "집계 대기"}</strong><small>{row.available ? row.trademarks ? `${number(row.registered)} ÷ ${number(row.trademarks)}` : "출원 0건으로 분모 없음" : "지역 출원 수 확정 후 계산"}</small></span></div>; })}</div><div className="method-note"><strong>품목명 집계 기준</strong><p>고시명칭·NICE류가 확정된 품목만 공식 명칭 기준으로 재그룹합니다(&quot;풋고추&quot;·&quot;파프리카&quot;는 같은 &quot;고추&quot;로 합쳐짐). 아직 고시명칭이 확정되지 않은 원물명은 이 표에서 제외하고 지역별 상세 화면에 원문 그대로 보존합니다.</p></div></div></section>}

    {tab === "compare" && <section className="screen-section"><div className="screen-heading"><div><p className="eyebrow">SPECIALIZED CROP MATCH</p><h1>특화작목 비교</h1></div><p>정책 지정 작목과 실제 상표 활동의 일치 여부를 비교하는 화면입니다.</p></div><div className="compare-banner"><span>현재 상태</span><strong>정책 지정 특화작목 원본 미수집 · 비교 대기</strong><p>농사로 지역특산물과 정책 지정 특화작목은 같은 데이터가 아니므로 임의로 대체하지 않습니다.</p></div><div className="compare-grid">{[...provinceStats.entries()].map(([province, stat]) => { const names = snapshot.regions.filter((region) => (region.sido || region.region) === province).flatMap((region) => region.items.map(itemName)); return <article key={province}><div className="compare-head"><h2>{province}</h2><span>비교 대기</span></div><dl><dt>현재 공식 특산품 후보</dt><dd>{names.join(", ") || "없음"}</dd><dt>정책 지정 특화작목</dt><dd className="missing">미수집</dd><dt>지역 주소 일치 출원 합계</dt><dd>{stat.verified ? `${number(stat.trademarks)}건` : "지역별 집계 대기"}</dd><dt>일치 여부</dt><dd className="missing">판정 불가</dd></dl></article>; })}</div><div className="compare-sources"><article><span>추가 수집 1</span><strong>농촌진흥청 지역특화작목 지정 목록</strong><p>계획 기간·지역·작목·고시 또는 보고서 버전을 구조화해야 합니다.</p></article><article><span>추가 수집 2</span><strong>한국지식재산연구원 로컬브랜드 근거</strong><p>레퍼런스가 인용한 2024년 보고서의 지역·품목 대응표와 페이지 근거가 필요합니다.</p></article><article><span>자동화 원칙</span><strong>정책 목록 확보 후 결정론적 비교</strong><p>명칭 정규화 후보만 사람 검토하고 나머지 집계·일치 판정은 자동화합니다.</p></article></div></section>}

    {tab === "data" && pipeline && <section className="screen-section data-overview">
      <div className="screen-heading"><div><p className="eyebrow">DATA JOURNEY</p><h1>특산물과 상표가<br />데이터가 되기까지</h1></div><p>수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다.</p></div>
      <div className="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>{number(pipeline.rowCounts.total)}</strong><small>지역×특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>{number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역×품목</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>{number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>{number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 전국 고유 후보</small></article><i>→</i><article className="flow-highlight"><span>05 · 지역별 집계</span><strong>{number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>지역 출원 수 표시 가능 항목</small></article></div>
      <div className="data-summary-grid"><article className="data-summary-card"><p className="eyebrow">SPECIALTY DATA</p><h2>특산물 데이터</h2><div className="data-stat"><strong>{number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div className="data-stat"><strong>{number(snapshot.coverage.regionItemCount)}개</strong><span>지역×품목 조합</span></div><div className="data-stat"><strong>{number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p className="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article className="data-summary-card"><p className="eyebrow">TRADEMARK MATCH</p><h2>상표 매칭 결과</h2><div className="match-bars"><div><span>고유 상표 주소 확보 <b>{number(pipeline.applicantRegionVerification.verifiedCount)}건</b></span><em><i style={{ width: `${Math.round((pipeline.applicantRegionVerification.rate || 0) * 100)}%` }} /></em><small>전국 고유 후보 중 {percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>출원인 주소-대상 지역 일치 <b>{number(attributionCounts.inside)}개 관계</b></span><em><i style={{ width: `${Math.max(2, Math.round(attributionInsideRate * 100))}%` }} /></em><small>판정 완료 {number(attributionDecided)}개 관계 중 {percent(attributionInsideRate)}</small></div><div><span>지역별 출원 수 표시 가능 <b>{number(pipeline.regionalMetricGate.availableRegionItemCount)}개</b></span><em><i style={{ width: `${Math.round(pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal) * 100)}%` }} /></em><small>전체 {number(gateTotal)}개 지역×품목 중 {percent(pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal))}</small></div></div><p className="match-explanation">두 번째 값은 상표의 유효성 비율이 아닙니다. 각 전국 검색 후보의 출원인 주소가 검색 대상 지역과 같은지 판정한 결과이며, 주소 미확보·판정 불가 {number(attributionCounts.unverified)}개 관계는 비율에서 제외했습니다. 같은 상표가 여러 지역×품목 검색에 나타날 수 있어 관계 수는 고유 상표 수보다 클 수 있습니다.</p></article></div>
      <div className="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>{number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 출원번호 중복을 제거한 전국 검색 후보입니다. 지역별 출원 수에는 이 가운데 출원인 주소가 해당 지역과 일치한 건만 쓰고, 등록 비율은 그 지역 주소 일치 출원 중 등록 상태인 건의 비율로 계산합니다. 검색이 부분 수집 상태인 품목은 0건으로 보지 않고 <b>지역별 집계 대기</b>로 표시합니다.</p></div>
    </section>}

    <section className="provenance"><div className="section-heading"><div><p className="eyebrow">TRACEABLE BY DESIGN</p><h2>출처와 데이터 상태</h2></div><span>{snapshot.schemaVersion}</span></div><div className="source-grid">{snapshot.sources.filter((source) => source.sourceUrl).map((source) => <a href={source.sourceUrl || "#"} target="_blank" rel="noreferrer" key={source.sourceId}><span>{source.sourceLabel || source.sourceId}</span><strong>{source.sourceContractVersion || "버전 미기록"}</strong><small>검증 {source.sourceLastVerifiedAt || date(source.sourceFetchedAt)}</small></a>)}<a href={geometry.boundaryReference.sourceUrl} target="_blank" rel="noreferrer"><span>지도 경계</span><strong>{geometry.boundaryReference.sourceName}</strong><small>{geometry.boundaryReference.sourceBasis} · 참고용</small></a></div><details><summary>현재 해석 주의사항 {snapshot.warnings.length}건 보기</summary><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details></section>
    <footer><span>Snapshot {snapshot.snapshotId}</span><span>수치·판정·지도 경계는 출처와 버전을 함께 표시합니다.</span></footer>
  </main>;
}

function RegionDetail({ region, item, onItem }: { region: Region; item: Item; onItem: (id: string) => void }) {
  const examples = item.trademarkExamples || [];
  const regionalAvailable = item.metrics.uniqueTrademarkCount.availability === "available";
  const localCount = item.metrics.uniqueTrademarkCount.value || 0;
  const registeredCount = item.metrics.registeredTrademarkCount.value || 0;
  const pendingReason = regionalMetricPendingReason(item);
  return <div className="detail-panel">
    <div className="detail-heading"><div><p className="eyebrow">REGION DETAIL</p><h2>{region.region}</h2><p>법정동코드 {region.regionCode || "미확정"}</p></div><span className={`state state-${region.dataState}`}>{STATE_LABELS[region.dataState] || region.dataState}</span></div>
    <div className="item-tabs" role="tablist" aria-label={`${region.region} 특산품`}>{region.items.map((row) => <button type="button" role="tab" aria-selected={item.specialtyId === row.specialtyId} key={row.specialtyId || row.itemName} onClick={() => onItem(row.specialtyId || "")}>{itemName(row)}</button>)}</div>
    <div className="item-title"><div><span>이 지역의 대표 특산품</span><h3>{itemName(item)}</h3><small>{noticeBasis(item)}</small></div><span className="class-chip">{item.niceClass ? `NICE ${item.niceClass}` : "NICE 분류 미확정"}</span>{item.itemVerdict?.source === "algorithm" && <span className="verdict-chip" title={verdictTitle(item.itemVerdict)}>AI 판정</span>}</div>
    <div className="metric-reading-note"><strong>아래 수치의 기준</strong><p>전국 검색 결과 전체가 아니라, 출원인 주소가 <b>{region.region}</b>으로 확인된 출원을 지역 수치로 셉니다. 등록 비율은 그중 등록 상태 건수 ÷ 지역 주소 일치 출원 건수입니다.</p></div>
    <div className="detail-grid">
      <article><span>{itemName(item)} · 지역 주소 일치 출원</span><strong>{regionalAvailable ? `${number(localCount)}건` : "지역별 집계 대기"}</strong><small>{regionalAvailable ? `출원인 주소가 ${region.region}으로 확인된 고유 출원` : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${pendingReason}`}</small></article>
      <article><span>그중 등록 상태</span><strong>{regionalAvailable ? `${number(registeredCount)}건` : "지역별 집계 대기"}</strong><small>{regionalAvailable ? localCount ? `${number(registeredCount)} ÷ ${number(localCount)} · 등록 비율 ${percent(item.metrics.registrationRate.value)}` : "지역 주소 일치 출원 0건 · 등록 비율 계산 불가" : "지역 주소 일치 출원 수가 확정된 뒤 계산합니다."}</small></article>
      <article><span>주소 확인 후보 중 이 지역 비율</span><strong>{regionalAvailable ? item.metrics.localApplicantShare.value === null ? "계산 불가" : percent(item.metrics.localApplicantShare.value) : "지역별 집계 대기"}</strong><small>{regionalAvailable ? "주소를 판정할 수 있었던 전국 검색 후보 중 이 지역 주소와 일치한 비율 · 주소 미확보 후보 제외" : pendingReason}</small></article>
      <article><span>상표 활용 여지</span><strong>{item.metrics.gapScore.value ?? "산출 대기"}</strong><small>{item.metrics.gapScore.availability === "blocked" ? `${item.metrics.gapScore.blockingIssue || "#50"} 지역별 출원 수와 산출 기준이 준비된 뒤 표시합니다.` : "대표 특산품에 비해 지역 상표 활동이 적을수록 높은 점수"}</small></article>
    </div>
    <div className="review-strip"><div><span>지정상품 자동 일치</span><strong>{number(item.metrics.confirmedGoodsMatchCount.value)}건</strong></div><div><span>지정상품 사람 검토</span><strong>{number(item.metrics.goodsReviewCandidateCount.value)}건</strong></div><p>상표명은 사례로 보존하고, 대표 특산품 집계 키와 분리합니다.</p></div>
    <section className="trademark-examples"><div className="example-heading"><strong>전국 검색 상표 사례</strong><span>지역 귀속 전 검색 후보 · 최근 출원 + 지정상품 근거 우선 · 최대 {examples.length || 0}건</span></div>{examples.length ? <div className="example-list">{examples.map((example, index) => <article key={example.applicationNumber || `${example.title}-${index}`}><div><strong>{example.title || "상표명 미기록"}</strong><small>{example.applicationNumber || "출원번호 미기록"} · {example.applicationDate || "출원일 미기록"} · {example.applicationStatus || "상태 미기록"}</small></div><span className={example.goodsReviewRequired ? "goods-chip review" : "goods-chip"}>{goodsMethod(example.goodsMatchMethod)}</span>{example.goodsEvidence.length > 0 && <p>지정상품: {example.goodsEvidence.map((row) => `${row.designatedProductName || "명칭 미기록"}${row.classCode ? ` (${row.classCode}류)` : ""}`).join(", ")}</p>}</article>)}</div> : <p className="empty">현재 스냅샷에는 개별 상표명이 포함되지 않았습니다.</p>}</section>
    <div className="blocking-list">{[item.metrics.uniqueTrademarkCount, item.metrics.localApplicantShare, item.metrics.gapScore].filter((metric) => metric.availability === "blocked" && metric.blockingIssue).map((metric, index) => { const href = issueUrl(metric.blockingIssue); return href ? <a href={href} target="_blank" rel="noreferrer" key={`${metric.blockingIssue}-${index}`}>{metric.blockingIssue} 기준 확인 →</a> : null; })}</div>
  </div>;
}
