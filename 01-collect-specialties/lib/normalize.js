"use strict";
/**
 * 여러 소스(지리적표시, 농사로 등)의 결과를 표준 출력 스키마
 * { sido, sigungu, rawItemName, source, collectedAt }로 정규화한다.
 * adminCodes.js가 만든 시군구 마스터 목록과 지역 문자열을 대조해서 sido/sigungu를
 * 분리한다 — 못 찾아도 하드 실패는 아니고 경고만 남긴다(소스마다 지역 표기 형식이
 * "경상북도 안동시" / "안동시" / "안동" 등으로 제각각이라 완벽한 매칭은 기대하기 어려움).
 *
 * ⚠️ 시군구명은 시도 경계 없이 중복되는 경우가 실제로 있다 — 중구(서울/부산/대구/대전/
 * 울산), 동구·서구·남구·북구(광역시 여러 곳), 고성군(강원/경남) 등. 시군구명만으로
 * 매칭하면 배열 순서상 우연히 먼저 걸리는 시도로 잘못 태깅된다(실제로 "대전광역시 중구"가
 * "서울특별시 중구"로, "강원도 고성군"이 "경상남도 고성군"으로 잘못 매칭되는 걸 확인함).
 * 그래서 시군구명이 여러 시도에 중복되면, 지역 문자열에 시도명(핵심어)이 함께 있는지로
 * 한 번 더 좁히고, 그래도 못 좁히면 틀린 시도를 단정하지 않고 matched:false + ambiguous:true로
 * 남긴다.
 */

const {
  SIDO_ALIASES,
  SIGUNGU_SUCCESSORS,
  REGION_CODE_SUCCESSORS,
} = require("./regionAliases");

const SIDO_SUFFIX_RE = /(특별자치시|특별자치도|광역시|특별시|도)$/;

function sidoCoreName(sido) {
  return (sido || "").replace(SIDO_SUFFIX_RE, "");
}

// 행정구역 통합으로 마스터에서 사라진 옛 시도명. 소스 데이터(뉴스, 오래된 공공데이터 등)는
// 통합 전 표기를 계속 쓸 수 있어, 동명 시군구 좁히기에서 신구 명칭을 함께 인정한다.
// 실제 마스터(법정동코드_전국)에 "전남광주통합특별시"만 있고 "전라남도"/"광주광역시"는
// 더 이상 없는 것을 확인하고 추가함 — 새 통합 사례가 생기면 여기만 추가하면 된다.
function sidoMatchTokens(sido) {
  return [...new Set([sido, sidoCoreName(sido), ...(SIDO_ALIASES[sido] || [])])].filter(Boolean);
}

function cleanRegionText(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function compactRegionText(value) {
  return cleanRegionText(value).replace(/[\s,;:>/\\|()〔〕\[\]·・-]+/g, "");
}

function uniqueAdminRows(adminList) {
  const seen = new Set();
  return (adminList || []).filter((row) => {
    if (!row?.sido || !row?.sigungu) return false;
    const key = `${row.sido}\u001f${row.sigungu}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRegionCode(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return digits;
  // 일부 공급자는 시군구 코드 5자리만 내려준다. 법정동 코드의 시군구 레벨
  // 형식과 동일한 경우에만 뒤를 0으로 채워 대조한다.
  if (digits.length === 5) return `${digits}00000`;
  return "";
}

/**
 * 원천 코드가 현재 마스터에 있으면 이름보다 먼저 사용한다. 과거 코드인 경우에도
 * 목적지가 하나로 확정되는 명시적 승계표만 적용하며, 나머지는 이름 매칭으로 넘긴다.
 */
function resolveRegionByCode(regionCode, adminList) {
  const sourceRegionCode = normalizeRegionCode(regionCode);
  if (!sourceRegionCode) return null;
  const currentRegionCode = REGION_CODE_SUCCESSORS[sourceRegionCode] || sourceRegionCode;
  const candidates = uniqueAdminRows(adminList).filter((row) => row.code === currentRegionCode);
  if (candidates.length !== 1) return null;
  return {
    sido: candidates[0].sido,
    sigungu: candidates[0].sigungu,
    regionCode: currentRegionCode,
    sourceRegionCode,
    matched: true,
    matchMethod: currentRegionCode === sourceRegionCode
      ? "exact_region_code"
      : "region_code_successor",
  };
}

function narrowBySido(candidates, compactInput) {
  const narrowed = candidates.filter((row) =>
    sidoMatchTokens(row.sido).some((token) => compactInput.includes(compactRegionText(token)))
  );
  return narrowed.length > 0 ? narrowed : candidates;
}

function resultFromCandidates(candidates, normalized, matchMethod) {
  if (candidates.length === 1) {
    return {
      sido: candidates[0].sido,
      sigungu: candidates[0].sigungu,
      matched: true,
      matchMethod,
    };
  }
  return {
    sido: "",
    sigungu: normalized,
    matched: false,
    ambiguous: true,
    candidateSidos: [...new Set(candidates.map((row) => row.sido))],
    reason: "ambiguous_region_alias",
  };
}

/**
 * 공식 법정동 마스터에 기대어 신·구 명칭과 축약 표기를 해석한다.
 * 자동 확정은 후보가 하나일 때만 하며, 동명 시군구는 ambiguous로 보류한다.
 */
function resolveRegion(regionText, adminList) {
  const normalized = cleanRegionText(regionText);
  if (!normalized) return { sido: "", sigungu: "", matched: false, reason: "empty_region" };
  const compact = compactRegionText(normalized);
  const adminRows = uniqueAdminRows(adminList);
  const sidos = [...new Set(adminRows.map((row) => row.sido))];

  // 시군구 없이 시도만 온 경우: 정식명·축약·개칭 전 명칭을 모두 인정한다.
  const provinceCandidates = sidos.filter((sido) =>
    sidoMatchTokens(sido).some((token) => compact === compactRegionText(token))
  );
  if (provinceCandidates.length === 1) {
    const sido = provinceCandidates[0];
    return {
      sido,
      sigungu: "",
      matched: true,
      matchMethod: compact === compactRegionText(sido) ? "exact_sido" : "sido_alias",
    };
  }
  if (provinceCandidates.length > 1) {
    return {
      sido: "",
      sigungu: normalized,
      matched: false,
      ambiguous: true,
      candidateSidos: provinceCandidates,
      reason: "ambiguous_sido_alias",
    };
  }

  // 복합 시군구(예: "수원시영통구")도 입력의 공백·구분자를 제거해 대조한다.
  const exactCandidates = adminRows.filter((row) =>
    compact.includes(compactRegionText(row.sigungu))
  );
  const longestExact = Math.max(0, ...exactCandidates.map((row) => compactRegionText(row.sigungu).length));
  const exactLongestCandidates = exactCandidates.filter(
    (row) => compactRegionText(row.sigungu).length === longestExact
  );
  if (exactLongestCandidates.length > 0) {
    return resultFromCandidates(
      narrowBySido(exactLongestCandidates, compact),
      normalized,
      "exact_sigungu"
    );
  }

  // 통합·개칭 전 시군구명은 명시적 승계표에 있는 경우만 현재 지역으로 연결한다.
  const successorCandidates = [];
  for (const mapping of SIGUNGU_SUCCESSORS) {
    if (!mapping.aliases.some((alias) => compact.includes(compactRegionText(alias)))) continue;
    successorCandidates.push(
      ...adminRows.filter(
        (row) => row.sido === mapping.targetSido && row.sigungu === mapping.targetSigungu
      )
    );
  }
  if (successorCandidates.length > 0) {
    return resultFromCandidates(
      narrowBySido(successorCandidates, compact),
      normalized,
      "sigungu_successor_alias"
    );
  }

  // '안동' 같은 접미사 생략은 전체 지역명(또는 시도+지역명)과 일치할 때만
  // 허용한다. 상세주소 일부에 같은 글자가 있다는 이유로 오매칭하지 않는다.
  const stemCandidates = adminRows.filter((row) => {
    const stem = compactRegionText(row.sigungu).replace(/[시군구]$/, "");
    if (!stem) return false;
    if (compact === stem) return true;
    return sidoMatchTokens(row.sido).some(
      (token) => compact === `${compactRegionText(token)}${stem}`
    );
  });
  const longestStem = Math.max(
    0,
    ...stemCandidates.map((row) => compactRegionText(row.sigungu).replace(/[시군구]$/, "").length)
  );
  const stemLongestCandidates = stemCandidates.filter(
    (row) => compactRegionText(row.sigungu).replace(/[시군구]$/, "").length === longestStem
  );
  if (stemLongestCandidates.length > 0) {
    return resultFromCandidates(
      narrowBySido(stemLongestCandidates, compact),
      normalized,
      "sigungu_suffix_restored"
    );
  }

  return {
    sido: "",
    sigungu: normalized,
    matched: false,
    reason: "region_not_in_admin_master",
  };
}

/**
 * @param {string} regionText
 * @param {{sido:string, sigungu:string}[]} adminList
 */
function resolveRegionInput(regionText, adminList, regionCode = "") {
  const resolvedByCode = resolveRegionByCode(regionCode, adminList);
  const resolved = resolvedByCode || resolveRegion(regionText, adminList);
  if (resolved.matched) {
    const adminRow = uniqueAdminRows(adminList).find(
      (row) => row.sido === resolved.sido && row.sigungu === resolved.sigungu
    );
    return {
      sido: resolved.sido,
      sigungu: resolved.sigungu,
      regionCode: resolved.regionCode || adminRow?.code || "",
      sourceRegionCode: resolved.sourceRegionCode || normalizeRegionCode(regionCode),
      matched: true,
      matchMethod: resolved.matchMethod || "region_name",
    };
  }
  if (resolved.ambiguous) {
    return {
      sido: "",
      sigungu: cleanRegionText(regionText),
      matched: false,
      ambiguous: true,
      candidateSidos: resolved.candidateSidos || [],
    };
  }
  return { sido: "", sigungu: cleanRegionText(regionText), matched: false };
}

function splitRegion(regionText, adminList, regionCode = "") {
  const resolved = resolveRegionInput(regionText, adminList, regionCode);
  if (resolved.matched) {
    return { sido: resolved.sido, sigungu: resolved.sigungu, matched: true };
  }
  if (resolved.ambiguous) {
    return {
      sido: "",
      sigungu: cleanRegionText(regionText),
      matched: false,
      ambiguous: true,
      candidateSidos: resolved.candidateSidos || [],
    };
  }
  return { sido: "", sigungu: cleanRegionText(regionText), matched: false };
}

function toRows(entries, {
  adminList,
  source,
  itemNameOf,
  regionOf,
  regionCodeOf = () => "",
  sourceItemNameOf = itemNameOf,
  sourceRecordUrlOf = () => "",
  now = new Date().toISOString(),
}) {
  const warnings = [];
  const rows = entries.map((entry) => {
    const region = regionOf(entry);
    const sourceRegionCode = regionCodeOf(entry);
    const split = resolveRegionInput(region, adminList, sourceRegionCode);
    if (split.ambiguous) {
      warnings.push(
        `${source}: 시군구명이 여러 시도에 중복돼 확정 못함 - "${region}" (후보: ${split.candidateSidos.join(", ")}) (품목: ${itemNameOf(entry)})`
      );
    } else if (!split.matched) {
      warnings.push(
        `${source}: 지역 매칭 실패 - "${region}"` +
        `${sourceRegionCode ? ` (원천코드: ${sourceRegionCode})` : ""} (품목: ${itemNameOf(entry)})`
      );
    }
    return {
      sido: split.sido,
      sigungu: split.sigungu,
      regionCode: split.regionCode || "",
      regionMatchMethod: split.matchMethod || "unresolved",
      sourceRegionName: cleanRegionText(region),
      sourceRegionCode: normalizeRegionCode(sourceRegionCode),
      sourceItemName: sourceItemNameOf(entry),
      sourceRecordUrl: sourceRecordUrlOf(entry),
      rawItemName: itemNameOf(entry),
      source,
      collectedAt: now,
    };
  });
  return { rows, warnings };
}

function fromGiRegistrations(registrations, adminList) {
  return toRows(registrations, {
    adminList,
    source: "지리적표시",
    itemNameOf: (r) => r.registeredName,
    regionOf: (r) => r.region,
  });
}

function fromNongsaro(specialties, adminList) {
  return toRows(specialties, {
    adminList,
    source: "농사로",
    itemNameOf: (s) => s.title,
    regionOf: (s) => s.region,
    regionCodeOf: (s) => s.raw?.areaCode || s.areaCode || "",
    sourceRecordUrlOf: (s) => s.raw?.linkUrl || "",
  });
}

// #114: NFQS `jisokaddr` is certified-facility metadata, not specialty-origin evidence.
function fromNfqsCertifications(certifications, adminList) {
  // `jisokaddr` is the certified company's/facility's address. It is not a
  // fishing ground, place of production, origin, or specialty-region field.
  // Keep the official certified-product catalog searchable, but never turn a
  // processing facility location into a regional specialty assignment.
  void adminList;
  const now = new Date().toISOString();
  return {
    rows: certifications.map((certification) => ({
      sido: "",
      sigungu: "",
      regionCode: "",
      regionMatchMethod: "facility_location_not_specialty_origin",
      sourceRegionName: "전국(인증사업장 소재지는 특산품 생산지 근거가 아님)",
      sourceRegionCode: "",
      sourceItemName: certification.productName,
      sourceRecordUrl: "https://www.data.go.kr/data/15058693/openapi.do",
      sourceScope: "nationwide_certified_product_catalog",
      rawItemName: certification.productName,
      source: "품질인증수산물",
      collectedAt: now,
    })),
    warnings: [
      `nfqs_quality_cert: 인증사업장 주소를 지역 특산품 근거로 사용하지 않고 전국 인증품 ${certifications.length}건으로 수집`,
    ],
  };
}

function fromKofpiProducts(products, now = new Date().toISOString()) {
  return {
    rows: products.map((product) => ({
      sido: "",
      sigungu: "",
      regionCode: "",
      regionMatchMethod: "source_has_no_region_nationwide_scope",
      sourceRegionName: "전국(지역 미제공)",
      sourceRegionCode: "",
      sourceItemName: product.productName,
      sourceRecordUrl: "https://www.kofpi.or.kr/public/dataOpen_02.do",
      sourceScope: "nationwide_catalog",
      rawItemName: product.productName,
      source: "임산물DB백과",
      collectedAt: now,
    })),
    warnings: [
      `kofpi_forest_product: 지역 필드가 없는 전국 임산물 ${products.length}건을 지역 미지정으로 수집`,
    ],
  };
}

module.exports = {
  cleanRegionText,
  compactRegionText,
  normalizeRegionCode,
  resolveRegionByCode,
  resolveRegion,
  resolveRegionInput,
  splitRegion,
  toRows,
  fromGiRegistrations,
  fromNongsaro,
  fromNfqsCertifications,
  fromKofpiProducts,
};
