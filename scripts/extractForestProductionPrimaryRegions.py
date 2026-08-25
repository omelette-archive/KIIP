#!/usr/bin/env python3
"""Extract 2024 official primary forest-product regions and link them to KOFPI items."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber


SOURCE_URL = "https://kfss.forest.go.kr/stat/ptl/article/articleDtl.do?bbsId=ptlPdsMntProdReq&articleSeq=2664"
SOURCE_FILE_URL = "https://kfss.forest.go.kr/stat/ptl/article/articleFileDown.do?fileSeq=8135&workSeq=2664"
ALIASES = {
    "복분자딸기": "복분자",
    "생표고": "표고",
    "건표고": "표고",
    "고로쇠": "수액",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="2024 임산물생산조사 PDF")
    parser.add_argument(
        "--kofpi",
        default="02-normalize-items/data/kofpi-forest-products-v1.json",
        help="KOFPI 90품목 사전",
    )
    parser.add_argument(
        "--output",
        default="02-normalize-items/data/kofpi-primary-regions-2024.json",
        help="생성할 지역 근거 JSON",
    )
    return parser.parse_args()


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_tables(pdf_path: Path) -> list[dict]:
    rows = []
    with pdfplumber.open(pdf_path) as document:
        # PDF pages 38-46 contain tables 19-45, the explicitly published primary regions.
        for page_index in range(37, 46):
            text = document.pages[page_index].extract_text() or ""
            headings = list(re.finditer(r"표(\d+)\s+l\s+(.+?)\s+주산지 현황", text))
            for index, heading in enumerate(headings):
                end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
                block = text[heading.start():end]
                primary = re.search(r"주산지\s*:\s*.*?→\s*[’']24\s+(.+?)\s*\(단위", block, re.S)
                unit = re.search(r"\(단위\s*:\s*([^,)]+)", block)
                if not primary:
                    raise ValueError(f"표 {heading.group(1)}의 2024 주산지를 추출하지 못했습니다")
                region = clean(primary.group(1))
                parts = region.split(" ", 1)
                if len(parts) != 2:
                    raise ValueError(f"시도·시군구 분리 실패: {region}")
                rows.append({
                    "tableNumber": int(heading.group(1)),
                    "sourceItemName": clean(heading.group(2)),
                    "sido": parts[0],
                    "sigungu": parts[1],
                    "region": region,
                    "productionUnit": clean(unit.group(1)) if unit else None,
                    "pdfPage": page_index + 1,
                })
    if len(rows) != 27 or {row["tableNumber"] for row in rows} != set(range(19, 46)):
        raise ValueError(f"주산지 표 19-45를 모두 추출해야 합니다: {len(rows)}개")
    return rows


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.input).resolve()
    kofpi_path = Path(args.kofpi).resolve()
    output_path = Path(args.output).resolve()
    kofpi = json.loads(kofpi_path.read_text(encoding="utf-8"))
    kofpi_names = set(kofpi["items"])
    tables = extract_tables(pdf_path)

    evidence = []
    unmatched = []
    for row in tables:
        item_name = ALIASES.get(row["sourceItemName"], row["sourceItemName"])
        if item_name not in kofpi_names:
            unmatched.append(row)
            continue
        evidence.append({
            "itemName": item_name,
            **row,
            "matchMethod": "approved_alias" if item_name != row["sourceItemName"] else "exact_item_name",
            "evidenceType": "official_primary_production_region",
            "evidenceStrength": "strong",
            "referenceYear": 2024,
            "regionalMetricEligible": False,
            "regionalMetricBlockingReason": "상표 출원인 주소를 이 주산지 기준으로 다시 귀속하기 전까지 지역 상표 지표에 사용하지 않음",
        })

    grouped = {}
    for row in evidence:
        grouped.setdefault(row["itemName"], []).append(row)

    output = {
        "schemaVersion": "kofpi-primary-regions-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "referenceYear": 2024,
        "sourceName": "산림청·한국임업진흥원 2024년 임산물생산조사",
        "sourceUrl": SOURCE_URL,
        "sourceFileUrl": SOURCE_FILE_URL,
        "sourceFileSha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        "policy": {
            "scope": "보고서가 명시적으로 공표한 주요 단기소득 임산물의 2024년 주산지",
            "use": "KOFPI 전국 품목에 지역 근거를 표시하는 용도",
            "exclusion": "생산량 전체 시군구표와 출원인 주소 재귀속 전에는 지역 상표 통계 분모·분자에 넣지 않음",
        },
        "counts": {
            "kofpiCatalogItems": len(kofpi_names),
            "sourcePrimaryRegionTables": len(tables),
            "matchedEvidenceRows": len(evidence),
            "matchedKofpiItems": len(grouped),
            "unmatchedSourceTables": len(unmatched),
        },
        "items": grouped,
        "unmatchedSourceTables": unmatched,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
