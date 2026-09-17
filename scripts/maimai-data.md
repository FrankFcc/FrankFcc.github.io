# Mainland China map data

`static/data/maimai_locations_china.json` is the saved China dataset served by the
site. It contains the official store IDs, names and addresses, the assigned
province/city/district, and the region hierarchy and overview coordinates. The
map loads this file before checking the official Wahlap list in the background.
A remote outage or invalid response does not block the saved list.

The background comparison checks IDs, names, addresses, provinces and place IDs.
Ordering and surrounding whitespace do not count as changes. An unchanged list
does not replace saved data. A valid changed list is normalized and saved in the
browser for the next visit to the China map, preserving the active selection.
Browser storage is optional; if unavailable, changes remain available for the
current page session. New visitors receive the repository snapshot.

Wahlap publishes addresses rather than exact store coordinates. Store latitude
and longitude remain null until an address has been geocoded; region centers
are never used as store coordinates. Successful Baidu BD-09 coordinates are
saved in the visitor's browser and reused across reloads. Changing a store's
address, province or city invalidates that cached point. The coordinate cache
retains up to 5,000 entries for one year. It is separate from the saved store list.

## Refresh the shared snapshot

Use Node.js 22 or later from the repository root:

```sh
node scripts/fetch_maimai_china_locations.mjs --check
node scripts/fetch_maimai_china_locations.mjs
```

The first command reports whether the official list or region reference changed
without writing. The second updates the snapshot only when needed. Review and
commit the resulting file, then deploy through the existing GitHub Pages workflow
so all visitors receive the updated snapshot. No geocoding runs during refresh;
any existing exact coordinates are retained only for an unchanged address and
region context.

For reproducible/offline input, use `--source FILE`. `--support FILE` and
`--output FILE` override the hierarchy input and saved snapshot path. The shared
normalizer in `static/js/maimai-china-data.js` is used by both the refresh command
and the browser's background check.

## Verify changes

```sh
node scripts/test_maimai_china_data.mjs
node scripts/test_maimai_baidu_cache.mjs
node scripts/test_maimai_map_marker_path.mjs
python -m unittest discover -s scripts -p 'test_*.py'
```
