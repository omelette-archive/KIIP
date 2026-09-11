"use strict";
/**
 * 상위 30개 다출원 품목의 "고시명칭 별칭 세트"를 만든다.
 *
 * 아래 목록은 사전 후보를 사람이 눈으로 고른 결과다(2026-09-10). 고른 기준:
 *  - 같은 원물을 가리키거나 그 원물을 주원료로 하는 가공품·음료·주류·가공서비스만 넣는다.
 *  - 낱말만 겹치는 다른 작물은 뺀다(배↔배추/양배추, 고추↔고추냉이, 대추↔대추야자,
 *    버섯↔다른 버섯 종, 포도↔포도당, 쌀↔쌀겨비료).
 *  - 묘목·종자·나무·사료는 뺀다 — 특산품 자체가 아니라 자재다.
 *  - 여기 적은 이름은 전부 고시상품명칭 사전에 실재해야 한다(아래에서 검증하고,
 *    없으면 빌드가 실패한다). 사전에 없는 이름을 지어내지 않기 위한 장치다.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const CURATED = {
  "신선한 배": ["보존처리한 배", "냉동배", "배음료", "배주스", "음료용 배즙", "배 주스 음료", "배술", "돌배주"],
  쌀: [
    "통밀쌀", "현미찹쌀", "찹쌀", "탈곡한 쌀", "쌀가루", "찐 쌀", "식용 가공된 천연 쌀",
    "천연 쌀 플레이크", "쌀엿", "쌀빵", "쌀과자", "쌀조청", "찹쌀떡", "쌀떡", "쌀국수", "쌀라면",
    "쌀을 주원료로 한 스낵식품", "쌀을 주원료로 하는 음료(우유대용품은 제외)",
    "아와모리(쌀소주)", "쌀로 빚은 술", "쌀의 발효 가공업", "쌀 가공업", "타인을 위한 쌀 술 양조업",
  ],
  "신선한 사과": [
    "미가공 사과", "사과퓌레", "보존처리한 사과", "가공된 사과", "사과 버터", "냉동사과",
    "설탕이 코팅된 사과", "사과식초", "사과향 차(비의료용)", "사과주스", "사과주스(음료)",
    "비알코올성 사과즙", "사과주",
  ],
  "신선한 토마토": [
    "미가공 토마토", "신선한 체리토마토", "신선한 포도토마토", "신선한 플럼토마토",
    "냉동토마토", "통조림 토마토", "토마토 페이스트", "보존처리된 토마토", "토마토 퓌레",
    "껍질 벗긴 토마토", "벗긴 기다란 토마토", "가공된 토마토", "토마토진액", "요리용 토마토주스",
    "토마토케첩", "토마토소스", "통조림된 스파게티용 토마토소스", "토마토주스음료",
  ],
  소고기: ["소고기 국물", "소고기 패티", "식용 소고기 힘줄", "다진 소고기가 포함된 샌드위치"],
  "신선한 고추": ["냉동고추", "고추절임", "고추장아찌", "고추로 채운 올리브", "식용 고추씨기름", "고추장", "가루고추장", "초고추장", "고추가루", "고추 향신료"],
  "신선한 포도": [
    "신선한 양조용 포도(釀造用葡萄)", "보존처리한 포도", "건포도", "씨없는 건포도", "냉동포도",
    "식용 포도씨유", "포도씨 오일", "비탄산 포도음료", "포도음료", "포도주스", "음료용 포도즙",
    "비발효 포도액", "포도 에일", "포도주", "강화포도주", "천연 발포성 포도주", "막포도주",
    "스파클링포도주", "발포성 포도주", "식탁용 포도주", "포도주 양조 관련 정보제공업",
    "포도 재배업", "포도재배 분야의 상담업",
  ],
  생버섯: [
    "미가공 버섯", "신선한 식용 버섯", "냉동버섯", "가공된 버섯", "건조된 식용 버섯",
    "보존처리된 버섯", "버섯 퓌레", "브레디드버섯", "버섯가루(향신료)", "버섯차",
    "버섯음료", "버섯주",
  ],
  "신선한 수박": ["수박껍질 절임"],
  "신선한 딸기": ["보존처리한 딸기", "통조림된 딸기", "냉동딸기", "딸기음료", "딸기주스", "딸기주"],
  "신선한 표고버섯": ["냉동표고버섯", "가공된 표고버섯"],
  "미가공 버섯": [
    "생버섯", "신선한 식용 버섯", "냉동버섯", "가공된 버섯", "건조된 식용 버섯",
    "보존처리된 버섯", "버섯 퓌레", "브레디드버섯", "버섯가루(향신료)", "버섯차",
    "버섯음료", "버섯주",
  ],
  "미가공 감자": [
    "생 감자", "냉동감자", "튀김감자", "감자칩", "감자만두", "감자 프레이크", "감자튀김",
    "감자퍼프", "가공된 감자", "으깬 감자", "인스턴트 으깬 감자", "구운 감자",
    "갈아서 만든 감자너겟", "감자 샐러드", "감자를 주원료로 한 뇨끼", "감자로 만든 덤플링",
    "감자스낵", "감자탕", "식용 감자가루", "감자옹심이", "납작모양의 감자빵", "감자떡",
  ],
  생밤: ["보존처리한 밤", "군밤", "가공된 밤"],
  꿀: ["천연 꿀", "천연 숙성 꿀", "허브 꿀", "식용 아카시아 꿀", "식용 꿀", "꿀떡", "꿀차", "꿀을 주성분으로 하는 비알코올음료", "벌꿀주"],
  "신선한 복숭아": ["보존처리한 복숭아", "가공된 복숭아", "냉동복숭아", "복숭아음료", "복숭아주스", "복숭아주"],
  "신선한 참외": ["참외(신선한 것)"],
  오미자: ["요리용 오미자즙", "오미자차", "오미자주스", "오미자음료", "오미자주"],
  곶감: [],
  "보존처리한 대추": ["대추를 주원료로 하는 건강보조식품", "대추차", "대추음료", "대추주스"],
  "신선한 키위": ["신선한 키위프루트", "키위주스", "키위 과일주스음료"],
  "신선한 블루베리": ["가공된 블루베리", "냉동블루베리", "블루베리 파이", "블루베리주스"],
  "신선한 고구마": ["냉동고구마", "가공된 고구마", "식용 고구마가루"],
  "신선한 부추": ["부추김치"],
  돼지고기: ["돼지고기 미트볼", "가공된 돼지고기", "튀긴 돼지고기 껍질", "통조림된 돼지고기", "햄버거용 돼지고기"],
  "신선한 호박": ["신선한 폐포호박", "가공된 호박", "페포호박 페이스트", "요리용 호박즙", "단호박죽", "호박죽", "호박파이", "호박떡", "호박차"],
  "신선한 오이": ["냉동오이", "오이소박이", "절임 오이", "오이장아찌", "오이절임"],
  매실: ["매실장아찌", "매실식초", "매실차", "훈제된 매실 주스음료", "매실음료", "매실주스", "매실진액으로 만든 일본술", "매실주"],
  "신선한 인삼": [
    "냉동인삼", "인삼잼", "인삼젤리", "가공된 인삼", "인삼 가공식품", "인삼젤리과자",
    "인삼정과", "인삼캔디", "인삼과자", "인삼차", "비알코올성 인삼넥타", "인삼주스(음료)",
    "인삼넥타", "음료용 인삼진액", "음료용 인삼 분말", "인삼주", "인삼 가공업",
  ],
  "신선한 마늘": [
    "신선한 마늘종(마늘속대)", "냉동마늘", "다진마늘", "보존처리된 마늘", "가공된 마늘",
    "마늘 버터", "요리용 마늘 페이스트", "마늘 퓌레", "마늘스프레드", "마늘빵", "마늘가루",
    "다진 마늘(향신료)", "가공된 마늘(향신료)", "마늘음료", "음료용 마늘진액",
  ],
};

// ── 사전 검증 ───────────────────────────────────────────────────────────
const csv = fs.readFileSync(path.join(ROOT, "02-normalize-items/data/고시상품명칭_13판_2026.csv"), "utf8");
const dict = new Map();
for (const line of csv.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const c = line.split(",");
  const name = (c[0] || "").replace(/^﻿/, "").trim();
  if (!name) continue;
  if (!dict.has(name)) dict.set(name, []);
  dict.get(name).push({ niceClass: (c[1] || "").trim(), similarGroupCode: (c[2] || "").trim() });
}

const RAW_PREFIX = /^(신선한|미가공|무가공|살아있는|생)\s*/;
const stageOf = (name, cls) => {
  if (["35", "40", "43", "44"].includes(cls)) return "service";
  if (cls === "31" && (RAW_PREFIX.test(name) || name.includes("(신선한 것)"))) return "raw";
  if (cls === "31") return "raw";
  return "processed";
};

const missing = [];
const items = [];
for (const [notice, aliases] of Object.entries(CURATED)) {
  // 「오미자」·「매실」은 고시명칭 사전에 표제어가 없어 ②에서 원물명 그대로 검색되는
  // 품목이다(niceClass 미확정). 별칭 세트는 그래도 붙일 수 있으므로 키는 검증에서 뺀다.
  const keyInDictionary = dict.has(notice);
  const entries = [];
  for (const alias of aliases) {
    const found = dict.get(alias);
    if (!found) {
      missing.push(alias);
      continue;
    }
    for (const f of found) {
      entries.push({
        noticeName: alias,
        niceClass: f.niceClass,
        similarGroupCode: f.similarGroupCode,
        stage: stageOf(alias, f.niceClass),
      });
    }
  }
  const self = (dict.get(notice) || []).map((f) => ({
    noticeName: notice,
    niceClass: f.niceClass,
    similarGroupCode: f.similarGroupCode,
    stage: stageOf(notice, f.niceClass),
  }));
  const all = [...self, ...entries];
  const seen = new Set();
  items.push({
    noticeName: notice,
    keyInDictionary,
    aliases: all.filter((e) => {
      const k = `${e.noticeName}|${e.niceClass}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  });
}

if (missing.length) {
  console.error("사전에 없는 이름:", missing.join(", "));
  process.exit(1);
}

const doc = {
  version: "notice-name-aliases-v1",
  dictionaryVersion: "고시상품명칭 13판(2026)",
  scope: "상위 30개 다출원 품목",
  curatedAt: "2026-09-10",
  items,
};
const outPath = path.join(ROOT, "02-normalize-items/data/notice-name-aliases-v1.json");
fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
const total = items.reduce((n, i) => n + i.aliases.length, 0);
console.log(`${items.length}개 품목 · 별칭 ${total}개 → ${outPath}`);
for (const i of items) {
  const byStage = { raw: 0, processed: 0, service: 0 };
  for (const a of i.aliases) byStage[a.stage]++;
  console.log(
    `  ${i.noticeName.padEnd(14)} 총 ${String(i.aliases.length).padStart(2)} (원물 ${byStage.raw} · 가공 ${byStage.processed} · 서비스 ${byStage.service})`
  );
}
