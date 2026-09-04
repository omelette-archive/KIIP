"use strict";

/**
 * #70(2026-09-04): 공개 대시보드 스냅샷이 "이전 ∪ 신규(플러스 알파)"가 되도록 강제한다.
 *
 * 배경: 검색 체크포인트 자체는 누적(complete 쿼리 재사용, 절대 삭제 안 함)이지만
 * (a) --out-max-hits가 대시보드 입력을 slice하고 (b) KIPRIS 재랭킹으로 경계 근처 hit이
 * 밀리고 (c) 일시적 미응답 출처가 이번 실행에서 빠질 수 있다. 이 셋은 전부 "저번엔
 * 있었는데 이번엔 없다"를 만든다 — 삭제가 아니라 일시 누락인데도.
 *
 * 규칙:
 * - 지역×품목 키가 이전·신규에 다 있으면: 지역 상표 수치(uniqueTrademarkCount 등)와
 *   연도별 집계는 max/union으로 유지한다(last-known-good, 절대 감소 금지).
 * - 키가 이전엔 있고 신규엔 없으면: 이전 항목을 그대로 되살리고 presence를 남긴다.
 * - 단, tombstone(권리 소멸·공식 삭제·확인된 정책 변경)이 있는 키는 제거를 허용한다.
 * - 설명 없는 removed가 하나라도 있으면 배포 차단(호출자가 exit code로 판단).
 *
 * 원자료 archive(검색 체크포인트·SQLite 이력)는 그대로 두고, 이 함수는 파생 뷰(스냅샷)만
 * 보정한다.
 */

const UNIT_SEP = String.fromCharCode(31);

function clean(value) {
  return String(value ?? "").normalize("NFC").trim();
}

/** 품목명 정규화: 괄호 부기 제거·공백 정리. 2026-09-04 검색어 정제(#70)로 품목명이
 * "토마토(완숙토마토)" → "토마토"로 바뀌어도 같은 항목으로 대조되게 한다. */
function normalizeItemName(value) {
  return clean(value)
    .replace(/\s*[（(][^）)]*[）)]/g, "")
    .replace(/\s*[（(\[].*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 지역×품목 canonical 키. sido·sigungu·품목명(괄호 정규화).
 * - niceClass는 키에 안 넣는다: 품목이 미분류→고시명칭 매칭으로 승격되면 niceClass가
 *   null→"31"로 바뀌는데 그건 같은 항목의 개선이지 삭제가 아니다.
 * - "전국" 카탈로그(NFQS 인증품·주산지 근거 없는 KOFPI)는 지역이 없는 게 본질이라
 *   sigungu 라벨 변형("지역 미제공"/"지역 검토대기")과 무관하게 품목명으로만 대조한다. */
function regionItemKey(region, item) {
  const sido = clean(region.sido || region.region);
  const isNationwide = sido === "전국" || /^전국\b/.test(clean(region.region));
  return [
    isNationwide ? "전국" : sido,
    isNationwide ? "" : clean(region.sigungu),
    normalizeItemName(item.itemName || item.noticeName),
  ].join(UNIT_SEP);
}

/** 품목명만(지역 무관) 정규화 집합 — "전국 → 특정 지역"으로 이동한 항목을 실종으로
 * 오판하지 않으려고 쓴다. */
function itemNameSet(snapshot) {
  const names = new Set();
  for (const region of snapshot.regions || []) {
    for (const item of region.items || []) {
      names.add(normalizeItemName(item.itemName || item.noticeName));
    }
  }
  return names;
}

function keyToLabel(key) {
  return key.split(UNIT_SEP).filter(Boolean).join(" / ");
}

function indexSnapshot(snapshot) {
  const items = new Map();
  for (const region of snapshot.regions || []) {
    for (const item of region.items || []) {
      items.set(regionItemKey(region, item), { region, item });
    }
  }
  return items;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 연도별 집계를 연도별 max로 합친다(둘 다 같은 모집단 기준이라 max가 안전). */
function unionYearCounts(previous, next) {
  if (!previous && !next) return next ?? previous ?? null;
  const merged = { ...(next || {}) };
  for (const [year, count] of Object.entries(previous || {})) {
    merged[year] = Math.max(num(merged[year]), num(count));
  }
  return merged;
}

/**
 * 신규 item의 지역 지표가 이전보다 낮으면 이전 값을 유지한다.
 * @returns {{item: object, retained: boolean, retainedFields: string[]}}
 */
function retainMetricFloor(previousItem, nextItem, context) {
  const retainedFields = [];
  const item = nextItem;

  const metricNames = ["uniqueTrademarkCount", "registeredTrademarkCount", "confirmedGoodsMatchCount"];
  for (const name of metricNames) {
    const prevMetric = previousItem.metrics?.[name];
    const nextMetric = item.metrics?.[name];
    if (!prevMetric) continue;
    const prevValue = num(prevMetric.value);
    const nextValue = num(nextMetric?.value);
    // 이전에 실제 값이 있었고(available), 신규가 그보다 낮거나 사라졌으면 이전을 유지.
    const prevWasAvailable = prevMetric.availability === "available" || prevMetric.availability === "preview";
    if (prevWasAvailable && prevValue > nextValue) {
      item.metrics = item.metrics || {};
      item.metrics[name] = {
        ...prevMetric,
        retainedFromPrevious: {
          previousSnapshotId: context.previousSnapshotId || null,
          previousValue: prevValue,
          recollectedValue: nextValue,
          reason: "recollection_below_previous_last_known_good",
          retainedAt: context.retainedAt,
        },
      };
      retainedFields.push(name);
    }
  }

  const mergedAppYears = unionYearCounts(previousItem.applicationYearCounts, item.applicationYearCounts);
  const mergedRegYears = unionYearCounts(previousItem.registrationYearCounts, item.registrationYearCounts);
  if (JSON.stringify(mergedAppYears) !== JSON.stringify(item.applicationYearCounts || null)) {
    item.applicationYearCounts = mergedAppYears;
    retainedFields.push("applicationYearCounts");
  }
  if (JSON.stringify(mergedRegYears) !== JSON.stringify(item.registrationYearCounts || null)) {
    item.registrationYearCounts = mergedRegYears;
    retainedFields.push("registrationYearCounts");
  }

  return { item, retained: retainedFields.length > 0, retainedFields };
}

/**
 * @param {object} nextSnapshot 이번 실행 스냅샷(파괴적으로 수정됨)
 * @param {object|null} previousSnapshot 직전 공개 스냅샷(없으면 첫 배포로 간주)
 * @param {{key:string, reason:string, runId?:string, tombstonedAt?:string}[]} tombstones
 * @param {{massRevivalLimit?: number}} [options] revive가 이 수를 넘으면 배포 차단(대량
 *   실종 = 재수집 실패 신호, 사람이 봐야 함). 기본 50.
 * @returns {{report: object, blocked: boolean}}
 */
function reconcilePublicSnapshot(nextSnapshot, previousSnapshot, tombstones = [], options = {}) {
  const retainedAt = new Date().toISOString();
  const massRevivalLimit = Number.isInteger(options.massRevivalLimit) ? options.massRevivalLimit : 50;
  const tombstoneByKey = new Map(tombstones.map((entry) => [clean(entry.key), entry]));

  if (!previousSnapshot) {
    return {
      blocked: false,
      report: {
        schemaVersion: "public-snapshot-reconcile-v1",
        generatedAt: retainedAt,
        previousSnapshotId: null,
        nextSnapshotId: nextSnapshot.snapshotId || null,
        firstPublication: true,
        counts: { added: countItems(nextSnapshot), retained: 0, metricFloorRetained: 0, revivedLastKnownGood: 0, removedWithTombstone: 0 },
        revivedLastKnownGood: [],
        removedWithTombstone: [],
      },
    };
  }

  const prevIndex = indexSnapshot(previousSnapshot);
  const nextIndex = indexSnapshot(nextSnapshot);
  // tombstone 키는 사람이 읽는 형태(" / "로 이은 sido/sigungu/품목/niceClass).
  const tombstoneByLabel = new Map([...tombstoneByKey.entries()].map(([key, entry]) => [clean(key), entry]));

  let metricFloorRetained = 0;
  const revivedLastKnownGood = [];
  const removedWithTombstone = [];

  // 1) 양쪽에 있는 키: 지표 floor 유지(절대 감소 금지).
  const context = { previousSnapshotId: previousSnapshot.snapshotId, retainedAt };
  for (const [key, { item: nextItem }] of nextIndex) {
    const prev = prevIndex.get(key);
    if (!prev) continue;
    const { retained } = retainMetricFloor(prev.item, nextItem, context);
    if (retained) metricFloorRetained++;
  }

  // 2) 이전엔 있고 신규엔 없는 키: tombstone이 있으면 제거를 허용, 없으면 되살린다.
  const nextRegionByName = new Map((nextSnapshot.regions || []).map((region) => [clean(region.region), region]));
  const nextNames = itemNameSet(nextSnapshot);
  const relocated = [];
  for (const [key, prev] of prevIndex) {
    if (nextIndex.has(key)) continue;
    const tombstone = tombstoneByLabel.get(keyToLabel(key));
    if (tombstone) {
      removedWithTombstone.push({
        key: keyToLabel(key),
        reason: tombstone.reason,
        runId: tombstone.runId || null,
        tombstonedAt: tombstone.tombstonedAt || null,
      });
      continue;
    }
    // "전국" 카탈로그 항목이 이번엔 특정 지역 행으로 이동했으면(KOFPI 주산지 확장 등)
    // 실종이 아니다 — 되살리면 전국·지역 중복이 된다.
    const prevSido = clean(prev.region.sido || prev.region.region);
    const isNationwidePrev = prevSido === "전국" || /^전국\b/.test(clean(prev.region.region));
    const prevName = normalizeItemName(prev.item.itemName || prev.item.noticeName);
    if (isNationwidePrev && nextNames.has(prevName)) {
      relocated.push({ key: keyToLabel(key), reason: "nationwide_catalog_now_regional" });
      continue;
    }
    // 삭제로 보지 않는다 — 이전 항목을 되살려 last-known-good 유지(missing ≠ deletion).
    const revived = JSON.parse(JSON.stringify(prev.item));
    revived.presence = {
      state: "retained_last_known_good",
      reason: "absent_in_recollection_no_tombstone",
      lastSeenSnapshotId: previousSnapshot.snapshotId || null,
      retainedAt,
    };
    let region = nextRegionByName.get(clean(prev.region.region));
    if (!region) {
      region = JSON.parse(JSON.stringify(prev.region));
      region.items = [];
      nextSnapshot.regions.push(region);
      nextRegionByName.set(clean(region.region), region);
    }
    region.items.push(revived);
    revivedLastKnownGood.push({ key: keyToLabel(key), lastSeenSnapshotId: previousSnapshot.snapshotId || null });
  }

  nextSnapshot.pipelineStatus = nextSnapshot.pipelineStatus || {};
  nextSnapshot.pipelineStatus.publicSnapshotReconcile = {
    previousSnapshotId: previousSnapshot.snapshotId || null,
    reconciledAt: retainedAt,
    metricFloorRetained,
    revivedLastKnownGood: revivedLastKnownGood.length,
    relocatedNationwideToRegional: relocated.length,
    removedWithTombstone: removedWithTombstone.length,
  };

  // 정상 상황이면 revive는 소수(재랭킹·slice 경계). 대량 실종은 재수집이 깨진 것이라
  // 사람이 봐야 한다.
  const blocked = revivedLastKnownGood.length > massRevivalLimit;

  return {
    blocked,
    report: {
      schemaVersion: "public-snapshot-reconcile-v1",
      generatedAt: retainedAt,
      previousSnapshotId: previousSnapshot.snapshotId || null,
      nextSnapshotId: nextSnapshot.snapshotId || null,
      firstPublication: false,
      blocked,
      blockReason: blocked
        ? `last-known-good로 되살린 지역×품목 ${revivedLastKnownGood.length}개가 한계(${massRevivalLimit})를 넘음 — 재수집 이상 여부를 확인하세요`
        : null,
      counts: {
        retained: prevIndex.size - removedWithTombstone.length - revivedLastKnownGood.length - relocated.length,
        added: [...nextIndex.keys()].filter((key) => !prevIndex.has(key)).length,
        metricFloorRetained,
        revivedLastKnownGood: revivedLastKnownGood.length,
        relocatedNationwideToRegional: relocated.length,
        removedWithTombstone: removedWithTombstone.length,
      },
      revivedLastKnownGood,
      relocated,
      removedWithTombstone,
    },
  };
}

function countItems(snapshot) {
  return (snapshot.regions || []).reduce((sum, region) => sum + (region.items || []).length, 0);
}

module.exports = {
  regionItemKey,
  indexSnapshot,
  unionYearCounts,
  retainMetricFloor,
  reconcilePublicSnapshot,
};
