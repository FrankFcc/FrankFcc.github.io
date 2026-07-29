#!/usr/bin/env python3
"""Build the compact Baidu overview hierarchy used by the maimai map."""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = (
    "https://raw.githubusercontent.com/"
    "boyan01/ChinaRegionDistrict/master/region.json"
)
DEFAULT_OUTPUT = ROOT / "static" / "data" / "maimai_china_region_hierarchy.json"
PROVINCE_CENTERS = ROOT / "static" / "data" / "maimai_china_province_centers.json"
X_PI = math.pi * 3000.0 / 180.0


def gcj02_to_bd09(longitude: float, latitude: float) -> tuple[float, float]:
    """Convert an AMap/GCJ-02 point to a Baidu/BD-09 point."""

    radius = math.hypot(longitude, latitude) + 0.00002 * math.sin(latitude * X_PI)
    theta = math.atan2(latitude, longitude) + 0.000003 * math.cos(longitude * X_PI)
    return (
        round(radius * math.cos(theta) + 0.0065, 6),
        round(radius * math.sin(theta) + 0.006, 6),
    )


def short_province_name(name: str) -> str:
    suffixes = (
        "维吾尔自治区",
        "壮族自治区",
        "回族自治区",
        "特别行政区",
        "自治区",
        "省",
        "市",
    )
    for suffix in suffixes:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def converted_center(region: dict[str, Any]) -> tuple[float, float]:
    center = region["center"]
    return gcj02_to_bd09(
        float(center["longitude"]),
        float(center["latitude"]),
    )


def compact_district(region: dict[str, Any]) -> dict[str, Any]:
    longitude, latitude = converted_center(region)
    return {
        "key": region["name"],
        "name": region["name"],
        "lat": latitude,
        "lng": longitude,
    }


def compact_city(region: dict[str, Any]) -> dict[str, Any]:
    longitude, latitude = converted_center(region)
    return {
        "key": region["name"],
        "name": region["name"],
        "lat": latitude,
        "lng": longitude,
        "districts": [
            compact_district(district)
            for district in region.get("districts", [])
            if district.get("center")
        ],
    }


def load_json(source: str) -> Any:
    path = Path(source)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    request = urllib.request.Request(
        source,
        headers={"User-Agent": "FrankFcc-maimai-map-hierarchy-builder/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def build(source: str, output: Path) -> dict[str, Any]:
    raw = load_json(source)
    centers = json.loads(PROVINCE_CENTERS.read_text(encoding="utf-8"))
    group_by_key = {group["key"]: group for group in centers["mapGroups"]}
    raw_by_key = {
        short_province_name(province["name"]): province
        for province in raw.get("districts", [])
        if province.get("level") == "province"
    }
    missing = sorted(set(group_by_key) - set(raw_by_key))
    if missing:
        raise RuntimeError(f"Missing upstream provinces: {', '.join(missing)}")

    regions = []
    map_groups = []
    for key, old_group in group_by_key.items():
        province = raw_by_key[key]
        longitude, latitude = converted_center(province)
        map_groups.append(
            {
                "id": old_group["id"],
                "key": key,
                "name": key,
                "lat": latitude,
                "lng": longitude,
            }
        )
        regions.append(
            {
                "key": key,
                "name": province["name"],
                "aliases": [key],
                "lat": latitude,
                "lng": longitude,
                "cities": [
                    compact_city(city)
                    for city in province.get("districts", [])
                    if city.get("center")
                ],
            }
        )

    payload = {
        "schemaVersion": 1,
        "generatedAt": "2026-07-28T00:00:00Z",
        "coordinateSystem": "BD-09",
        "coordinatePrecision": "administrative-center",
        "source": {
            "name": "ChinaRegionDistrict administrative centers (derived from AMap)",
            "url": "https://github.com/boyan01/ChinaRegionDistrict",
            "coordinateSystem": "GCJ-02",
        },
        "conversion": {
            "name": "Offline GCJ-02 to BD-09 conversion",
            "reference": (
                "https://lbsyun.baidu.com/docs/jsapi"
                "?title=jspopularGL/guide/coorinfo"
            ),
        },
        "mapGroups": map_groups,
        "regions": regions,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = build(args.source, args.output)
    city_count = sum(len(province["cities"]) for province in payload["regions"])
    district_count = sum(
        len(city["districts"])
        for province in payload["regions"]
        for city in province["cities"]
    )
    print(
        f"Wrote {len(payload['regions'])} provinces, "
        f"{city_count} cities, and {district_count} districts to {args.output}"
    )


if __name__ == "__main__":
    main()
