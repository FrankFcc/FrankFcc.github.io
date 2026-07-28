#!/usr/bin/env python3
"""Fetch official maimai Japan, US-area, or worldwide locations from ALL.Net.

Japan data comes from the maimai Japan site's ALL.Net title id gm=96.
US data is filtered from the maimai DX International Version North America
ALL.Net result page, title id gm=98 and country id ct=1009.
Worldwide data covers every enabled country/area on the gm=98 locator.
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
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
from xml.sax.saxutils import escape as xml_escape


BASE_URL = "https://location.am-all.net/alm/location"
SHOP_URL = "https://location.am-all.net/alm/shop"
JP_GM = "96"
INTL_GM = "98"
JAPAN_COUNTRY = "1000"
NORTH_AMERICA_COUNTRY = "1009"
INTL_AREAS = [
    ("1001", "Taiwan"),
    ("1002", "Hong Kong"),
    ("1003", "Singapore"),
    ("1004", "Malaysia"),
    ("1005", "Korea"),
    ("1006", "Thailand"),
    ("1007", "Indonesia"),
    ("1008", "Macau"),
    ("1009", "North America"),
    ("1010", "Philippines"),
    ("1011", "Viet Nam"),
    ("1012", "Australia"),
    ("1013", "Myanmar"),
    ("1014", "New Zealand"),
]
INTL_AREA_BOUNDS = {
    "Taiwan": (21.5, 26.5, 119.0, 123.0),
    "Hong Kong": (22.1, 22.7, 113.7, 114.6),
    "Singapore": (1.1, 1.6, 103.5, 104.1),
    "Malaysia": (0.5, 7.5, 99.0, 120.0),
    "Korea": (33.0, 39.5, 124.0, 132.0),
    "Thailand": (5.0, 21.0, 97.0, 106.0),
    "Indonesia": (-11.5, 6.5, 94.0, 142.0),
    "Macau": (22.0, 22.3, 113.4, 113.7),
    "North America": (7.0, 75.0, -180.0, -50.0),
    "Philippines": (4.0, 22.0, 116.0, 127.0),
    "Viet Nam": (8.0, 24.0, 102.0, 110.0),
    "Australia": (-44.5, -9.0, 112.0, 154.0),
    "Myanmar": (9.0, 29.0, 92.0, 102.0),
    "New Zealand": (-48.0, -33.0, 165.0, 180.0),
}

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

STORE_ITEM_RE = re.compile(r"<li>\s*(.*?)</li>", re.S)
STORE_NAME_RE = re.compile(r'<span class="store_name">(.*?)</span>', re.S)
STORE_ADDRESS_RE = re.compile(r'<span class="store_address">(.*?)</span>', re.S)
STORE_COORDINATES_RE = re.compile(
    r"maps\.google\.com/maps\?q=.*?@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)&zoom=\d+",
    re.S,
)
STORE_SID_RE = re.compile(r"(?:&|&amp;)sid=(\d+)")
RESULT_COUNT_RE = re.compile(
    r"[（(](?:\s|<[^>]+>)*(\d+)(?:\s|<[^>]+>)*(?:locations|店舗)",
    re.I,
)
COUNTRY_SELECT_RE = re.compile(
    r'<select\b[^>]*\bname=["\']ct["\'][^>]*>(.*?)</select>',
    re.I | re.S,
)
OPTION_RE = re.compile(r"<option\b(?P<attrs>[^>]*)>(?P<label>.*?)</option>", re.I | re.S)
OPTION_VALUE_RE = re.compile(r'\bvalue=["\']([^"\']+)["\']', re.I)


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
    count_match = RESULT_COUNT_RE.search(markup)
    if not count_match:
        raise ValueError(f"locator result count is missing: {source_url}")

    stores: list[dict[str, object]] = []
    for item_match in STORE_ITEM_RE.finditer(markup):
        item_markup = item_match.group(1)
        name_match = STORE_NAME_RE.search(item_markup)
        address_match = STORE_ADDRESS_RE.search(item_markup)
        sid_match = STORE_SID_RE.search(item_markup)
        if not name_match or not address_match or not sid_match:
            continue
        coordinate_match = STORE_COORDINATES_RE.search(item_markup)
        lat = float(coordinate_match.group(1)) if coordinate_match else 0.0
        lng = float(coordinate_match.group(2)) if coordinate_match else 0.0
        stores.append(
            {
                "sid": sid_match.group(1),
                "name": clean(name_match.group(1)),
                "address": clean(address_match.group(1)),
                "lat": None if lat == 0.0 and lng == 0.0 else lat,
                "lng": None if lat == 0.0 and lng == 0.0 else lng,
                "needsGeocode": lat == 0.0 and lng == 0.0,
                "sourceUrl": source_url,
            }
        )
    if len(stores) != int(count_match.group(1)):
        raise ValueError(
            f"parsed {len(stores)} stores but locator reports {count_match.group(1)}: {source_url}"
        )
    return stores


def japan_url(prefecture_index: int) -> str:
    return f"{BASE_URL}?gm={JP_GM}&ct={JAPAN_COUNTRY}&at={prefecture_index}"


def north_america_url() -> str:
    return f"{BASE_URL}?gm={INTL_GM}&ct={NORTH_AMERICA_COUNTRY}&lang=en"


def international_area_url(country_id: str) -> str:
    return f"{BASE_URL}?gm={INTL_GM}&ct={country_id}&lang=en"


def parse_international_areas(markup: str) -> list[tuple[str, str]]:
    select_match = COUNTRY_SELECT_RE.search(markup)
    if not select_match:
        raise ValueError("international country selector is missing")
    areas: list[tuple[str, str]] = []
    for option_match in OPTION_RE.finditer(select_match.group(1)):
        attrs = option_match.group("attrs")
        if re.search(r"\bdisabled\b", attrs, re.I):
            continue
        value_match = OPTION_VALUE_RE.search(attrs)
        if not value_match:
            continue
        areas.append((value_match.group(1), clean(option_match.group("label"))))
    return areas


def coordinates_in_area(store: dict[str, object], area_name: str) -> bool:
    lat = store.get("lat")
    lng = store.get("lng")
    if lat is None or lng is None:
        return True
    min_lat, max_lat, min_lng, max_lng = INTL_AREA_BOUNDS[area_name]
    return min_lat <= float(lat) <= max_lat and min_lng <= float(lng) <= max_lng


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
                    "detailsUrl": f"{SHOP_URL}?gm={JP_GM}&astep={index}&sid={store['sid']}",
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
                "detailsUrl": f"{SHOP_URL}?gm={INTL_GM}&astep={NORTH_AMERICA_COUNTRY}&sid={store['sid']}&lang=en",
            }
        )
        output.append(store)
    print(f"United States from North America page: {len(output)}", file=sys.stderr)
    return output


def fetch_worldwide() -> list[dict[str, object]]:
    selector_url = f"{BASE_URL}?gm={INTL_GM}&lang=en"
    enabled_areas = parse_international_areas(fetch(selector_url))
    if enabled_areas != INTL_AREAS:
        raise ValueError(
            f"enabled international areas changed: expected {INTL_AREAS!r}, got {enabled_areas!r}"
        )

    output: list[dict[str, object]] = []
    for country_id, area_name in INTL_AREAS:
        url = international_area_url(country_id)
        stores = parse_stores(fetch(url), source_url=url)
        for store in stores:
            store.update(
                {
                    "id": f"intl-{country_id}-{store['sid']}",
                    "source": "maimai International official / ALL.Net",
                    "gameTitle": "maimai DX International Version",
                    "country": area_name,
                    "region": "Worldwide",
                    "subregion": "",
                    "officialLocatorUrl": url,
                    "detailsUrl": (
                        f"{SHOP_URL}?gm={INTL_GM}"
                        f"&astep={country_id}&sid={store['sid']}&lang=en"
                    ),
                }
            )
            if not coordinates_in_area(store, area_name):
                store.update(
                    {
                        "officialLat": store["lat"],
                        "officialLng": store["lng"],
                        "lat": None,
                        "lng": None,
                        "needsGeocode": True,
                        "coordinateIssue": "official coordinate falls outside its assigned area",
                    }
                )
        print(f"Worldwide {area_name}: {len(stores)}", file=sys.stderr)
        output.extend(stores)
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
    return f"https://www.google.com/maps/search/?api=1&query={quote_plus(query)}"


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
        f"    <name>{xml_escape(str(payload.get('label', 'maimai Locations')))}</name>",
        "    <Style id=\"primary\"><IconStyle><color>ff3a4ad8</color><scale>0.85</scale></IconStyle></Style>",
        "    <Style id=\"secondary\"><IconStyle><color>ff9c6f25</color><scale>0.85</scale></IconStyle></Style>",
    ]
    for country, stores in sorted(by_country.items()):
        lines.append("    <Folder>")
        lines.append(f"      <name>{xml_escape(country)}</name>")
        for store in stores:
            style = "primary" if country == "Japan" else "secondary"
            description = (
                f"{store['address']}<br/>"
                f"{store['gameTitle']}<br/>"
                f"{store['source']}<br/>"
                f"<a href=\"{store.get('detailsUrl', store['officialLocatorUrl'])}\">Official detail</a>"
            )
            area = store.get("subregion") or country
            lines.extend(
                [
                    "      <Placemark>",
                    f"        <name>{xml_escape(str(store['name']))}</name>",
                    f"        <description>{xml_escape(description)}</description>",
                    f"        <styleUrl>#{style}</styleUrl>",
                    "        <ExtendedData>",
                    f"          <Data name=\"id\"><value>{xml_escape(str(store['id']))}</value></Data>",
                    f"          <Data name=\"area\"><value>{xml_escape(str(area))}</value></Data>",
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

    mapped = sum(1 for store in stores if not store["needsGeocode"])
    summary = {
        "total": len(stores),
        "mapped": mapped,
        "japan": sum(1 for store in stores if store["country"] == "Japan"),
        "unitedStates": sum(1 for store in stores if store["country"] == "United States"),
        "needsGeocode": len(stores) - mapped,
        "areaCount": 2,
    }
    return {
        "schemaVersion": 2,
        "id": "current",
        "label": "maimai Japan + United States",
        "mapMode": "locations",
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


def build_worldwide_payload() -> dict[str, object]:
    stores = dedupe(fetch_worldwide())
    stores.sort(key=lambda item: (str(item["country"]), str(item["name"])))

    map_groups: list[dict[str, object]] = []
    area_summary: dict[str, dict[str, int]] = {}
    for country_id, area_name in INTL_AREAS:
        area_stores = [store for store in stores if store["country"] == area_name]
        mapped_stores = [store for store in area_stores if not store["needsGeocode"]]
        if mapped_stores:
            lat = sum(float(store["lat"]) for store in mapped_stores) / len(mapped_stores)
            lng = sum(float(store["lng"]) for store in mapped_stores) / len(mapped_stores)
            map_groups.append(
                {
                    "id": f"intl-area-{country_id}",
                    "key": area_name,
                    "name": area_name,
                    "country": area_name,
                    "subregion": "",
                    "lat": round(lat, 7),
                    "lng": round(lng, 7),
                    "count": len(area_stores),
                    "mapped": len(mapped_stores),
                    "needsGeocode": len(area_stores) - len(mapped_stores),
                    "aggregate": True,
                }
            )
        area_summary[area_name] = {
            "total": len(area_stores),
            "mapped": len(mapped_stores),
            "needsGeocode": len(area_stores) - len(mapped_stores),
        }

    mapped = sum(1 for store in stores if not store["needsGeocode"])
    coordinate_outliers = sum(1 for store in stores if store.get("coordinateIssue"))
    return {
        "schemaVersion": 2,
        "id": "worldwide",
        "label": "maimai Worldwide — official ALL.Net coverage",
        "mapMode": "grouped-overview",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": [
            {
                "name": "maimai DX International Version / ALL.Net Games Locator",
                "url": "https://maimai.sega.com/",
                "locator": f"{BASE_URL}?gm={INTL_GM}&lang=en",
            }
        ],
        "notes": [
            "The official locator covers 14 enabled country/area pages; it is not an exhaustive list of every country.",
            "The overview uses one summary marker per official area. Select an area to show exact store markers.",
            (
                f"{coordinate_outliers} official coordinates outside their assigned area were "
                "kept in the list but excluded from the map."
            ),
        ],
        "summary": {
            "total": len(stores),
            "mapped": mapped,
            "needsGeocode": len(stores) - mapped,
            "coordinateOutliers": coordinate_outliers,
            "areaCount": len(area_summary),
            "areas": area_summary,
        },
        "mapGroups": map_groups,
        "locations": stores,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--worldwide",
        action="store_true",
        help="fetch every enabled maimai International country/area instead of Japan + US",
    )
    parser.add_argument(
        "--output",
        help="output JSON path relative to the site root",
    )
    parser.add_argument(
        "--from-json",
        help="read an existing JSON dataset and only regenerate CSV/KML exports",
    )
    parser.add_argument("--csv-output", help="CSV path for Google My Maps import")
    parser.add_argument("--kml-output", help="KML path for Google My Maps import")
    args = parser.parse_args()

    default_output = (
        "static/data/maimai_locations_worldwide.json"
        if args.worldwide
        else "static/data/maimai_locations.json"
    )
    output_path = Path(args.output or default_output)
    if args.from_json:
        payload = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
    else:
        payload = build_worldwide_payload() if args.worldwide else build_payload()
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
