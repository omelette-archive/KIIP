#!/usr/bin/env node
/**
 * 시군구별 상표 출원 통계 대시보드용 샘플(합성) 데이터 생성기.
 * 실제 KIPRIS 데이터로 교체할 때는 이 스크립트가 만드는 것과 동일한
 * 컬럼 구조(data/sample_trademark_data.csv)를 유지하면 대시보드 코드를 그대로 쓸 수 있다.
 */

const fs = require("fs");
const path = require("path");

// 시도 + 시군구 + 상대 출원 비중(가중치). 가중치는 인구/사업체 밀도를 대략 반영한 가상의 값.
const REGIONS = [
  ["서울특별시", "강남구", 32],
  ["서울특별시", "서초구", 24],
  ["서울특별시", "마포구", 16],
  ["서울특별시", "영등포구", 14],
  ["서울특별시", "송파구", 15],
  ["서울특별시", "성동구", 11],
  ["서울특별시", "중구", 10],
  ["서울특별시", "종로구", 9],
  ["경기도", "성남시 분당구", 22],
  ["경기도", "수원시 영통구", 13],
  ["경기도", "용인시 기흥구", 10],
  ["경기도", "화성시", 9],
  ["경기도", "고양시 일산동구", 8],
  ["경기도", "부천시", 7],
  ["인천광역시", "연수구", 9],
  ["인천광역시", "남동구", 7],
  ["부산광역시", "해운대구", 10],
  ["부산광역시", "부산진구", 7],
  ["대구광역시", "수성구", 8],
  ["대구광역시", "달서구", 6],
  ["광주광역시", "서구", 6],
  ["대전광역시", "유성구", 9],
  ["울산광역시", "남구", 6],
  ["세종특별자치시", "세종시", 5],
  ["강원특별자치도", "춘천시", 4],
  ["강원특별자치도", "원주시", 4],
  ["충청북도", "청주시 흥덕구", 6],
  ["충청남도", "천안시 서북구", 6],
  ["전북특별자치도", "전주시 덕진구", 5],
  ["전라남도", "여수시", 4],
  ["경상북도", "포항시 남구", 5],
  ["경상남도", "창원시 성산구", 7],
  ["제주특별자치도", "제주시", 5],
];

const YEAR_WEIGHTS = [
  [2021, 8],
  [2022, 9],
  [2023, 10],
  [2024, 12],
  [2025, 13],
];

const STATUS_WEIGHTS = [
  ["등록", 58],
  ["출원중", 27],
  ["거절", 10],
  ["소멸", 5],
];

const NICE_CLASSES = [
  [35, "광고업/판매업"],
  [30, "식품"],
  [25, "의류"],
  [9, "전자/소프트웨어"],
  [41, "교육/문화"],
  [43, "요식업"],
  [3, "화장품"],
  [42, "IT서비스"],
  [44, "의료/미용"],
  [21, "생활용품"],
];

const NAME_PARTS_1 = [
  "한빛", "미르", "다솜", "온새미", "새록", "푸른", "하늘", "다온", "이든", "가온",
  "누리", "별빛", "solar", "nova", "prime", "third", "true", "smart", "green", "urban",
];
const NAME_PARTS_2 = [
  "코리아", "랩스", "스튜디오", "컴퍼니", "브루", "키친", "베이커리", "테크", "메디컬", "디자인",
  "물산", "상사", "전자", "F&B", "코스메틱", "플랫폼",
];

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function weightedPick(rand, weightedItems) {
  const total = weightedItems.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const item of weightedItems) {
    r -= item[1];
    if (r <= 0) return item;
  }
  return weightedItems[weightedItems.length - 1];
}

function pad(n, len) {
  return String(n).padStart(len, "0");
}

function generate(count, seed) {
  const rand = seededRandom(seed);
  const rows = [];

  for (let i = 0; i < count; i++) {
    const [[sido, sigungu]] = weightedPick(rand, REGIONS.map(([s, g, w]) => [[s, g], w]));
    const [year] = weightedPick(rand, YEAR_WEIGHTS);
    const [status] = weightedPick(rand, STATUS_WEIGHTS);
    const [[niceClass, niceLabel]] = weightedPick(rand, NICE_CLASSES.map(([c, l]) => [[c, l], 1]));

    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    const applicationDate = `${year}-${pad(month, 2)}-${pad(day, 2)}`;

    const applicant =
      NAME_PARTS_1[Math.floor(rand() * NAME_PARTS_1.length)] +
      NAME_PARTS_2[Math.floor(rand() * NAME_PARTS_2.length)];
    const trademarkName =
      NAME_PARTS_1[Math.floor(rand() * NAME_PARTS_1.length)] +
      (rand() > 0.5 ? NAME_PARTS_2[Math.floor(rand() * NAME_PARTS_2.length)] : "");

    rows.push({
      application_no: `40-2026-${pad(100000 + i, 7)}`,
      trademark_name: trademarkName,
      applicant_name: applicant,
      sido,
      sigungu,
      application_date: applicationDate,
      year,
      nice_class: niceClass,
      nice_class_label: niceLabel,
      status,
    });
  }

  return rows;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

const COUNT = 600;
const SEED = 20260804;
const rows = generate(COUNT, SEED);

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "sample_trademark_data.csv"), toCsv(rows), "utf8");
fs.writeFileSync(
  path.join(dataDir, "sample_trademark_data.json"),
  JSON.stringify(rows, null, 2),
  "utf8"
);

console.log(`Generated ${rows.length} sample rows -> data/sample_trademark_data.{csv,json}`);
