"use strict";

const fs = require("fs");
const { loadAdminCodes } = require("../../01-collect-specialties/lib/adminCodes");
const { splitRegion } = require("../../01-collect-specialties/lib/normalize");
const {
  AREA_BRAND_CONTRACT_VERSION,
  AREA_BRAND_SOURCE_METADATA,
  indexByApplicationNumber,
  normalizeApplicationNumber,
} = require("./areaBrandClient");

const SIDO_SUFFIX_RE = /(특별자치시|특별자치도|광역시|특별시|도)$/;
const SIDO_SHORT_NAMES = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};
const LEGACY_SIDO_ALIASES = {
  전남광주통합특별시: ["전라남도", "전남", "광주광역시", "광주"],
};

function clean(value) {
  return String(value || "").normalize("NFC").trim().replace(/\s+/g, " ");
}

function uniqueAdminSidos(adminList) {
  return [...new Set(adminList.map((row) => row.sido).filter(Boolean))];
}

function normalizeAreaBrandRegion(regionText, adminList = loadAdminCodes()) {
  const raw = clean(regionText);
  if (!raw) return { status: "unmatched", level: null, raw, reason: "empty_region" };

  const direct = splitRegion(raw, adminList);
  if (direct.matched) {
    return {
      status: "matched",
      level: "sigungu",
      raw,
      sido: direct.sido,
      sigungu: direct.sigungu,
      normalizedRegion: `${direct.sido} ${direct.sigungu}`,
      method: "exact_sigungu",
    };
  }
  if (direct.ambiguous) {
    return {
      status: "ambiguous",
      level: null,
      raw,
      reason: "ambiguous_sigungu",
      candidateSidos: direct.candidateSidos || [],
    };
  }

  const sidos = uniqueAdminSidos(adminList);
  const expandedShortName = SIDO_SHORT_NAMES[raw];
  const sidoCandidates = sidos.filter((sido) =>
    raw === sido ||
    raw === sido.replace(SIDO_SUFFIX_RE, "") ||
    expandedShortName === sido ||
    (LEGACY_SIDO_ALIASES[sido] || []).includes(raw)
  );
  if (sidoCandidates.length === 1) {
    return {
      status: "matched",
      level: "sido",
      raw,
      sido: sidoCandidates[0],
      sigungu: "",
      normalizedRegion: sidoCandidates[0],
      method: "exact_sido",
    };
  }

  const compact = raw.replace(/\s/g, "");
  const stemCandidates = adminList.filter((admin) => {
    const sigungu = clean(admin.sigungu).replace(/\s/g, "");
    const stem = sigungu.replace(/[시군구]$/, "");
    return compact === stem;
  });
  if (stemCandidates.length === 1) {
    const match = stemCandidates[0];
    return {
      status: "matched",
      level: "sigungu",
      raw,
      sido: match.sido,
      sigungu: match.sigungu,
      normalizedRegion: `${match.sido} ${match.sigungu}`,
      method: "sigungu_suffix_restored",
    };
  }
  if (stemCandidates.length > 1 || sidoCandidates.length > 1) {
    return {
      status: "ambiguous",
      level: null,
      raw,
      reason: "ambiguous_region_alias",
      candidateSidos: [...new Set([...stemCandidates.map((row) => row.sido), ...sidoCandidates])],
    };
  }
  return { status: "unmatched", level: null, raw, reason: "region_not_in_admin_master" };
}

function classifyRegionalBrandMatch(queryRegion, referenceRegion) {
  if (queryRegion.status !== "matched" || referenceRegion.status !== "matched") {
    return { match: "unverified", confidence: "unverified_region_name" };
  }
  if (queryRegion.sido !== referenceRegion.sido) {
    return { match: "outside", confidence: "exact_application_number_sido" };
  }
  if (queryRegion.level === "sigungu" && referenceRegion.level === "sigungu") {
    return {
      match: queryRegion.sigungu === referenceRegion.sigungu ? "inside" : "outside",
      confidence: "exact_application_number_sigungu",
    };
  }
  return { match: "inside", confidence: "exact_application_number_sido" };
}

function loadAreaBrandDocument(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const brands = Array.isArray(parsed) ? parsed : parsed?.brands;
  if (!Array.isArray(brands)) {
    throw new Error("지역브랜드 JSON은 배열 또는 { brands: [] } 형태여야 합니다.");
  }
  for (const [index, brand] of brands.entries()) {
    if (!normalizeApplicationNumber(brand.applicationNumber)) {
      throw new Error(`지역브랜드 JSON ${index + 1}번째 행에 applicationNumber가 필요합니다.`);
    }
  }
  return {
    brands,
    metadata: {
      ...AREA_BRAND_SOURCE_METADATA,
      contractVersion: parsed?.contractVersion || AREA_BRAND_CONTRACT_VERSION,
      fetchedAt: parsed?.fetchedAt || parsed?.sourceMetadata?.fetchedAt || null,
      ...(parsed?.sourceMetadata || {}),
    },
  };
}

function loadAreaBrandFile(filePath) {
  return loadAreaBrandDocument(filePath).brands;
}

function createAreaBrandContext(brands, adminList = loadAdminCodes(), metadata = AREA_BRAND_SOURCE_METADATA) {
  return {
    brands,
    adminList,
    index: indexByApplicationNumber(brands),
    metadata: {
      ...AREA_BRAND_SOURCE_METADATA,
      ...metadata,
      joinMethodVersion: "area-brand-application-region-join-v1",
      adminRegionMaster: "국토교통부 전국 법정동 코드 2026-07-03",
      adminRegionMasterUrl: "https://www.data.go.kr/data/15063424/fileData.do",
    },
  };
}

function evidenceOf(reference, normalizedRegion) {
  return {
    contentId: reference.contentId || null,
    applicationNumber: reference.applicationNumber || null,
    brandName: reference.brandName || null,
    primaryProductName: reference.primaryProductName || null,
    rawRegionName: reference.regionName || null,
    normalizedRegion: normalizedRegion.normalizedRegion || null,
    regionStatus: normalizedRegion.status,
    regionLevel: normalizedRegion.level,
    sido: normalizedRegion.sido || null,
    sigungu: normalizedRegion.sigungu || null,
  };
}

function enrichHitsWithAreaBrands(hits, queryRegionText, context) {
  if (!context) return hits;
  const queryRegion = normalizeAreaBrandRegion(queryRegionText, context.adminList);
  return (hits || []).map((hit) => {
    const key = normalizeApplicationNumber(hit.applicationNumber);
    const references = key ? context.index.get(key) || [] : [];
    if (references.length === 0) return hit;

    const evaluated = references.map((reference) => {
      const referenceRegion = normalizeAreaBrandRegion(reference.regionName, context.adminList);
      return {
        reference,
        referenceRegion,
        result: classifyRegionalBrandMatch(queryRegion, referenceRegion),
      };
    });
    const matchValues = [...new Set(evaluated.map((row) => row.result.match))];
    const confidenceValues = [...new Set(evaluated.map((row) => row.result.confidence))];
    const consistent = matchValues.length === 1 && confidenceValues.length === 1;
    return {
      ...hit,
      regionalBrandMatch: consistent ? matchValues[0] : "unverified",
      regionalBrandMatchSource: "nongsaro_area_brand_application_number",
      regionalBrandMatchVersion: "area-brand-application-region-join-v1",
      regionalBrandMatchConfidence: consistent
        ? confidenceValues[0]
        : "multiple_conflicting_references",
      regionalBrandEvidence: evaluated.map((row) =>
        evidenceOf(row.reference, row.referenceRegion)
      ),
    };
  });
}

function summarizeRegionalBrandMatches(results) {
  const counts = { inside: 0, outside: 0, unverified: 0, referenced: 0 };
  for (const entry of results || []) {
    for (const hit of entry.hits || []) {
      if (!hit.regionalBrandMatchSource) continue;
      counts.referenced++;
      const value = ["inside", "outside"].includes(hit.regionalBrandMatch)
        ? hit.regionalBrandMatch
        : "unverified";
      counts[value]++;
    }
  }
  return counts;
}

module.exports = {
  classifyRegionalBrandMatch,
  createAreaBrandContext,
  enrichHitsWithAreaBrands,
  loadAreaBrandFile,
  loadAreaBrandDocument,
  normalizeAreaBrandRegion,
  summarizeRegionalBrandMatches,
};
