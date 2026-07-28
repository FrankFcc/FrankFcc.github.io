#!/usr/bin/env python3
"""Regression checks for the generated maimai location datasets."""

from __future__ import annotations

import csv
import json
import unittest
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from xml.etree import ElementTree

import fetch_maimai_locations as locations


ROOT = Path(__file__).resolve().parents[1]
WORLDWIDE_PATH = ROOT / "static" / "data" / "maimai_locations_worldwide.json"
WORLDWIDE_CSV_PATH = WORLDWIDE_PATH.with_suffix(".csv")
WORLDWIDE_KML_PATH = WORLDWIDE_PATH.with_suffix(".kml")
CHINA_CENTERS_PATH = ROOT / "static" / "data" / "maimai_china_province_centers.json"


class LocatorParserTests(unittest.TestCase):
    def test_accepts_non_default_zoom_and_list_only_records(self) -> None:
        markup = """
        <div class="result_count">(2 locations)</div>
        <li>
          <span class="store_name">RETROCITY &amp; CONCEPT</span>
          <span class="store_address">Hong Kong</span>
          <a href="https://maps.google.com/maps?q=Retrocity@22.297,114.172&zoom=19">Map</a>
          <a href="/alm/shop?gm=98&amp;sid=12345">Detail</a>
        </li>
        <li>
          <span class="store_name">List Only</span>
          <span class="store_address">No official coordinates</span>
          <a href="https://maps.google.com/maps?q=List@0,0&zoom=16">Map</a>
          <a href="/alm/shop?gm=98&amp;sid=67890">Detail</a>
        </li>
        """

        stores = locations.parse_stores(markup, source_url="https://example.test")

        self.assertEqual(len(stores), 2)
        self.assertEqual(stores[0]["name"], "RETROCITY & CONCEPT")
        self.assertEqual((stores[0]["lat"], stores[0]["lng"]), (22.297, 114.172))
        self.assertFalse(stores[0]["needsGeocode"])
        self.assertIsNone(stores[1]["lat"])
        self.assertIsNone(stores[1]["lng"])
        self.assertTrue(stores[1]["needsGeocode"])

    def test_rejects_silent_record_loss(self) -> None:
        markup = """
        <div class="result_count">(2 locations)</div>
        <li>
          <span class="store_name">Only parsed store</span>
          <span class="store_address">Somewhere</span>
          <a href="/alm/shop?gm=98&amp;sid=12345">Detail</a>
        </li>
        """

        with self.assertRaisesRegex(ValueError, "locator reports 2"):
            locations.parse_stores(markup, source_url="https://example.test")

    def test_rejects_a_page_without_locator_results(self) -> None:
        with self.assertRaisesRegex(ValueError, "result count is missing"):
            locations.parse_stores(
                "<html><title>Maintenance</title></html>",
                source_url="https://example.test",
            )

    def test_accepts_a_japanese_zero_result_count(self) -> None:
        stores = locations.parse_stores(
            "<div>選択エリア：「例」（<span>0</span> 店舗）</div>",
            source_url="https://example.test",
        )
        self.assertEqual(stores, [])

    def test_reads_only_enabled_international_country_options(self) -> None:
        markup = """
        <select name="language"><option value="en">English</option></select>
        <select name="ct" class="w_200">
          <option value="1000" selected disabled>日本(設置店舗なし)</option>
          <option value="1001">Taiwan</option>
          <option value="1002">Hong Kong</option>
          <option value="1015" disabled>Cambodia(No Installed Locations)</option>
        </select>
        """
        self.assertEqual(
            locations.parse_international_areas(markup),
            [("1001", "Taiwan"), ("1002", "Hong Kong")],
        )


class GeneratedDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.worldwide = json.loads(WORLDWIDE_PATH.read_text(encoding="utf-8"))
        cls.china_centers = json.loads(CHINA_CENTERS_PATH.read_text(encoding="utf-8"))

    def test_worldwide_schema_and_totals(self) -> None:
        payload = self.worldwide
        stores = payload["locations"]
        summary = payload["summary"]

        self.assertEqual(payload["schemaVersion"], 2)
        self.assertEqual(payload["mapMode"], "grouped-overview")
        self.assertEqual(summary["total"], len(stores))
        self.assertGreater(summary["mapped"], 0)
        self.assertEqual(summary["areaCount"], len(locations.INTL_AREAS))
        self.assertEqual(len(payload["mapGroups"]), len(locations.INTL_AREAS))
        self.assertEqual(len({store["id"] for store in stores}), len(stores))

        mapped = sum(store["lat"] is not None for store in stores)
        self.assertEqual(mapped, summary["mapped"])
        self.assertEqual(len(stores) - mapped, summary["needsGeocode"])

        country_counts = Counter(store["country"] for store in stores)
        self.assertEqual(set(country_counts), set(summary["areas"]))
        for country, values in summary["areas"].items():
            country_stores = [store for store in stores if store["country"] == country]
            country_mapped = sum(store["lat"] is not None for store in country_stores)
            self.assertEqual(values["total"], country_counts[country])
            self.assertEqual(values["mapped"], country_mapped)
            self.assertEqual(values["needsGeocode"], len(country_stores) - country_mapped)

    def test_worldwide_coordinates_are_paired_and_valid(self) -> None:
        for store in self.worldwide["locations"]:
            lat = store["lat"]
            lng = store["lng"]
            self.assertEqual(lat is None, lng is None, store["id"])
            self.assertEqual(store["needsGeocode"], lat is None, store["id"])
            if lat is not None:
                self.assertGreaterEqual(lat, -90, store["id"])
                self.assertLessEqual(lat, 90, store["id"])
                self.assertGreaterEqual(lng, -180, store["id"])
                self.assertLessEqual(lng, 180, store["id"])
                self.assertTrue(
                    locations.coordinates_in_area(store, store["country"]),
                    store["id"],
                )

        outliers = {
            store["id"]
            for store in self.worldwide["locations"]
            if store.get("coordinateIssue")
        }
        self.assertEqual(len(outliers), self.worldwide["summary"]["coordinateOutliers"])
        for store in self.worldwide["locations"]:
            if store["id"] in outliers:
                self.assertIsNone(store["lat"])
                self.assertIsNone(store["lng"])
                self.assertIsInstance(store["officialLat"], (int, float))
                self.assertIsInstance(store["officialLng"], (int, float))

    def test_worldwide_links_and_exports_are_valid(self) -> None:
        for store in self.worldwide["locations"]:
            details = urlparse(store["detailsUrl"])
            self.assertEqual(details.scheme, "https", store["id"])
            self.assertEqual(details.netloc, "location.am-all.net", store["id"])
            self.assertEqual(details.path, "/alm/shop", store["id"])

        with WORLDWIDE_CSV_PATH.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), self.worldwide["summary"]["total"])
        for row in rows:
            search_url = urlparse(row["googleMapsSearchUrl"])
            query = parse_qs(search_url.query)
            self.assertEqual(search_url.netloc, "www.google.com", row["id"])
            self.assertEqual(search_url.path, "/maps/search/", row["id"])
            self.assertEqual(query.get("api"), ["1"], row["id"])
            self.assertEqual(len(query.get("query", [])), 1, row["id"])

        kml = ElementTree.parse(WORLDWIDE_KML_PATH)
        namespace = {"kml": "http://www.opengis.net/kml/2.2"}
        placemarks = kml.findall(".//kml:Placemark", namespace)
        self.assertEqual(len(placemarks), self.worldwide["summary"]["mapped"])

    def test_china_province_centers_cover_thirty_unique_areas(self) -> None:
        groups = self.china_centers["mapGroups"]
        self.assertEqual(len(groups), 30)
        self.assertEqual(len({group["id"] for group in groups}), 30)
        self.assertEqual(len({group["key"] for group in groups}), 30)
        for group in groups:
            self.assertGreaterEqual(group["lat"], -90, group["id"])
            self.assertLessEqual(group["lat"], 90, group["id"])
            self.assertGreaterEqual(group["lng"], -180, group["id"])
            self.assertLessEqual(group["lng"], 180, group["id"])


if __name__ == "__main__":
    unittest.main()
