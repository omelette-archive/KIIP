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
type Tab = "summary" | "applications" | "regions" | "items" | "gaps" | "compare" | "data";
type MapMetric = "trademarks" | "registration" | "coverage" | "applicationCoverage";
type SpecialtyCoverage = { total: number; decided: number; applied: number; pending: number; rate: number | null };
type MapLabel = { name: string; x: number; y: number; targetX: number; targetY: number; edgeX: number; anchor: "start" | "end"; value: string; connector: boolean };

const STATE_LABELS: Record<string, string> = { complete_nonzero: "수집 완료", complete_zero: "결과 0건", partial: "부분 수집", error: "오류", skipped: "건너뜀", not_collected: "미수집", complete: "완료" };
const TAB_LABELS: Record<Tab, string> = { summary: "요약", applications: "지역별 출원율", regions: "지자체별 조회", items: "품목별 조회", gaps: "미출원 특산품", compare: "특화작목 비교", data: "데이터 개요" };
const MAP_LABELS: Record<MapMetric, string> = { trademarks: "상표 건수", registration: "상표 등록률", coverage: "확인 특산품 수", applicationCoverage: "특산품 출원율" };
const MAP_DESCRIPTIONS: Record<MapMetric, string> = {
  trademarks: "검색 수집이 완료된 항목에서, 출원인 주소가 해당 지역으로 확인된 고유 상표 출원 건수입니다.",
  registration: "지도에 포함된 지역 주소 일치 출원 중 등록 상태인 건의 비율입니다(등록 ÷ 출원).",
  coverage: "고시명칭·NICE류가 확인된 지역×특산품 수입니다.",
  applicationCoverage: "지역별 집계가 끝난 특산품 중 지역 주소 일치 출원이 1건 이상 확인된 특산품의 비율입니다. 집계 대기 품목은 분모에서 제외합니다.",
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
  return prefix ? name.slice(prefix.length) : name;
}
// 지자체 상세의 "특산품 탭"은 고시명칭이 확정된 공식 특산품만 골라 보여준다.
// matchingBasis=raw_item_name_unclassified인 검토대기 원물명·상호(예: "꿀다림
// 데일리허니", "왕곡한과")는 삭제하지 않고 데이터에는 남기되, 탭 목록·기본 선택에서는
// 절대 노출하지 않는다(2026-08-19 데이터 감사). 지역에 공식 특산품이 하나도 없는
// 경우(11/124개 지역)에도 원물을 대신 보여주지 않고, 호출부에서 "확인된 특산품 없음"
// 빈 상태로 분기한다.
function officialRegionItems(region: Region): Item[] {
  return region.items.filter((item) => officialItemLabel(item));
}
function specialtyCoverage(regions: Region[]): SpecialtyCoverage {
  let total = 0;
  let decided = 0;
  let applied = 0;
  regions.forEach((region) => region.items.forEach((item) => {
    if (!officialItemLabel(item)) return;
    total += 1;
    if (item.metrics.uniqueTrademarkCount.availability !== "available") return;
    decided += 1;
    if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) applied += 1;
  }));
  return { total, decided, applied, pending: total - decided, rate: decided ? applied / decided : null };
}
function compactRegionName(name: string) {
  if (name === "전남광주통합특별시") return "전남·광주";
  return name.replace(/특별자치도$|특별자치시$|광역시$|특별시$|도$/, "");
}
function parseViewBox(viewBox: string) {
  const [x, y, width, height] = viewBox.split(/\s+/).map(Number);
  return { x, y, width, height };
}
function calloutViewBox(viewBox: string, withGutter?: boolean) {
  const { x, y, width, height } = parseViewBox(viewBox);
  const gutter = (withGutter ?? width < 700) ? Math.max(125, width * 0.2) : 0;
  return `${x - gutter} ${y} ${width + gutter * 2} ${height}`;
}
function calloutLabels(shapes: (ProvinceShape | MunicipalityShape)[], viewBox: string, valueFor: (name: string) => number | null, labelFor: (value: number | null) => string, includeName: (name: string) => boolean = () => true, inlineByDefault = shapes.length === 17): MapLabel[] {
  const { x, y, width, height } = parseViewBox(viewBox);
  const center = x + width / 2;
  const rows = shapes
    .map((shape) => ({ shape, rawValue: valueFor(shape.name) }))
    .filter(({ shape }) => includeName(shape.name));
  const result: MapLabel[] = [];
  const connectorRows = inlineByDefault ? rows.filter(({ shape }, index) => rows.some(({ shape: other }, otherIndex) => otherIndex !== index && Math.abs(shape.labelX - other.labelX) < 52 && Math.abs(shape.labelY - other.labelY) < 24)) : rows;
  if (inlineByDefault) rows.filter(({ shape }) => !connectorRows.some(({ shape: other }) => other === shape)).forEach(({ shape, rawValue }) => result.push({ name: shape.name, x: shape.labelX, y: shape.labelY, targetX: shape.labelX, targetY: shape.labelY, edgeX: shape.labelX, anchor: "middle", value: labelFor(rawValue), connector: false }));
  (["left", "right"] as const).forEach((side) => {
    const sideRows = connectorRows.filter(({ shape }) => side === "left" ? shape.labelX < center : shape.labelX >= center).sort((a, b) => a.shape.labelY - b.shape.labelY);
    if (!sideRows.length) return;
    const top = y + Math.max(18, height * 0.035);
    const bottom = y + height - Math.max(18, height * 0.035);
    const step = sideRows.length === 1 ? 0 : (bottom - top) / (sideRows.length - 1);
    sideRows.forEach(({ shape, rawValue }, index) => {
      const labelY = sideRows.length === 1 ? Math.max(top, Math.min(bottom, shape.labelY)) : top + step * index;
      const isLeft = side === "left";
      result.push({
        name: shape.name,
        x: isLeft ? x - 13 : x + width + 13,
        y: labelY,
        targetX: shape.labelX,
        targetY: shape.labelY,
        edgeX: isLeft ? x - 4 : x + width + 4,
        anchor: isLeft ? "end" : "start",
        value: labelFor(rawValue),
        connector: true,
      });
    });
  });
  return result;
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
function goodsMethod(method: string) { return ({ normalized_exact: "특산품 활용 확정", normalized_contains: "고시명칭 포함·인정", class_only: "NICE류 검토", mismatch: "지정상품 불일치", unverified: "미검증" } as Record<string, string>)[method] || method; }
function verdictTitle(verdict: ItemVerdict) { return `사람이 개별 승인하지 않고 규칙 기반 알고리즘이 자동 확정(${verdict.method || "algorithm"}, 신뢰도 ${verdict.confidence ?? "미기록"})`; }
function regionKey(region: Region) { return region.regionCode || region.region; }
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
  const [gapQuery, setGapQuery] = useState("");
  const [selectedRegionCode, setSelectedRegionCode] = useState(regionKey(snapshot.regions[0]));
  const [selectedItemId, setSelectedItemId] = useState("");
  const [mapMetric, setMapMetric] = useState<MapMetric>("trademarks");
  const [rankingLimit, setRankingLimit] = useState<10 | 50>(10);
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string | null>(null);

  const totals = useMemo(() => snapshot.regions.reduce((acc, region) => { region.items.forEach((item) => { if (item.metrics.uniqueTrademarkCount.availability === "available") { acc.availableItems += 1; acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0; acc.registered += item.metrics.registeredTrademarkCount.value || 0; } acc.review += item.metrics.goodsReviewCandidateCount.value || 0; }); return acc; }, { trademarks: 0, registered: 0, review: 0, availableItems: 0 }), [snapshot.regions]);
  const sourceLine = snapshot.sources.map((source) => source.sourceLabel || source.sourceId).filter(Boolean).join(" · ");
  const provinceStats = useMemo(() => {
    const stats = new Map<string, { trademarks: number; registered: number; verified: number; officialItems: number; decidedItems: number; appliedItems: number }>();
    snapshot.regions.forEach((region) => {
      const name = region.sido || region.region;
      const current = stats.get(name) || { trademarks: 0, registered: 0, verified: 0, officialItems: 0, decidedItems: 0, appliedItems: 0 };
      region.items.forEach((item) => {
        const official = Boolean(officialItemLabel(item));
        if (official) current.officialItems += 1;
        // 지역 단위 상표 집계(trademarks/verified/registered)는 고시명칭이 확정된
        // 공식 특산품만 포함한다. matchingBasis=raw_item_name_unclassified인 검토대기
        // 원물명·상호(예: "꿀다림 데일리허니", "왕곡한과")는 uniqueTrademarkCount가
        // available이어도 지역 상표 건수 합계에 섞이면 안 된다(2026-08-19 데이터 감사).
        if (official && item.metrics.uniqueTrademarkCount.availability === "available") {
          current.verified += 1;
          current.trademarks += item.metrics.uniqueTrademarkCount.value || 0;
          current.registered += item.metrics.registeredTrademarkCount.value || 0;
          current.decidedItems += 1;
          if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) current.appliedItems += 1;
        }
      });
      stats.set(name, current);
    });
    return stats;
  }, [snapshot.regions]);
  const mapMax = mapMetric === "registration" || mapMetric === "applicationCoverage" ? 1 : Math.max(1, ...[...provinceStats.values()].map((stat) => mapMetric === "trademarks" ? stat.trademarks : stat.officialItems));
  const filteredRegions = useMemo(() => { const keyword = query.trim().toLocaleLowerCase("ko-KR"); return !keyword ? snapshot.regions : snapshot.regions.filter((region) => region.region.toLocaleLowerCase("ko-KR").includes(keyword) || region.items.some((item) => `${itemName(item)} ${item.noticeName || ""}`.toLocaleLowerCase("ko-KR").includes(keyword))); }, [query, snapshot.regions]);
  const selectedRegion = snapshot.regions.find((region) => regionKey(region) === selectedRegionCode) || filteredRegions[0] || snapshot.regions[0];
  const selectedRegionOfficialItems = selectedRegion ? officialRegionItems(selectedRegion) : [];
  const selectedItem = selectedRegionOfficialItems.find((item) => item.specialtyId === selectedItemId) || selectedRegionOfficialItems[0];
  const itemRows = useMemo(() => {
    const rows = new Map<string, { name: string; trademarks: number; trademarksDisplay: number; hasProvisional: boolean; registered: number; available: number; availableRegions: string[]; regions: string[]; states: string[] }>();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      const name = officialItemLabel(item);
      if (!name) return; // 아직 고시명칭이 확정되지 않은 원물명은 여기서 제외(지역 상세에서는 계속 표시)
      const row = rows.get(name) || { name, trademarks: 0, trademarksDisplay: 0, hasProvisional: false, registered: 0, available: 0, availableRegions: [], regions: [], states: [] };
      const trade = tradeDisplay(item);
      if (trade.value !== null) { row.trademarksDisplay += trade.value; if (trade.provisional) row.hasProvisional = true; }
      if (item.metrics.uniqueTrademarkCount.availability === "available") { row.available += 1; row.trademarks += item.metrics.uniqueTrademarkCount.value || 0; row.registered += item.metrics.registeredTrademarkCount.value || 0; if (!row.availableRegions.includes(region.region)) row.availableRegions.push(region.region); }
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      row.states.push(item.dataState);
      rows.set(name, row);
    }));
    const keyword = itemQuery.trim().toLocaleLowerCase("ko-KR");
    // 정렬은 확정 건수(trademarks) 기준으로 한다 — 전국 검색까지 섞은 trademarksDisplay로
    // 정렬하면 지역 확인이 안 된 노이즈가 큰 품목이 상위 100개 컷에서 확정 데이터를
    // 밀어낼 수 있다(2026-08-19 결정).
    return [...rows.values()].filter((row) => !keyword || row.name.toLocaleLowerCase("ko-KR").includes(keyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(keyword))).sort((a, b) => b.trademarks - a.trademarks);
  }, [itemQuery, snapshot.regions]);
  const comparisonRows = useMemo(() => [...provinceStats.keys()].map((province) => {
    const regions = snapshot.regions.filter((region) => (region.sido || region.region) === province);
    const coverage = specialtyCoverage(regions);
    const names = [...new Set(regions.flatMap((region) => region.items.map(officialItemLabel).filter((name): name is string => Boolean(name))))].sort((a, b) => a.localeCompare(b, "ko-KR"));
    return { province, coverage, names };
  }).sort((a, b) => b.coverage.applied - a.coverage.applied || b.coverage.total - a.coverage.total || a.province.localeCompare(b.province, "ko-KR")), [provinceStats, snapshot.regions]);
  // 검토가 덜 끝난 상태에서도 전체 목록을 다 보여주기보다, 상표 출원 건수가 많은
  // 순으로 상위 100개만 우선 보여준다(2026-08-19 결정).
  const ITEM_ROW_LIMIT = 100;
  const visibleItemRows = itemRows.slice(0, ITEM_ROW_LIMIT);
  // 2026-08-20: "미출원 특산품" — 실제로 존재하는 특산품인데 그 지역 주소로 낸 상표
  // 출원이 KIPRIS에 한 건도 없는 경우다. 검색·주소 판정까지 끝난(availability=
  // available) 것 중 값이 0인 것만 대상으로 한다 — 아직 판정 안 끝난(partial/blocked)
  // 항목을 "미출원"으로 잘못 보여주면 안 된다. 확정 특산품(고시명칭·지정상품 매칭)과
  // 아직 미분류인 원물명은 신뢰도가 다르므로 별도 그룹으로 나눈다.
  const unfiledRows = useMemo(() => {
    const confirmed = new Map<string, { name: string; regions: string[] }>();
    const raw = new Map<string, { name: string; regions: string[] }>();
    snapshot.regions.forEach((region) => region.items.forEach((item) => {
      if (item.metrics.uniqueTrademarkCount.availability !== "available") return;
      if ((item.metrics.uniqueTrademarkCount.value || 0) > 0) return;
      const officialLabel = officialItemLabel(item);
      const bucket = officialLabel ? confirmed : item.matchingBasis === "raw_item_name_unclassified" ? raw : null;
      if (!bucket) return;
      const name = officialLabel || itemName(item);
      const row = bucket.get(name) || { name, regions: [] };
      if (!row.regions.includes(region.region)) row.regions.push(region.region);
      bucket.set(name, row);
    }));
    const sortRows = (map: Map<string, { name: string; regions: string[] }>) =>
      [...map.values()].sort((a, b) => b.regions.length - a.regions.length || a.name.localeCompare(b.name, "ko-KR"));
    return { confirmed: sortRows(confirmed), raw: sortRows(raw) };
  }, [snapshot.regions]);
  const gapKeyword = gapQuery.trim().toLocaleLowerCase("ko-KR");
  const matchesGapKeyword = (row: { name: string; regions: string[] }) =>
    !gapKeyword || row.name.toLocaleLowerCase("ko-KR").includes(gapKeyword) || row.regions.some((region) => region.toLocaleLowerCase("ko-KR").includes(gapKeyword));
  const visibleUnfiledConfirmed = unfiledRows.confirmed.filter(matchesGapKeyword);
  const visibleUnfiledRaw = unfiledRows.raw.filter(matchesGapKeyword);

  function chooseRegion(region: Region) { setSelectedRegionCode(regionKey(region)); setSelectedItemId(officialRegionItems(region)[0]?.specialtyId || ""); }
  function regionTrademarkValue(region: Region | undefined) { if (!region) return null; const verified = region.items.filter((item) => officialItemLabel(item) && item.metrics.uniqueTrademarkCount.availability === "available"); return verified.length ? verified.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0) : null; }
  function regionMapValue(region: Region | undefined, metric: MapMetric = mapMetric) { if (!region) return null; const available = region.items.filter((item) => officialItemLabel(item) && item.metrics.uniqueTrademarkCount.availability === "available"); const trademarks = available.reduce((sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0), 0); const registered = available.reduce((sum, item) => sum + (item.metrics.registeredTrademarkCount.value || 0), 0); if ((metric === "trademarks" || metric === "registration") && available.length === 0) return null; if (metric === "trademarks") return trademarks; if (metric === "registration") return trademarks ? registered / trademarks : 0; const coverage = specialtyCoverage([region]); if (metric === "coverage") return coverage.total; return coverage.rate; }
  function mapValue(name: string, metric: MapMetric = mapMetric) { const stat = provinceStats.get(name); if (!stat) return null; if (metric === "trademarks") return stat.verified ? stat.trademarks : null; if (metric === "registration") return stat.verified && stat.trademarks ? stat.registered / stat.trademarks : null; if (metric === "coverage") return stat.officialItems; return stat.decidedItems ? stat.appliedItems / stat.decidedItems : null; }
  function mapMetricValueLabel(value: number | null, metric: MapMetric = mapMetric) { if (value === null) return "데이터 없음"; if (metric === "registration" || metric === "applicationCoverage") return percent(value); return `${number(value)}${metric === "trademarks" ? "건" : "개 품목"}`; }
  function mapValueLabel(name: string, metric: MapMetric = mapMetric) { return mapMetricValueLabel(mapValue(name, metric), metric); }
  function openProvince(name: string) { setSelectedProvince(name); setSelectedMunicipality(null); }
  function openMunicipality(name: string) { setSelectedMunicipality(name); const match = snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === name); if (match) chooseRegion(match); }

  const visibleRegions = selectedProvince ? snapshot.regions.filter((region) => (region.sido || region.region) === selectedProvince && (!selectedMunicipality || region.sigungu === selectedMunicipality)) : snapshot.regions;
  const nationalSpecialtyCoverage = specialtyCoverage(snapshot.regions);
  const visibleSpecialtyCoverage = specialtyCoverage(visibleRegions);
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
  const municipalityMapMax = mapMetric === "registration" || mapMetric === "applicationCoverage" ? 1 : municipalityGeometry ? Math.max(1, ...municipalityGeometry.items.map((shape) => regionMapValue(snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === shape.name)) || 0)) : 1;
  const activeMapViewBox = municipalityGeometry?.viewBox || geometry.viewBox;
  const activeMapShapes = municipalityGeometry?.items || geometry.provinces;
  const activeMapLabels = calloutLabels(
    activeMapShapes,
    activeMapViewBox,
    (name) => municipalityGeometry ? regionMapValue(snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === name)) : mapValue(name),
    (value) => mapMetricValueLabel(value),
    (name) => !municipalityGeometry || snapshot.regions.some((region) => region.sido === selectedProvince && region.sigungu === name),
    !municipalityGeometry,
  );
  const coverageAreaRegions = selectedProvince
    ? snapshot.regions.filter((region) => region.sido === selectedProvince && (!selectedMunicipality || region.sigungu === selectedMunicipality))
    : snapshot.regions;
  const coverageArea = specialtyCoverage(coverageAreaRegions);
  const coverageAreaName = selectedMunicipality || selectedProvince || "전국";
  const coverageMapLabels = calloutLabels(
    activeMapShapes,
    activeMapViewBox,
    (name) => municipalityGeometry ? regionMapValue(snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === name), "applicationCoverage") : mapValue(name, "applicationCoverage"),
    (value) => mapMetricValueLabel(value, "applicationCoverage"),
    (name) => !municipalityGeometry || snapshot.regions.some((region) => region.sido === selectedProvince && region.sigungu === name),
    !municipalityGeometry,
  );
  const coverageBreakdown = (selectedProvince
    ? coverageAreaRegions.map((region) => ({ key: regionKey(region), label: region.sigungu || region.region, regions: [region], region }))
    : [...provinceStats.keys()].map((province) => ({ key: province, label: province, regions: snapshot.regions.filter((region) => region.sido === province), region: null })))
    .map((row) => ({
      ...row,
      coverage: specialtyCoverage(row.regions),
      items: row.regions.flatMap((region) => officialRegionItems(region).map((item) => ({ region, item, label: officialItemLabel(item) || itemName(item) }))),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  const pipeline = snapshot.pipelineStatus;
  const scopeLabel = snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터";
  const gateTotal = pipeline ? pipeline.regionalMetricGate.availableRegionItemCount + pipeline.regionalMetricGate.blockedRegionItemCount : snapshot.coverage.regionItemCount;
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
      <section className="hero"><div><p className="eyebrow">LOCAL BRAND OBSERVATORY</p><h1>지역 특산품 상표 분석</h1><p className="hero-copy">지역별 특산품과 관련 상표 현황을 한눈에 확인합니다.</p></div><div className="hero-note"><span>DATA COVERAGE</span><strong>{snapshot.coverage.observedRegionCount}개 지역 · {snapshot.coverage.regionItemCount}개 지역×품목</strong><p>현재 확인 가능한 데이터 범위입니다.</p></div></section>
      <section className="metrics" aria-label="핵심 지표"><article><span>특산품 출원율</span><strong>{percent(nationalSpecialtyCoverage.rate)}</strong><small>확인 특산품 전체 {number(nationalSpecialtyCoverage.total)}개 · 판정 완료 {number(nationalSpecialtyCoverage.decided)}개 중 {number(nationalSpecialtyCoverage.applied)}개 출원 확인 · 집계 대기 {number(nationalSpecialtyCoverage.pending)}개</small></article><article><span>전국 검색 고유 상표 후보</span><strong>{pipeline ? number(pipeline.nationwideCandidates.uniqueTrademarkCount) : totals.availableItems ? number(totals.trademarks) : "집계 전"}</strong><small>출원번호 중복 제거 · 지역별 출원 수와는 다른 전국 검색 결과</small></article><article><span>출원인 주소 확보율</span><strong>{pipeline ? percent(pipeline.applicantRegionVerification.rate) : "—"}</strong><small>{pipeline ? `고유 후보 중 확보 ${number(pipeline.applicantRegionVerification.verifiedCount)} · 미확보 ${number(pipeline.applicantRegionVerification.unverified)}` : "주소 수집 전"}</small></article><article><span>지역별 출원 수 표시 가능</span><strong>{pipeline ? `${number(pipeline.regionalMetricGate.availableRegionItemCount)} / ${number(gateTotal)}` : number(totals.availableItems)}</strong><small>검색 수집이 완료된 지역×특산품 항목 수</small></article></section>
      <section className="map-workspace">
        <div className="map-card"><div className="map-heading"><div><p className="eyebrow">REGIONAL TRADEMARK MAP</p><h2>{selectedProvince ? `${selectedProvince} 시군구` : "전국 지역 브랜드 지도"}</h2></div><span className="reference-chip">참고 경계 · 2013 KOSTAT</span></div>
          <div className="map-toolbar"><div className="map-metrics">{(Object.keys(MAP_LABELS) as MapMetric[]).map((key) => <button type="button" key={key} className={mapMetric === key ? "active" : ""} onClick={() => setMapMetric(key)} title={MAP_DESCRIPTIONS[key]} aria-label={`${MAP_LABELS[key]}: ${MAP_DESCRIPTIONS[key]}`}>{MAP_LABELS[key]}</button>)}</div>{selectedProvince && <button className="map-back" type="button" onClick={() => { setSelectedProvince(null); setSelectedMunicipality(null); }}>← 전국</button>}</div>
          <p className="map-metric-description"><strong>{MAP_LABELS[mapMetric]}</strong><span>{MAP_DESCRIPTIONS[mapMetric]}</span></p>
          <div className="map-stage"><svg className="korea-map map-with-callouts" viewBox={calloutViewBox(activeMapViewBox, activeMapLabels.some((label) => label.connector))} role="img" aria-label={selectedProvince ? `${selectedProvince} 시군구 지도` : "대한민국 시도 지도"}>{municipalityGeometry ? <>
             {municipalityGeometry.items.map((shape) => { const match = snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === shape.name); const statValue = regionMapValue(match); const active = selectedMunicipality === shape.name; return <path key={`${shape.name}-shape`} d={shape.d} className={active ? "map-shape selected" : "map-shape"} style={{ fill: fill(statValue, municipalityMapMax) }} tabIndex={0} role="button" aria-label={`${shape.name} ${mapMetricValueLabel(statValue)}`} onClick={() => openMunicipality(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openMunicipality(shape.name); }}><title>{shape.name} · {mapMetricValueLabel(statValue)}</title></path>; })}
          </> : <>
             {geometry.provinces.map((shape) => <path key={`${shape.name}-shape`} d={shape.d} className={selectedProvince === shape.name ? "map-shape selected" : "map-shape"} style={{ fill: fill(mapValue(shape.name), mapMax) }} tabIndex={0} role="button" aria-label={`${shape.name} ${mapValueLabel(shape.name)}`} onClick={() => openProvince(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProvince(shape.name); }}><title>{shape.name} · {mapValueLabel(shape.name)}</title></path>)}
          </>}{activeMapLabels.map((label) => <g className={`map-callout${label.connector ? " with-connector" : ""}`} key={`${label.name}-label`}>{label.connector && <polyline points={`${label.targetX},${label.targetY} ${label.edgeX},${label.y} ${label.x},${label.y}`} />}<text x={label.x} y={label.y} textAnchor={label.anchor}><tspan>{compactRegionName(label.name)}</tspan><tspan className="map-callout-value"> {label.value}</tspan></text></g>)}</svg></div>
          <div className="map-legend"><span><i className="legend-swatch no-data" />데이터 없음</span><span><i className="legend-swatch low" />낮음</span><span><i className="legend-swatch high" />높음</span><strong>{MAP_LABELS[mapMetric]} 기준</strong></div><p className="map-warning">{geometry.boundaryReference.warning} 지도를 클릭하면 해당 지역의 특산품 목록과 상표 사례를 확인할 수 있습니다. 집계 대기 특산품은 출원율 분모에서 제외합니다.</p>
        </div>
        <aside className="map-insight"><p className="eyebrow">SELECTED AREA</p><h2>{selectedMunicipality || selectedProvince || "전국"}</h2><p className="insight-summary">확인 특산품 {number(visibleSpecialtyCoverage.total)}개 · 출원 확인 {number(visibleSpecialtyCoverage.applied)} / 판정 완료 {number(visibleSpecialtyCoverage.decided)} · 출원율 {percent(visibleSpecialtyCoverage.rate)}{visibleSpecialtyCoverage.pending ? ` · 집계 대기 ${number(visibleSpecialtyCoverage.pending)}개` : ""}</p><div className="mini-list">{visibleItems.slice(0, 5).map(({ region, item, label }) => <button type="button" key={`${regionKey(region)}-${item.specialtyId}`} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span><strong>{region.sigungu || region.region} / {label}</strong><small>{noticeBasis(item)} · NICE {item.niceClass}류</small></span><b>{item.metrics.uniqueTrademarkCount.availability === "available" ? (item.metrics.uniqueTrademarkCount.value || 0) > 0 ? `출원 확인 · ${number(item.metrics.uniqueTrademarkCount.value)}건` : "출원 없음 · 판정 완료" : "지역별 집계 대기"}</b></button>)}{visibleItems.length === 0 && <p className="empty">이 지역에는 고시명칭이 확인된 특산품이 없습니다.</p>}</div><div className="insight-note"><strong>출원율 계산</strong><p>출원 확인 특산품 수 ÷ 지역별 집계 판정 완료 특산품 수입니다. 전체 특산품 수와 집계 대기 수를 함께 표시하며, 대기 품목을 출원 없음으로 계산하지 않습니다.</p></div></aside>
      </section>
      <section className="ranking" aria-label="지역 주소 일치 출원 중 등록 랭킹"><div className="section-heading"><div><p className="eyebrow">TRADEMARK RANKING</p><h2>지역×대표 특산품 · 등록 상태 출원 랭킹</h2></div><div className="ranking-toggle" role="group" aria-label="랭킹 표시 건수">{([10, 50] as const).map((limit) => <button type="button" key={limit} className={rankingLimit === limit ? "active" : ""} onClick={() => setRankingLimit(limit)}>TOP {limit}</button>)}</div></div><p className="ranking-note">출원인 주소가 해당 지역과 일치한 출원 가운데 등록 상태인 건수로 순위를 정합니다. 고시명칭·NICE류가 확인된 특산품명만 표시하고, 개별 상표명은 아래 상표 예시와 상세 화면에서 확인합니다.</p><div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>순위</th><th>지역</th><th>대표 특산품</th><th>고시명칭·NICE</th><th>그중 등록</th></tr></thead><tbody>{rankingRows.slice(0, rankingLimit).map(({ region, item, label }, index) => <tr key={`${regionKey(region)}-${item.specialtyId || index}`}><td>{index + 1}</td><td>{region.region}</td><td>{label}</td><td>{item.noticeName} · {item.niceClass}류</td><td>{number(item.metrics.registeredTrademarkCount.value)}건</td></tr>)}</tbody></table></div></section>
      {trademarkShowcase.length > 0 && <section className="showcase" aria-label="수집된 상표 사례"><div className="section-heading"><div><p className="eyebrow">TRADEMARK EXAMPLES</p><h2>수집된 상표 예시</h2></div><span>최근 출원 · 품목별 1건</span></div><p className="showcase-intro">고시명칭으로 검색된 전국 후보이며, 해당 지역 출원으로 확정된 목록은 아닙니다.</p><div className="showcase-grid">{trademarkShowcase.map(({ region, item, example }) => <button type="button" key={example.applicationNumber || example.title} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span className="showcase-item">{itemName(item)} 검색 사례</span><strong>{example.title}</strong><small>{compactDate(example.applicationDate)} · {example.applicationStatus || "상태 미기록"}</small><span className="showcase-number">{example.applicationNumber || "출원번호 미기록"} →</span></button>)}</div></section>}
    </>}

    {tab === "applications" && <section className="screen-section coverage-screen">
      <div className="screen-heading"><div><p className="eyebrow">REGIONAL APPLICATION COVERAGE</p><h1>지역별 특산품 출원율</h1></div><p>지도 색과 숫자로 시도별 출원율을 비교하고, 시도를 누르면 시군구까지 내려갑니다.</p></div>
      <section className="coverage-kpis" aria-label={`${coverageAreaName} 특산품 출원 현황`}>
        <article><span>선택 지역</span><strong>{coverageAreaName}</strong><small>{selectedMunicipality ? `${selectedProvince} 내 시군구` : selectedProvince ? "시군구별 특산품 항목 합산" : "전국 시군구별 특산품 항목 합산"}</small></article>
        <article><span>확인 특산품</span><strong>{number(coverageArea.total)}개</strong><small>현재 고시명칭·NICE류가 확인된 항목</small></article>
        <article><span>출원 확인 특산품</span><strong>{number(coverageArea.applied)}개</strong><small>판정 완료 {number(coverageArea.decided)}개 중 1건 이상 출원 확인</small></article>
        <article className="coverage-rate-kpi"><span>특산품 출원율</span><strong>{percent(coverageArea.rate)}</strong><small>{number(coverageArea.applied)} ÷ {number(coverageArea.decided)}{coverageArea.pending ? ` · 집계 대기 ${number(coverageArea.pending)}개` : " · 전체 판정 완료"}</small></article>
      </section>
      <section className="coverage-map-card">
        <div className="map-heading"><div><p className="eyebrow">APPLICATION RATE MAP</p><h2>{selectedProvince ? `${selectedProvince} 시군구 출원율` : "전국 시도별 출원율"}</h2></div><div className="coverage-map-actions"><span className="reference-chip">색이 진할수록 출원율이 높음</span>{selectedProvince && <button className="map-back" type="button" onClick={() => { setSelectedProvince(null); setSelectedMunicipality(null); }}>← 전국</button>}</div></div>
        <p className="map-metric-description"><strong>특산품 출원율</strong><span>출원 확인 특산품 수 ÷ 판정 완료 특산품 수 · 집계 대기는 분모에서 제외합니다.</span></p>
        <div className="map-stage coverage-map-stage"><svg className="korea-map map-with-callouts coverage-map" viewBox={calloutViewBox(activeMapViewBox, coverageMapLabels.some((label) => label.connector))} role="img" aria-label={selectedProvince ? `${selectedProvince} 시군구별 특산품 출원율 지도` : "대한민국 시도별 특산품 출원율 지도"}>{municipalityGeometry ? <>
          {municipalityGeometry.items.map((shape) => { const match = snapshot.regions.find((region) => region.sido === selectedProvince && region.sigungu === shape.name); const value = regionMapValue(match, "applicationCoverage"); const active = selectedMunicipality === shape.name; return <path key={`${shape.name}-coverage-shape`} d={shape.d} className={active ? "map-shape selected" : "map-shape"} style={{ fill: fill(value, 1) }} tabIndex={0} role="button" aria-label={`${shape.name} 특산품 출원율 ${mapMetricValueLabel(value, "applicationCoverage")}`} onClick={() => openMunicipality(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openMunicipality(shape.name); }}><title>{shape.name} · 특산품 출원율 {mapMetricValueLabel(value, "applicationCoverage")}</title></path>; })}
        </> : <>
          {geometry.provinces.map((shape) => { const value = mapValue(shape.name, "applicationCoverage"); return <path key={`${shape.name}-coverage-shape`} d={shape.d} className="map-shape" style={{ fill: fill(value, 1) }} tabIndex={0} role="button" aria-label={`${shape.name} 특산품 출원율 ${mapMetricValueLabel(value, "applicationCoverage")}`} onClick={() => openProvince(shape.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProvince(shape.name); }}><title>{shape.name} · 특산품 출원율 {mapMetricValueLabel(value, "applicationCoverage")}</title></path>; })}
        </>}{coverageMapLabels.map((label) => <g className={`map-callout${label.connector ? " with-connector" : ""}`} key={`${label.name}-coverage-label`}>{label.connector && <polyline points={`${label.targetX},${label.targetY} ${label.edgeX},${label.y} ${label.x},${label.y}`} />}<text x={label.x} y={label.y} textAnchor={label.anchor}><tspan>{compactRegionName(label.name)}</tspan><tspan className="map-callout-value"> {label.value}</tspan></text></g>)}</svg></div>
        <div className="coverage-legend" aria-label="출원율 색상 범례"><span>0%</span><i /><span>25%</span><span>50%</span><span>75%</span><span>100%</span><b>회색은 데이터 없음</b></div>
        <p className="map-warning">{selectedProvince ? "라벨은 현재 특산품 데이터가 있는 시군구만 표시합니다. 지역을 선택하면 아래 목록도 함께 좁혀집니다." : "각 시도의 숫자는 시군구별 특산품 항목을 합산한 출원율입니다. 시도를 선택하면 시군구 지도로 전환됩니다."}</p>
      </section>
      <section className="coverage-directory"><div className="section-heading"><div><p className="eyebrow">SPECIALTY DIRECTORY</p><h2>{coverageAreaName} 특산품 목록</h2></div><span>확인 {number(coverageArea.total)}개 · 출원 확인 {number(coverageArea.applied)}개 · 출원율 {percent(coverageArea.rate)}</span></div>
        <div className="coverage-region-grid">{coverageBreakdown.map((row) => <article className={selectedMunicipality && row.label === selectedMunicipality ? "coverage-region-card selected" : "coverage-region-card"} key={row.key}><div className="coverage-region-head"><div><strong>{row.label}</strong><small>특산품 {number(row.coverage.total)}개 · 출원 확인 {number(row.coverage.applied)} / 판정 완료 {number(row.coverage.decided)}{row.coverage.pending ? ` · 대기 ${number(row.coverage.pending)}` : ""}</small></div><b>{percent(row.coverage.rate)}</b>{!selectedProvince && <button type="button" onClick={() => openProvince(row.label)}>지도에서 보기</button>}</div><div className="coverage-specialty-list">{row.items.map(({ region, item, label }) => <button type="button" key={`${regionKey(region)}-${item.specialtyId}`} onClick={() => { chooseRegion(region); setSelectedItemId(item.specialtyId || ""); setTab("regions"); }}><span>{selectedProvince ? label : `${region.sigungu || region.region} / ${label}`}</span><small>{item.metrics.uniqueTrademarkCount.availability === "available" ? (item.metrics.uniqueTrademarkCount.value || 0) > 0 ? `출원 확인 · ${number(item.metrics.uniqueTrademarkCount.value)}건` : "출원 없음 · 판정 완료" : "집계 대기"}</small></button>)}</div></article>)}</div>
      </section>
    </section>}

    {tab === "regions" && <section className="screen-section"><div className="screen-heading"><div><p className="eyebrow">LOCAL GOVERNMENT</p><h1>지자체별 조회</h1></div><p>지역 → 품목 → 근거 지표 순으로 확인합니다.</p></div><section className="workspace" aria-label="지역별 상세 조회"><aside className="region-panel"><div className="panel-heading"><div><p className="eyebrow">REGION INDEX</p><h2>수집 지역</h2></div><span>{filteredRegions.length}건</span></div><label className="search-field"><span className="sr-only">지역 또는 품목 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역 또는 품목 검색" /></label><div className="region-list">{filteredRegions.map((region) => { const count = regionTrademarkValue(region); const coverage = specialtyCoverage([region]); return <button type="button" key={regionKey(region)} className={regionKey(selectedRegion) === regionKey(region) ? "region-button active" : "region-button"} onClick={() => chooseRegion(region)}><span><strong>{region.region}</strong><small>{coverage.total}개 확인 특산품 · 출원율 {percent(coverage.rate)} ({coverage.applied}/{coverage.decided}){coverage.pending ? ` · ${coverage.pending}개 대기` : ""}<br />{count === null ? "지역별 출원 집계 대기" : `주소 일치 출원 ${number(count)}건`}</small></span><span className={`state state-${region.dataState}`}>{STATE_LABELS[region.dataState] || region.dataState}</span></button>; })}{filteredRegions.length === 0 && <p className="empty">검색 결과가 없습니다.</p>}</div></aside><RegionDetail region={selectedRegion} item={selectedItem} onItem={setSelectedItemId} /></section></section>}

    {tab === "items" && <section className="screen-section">
      <div className="screen-heading"><div><p className="eyebrow">ITEM EXPLORER</p><h1>품목별 조회</h1></div><p>품목마다 확인 지역과 상표 현황을 카드 한 장에 요약했습니다.</p></div>
      <div className="item-screen">
        <div className="item-screen-toolbar"><label><span className="sr-only">품목 검색</span><input value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder="품목명 또는 지역명 검색" /></label><span>{itemRows.length > ITEM_ROW_LIMIT ? `상표 출원 건수 상위 ${ITEM_ROW_LIMIT}개 표시 · 전체 ${itemRows.length}개` : `검색 결과 ${itemRows.length}개`}</span></div>
        <div className="item-reading-guide"><strong>수치 구분</strong><span><b>지역 확인 출원</b> 출원인 주소가 해당 지역과 일치</span><span><b>전국 검색</b> 아직 지역 확인 전인 별도 모집단</span></div>
        <div className="item-card-grid">{visibleItemRows.map((row, index) => { const decidedRegions = row.availableRegions.length; const pendingRegions = Math.max(0, row.regions.length - decidedRegions); const nationwideOnly = Math.max(0, row.trademarksDisplay - row.trademarks); return <article className="item-card" key={row.name}>
          <div className="item-card-head"><div><span className="item-rank">{String(index + 1).padStart(2, "0")}</span><h2>{row.name}</h2><small>{row.regions.length}개 지역에서 확인</small></div><span className={pendingRegions === 0 ? "item-status complete" : decidedRegions ? "item-status partial" : "item-status pending"}>{pendingRegions === 0 ? "전체 지역 판정 완료" : decidedRegions ? "일부 지역 판정" : "지역 집계 대기"}</span></div>
          <details className="item-regions-detail"><summary>전체 {row.regions.length}개 지역 보기</summary><div className="region-chips">{row.regions.map((region) => <span key={region}>{region}</span>)}</div></details>
          <div className="item-card-metrics"><div><span>지역 확인 출원</span><strong>{decidedRegions ? `${number(row.trademarks)}건` : "집계 대기"}</strong><small>판정 완료 {decidedRegions}/{row.regions.length}개 지역</small></div><div><span>그중 등록</span><strong>{decidedRegions ? `${number(row.registered)}건` : "—"}</strong><small>확인 출원 중 등록 상태</small></div><div><span>등록률</span><strong>{decidedRegions && row.trademarks ? percent(row.registered / row.trademarks) : decidedRegions ? "계산 불가" : "—"}</strong><small>{decidedRegions && row.trademarks ? `${number(row.registered)} ÷ ${number(row.trademarks)}` : "지역 확인 후 계산"}</small></div></div>
          {nationwideOnly > 0 && <p className="provisional-note">지역 확인 전 전국 검색 후보 {number(nationwideOnly)}건은 위 확정 수치에 포함하지 않았습니다.</p>}
        </article>; })}{itemRows.length === 0 && <p className="empty item-empty">검색 결과가 없습니다.</p>}</div>
        <details className="method-note"><summary>품목명 집계 기준 보기</summary><p>고시명칭·NICE류가 확정된 품목만 공식 명칭으로 묶습니다. 아직 고시명칭이 확정되지 않은 원물명은 지역별 상세 화면에 원문 그대로 보존합니다.</p></details>
      </div>
    </section>}

    {tab === "gaps" && <section className="screen-section">
      <div className="screen-heading"><div><p className="eyebrow">BRAND PROTECTION GAP</p><h1>미출원 특산품</h1></div><p>실제로 존재하는 특산품인데, 그 지역 주소로 낸 상표 출원이 KIPRIS에 한 건도 없는 경우입니다.</p></div>
      <div className="compare-banner"><span>읽는 법</span><strong>검색·주소 판정까지 끝난 것만 표시합니다</strong><p>상표 출원이 없다는 것이지 특산품 자체가 없다는 뜻이 아닙니다 — 생산·판매는 되지만 아직 상표 등록을 안 했을 수 있습니다. 아직 검색·주소 확인이 안 끝난 항목은(집계 대기) 여기 포함하지 않습니다.</p></div>
      <label className="search-field"><span className="sr-only">품목 또는 지역 검색</span><input value={gapQuery} onChange={(event) => setGapQuery(event.target.value)} placeholder="품목명 또는 지역명 검색" /></label>
      <section className="compare-region-section">
        <div className="compare-section-head"><div><span>확인 특산품 기준</span><h2>고시명칭·지정상품까지 확인됐지만 출원 없음</h2></div><p>신뢰도가 가장 높은 목록입니다 — 특산품 분류까지 끝난 항목입니다.</p></div>
        <div className="item-card-grid">{visibleUnfiledConfirmed.map((row) => <article className="item-card" key={row.name}>
          <div className="item-card-head"><div><h2>{row.name}</h2><small>{row.regions.length}개 지역에서 출원 0건</small></div><span className="item-status pending">미출원</span></div>
          <details className="item-regions-detail"><summary>해당 지역 {row.regions.length}개 보기</summary><div className="region-chips">{row.regions.map((region) => <span key={region}>{region}</span>)}</div></details>
        </article>)}{visibleUnfiledConfirmed.length === 0 && <p className="empty item-empty">검색 결과가 없습니다.</p>}</div>
      </section>
      <section className="compare-region-section">
        <div className="compare-section-head"><div><span>검토대기 원물 기준</span><h2>고시명칭 미확정 원물명 검색 결과 출원 없음</h2></div><p>아직 공식 분류 전인 원물명이라 확인 특산품보다 신뢰도가 낮습니다 — 참고용입니다.</p></div>
        <details className="method-note"><summary>{visibleUnfiledRaw.length}개 보기</summary><div className="item-card-grid">{visibleUnfiledRaw.map((row) => <article className="item-card" key={row.name}>
          <div className="item-card-head"><div><h2>{row.name}</h2><small>{row.regions.length}개 지역에서 출원 0건</small></div><span className="item-status pending">미출원(검토대기)</span></div>
          <details className="item-regions-detail"><summary>해당 지역 {row.regions.length}개 보기</summary><div className="region-chips">{row.regions.map((region) => <span key={region}>{region}</span>)}</div></details>
        </article>)}{visibleUnfiledRaw.length === 0 && <p className="empty item-empty">검색 결과가 없습니다.</p>}</div></details>
      </section>
    </section>}

    {tab === "compare" && <section className="screen-section">
      <div className="screen-heading"><div><p className="eyebrow">SPECIALIZED CROP MATCH</p><h1>특화작목 비교</h1></div><p>지금 비교할 수 있는 데이터와 아직 필요한 데이터를 먼저 구분했습니다.</p></div>
      <div className="compare-banner"><span>현재 단계</span><strong>비교 기준 원본 확보 전 · 준비 현황만 확인 가능</strong><p>정책 지정 특화작목 목록이 아직 없어 일치율은 계산하지 않습니다. 현재 지역 특산품과 출원 현황은 아래에서 먼저 확인할 수 있습니다.</p></div>
      <div className="compare-readiness" aria-label="특화작목 비교 준비 단계"><article className="ready"><span>01 · 현재 보유</span><strong>지역 특산품·상표 현황</strong><p>지역별 확인 특산품 수, 출원 판정 수와 출원율</p></article><i>→</i><article className="waiting"><span>02 · 추가 필요</span><strong>정책 지정 특화작목 원본</strong><p>지정 지역·작목·기간·근거 문서</p></article><i>→</i><article><span>03 · 원본 확보 후</span><strong>일치·누락 비교</strong><p>정책 작목 대비 상표 활동과 미출원 품목</p></article></div>
      <section className="compare-region-section"><div className="compare-section-head"><div><span>현재 확인 가능</span><h2>지역별 특산품 출원 현황</h2></div><p>정책 비교 결과가 아니라, 비교에 투입될 현재 데이터입니다.</p></div><div className="compare-region-table"><div className="compare-region-head"><span>지역</span><span>전체 확인 특산품</span><span>판정 완료분 출원율</span><span>정책 비교</span></div>{comparisonRows.map(({ province, coverage, names }) => <div className="compare-region-row" key={province}><strong>{province}</strong><div><b>{number(coverage.total)}개</b></div><div><b>{percent(coverage.rate)}</b><small>출원 확인 {coverage.applied}개 / 판정 완료 {coverage.decided}개{coverage.pending ? ` · 전체 중 ${coverage.pending}개 대기` : ""}</small></div><span className="compare-waiting">원본 대기</span><details className="compare-items-detail"><summary>확인된 특산품 {number(names.length)}개 보기</summary><div className="compare-item-chips">{names.map((name) => <span key={name}>{name}</span>)}</div></details></div>)}</div></section>
      <div className="compare-sources"><article><span>필수 입력</span><strong>농촌진흥청 지역특화작목 지정 목록</strong><p>지역·작목·계획 기간·근거 버전을 구조화해야 합니다.</p></article><article><span>처리 원칙</span><strong>원본 확보 후 자동 비교</strong><p>명칭 정규화 후보만 개별 검토하고 집계·일치 판정은 자동화합니다.</p></article></div>
    </section>}

    {tab === "data" && pipeline && <section className="screen-section data-overview">
      <section className="criteria" aria-label="판정 기준과 매칭 방법">
        <div className="section-heading">
          <div><p className="eyebrow">HOW THIS IS BUILT</p><h2>판정 기준과 매칭 방법</h2></div>
          <span>현재 출처 {sourceLine}</span>
        </div>
        <div className="criteria-grid">
          <article><span>대표 특산품 판정</span><strong>GI 출처 또는 상표 출원 3건 이상</strong><small>GI 미등록이어도 출원 활동이 활발하면 대표로 인정(OR 조건)</small></article>
          <article><span>품목 매칭</span><strong>고시명칭 일치·포함</strong><small>지정상품명이 고시상품명칭과 일치하거나 포함되면 특산품 활용 출원으로 인정하고, NICE류만 일치하면 개별 검토로 분리합니다.</small></article>
          <article><span>지역 매칭</span><strong>법정동코드 완전일치</strong><small>국토교통부 전국 법정동 코드(2026-07-03). 시/군/구 접미사 복원은 후보가 유일할 때만</small></article>
          <article><span>상표 검색</span><strong>KIPRIS 단어검색(고시명칭 기준)</strong><small>검색·집계 키는 고시명칭 + NICE류이며, 상표명은 개별 사례로만 보존하고 집계 키로 쓰지 않음</small></article>
          <article><span>지역 주소 일치 출원 / 그중 등록</span><strong>출원인 주소가 해당 지역으로 확인된 출원만</strong><small>등록 비율은 그중 등록 상태 건수 ÷ 지역 주소 일치 출원 건수입니다. 전국 검색 후보와 주소 미확보 건은 제외합니다.</small></article>
          <article><span>출원인 지역 매칭</span><strong>주소 확보율은 참고 지표</strong><small>주소가 확인된 건은 지역 귀속에 반영하고, 미확보 건도 원자료와 확보율을 함께 표시합니다. 부분 수집은 별도 상태로 구분합니다.</small></article>
        </div>
      </section>
      <div className="screen-heading"><div><p className="eyebrow">DATA JOURNEY</p><h1>특산물과 상표가<br />데이터가 되기까지</h1></div><p>수집한 특산물을 표준화하고 상표·출원인 주소와 연결해 지역별 지표로 만드는 전 과정을 보여줍니다.</p></div>
      <div className="data-flow" aria-label="데이터 처리 흐름"><article><span>01 · 수집 입력</span><strong>{number(pipeline.rowCounts.total)}</strong><small>지역×특산물 원본 행</small></article><i>→</i><article><span>02 · 표준화 완료</span><strong>{number(snapshot.coverage.regionItemCount)}</strong><small>정제된 지역×품목</small></article><i>→</i><article><span>03 · 고유 검색어</span><strong>{number(pipeline.uniqueQueryCounts.total)}</strong><small>고시명칭 + NICE류</small></article><i>→</i><article><span>04 · 상표 매칭</span><strong>{number(pipeline.nationwideCandidates.uniqueTrademarkCount)}</strong><small>출원번호 기준 전국 고유 후보</small></article><i>→</i><article className="flow-highlight"><span>05 · 지역별 집계</span><strong>{number(pipeline.regionalMetricGate.availableRegionItemCount)}</strong><small>지역 출원 수 표시 가능 항목</small></article></div>
      <div className="data-summary-grid"><article className="data-summary-card"><p className="eyebrow">SPECIALTY DATA</p><h2>특산물 데이터</h2><div className="data-stat"><strong>{number(uniqueSpecialtyCount)}개</strong><span>고유 특산품명</span></div><div className="data-stat"><strong>{number(snapshot.coverage.regionItemCount)}개</strong><span>지역×품목 조합</span></div><div className="data-stat"><strong>{number(snapshot.coverage.observedRegionCount)}개</strong><span>관측 지역</span></div><p className="data-card-note">같은 특산물도 지역이 다르면 별도 관측 단위로 관리합니다.</p></article><article className="data-summary-card"><p className="eyebrow">TRADEMARK MATCH</p><h2>상표 매칭 결과</h2><div className="match-bars"><div><span>특산품 출원율 <b>{percent(nationalSpecialtyCoverage.rate)}</b></span><em><i style={{ width: `${Math.round((nationalSpecialtyCoverage.rate || 0) * 100)}%` }} /></em><small>출원 확인 {number(nationalSpecialtyCoverage.applied)} / 판정 완료 {number(nationalSpecialtyCoverage.decided)}</small></div><div><span>고유 상표 주소 확보 <b>{number(pipeline.applicantRegionVerification.verifiedCount)}건</b></span><em><i style={{ width: `${Math.round((pipeline.applicantRegionVerification.rate || 0) * 100)}%` }} /></em><small>전국 고유 후보 중 {percent(pipeline.applicantRegionVerification.rate)}</small></div><div><span>지역별 출원 수 표시 가능 <b>{number(pipeline.regionalMetricGate.availableRegionItemCount)}개</b></span><em><i style={{ width: `${Math.round(pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal) * 100)}%` }} /></em><small>전체 {number(gateTotal)}개 지역×품목 중 {percent(pipeline.regionalMetricGate.availableRegionItemCount / Math.max(1, gateTotal))}</small></div></div><p className="match-explanation">특산품 출원율은 고시명칭·NICE류가 확인되고 지역별 출원 판정까지 끝난 특산품 중, 지역 주소 일치 출원이 1건 이상 있는 비율입니다. 확인 특산품 전체 {number(nationalSpecialtyCoverage.total)}개 중 {number(nationalSpecialtyCoverage.pending)}개는 집계 대기이므로 현재 출원율 분모에서 제외했습니다.</p></article></div>
      <div className="data-reading-note"><strong>숫자를 읽는 법</strong><p><b>특산품 출원율 = 출원 확인 특산품 수 ÷ 판정 완료 특산품 수</b>입니다. 전체 특산품 수와 집계 대기 수를 함께 봐야 합니다. <b>{number(pipeline.nationwideCandidates.uniqueTrademarkCount)}건</b>은 출원번호 중복을 제거한 전국 검색 후보이며, 등록 비율은 지역 주소 일치 출원 중 등록 상태인 건의 비율로 별도 계산합니다. 검색이 부분 수집 상태인 품목은 0건으로 보지 않고 <b>지역별 집계 대기</b>로 표시합니다.</p></div>
    </section>}

    <section className="provenance"><div className="section-heading"><div><p className="eyebrow">TRACEABLE BY DESIGN</p><h2>출처와 데이터 상태</h2></div><span>{snapshot.schemaVersion}</span></div><div className="source-grid">{snapshot.sources.filter((source) => source.sourceUrl).map((source) => <a href={source.sourceUrl || "#"} target="_blank" rel="noreferrer" key={source.sourceId}><span>{source.sourceLabel || source.sourceId}</span><strong>{source.sourceContractVersion || "버전 미기록"}</strong><small>검증 {source.sourceLastVerifiedAt || date(source.sourceFetchedAt)}</small></a>)}<a href={geometry.boundaryReference.sourceUrl} target="_blank" rel="noreferrer"><span>지도 경계</span><strong>{geometry.boundaryReference.sourceName}</strong><small>{geometry.boundaryReference.sourceBasis} · 참고용</small></a></div><details><summary>현재 해석 주의사항 {snapshot.warnings.length}건 보기</summary><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details></section>
    <footer><span>Snapshot {snapshot.snapshotId}</span><span>수치·판정·지도 경계는 출처와 버전을 함께 표시합니다.</span><span>알파 테스트 · 데이터 검토 중</span></footer>
  </main>;
}

function RegionDetail({ region, item, onItem }: { region: Region; item: Item | undefined; onItem: (id: string) => void }) {
  const official = officialRegionItems(region);
  const heading = <div className="detail-heading"><div><p className="eyebrow">REGION DETAIL</p><h2>{region.region}</h2><p>법정동코드 {region.regionCode || "미확정"}</p></div><span className={`state state-${region.dataState}`}>{STATE_LABELS[region.dataState] || region.dataState}</span></div>;
  if (!item) {
    return <div className="detail-panel">
      {heading}
      <div className="item-tabs" role="tablist" aria-label={`${region.region} 특산품`} />
      <p className="empty">고시명칭·NICE류가 확인된 특산품이 없습니다 · 검토대기 원물명·상호 {region.items.length}개</p>
    </div>;
  }
  const examples = item.trademarkExamples || [];
  const regionalAvailable = item.metrics.uniqueTrademarkCount.availability === "available";
  const localCount = item.metrics.uniqueTrademarkCount.value || 0;
  const pendingReason = regionalMetricPendingReason(item);
  return <div className="detail-panel">
    {heading}
    <div className="item-tabs" role="tablist" aria-label={`${region.region} 특산품`}>{official.map((row) => <button type="button" role="tab" aria-selected={item.specialtyId === row.specialtyId} key={row.specialtyId || row.itemName} onClick={() => onItem(row.specialtyId || "")}>{itemName(row)}</button>)}</div>
    <div className="item-title"><div><span>이 지역의 대표 특산품</span><h3>{itemName(item)}</h3><small>{noticeBasis(item)}</small></div><span className="class-chip">{item.niceClass ? `NICE ${item.niceClass}` : "NICE 분류 미확정"}</span>{item.itemVerdict?.source === "algorithm" && <span className="verdict-chip" title={verdictTitle(item.itemVerdict)}>AI 판정</span>}</div>
    <div className="metric-reading-note"><strong>아래 수치의 기준</strong><p>전국 검색 결과 전체가 아니라, 출원인 주소가 <b>{region.region}</b>으로 확인된 출원을 지역 수치로 셉니다.</p></div>
    <div className="detail-grid">
      <article><span>{itemName(item)} · 지역 주소 일치 출원</span><strong>{regionalAvailable ? `${number(localCount)}건` : "지역별 집계 대기"}</strong><small>{regionalAvailable ? `출원인 주소가 ${region.region}으로 확인된 고유 출원` : `전국 검색 후보 ${number(item.metrics.nationwideSearchTrademarkCount?.value)}건 · ${pendingReason}`}</small></article>
      <article><span>주소 확인 후보 중 이 지역 비율</span><strong>{regionalAvailable ? item.metrics.localApplicantShare.value === null ? "계산 불가" : percent(item.metrics.localApplicantShare.value) : "지역별 집계 대기"}</strong><small>{regionalAvailable ? "주소를 판정할 수 있었던 전국 검색 후보 중 이 지역 주소와 일치한 비율 · 주소 미확보 후보 제외" : pendingReason}</small></article>
      <article><span>이 특산품의 출원 판정</span><strong>{regionalAvailable ? localCount > 0 ? "출원 확인" : "출원 없음" : "집계 대기"}</strong><small>{regionalAvailable ? localCount > 0 ? `특산품 출원율 계산에서 출원 확인 1개로 집계` : "판정은 완료됐으며 특산품 출원율의 분모에만 포함" : "판정 전이므로 특산품 출원율의 분모에서 제외"}</small></article>
    </div>
    <div className="review-strip"><div><span>지정상품 자동 일치</span><strong>{number(item.metrics.confirmedGoodsMatchCount.value)}건</strong></div><div><span>지정상품 개별 검토</span><strong>{number(item.metrics.goodsReviewCandidateCount.value)}건</strong></div><p>상표명은 사례로 보존하고, 대표 특산품 집계 키와 분리합니다.</p></div>
    <section className="trademark-examples"><div className="example-heading"><strong>전국 검색 상표 사례</strong><span>지역 귀속 전 검색 후보 · 최근 출원 + 지정상품 근거 우선 · 최대 {examples.length || 0}건</span></div>{examples.length ? <div className="example-list">{examples.map((example, index) => <article key={example.applicationNumber || `${example.title}-${index}`}><div><strong>{example.title || "상표명 미기록"}</strong><small>{example.applicationNumber || "출원번호 미기록"} · {example.applicationDate || "출원일 미기록"} · {example.applicationStatus || "상태 미기록"}</small></div><span className={example.goodsReviewRequired ? "goods-chip review" : "goods-chip"}>{goodsMethod(example.goodsMatchMethod)}</span>{example.goodsEvidence.length > 0 && <p>지정상품: {example.goodsEvidence.map((row) => `${row.designatedProductName || "명칭 미기록"}${row.classCode ? ` (${row.classCode}류)` : ""}`).join(", ")}</p>}</article>)}</div> : <p className="empty">현재 스냅샷에는 개별 상표명이 포함되지 않았습니다.</p>}</section>
  </div>;
}
