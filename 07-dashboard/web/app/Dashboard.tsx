"use client";

import { useMemo, useState } from "react";

type Metric = {
  value: number | null;
  availability: "available" | "preview" | "blocked";
  status: string;
  rationale?: string | null;
  blockingIssue?: string | null;
};

type Item = {
  specialtyId: string | null;
  itemName: string | null;
  noticeName: string | null;
  niceClass: string | null;
  dataState: string;
  metrics: {
    uniqueTrademarkCount: Metric;
    registeredTrademarkCount: Metric;
    registrationRate: Metric;
    localApplicantShare: Metric;
    confirmedGoodsMatchCount: Metric;
    goodsReviewCandidateCount: Metric;
    gapScore: Metric;
  };
};

type Region = {
  regionCode: string | null;
  regionCodeStatus: string;
  region: string;
  sido: string | null;
  sigungu: string | null;
  dataState: string;
  items: Item[];
};

type Source = {
  sourceId: string;
  sourceLabel: string | null;
  sourceContractVersion: string | null;
  sourceFetchedAt: string | null;
  sourceUrl: string | null;
  sourceLastVerifiedAt: string | null;
};

type Snapshot = {
  schemaVersion: string;
  snapshotId: string;
  mode: "sample" | "full";
  generatedAt: string;
  coverage: {
    targetRegionCount: number | null;
    observedRegionCount: number;
    regionItemCount: number;
    completeQueryCount: number;
    partialQueryCount: number;
    errorQueryCount: number;
  };
  regions: Region[];
  sources: Source[];
  warnings: string[];
};

const STATE_LABELS: Record<string, string> = {
  complete_nonzero: "수집 완료",
  complete_zero: "결과 0건",
  partial: "부분 수집",
  error: "오류",
  skipped: "건너뜀",
  not_collected: "미수집",
};

// 레퍼런스(local-k-tm.pages.dev)의 4탭(요약/지자체별/품목별/특화작목비교) 중 우리 데이터로
// 지금 채울 수 있는 3개만 둔다. 특화작목 비교는 별도 공식 데이터 확보가 필요해(#42 잔여 범위)
// 탭 자체를 만들지 않는다 — 없는 데이터를 흉내내지 않는다.
const TABS = [
  { key: "summary", label: "요약" },
  { key: "region", label: "지자체별 조회" },
  { key: "item", label: "품목별 조회" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const RANKING_LIMITS = [10, 50] as const;

function number(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString("ko-KR") : "—";
}

function percent(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function date(value: string | null | undefined) {
  if (!value) return "미기록";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function issueUrl(issue: string | null | undefined) {
  const match = issue?.match(/^#(\d+)$/);
  return match ? `https://github.com/omelette-archive/KIIP/issues/${match[1]}` : null;
}

type Entry = { region: Region; item: Item };

function flattenEntries(regions: Region[]): Entry[] {
  return regions.flatMap((region) => region.items.map((item) => ({ region, item })));
}

// 레퍼런스의 "등록상표 랭킹 TOP 10/50"에 해당. 다만 레퍼런스는 품목 단위 전국 집계인 반면,
// 우리는 아직 품목을 지역 간에 재집계하는 로직이 없어(대표 출원지역 TOP3 등, 별도 범위) 지역×품목
// 행 단위로 랭킹을 매긴다 — 있는 그대로의 데이터 granularity를 정직하게 보여준다.
function rankingEntries(regions: Region[]) {
  return flattenEntries(regions)
    .slice()
    .sort((a, b) => {
      const registeredDiff =
        (b.item.metrics.registeredTrademarkCount.value ?? -1) -
        (a.item.metrics.registeredTrademarkCount.value ?? -1);
      if (registeredDiff !== 0) return registeredDiff;
      const uniqueDiff =
        (b.item.metrics.uniqueTrademarkCount.value ?? -1) - (a.item.metrics.uniqueTrademarkCount.value ?? -1);
      if (uniqueDiff !== 0) return uniqueDiff;
      return a.region.region.localeCompare(b.region.region, "ko");
    });
}

// "품목별 조회" 탭용 — 이미 받아온 snapshot을 클라이언트에서 품목명 기준으로 다시 묶을 뿐,
// 서버·파이프라인에 새 집계 로직을 추가하지 않는다(#42 진행 범위 결정에 따름).
function groupByItemName(regions: Region[]) {
  const groups = new Map<string, Entry[]>();
  for (const entry of flattenEntries(regions)) {
    const key = entry.item.noticeName || entry.item.itemName || "미지정 품목";
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export default function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [rankingLimit, setRankingLimit] = useState<(typeof RANKING_LIMITS)[number]>(10);
  const [query, setQuery] = useState("");
  const [selectedRegionCode, setSelectedRegionCode] = useState(
    snapshot.regions.find((region) => region.regionCode)?.regionCode || "",
  );
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [selectedItemName, setSelectedItemName] = useState("");

  const filteredRegions = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return snapshot.regions;
    return snapshot.regions.filter(
      (region) =>
        region.region.toLocaleLowerCase("ko-KR").includes(keyword) ||
        region.items.some((item) =>
          (item.noticeName || item.itemName || "").toLocaleLowerCase("ko-KR").includes(keyword),
        ),
    );
  }, [query, snapshot.regions]);

  const selectedRegion =
    snapshot.regions.find((region) => region.regionCode === selectedRegionCode) ||
    filteredRegions[0] ||
    snapshot.regions[0];
  const selectedItem =
    selectedRegion?.items.find((item) => item.specialtyId === selectedItemId) ||
    selectedRegion?.items[0];

  const totals = useMemo(
    () =>
      snapshot.regions.reduce(
        (acc, region) => {
          for (const item of region.items) {
            acc.trademarks += item.metrics.uniqueTrademarkCount.value || 0;
            acc.registered += item.metrics.registeredTrademarkCount.value || 0;
            acc.review += item.metrics.goodsReviewCandidateCount.value || 0;
          }
          return acc;
        },
        { trademarks: 0, registered: 0, review: 0 },
      ),
    [snapshot.regions],
  );

  function chooseRegion(region: Region) {
    setSelectedRegionCode(region.regionCode || region.region);
    setSelectedItemId(region.items[0]?.specialtyId || "");
  }

  const ranking = useMemo(() => rankingEntries(snapshot.regions), [snapshot.regions]);
  const itemGroups = useMemo(() => groupByItemName(snapshot.regions), [snapshot.regions]);
  const filteredItemGroups = useMemo(() => {
    const keyword = itemQuery.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return itemGroups;
    return itemGroups.filter((group) => group.name.toLocaleLowerCase("ko-KR").includes(keyword));
  }, [itemQuery, itemGroups]);
  const selectedItemGroup =
    itemGroups.find((group) => group.name === selectedItemName) || filteredItemGroups[0] || itemGroups[0];

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="지역 브랜드 인사이트 홈">
          <span className="brand-mark">K</span>
          <span>
            <strong>지역 브랜드 인사이트</strong>
            <small>특산품 × 상표 근거 대시보드</small>
          </span>
        </a>
        <div className="snapshot-meta">
          <span className="sample-badge">{snapshot.mode === "sample" ? "샘플 데이터" : "전체 데이터"}</span>
          <span>마지막 생성 {date(snapshot.generatedAt)}</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">LOCAL BRAND OBSERVATORY</p>
          <h1>지역의 특산품과 상표 활용 현황을<br />근거부터 살펴봅니다.</h1>
          <p className="hero-copy">
            수집된 숫자만 보여주지 않습니다. 완료·부분·미검증 상태와 공식 출처를 함께 제공해
            지금 판단 가능한 범위를 분명하게 구분합니다.
          </p>
        </div>
        <div className="hero-note">
          <span>현재 범위</span>
          <strong>{snapshot.coverage.observedRegionCount}개 지역 · {snapshot.coverage.regionItemCount}개 품목</strong>
          <p>소규모 E2E 검증 자료입니다. 전국 통계로 해석하지 않습니다.</p>
        </div>
      </section>

      <div className="tab-nav" role="tablist" aria-label="대시보드 보기 전환">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.key}
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && (
        <>
          <section className="metrics" aria-label="핵심 지표">
            <article>
              <span>고유 상표</span>
              <strong>{number(totals.trademarks)}</strong>
              <small>저장 hit, 출원번호 우선 중복 제거</small>
            </article>
            <article>
              <span>등록 상표</span>
              <strong>{number(totals.registered)}</strong>
              <small>등록 상태로 확인된 표본</small>
            </article>
            <article>
              <span>지정상품 검토 후보</span>
              <strong>{number(totals.review)}</strong>
              <small>#12 확정 전 자동 제외하지 않음</small>
            </article>
            <article>
              <span>수집 상태</span>
              <strong>{snapshot.coverage.partialQueryCount > 0 ? "부분" : "완료"}</strong>
              <small>완료 {snapshot.coverage.completeQueryCount} · 부분 {snapshot.coverage.partialQueryCount}</small>
            </article>
          </section>

          <section className="ranking" aria-label="등록상표 랭킹">
            <div className="section-heading">
              <div>
                <p className="eyebrow">TRADEMARK RANKING</p>
                <h2>지역×품목 등록상표 랭킹</h2>
              </div>
              <div className="ranking-toggle" role="group" aria-label="랭킹 표시 건수">
                {RANKING_LIMITS.map((limit) => (
                  <button
                    type="button"
                    key={limit}
                    className={rankingLimit === limit ? "active" : ""}
                    onClick={() => setRankingLimit(limit)}
                  >
                    TOP {limit}
                  </button>
                ))}
              </div>
            </div>
            <p className="ranking-note">
              품목명이 같아도 지역이 다르면 별도 행으로 표시합니다. 전국 품목 단위 집계(대표
              출원지역 TOP3, 지리적표시 현황 등)는 아직 준비 중입니다.
            </p>
            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>지역</th>
                    <th>품목</th>
                    <th>NICE류</th>
                    <th>등록상표</th>
                    <th>고유상표</th>
                    <th>수집상태</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.slice(0, rankingLimit).map((entry, index) => (
                    <tr key={`${entry.region.regionCode || entry.region.region}-${entry.item.specialtyId || index}`}>
                      <td>{index + 1}</td>
                      <td>{entry.region.region}</td>
                      <td>{entry.item.noticeName || entry.item.itemName || "미지정 품목"}</td>
                      <td>{entry.item.niceClass || "미확정"}</td>
                      <td>{number(entry.item.metrics.registeredTrademarkCount.value)}</td>
                      <td>{number(entry.item.metrics.uniqueTrademarkCount.value)}</td>
                      <td>
                        <span className={`state state-${entry.item.dataState}`}>
                          {STATE_LABELS[entry.item.dataState] || entry.item.dataState}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {ranking.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty">
                        랭킹에 표시할 데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeTab === "region" && (
        <section className="workspace" aria-label="지역별 상세 조회">
          <aside className="region-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">REGION INDEX</p>
                <h2>지역별 조회</h2>
              </div>
              <span>{filteredRegions.length}건</span>
            </div>
            <label className="search-field">
              <span className="sr-only">지역 또는 품목 검색</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="지역 또는 품목 검색"
              />
            </label>
            <div className="region-list">
              {filteredRegions.map((region) => {
                const active = selectedRegion?.regionCode === region.regionCode;
                const count = region.items.reduce(
                  (sum, item) => sum + (item.metrics.uniqueTrademarkCount.value || 0),
                  0,
                );
                return (
                  <button
                    type="button"
                    key={region.regionCode || region.region}
                    className={active ? "region-button active" : "region-button"}
                    onClick={() => chooseRegion(region)}
                  >
                    <span>
                      <strong>{region.region}</strong>
                      <small>{region.items.length}개 품목 · 상표 {number(count)}건</small>
                    </span>
                    <span className={`state state-${region.dataState}`}>
                      {STATE_LABELS[region.dataState] || region.dataState}
                    </span>
                  </button>
                );
              })}
              {filteredRegions.length === 0 && <p className="empty">검색 결과가 없습니다.</p>}
            </div>
          </aside>

          <div className="detail-panel">
            {selectedRegion && selectedItem ? (
              <>
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">REGION DETAIL</p>
                    <h2>{selectedRegion.region}</h2>
                    <p>법정동코드 {selectedRegion.regionCode || "미확정"}</p>
                  </div>
                  <span className={`state state-${selectedRegion.dataState}`}>
                    {STATE_LABELS[selectedRegion.dataState] || selectedRegion.dataState}
                  </span>
                </div>

                <div className="item-tabs" role="tablist" aria-label={`${selectedRegion.region} 품목`}>
                  {selectedRegion.items.map((item) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selectedItem.specialtyId === item.specialtyId}
                      key={item.specialtyId || item.itemName}
                      onClick={() => setSelectedItemId(item.specialtyId || "")}
                    >
                      {item.noticeName || item.itemName || "미지정 품목"}
                    </button>
                  ))}
                </div>

                <div className="item-title">
                  <div>
                    <span>선택 품목</span>
                    <h3>{selectedItem.noticeName || selectedItem.itemName || "미지정 품목"}</h3>
                  </div>
                  <span className="class-chip">NICE {selectedItem.niceClass || "미확정"}</span>
                </div>

                <div className="detail-grid">
                  <article>
                    <span>고유 상표</span>
                    <strong>{number(selectedItem.metrics.uniqueTrademarkCount.value)}건</strong>
                    <small>{selectedItem.metrics.uniqueTrademarkCount.rationale}</small>
                  </article>
                  <article>
                    <span>등록 상표</span>
                    <strong>{number(selectedItem.metrics.registeredTrademarkCount.value)}건</strong>
                    <small>등록률 {percent(selectedItem.metrics.registrationRate.value)}</small>
                  </article>
                  <article>
                    <span>지역 출원인 비중</span>
                    <strong>{percent(selectedItem.metrics.localApplicantShare.value)}</strong>
                    <small>{selectedItem.metrics.localApplicantShare.availability === "blocked" ? "주소 검증률 부족" : "등록원부 주소 근거"}</small>
                  </article>
                  <article>
                    <span>브랜드 공백 점수</span>
                    <strong>{selectedItem.metrics.gapScore.value ?? "검토 중"}</strong>
                    <small>#29 건수 기준 반영 전 preview</small>
                  </article>
                </div>

                <div className="review-strip">
                  <div>
                    <span>자동 확정</span>
                    <strong>{number(selectedItem.metrics.confirmedGoodsMatchCount.value)}건</strong>
                  </div>
                  <div>
                    <span>사람 검토 필요</span>
                    <strong>{number(selectedItem.metrics.goodsReviewCandidateCount.value)}건</strong>
                  </div>
                  <p>확실한 항목은 자동 처리하고, 지정상품 후보처럼 눈으로 볼 항목만 검토 큐에 남깁니다.</p>
                </div>

                <div className="blocking-list">
                  {[selectedItem.metrics.localApplicantShare, selectedItem.metrics.gapScore]
                    .filter((metric) => metric.availability === "blocked" && metric.blockingIssue)
                    .map((metric) => {
                      const href = issueUrl(metric.blockingIssue);
                      return href ? (
                        <a href={href} target="_blank" rel="noreferrer" key={metric.blockingIssue}>
                          {metric.blockingIssue} 기준 확인 →
                        </a>
                      ) : null;
                    })}
                </div>
              </>
            ) : (
              <p className="empty">표시할 지역 데이터가 없습니다.</p>
            )}
          </div>
        </section>
      )}

      {activeTab === "item" && (
        <section className="workspace" aria-label="품목별 상세 조회">
          <aside className="region-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ITEM INDEX</p>
                <h2>품목별 조회</h2>
              </div>
              <span>{filteredItemGroups.length}건</span>
            </div>
            <label className="search-field">
              <span className="sr-only">품목 검색</span>
              <input
                type="search"
                value={itemQuery}
                onChange={(event) => setItemQuery(event.target.value)}
                placeholder="품목 검색"
              />
            </label>
            <div className="region-list">
              {filteredItemGroups.map((group) => {
                const active = selectedItemGroup?.name === group.name;
                const registeredTotal = group.entries.reduce(
                  (sum, entry) => sum + (entry.item.metrics.registeredTrademarkCount.value || 0),
                  0,
                );
                return (
                  <button
                    type="button"
                    key={group.name}
                    className={active ? "region-button active" : "region-button"}
                    onClick={() => setSelectedItemName(group.name)}
                  >
                    <span>
                      <strong>{group.name}</strong>
                      <small>{group.entries.length}개 지역 · 등록 {number(registeredTotal)}건</small>
                    </span>
                  </button>
                );
              })}
              {filteredItemGroups.length === 0 && <p className="empty">검색 결과가 없습니다.</p>}
            </div>
          </aside>

          <div className="detail-panel">
            {selectedItemGroup ? (
              <>
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">ITEM DETAIL</p>
                    <h2>{selectedItemGroup.name}</h2>
                    <p>{selectedItemGroup.entries.length}개 지역에서 확인됨</p>
                  </div>
                </div>
                <div className="ranking-table-wrap">
                  <table className="ranking-table">
                    <thead>
                      <tr>
                        <th>지역</th>
                        <th>NICE류</th>
                        <th>등록상표</th>
                        <th>고유상표</th>
                        <th>등록률</th>
                        <th>수집상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItemGroup.entries.map((entry) => (
                        <tr key={entry.region.regionCode || entry.region.region}>
                          <td>{entry.region.region}</td>
                          <td>{entry.item.niceClass || "미확정"}</td>
                          <td>{number(entry.item.metrics.registeredTrademarkCount.value)}</td>
                          <td>{number(entry.item.metrics.uniqueTrademarkCount.value)}</td>
                          <td>{percent(entry.item.metrics.registrationRate.value)}</td>
                          <td>
                            <span className={`state state-${entry.item.dataState}`}>
                              {STATE_LABELS[entry.item.dataState] || entry.item.dataState}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="empty">표시할 품목 데이터가 없습니다.</p>
            )}
          </div>
        </section>
      )}

      <section className="provenance">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TRACEABLE BY DESIGN</p>
            <h2>출처와 데이터 상태</h2>
          </div>
          <span>{snapshot.schemaVersion}</span>
        </div>
        <div className="source-grid">
          {snapshot.sources
            .filter((source) => source.sourceUrl)
            .map((source) => (
              <a href={source.sourceUrl || "#"} target="_blank" rel="noreferrer" key={source.sourceId}>
                <span>{source.sourceLabel || source.sourceId}</span>
                <strong>{source.sourceContractVersion || "버전 미기록"}</strong>
                <small>검증 {source.sourceLastVerifiedAt || date(source.sourceFetchedAt)}</small>
              </a>
            ))}
        </div>
        <details>
          <summary>현재 해석 주의사항 {snapshot.warnings.length}건 보기</summary>
          <ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      </section>

      <footer>
        <span>Snapshot {snapshot.snapshotId}</span>
        <span>수치·판정 기준은 버전과 함께 갱신됩니다.</span>
      </footer>
    </main>
  );
}
