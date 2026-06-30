#!/usr/bin/env python3
"""Fetch official maimai Japan and US-area locations from ALL.Net.

Japan data comes from the maimai Japan site's ALL.Net title id gm=96.
US data is filtered from the maimai DX International Version North America
ALL.Net result page, title id gm=98 and country id ct=1009.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen
from xml.sax.saxutils import escape as xml_escape


BASE_URL = "https://location.am-all.net/alm/location"
JP_GM = "96"
INTL_GM = "98"
JAPAN_COUNTRY = "1000"
NORTH_AMERICA_COUNTRY = "1009"

PREFECTURES = [
    "Hokkaido",
    "Aomori",
    "Iwate",
    "Miyagi",
    "Akita",
    "Yamagata",
    "Fukushima",
    "Ibaraki",
    "Tochigi",
    "Gunma",
    "Saitama",
    "Chiba",
    "Tokyo",
    "Kanagawa",
    "Niigata",
    "Toyama",
    "Ishikawa",
    "Fukui",
    "Yamanashi",
    "Nagano",
    "Gifu",
    "Shizuoka",
    "Aichi",
    "Mie",
    "Shiga",
    "Kyoto",
    "Osaka",
    "Hyogo",
    "Nara",
    "Wakayama",
    "Tottori",
    "Shimane",
    "Okayama",
    "Hiroshima",
    "Yamaguchi",
    "Tokushima",
    "Kagawa",
    "Ehime",
    "Kochi",
    "Fukuoka",
    "Saga",
    "Nagasaki",
    "Kumamoto",
    "Oita",
    "Miyazaki",
    "Kagoshima",
    "Okinawa",
]

US_STATES = {
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "IA",
    "ID",
    "IL",
    "IN",
    "KS",
    "KY",
    "LA",
    "MA",
    "MD",
    "ME",
    "MI",
    "MN",
    "MO",
    "MS",
    "MT",
    "NC",
    "ND",
    "NE",
    "NH",
    "NJ",
    "NM",
    "NV",
    "NY",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VA",
    "VT",
    "WA",
    "WI",
    "WV",
    "WY",
    "DC",
}

STORE_RE = re.compile(
    r"<li>\s*"
    r'.*?<span class="store_name">(.*?)</span>\s*'
    r'.*?<span class="store_address">(.*?)</span>\s*'
    r".*?maps\.google\.com/maps\?q=(.*?)@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)&zoom=16(?:&hl=en)?"
    r".*?sid=(\d+)",
    re.S,
)


def fetch(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 maimai-location-visualizer/1.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8", errors="replace")


def clean(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def parse_stores(markup: str, *, source_url: str) -> list[dict[str, object]]:
    stores: list[dict[str, object]] = []
    for match in STORE_RE.finditer(markup):
        name, address, _map_query, lat_raw, lng_raw, sid = match.groups()
        lat = float(lat_raw)
        lng = float(lng_raw)
        stores.append(
            {
                "sid": sid,
                "name": clean(name),
                "address": clean(address),
                "lat": None if lat == 0.0 and lng == 0.0 else lat,
                "lng": None if lat == 0.0 and lng == 0.0 else lng,
                "needsGeocode": lat == 0.0 and lng == 0.0,
                "sourceUrl": source_url,
            }
        )
    return stores


def japan_url(prefecture_index: int) -> str:
    return f"{BASE_URL}?gm={JP_GM}&ct={JAPAN_COUNTRY}&at={prefecture_index}"


def north_america_url() -> str:
    return f"{BASE_URL}?gm={INTL_GM}&ct={NORTH_AMERICA_COUNTRY}&lang=en"


def us_state_from_address(address: str) -> str | None:
    upper = address.upper()
    match = re.search(r"(?:^|[\s,])([A-Z]{2})\s*\d{5}(?:-\d{4})?\b", upper)
    if not match:
        return None
    state = match.group(1)
    return state if state in US_STATES else None


def fetch_japan() -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for index, prefecture in enumerate(PREFECTURES):
        url = japan_url(index)
        stores = parse_stores(fetch(url), source_url=url)
        for store in stores:
            store.update(
                {
                    "id": f"jp-{store['sid']}",
                    "source": "maimai JP official / ALL.Net",
                    "gameTitle": "maimai DX Japan",
                    "country": "Japan",
                    "region": "Japan",
                    "subregion": prefecture,
                    "officialLocatorUrl": url,
                    "detailsUrl": f"{BASE_URL.replace('/location', '/shop')}?gm={JP_GM}&astep={index}&sid={store['sid']}",
                }
            )
        print(f"Japan {prefecture}: {len(stores)}", file=sys.stderr)
        output.extend(stores)
    return output


def fetch_us() -> list[dict[str, object]]:
    url = north_america_url()
    stores = parse_stores(fetch(url), source_url=url)
    output: list[dict[str, object]] = []
    for store in stores:
        state = us_state_from_address(str(store["address"]))
        if not state:
            continue
        store.update(
            {
                "id": f"us-{store['sid']}",
                "source": "maimai International official / ALL.Net",
                "gameTitle": "maimai DX International Version",
                "country": "United States",
                "region": "United States",
                "subregion": state,
                "officialLocatorUrl": url,
                "detailsUrl": f"{BASE_URL.replace('/location', '/shop')}?gm={INTL_GM}&astep={NORTH_AMERICA_COUNTRY}&sid={store['sid']}&lang=en",
            }
        )
        output.append(store)
    print(f"United States from North America page: {len(output)}", file=sys.stderr)
    return output


def dedupe(stores: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[str] = set()
    unique: list[dict[str, object]] = []
    for store in stores:
        key = str(store["id"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(store)
    return unique


def google_maps_search_url(store: dict[str, object]) -> str:
    query = f"{store['name']} {store['address']}"
    return f"https://www.google.com/maps/search/?api=1&query={html.escape(query, quote=True).replace(' ', '+')}"


def write_csv(payload: dict[str, object], output_path: Path) -> None:
    locations = payload["locations"]
    fieldnames = [
        "id",
        "name",
        "country",
        "subregion",
        "address",
        "latitude",
        "longitude",
        "gameTitle",
        "source",
        "officialLocatorUrl",
        "detailsUrl",
        "needsGeocode",
        "googleMapsSearchUrl",
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for store in locations:
            writer.writerow(
                {
                    "id": store["id"],
                    "name": store["name"],
                    "country": store["country"],
                    "subregion": store["subregion"],
                    "address": store["address"],
                    "latitude": "" if store["lat"] is None else store["lat"],
                    "longitude": "" if store["lng"] is None else store["lng"],
                    "gameTitle": store["gameTitle"],
                    "source": store["source"],
                    "officialLocatorUrl": store["officialLocatorUrl"],
                    "detailsUrl": store["detailsUrl"],
                    "needsGeocode": store["needsGeocode"],
                    "googleMapsSearchUrl": google_maps_search_url(store),
                }
            )


def write_kml(payload: dict[str, object], output_path: Path) -> None:
    by_country: dict[str, list[dict[str, object]]] = {}
    for store in payload["locations"]:
        if store["lat"] is None or store["lng"] is None:
            continue
        by_country.setdefault(str(store["country"]), []).append(store)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        "  <Document>",
        "    <name>maimai Japan and United States Locations</name>",
        "    <Style id=\"jp\"><IconStyle><color>ff3a4ad8</color><scale>0.85</scale></IconStyle></Style>",
        "    <Style id=\"us\"><IconStyle><color>ff9c6f25</color><scale>0.85</scale></IconStyle></Style>",
    ]
    for country, stores in sorted(by_country.items()):
        lines.append("    <Folder>")
        lines.append(f"      <name>{xml_escape(country)}</name>")
        for store in stores:
            style = "jp" if country == "Japan" else "us"
            description = (
                f"{store['address']}<br/>"
                f"{store['gameTitle']}<br/>"
                f"{store['source']}<br/>"
                f"<a href=\"{store['detailsUrl']}\">Official detail</a>"
            )
            lines.extend(
                [
                    "      <Placemark>",
                    f"        <name>{xml_escape(str(store['name']))}</name>",
                    f"        <description>{xml_escape(description)}</description>",
                    f"        <styleUrl>#{style}</styleUrl>",
                    "        <ExtendedData>",
                    f"          <Data name=\"id\"><value>{xml_escape(str(store['id']))}</value></Data>",
                    f"          <Data name=\"area\"><value>{xml_escape(str(store['subregion']))}</value></Data>",
                    f"          <Data name=\"address\"><value>{xml_escape(str(store['address']))}</value></Data>",
                    "        </ExtendedData>",
                    "        <Point>",
                    f"          <coordinates>{store['lng']},{store['lat']},0</coordinates>",
                    "        </Point>",
                    "      </Placemark>",
                ]
            )
        lines.append("    </Folder>")
    lines.extend(["  </Document>", "</kml>", ""])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def default_export_paths(json_path: Path) -> tuple[Path, Path]:
    return json_path.with_suffix(".csv"), json_path.with_suffix(".kml")


def build_payload() -> dict[str, object]:
    stores = dedupe(fetch_japan() + fetch_us())
    stores.sort(key=lambda item: (str(item["country"]), str(item["subregion"]), str(item["name"])))

    summary = {
        "total": len(stores),
        "japan": sum(1 for store in stores if store["country"] == "Japan"),
        "unitedStates": sum(1 for store in stores if store["country"] == "United States"),
        "needsGeocode": sum(1 for store in stores if store["needsGeocode"]),
    }
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": [
            {
                "name": "maimai DX Japan official site",
                "url": "https://maimai.sega.jp/",
                "locator": f"{BASE_URL}?gm={JP_GM}",
            },
            {
                "name": "maimai DX International Version official site",
                "url": "https://maimai.sega.com/",
                "locator": f"{BASE_URL}?gm={INTL_GM}&lang=en",
            },
        ],
        "summary": summary,
        "locations": stores,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="static/data/maimai_locations.json",
        help="output JSON path relative to the site root",
    )
    parser.add_argument(
        "--from-json",
        help="read an existing JSON dataset and only regenerate CSV/KML exports",
    )
    parser.add_argument("--csv-output", help="CSV path for Google My Maps import")
    parser.add_argument("--kml-output", help="KML path for Google My Maps import")
    args = parser.parse_args()

    output_path = Path(args.output)
    if args.from_json:
        payload = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
    else:
        payload = build_payload()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    default_csv, default_kml = default_export_paths(output_path)
    write_csv(payload, Path(args.csv_output) if args.csv_output else default_csv)
    write_kml(payload, Path(args.kml_output) if args.kml_output else default_kml)

    print(json.dumps(payload["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except URLError as exc:
        print(f"network error: {exc}", file=sys.stderr)
        raise SystemExit(1)
