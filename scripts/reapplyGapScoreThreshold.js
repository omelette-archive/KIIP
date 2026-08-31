"use strict";
// #29(2026-08-31 확정: 대표 특산품 인정 기준 3건 -> 1건)를 라이브 dashboard-snapshot.json에
// 반영한다. 전체 카탈로그(1,937개 지역×품목)에 대한 완전한 ④ 산출물이 파일로 남아있지
// 않아(그동안 여러 부분 배치를 병합해 라이브 데이터를 만들어 왔음) ①→③을 다시 실행하지
// 않고, 이미 스냅샷에 저장된 지역 지표(고유 상표 건수·등록률 등, ③④ 재수집과 무관하게
// 변하지 않는 값)를 그대로 05/06단계의 실제 코드(scoreBucket/buildBriefing)에 다시
// 흘려보내 재계산한다 — 공식은 threshold를 빼면 동일하므로 API 재호출 없이도 정확하다.
//
// 재계산 대상은 실제 ④→⑤→⑥ 파이프라인을 거친 항목(gapScore.methodVersion ===
// "gap-score-v2-regional-address-gate", 1,692개)뿐이다. RDA/NFQS 등 나중에 병합만 된
// 보충 출처 항목(methodVersion "supplemental-source-catalog-no-gap-score")은 애초에 ④
// 분석을 거친 적이 없어 건드리지 않는다.
//
// 판정 로직(isRepresentative)은 "GI 출처 OR 상표 건수>=threshold"의 OR 조건이라 threshold를
// 낮춰도 이미 대표였던 항목의 대표 여부·gapScore 값은 그대로다(단조 증가) — 그래서 실제로
// 값이 바뀌는 항목은 "이전엔 비대표(GI 아님·3건 미만)였는데 지금은 1건 이상"인 경우뿐이고,
// 그 경우는 count>=1이 이미 대표 조건을 만족시키므로 GI 여부를 몰라도(⑦ 산출물에는 원본
// sources 라벨이 해시로만 남아 있어 복원 불가) 안전하게 재계산할 수 있다.

const fs = require("fs");
const path = require("path");
const { scoreBucket, GAP_SCORE_VERSION, REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD } = require("../05-detect-brand-gap/lib/scorer");
const { buildBriefing, TEMPLATE_VERSION } = require("../06-generate-business-strategy/lib/templates");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT, "07-dashboard", "web", "public", "data", "dashboard-snapshot.json");
const OLD_METHOD_VERSION = "gap-score-v2-regional-address-gate";

function buildSourceProvenance(sourceIds, sourcesById) {
  return (sourceIds || [])
    .map((id) => sourcesById.get(id))
    .filter(Boolean)
    .map((source) => ({
      sourceLabel: source.sourceLabel || null,
      sourceId: source.sourceId || null,
      sourceContractVersion: source.sourceContractVersion || null,
      sourceFetchedAt: source.sourceFetchedAt || null,
      sourceUrl: source.sourceUrl || null,
      sourceLastVerifiedAt: source.sourceLastVerifiedAt || null,
      sourceContentId: null,
      sourceApplicationNumber: null,
      normalizationVersion: null,
      dictionaryVersion: null,
      dictionarySourceUrl: null,
      dictionaryDownloadedAt: null,
      matchPurpose: null,
    }));
}

function reapplyGapScoreThreshold(snap, { generatedAt = new Date().toISOString() } = {}) {
  const sourcesById = new Map(snap.sources.map((s) => [s.sourceId, s]));
  let touched = 0;
  let alreadyRepresentative = 0;
  let newlyRepresentative = 0;
  let stillNotRepresentative = 0;
  let untouchedBlocked = 0;

  for (const region of snap.regions) {
    for (const item of region.items) {
      const gapMetric = item.metrics && item.metrics.gapScore;
      if (!gapMetric || gapMetric.methodVersion !== OLD_METHOD_VERSION) continue;
      touched++;

      if (typeof gapMetric.value === "number") {
        // 이미 대표였던 항목: threshold를 낮춰도 대표성·gapScore는 그대로(단조성) — 버전만 갱신
        gapMetric.methodVersion = GAP_SCORE_VERSION;
        gapMetric.calculatedAt = generatedAt;
        alreadyRepresentative++;
        continue;
      }

      const utc = item.metrics.uniqueTrademarkCount;
      const regionalMetricAvailable = utc && utc.availability === "available";
      const count = regionalMetricAvailable && typeof utc.value === "number" ? utc.value : 0;

      if (!regionalMetricAvailable || count < REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD) {
        // #50으로 지역 지표 자체가 막혔거나, 지표는 있어도 0건 -> 1건 기준에서도 여전히 비대표
        gapMetric.methodVersion = GAP_SCORE_VERSION;
        gapMetric.calculatedAt = generatedAt;
        if (!regionalMetricAvailable) untouchedBlocked++;
        else stillNotRepresentative++;
        continue;
      }

      // 이전엔 비대표(3건 미만)였는데 이제 1건 이상 -> 새로 대표로 전환
      const bucket = {
        regionalMetricAvailability: "available",
        regionalUniqueTrademarkCount: count,
        regionalRegistrationRate: item.metrics.registrationRate.value,
        sources: [], // ⑦ 산출물엔 원본 GI 라벨이 해시로만 남아 복원 불가하지만, count>=threshold만으로
        // 이미 대표 조건을 만족하므로 실제 판정 결과에는 영향 없음(OR 조건, 위 주석 참고)
      };
      const scored = scoreBucket(bucket, { representativeThreshold: REPRESENTATIVE_TRADEMARK_COUNT_THRESHOLD });

      item.metrics.gapScore = {
        value: scored.gapScore,
        availability: "preview",
        status: gapMetric.status,
        sourceIds: gapMetric.sourceIds,
        calculatedAt: generatedAt,
        methodVersion: GAP_SCORE_VERSION,
        rationale: scored.gapReason || "⑤ 예시 점수 기준",
        blockingIssue: "#29",
      };

      const row = {
        region: region.region,
        itemName: item.itemName,
        noticeName: item.noticeName,
        niceClass: item.niceClass,
        gapScore: scored.gapScore,
        uniqueTrademarkCount: count,
        registrationRate: item.metrics.registrationRate.value,
        localApplicantShare:
          item.metrics.localApplicantShare.availability === "available"
            ? item.metrics.localApplicantShare.value
            : null,
        regionMatchVerified: true,
        partialQueryCount: 0,
        scoreInputs: scored.scoreInputs,
        sourceProvenance: buildSourceProvenance(utc.sourceIds, sourcesById),
      };
      const briefing = buildBriefing(row);
      item.briefing = {
        templateVersion: TEMPLATE_VERSION,
        isGapAlert: Boolean(briefing.isGapAlert),
        sentences: briefing.sentences,
        evidence: briefing.evidence,
        aiReviewApplied: false,
      };
      newlyRepresentative++;
    }
  }

  const warningReplacements = new Map([
    [
      "대표 특산품 판정 기준(GI 출처 또는 상표 출원 3건 이상)은 #29에서 확정됐지만, 활용도 포화 건수·가중치는 아직 예시값이다(scoreVersion 참고) — 실제 기준 확정 후 05-detect-brand-gap/lib/scorer.js만 교체하면 된다.",
      "대표 특산품 판정 기준(GI 출처 또는 상표 출원 1건 이상)은 #29에서 2026-08-31 완화 확정됐다. 활용도 포화 건수·가중치는 아직 예시값이다(scoreVersion 참고) — 실제 기준 확정 후 05-detect-brand-gap/lib/scorer.js만 교체하면 된다.",
    ],
    [
      "923개 지역×품목은 대표 특산품 판정 기준을 충족하지 않아 순위에서 제외됨.",
      `${stillNotRepresentative}개 지역×품목은 대표 특산품 판정 기준을 충족하지 않아 순위에서 제외됨.`,
    ],
  ]);
  snap.warnings = snap.warnings.map((w) => warningReplacements.get(w) || w);
  snap.warnings.push(
    `대표 특산품 완화 기준(1건, #29 2026-08-31 확정)을 라이브 스냅샷에 반영했습니다(${generatedAt.slice(0, 10)}) — ` +
      "전체 카탈로그의 완전한 ④ 산출물이 파일로 남아있지 않아 ①~③을 다시 수집하지 않고, 이미 저장된 지역 지표(고유 상표 건수·등록률)를 " +
      "⑤·⑥ 실제 코드에 다시 흘려보내 재계산하는 방식으로 반영했습니다."
  );

  return { touched, alreadyRepresentative, newlyRepresentative, stillNotRepresentative, untouchedBlocked };
}

function main() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  const result = reapplyGapScoreThreshold(snap);
  console.log(result);
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + "\n", "utf8");
  console.log("saved.");
}

if (require.main === module) main();

module.exports = { reapplyGapScoreThreshold };
