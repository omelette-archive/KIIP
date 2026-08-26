"use strict";

// 이슈 #80: 지도 도형(GeoJSON)이 "현재 유효한" 전국 시도·시군구 목표 목록과 정확히
// 1:1로 대응하는지 결정론적으로 검증한다. 통과할 때만 스냅샷의 map.availability를
// "available"로 전환한다 — 근거 없이 조용히 지도를 공개하지 않기 위해서다.
//
// 법정동코드 마스터(01-collect-specialties/data/법정동코드_전국_20260703.csv)는 폐지된
// 행이 섞인 전체 이력 파일이라(01-collect-specialties/lib/adminCodes.js 주석 참고),
// 시군구 목록에는 "구 설치 시"의 상위 시 코드(예: 수원시)와 그 하위 구 코드(수원시장안구
// 등)가 함께 들어 있다. 실제 도형은 구 설치 시의 경우 하위 구 단위로만 그려지므로,
// 상위 시 코드는 "그 시의 모든 하위 구 코드가 도형에 있으면 충족된 것으로" 간주한다.

const { loadAdminRegionCodes } = require("../../01-collect-specialties/lib/adminCodes");

function flattenGeometryCodes(geometry) {
  const codes = new Set();
  for (const group of Object.values(geometry.municipalities || {})) {
    for (const item of group.items || []) {
      for (const part of String(item.code || "").split(",")) {
        const trimmed = part.trim();
        if (trimmed) codes.add(trimmed);
      }
    }
  }
  return codes;
}

function checkMapGeographyCoverage({ adminCodes = loadAdminRegionCodes(), geometry } = {}) {
  const allRows = adminCodes;
  const sidoRows = allRows.filter((row) => row.level === "sido");
  const sigunguRows = allRows.filter((row) => row.level === "sigungu");
  const geometryCodes = flattenGeometryCodes(geometry);
  const geometryProvinceNames = new Set((geometry.provinces || []).map((province) => province.name));

  const missingProvinces = sidoRows
    .map((row) => row.sido)
    .filter((name) => !geometryProvinceNames.has(name));
  const extraProvinces = [...geometryProvinceNames].filter(
    (name) => !sidoRows.some((row) => row.sido === name)
  );

  const missingSigungu = [];
  for (const row of sigunguRows) {
    const code5 = row.code.slice(0, 5);
    if (geometryCodes.has(code5)) continue;
    // 상위 "시" 코드일 수 있다 — 같은 시 이름으로 시작하는 하위 구 코드가 전부 도형에
    // 있으면 충족된 것으로 본다. 하위 구가 하나도 없으면 진짜 누락이다.
    const children = sigunguRows.filter(
      (candidate) =>
        candidate.code.slice(0, 4) === row.code.slice(0, 4) &&
        candidate.code.slice(0, 5) !== code5 &&
        candidate.sigungu.startsWith(row.sigungu.replace(/시$/, ""))
    );
    const coveredByChildren =
      children.length > 0 && children.every((child) => geometryCodes.has(child.code.slice(0, 5)));
    if (!coveredByChildren) missingSigungu.push({ code: code5, sido: row.sido, sigungu: row.sigungu });
  }

  const targetSigunguCodes = new Set(sigunguRows.map((row) => row.code.slice(0, 5)));
  const extraSigunguCodes = [...geometryCodes].filter((code) => !targetSigunguCodes.has(code));

  const mismatches = {
    missingProvinces,
    extraProvinces,
    missingSigungu,
    extraSigunguCodes,
  };
  const clean =
    missingProvinces.length === 0 &&
    extraProvinces.length === 0 &&
    missingSigungu.length === 0 &&
    extraSigunguCodes.length === 0;

  if (clean) {
    return {
      available: true,
      blockingReason: null,
      mismatches,
      summary: {
        provinceCount: sidoRows.length,
        sigunguTargetCount: sigunguRows.length,
        geometryCodeCount: geometryCodes.size,
      },
    };
  }
  const reasons = [];
  if (missingProvinces.length) reasons.push(`시도 도형 누락 ${missingProvinces.length}건`);
  if (extraProvinces.length) reasons.push(`목표 목록에 없는 시도 도형 ${extraProvinces.length}건`);
  if (missingSigungu.length) reasons.push(`시군구 도형 누락 ${missingSigungu.length}건`);
  if (extraSigunguCodes.length) reasons.push(`목표 목록에 없는 시군구 코드 ${extraSigunguCodes.length}건`);
  return {
    available: false,
    blockingReason: `현재 기준 행정구역 목표 목록과 지도 도형이 정확히 대응하지 않습니다(${reasons.join(", ")}).`,
    mismatches,
    summary: {
      provinceCount: sidoRows.length,
      sigunguTargetCount: sigunguRows.length,
      geometryCodeCount: geometryCodes.size,
    },
  };
}

module.exports = { checkMapGeographyCoverage, flattenGeometryCodes };
