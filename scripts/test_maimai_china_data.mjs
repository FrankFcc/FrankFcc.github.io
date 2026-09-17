import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import chinaData from "../static/js/maimai-china-data.js";
import { refreshSnapshot } from "./fetch_maimai_china_locations.mjs";

const { normalize, canonicalOfficialList, canonicalSavedList, validateSavedPayload, parseOfficialJson } = chinaData;
const supportPath = new URL("../static/data/maimai_china_region_hierarchy.json", import.meta.url);
const support = JSON.parse(await fs.readFile(supportPath, "utf8"));
const raw = [
  { id: "2090334498011553793", province: "西藏", arcadeName: "拉萨测试店", address: "西藏拉萨市城关区北京东路", placeId: "9007199254740993" },
  { id: "2", province: "北京市", arcadeName: "北京测试店", address: "北京市海淀区中关村大街", placeId: null },
  { id: "1", province: "未收录省", arcadeName: "测试店", address: "未收录省测试地址", placeId: "" },
];
const payload = normalize(raw, support);
assert.equal(validateSavedPayload(payload), payload);
assert.equal(payload.hierarchyGeneratedAt, support.generatedAt);
assert.deepEqual(payload.locations.map((location) => location.sourceId), raw.map((location) => location.id));
assert.equal(payload.locations[0].city, "拉萨市");
assert.equal(payload.locations[0].district, "城关区");
assert.equal(payload.locations[1].subregion, "北京");
assert.equal(payload.locations[1].sourceProvince, "北京市");
assert.equal(payload.locations[1].district, "海淀区");
assert.equal(payload.locations[2].subregion, "未收录省");
assert.equal(payload.locations[2].cityKey, "");
assert.match(payload.notes[0], /未收录省/);
assert.ok(payload.locations.every((location) => location.lat === null && location.lng === null && location.needsGeocode));
assert.equal(canonicalOfficialList(raw), canonicalSavedList(payload));
assert.equal(canonicalOfficialList(raw), canonicalOfficialList(raw.toReversed()));
assert.equal(canonicalOfficialList(raw), canonicalOfficialList(raw.map((location) => ({
  ...location, arcadeName: ` ${location.arcadeName} `, address: `\n${location.address}\t`, province: ` ${location.province} `,
}))));
for (const field of ["id", "province", "arcadeName", "address", "placeId"]) {
  const changed = structuredClone(raw);
  changed[0][field] += "changed";
  assert.notEqual(canonicalOfficialList(raw), canonicalOfficialList(changed), `${field} changes must be detected`);
}
for (const invalid of [[], null, {}, [...raw, raw[0]], [{ ...raw[0], address: " " }], [{ ...raw[0], id: 9007199254740993 }]]) {
  assert.throws(() => canonicalOfficialList(invalid));
  assert.throws(() => normalize(invalid, support));
}

const numericJson = '[{"id":2090334498011553793,"placeId":9007199254740993,"address":"escaped \\\"id\\\":2090334498011553793","count":2}]';
const parsed = parseOfficialJson(numericJson);
assert.equal(parsed[0].id, "2090334498011553793");
assert.equal(parsed[0].placeId, "9007199254740993");
assert.equal(parsed[0].count, 2);
assert.equal(parsed[0].address, 'escaped "id":2090334498011553793');
assert.throws(() => parseOfficialJson('[{"id":09999999999999999999}]'));
assert.throws(() => parseOfficialJson('[{"id":99999999999999999999,}]'));

const corruptions = [
  (saved) => { saved.schemaVersion = 3; },
  (saved) => { saved.coordinateSystem = "WGS-84"; },
  (saved) => { saved.generatedAt = "bad date"; },
  (saved) => { saved.sources = {}; },
  (saved) => { saved.notes = {}; },
  (saved) => { saved.locations[0].sourceId = 123; },
  (saved) => { saved.locations[0].lat = 29; },
  (saved) => { saved.locations[0].lat = 91; saved.locations[0].lng = 90; },
  (saved) => { saved.locations[0].cityKey = "missing"; },
  (saved) => { saved.locations[0].sourceProvince = ""; },
  (saved) => { saved.chinaRegions[0].cities[0].districts[0].lng = "bad"; },
  (saved) => { saved.locations[0].lat = 29; saved.locations[0].lng = 91; saved.locations[0].needsGeocode = false; },
  (saved) => { saved.locations.push(saved.locations[0]); },
  (saved) => { saved.summary.total -= 1; },
];
for (const corrupt of corruptions) {
  const saved = structuredClone(payload);
  corrupt(saved);
  assert.throws(() => validateSavedPayload(saved));
}

const browserContext = vm.createContext({});
vm.runInContext(await fs.readFile(new URL("../static/js/maimai-china-data.js", import.meta.url), "utf8"), browserContext);
assert.equal(browserContext.MaimaiChinaData.canonicalOfficialList(raw), canonicalOfficialList(raw));

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "maimai-china-data-test-"));
try {
  const source = path.join(tempRoot, "official.json");
  const output = path.join(tempRoot, "snapshot.json");
  const localSupport = path.join(tempRoot, "hierarchy.json");
  await fs.writeFile(source, JSON.stringify(raw));
  await fs.writeFile(localSupport, JSON.stringify(support));
  const options = { source, output, support: localSupport };
  let result = await refreshSnapshot({ ...options, check: true });
  assert.equal(result.changed, true);
  assert.equal(result.written, false);
  await assert.rejects(fs.access(output));
  result = await refreshSnapshot(options);
  assert.equal(result.written, true);
  const initial = await fs.readFile(output, "utf8");
  const initialStat = await fs.stat(output);
  await fs.writeFile(source, JSON.stringify(raw.toReversed()));
  result = await refreshSnapshot(options);
  assert.equal(result.changed, false);
  assert.equal(await fs.readFile(output, "utf8"), initial);
  assert.equal((await fs.stat(output)).mtimeMs, initialStat.mtimeMs, "unchanged feeds must not rewrite snapshots");

  const geocoded = JSON.parse(initial);
  geocoded.locations[0].lat = 29.651;
  geocoded.locations[0].lng = 91.172;
  geocoded.locations[0].coordinateSystem = "BD-09";
  geocoded.locations[0].coordinatePrecision = "store";
  geocoded.locations[0].needsGeocode = false;
  geocoded.summary.mapped = 1;
  geocoded.summary.needsGeocode -= 1;
  validateSavedPayload(geocoded);
  const approximate = structuredClone(geocoded);
  approximate.locations[0].coordinatePrecision = "administrative-center";
  assert.throws(() => validateSavedPayload(approximate));
  await fs.writeFile(output, JSON.stringify(geocoded));
  const renamed = structuredClone(raw);
  renamed[0].arcadeName = "更名店";
  await fs.writeFile(source, JSON.stringify(renamed));
  result = await refreshSnapshot({ ...options, check: true });
  assert.equal(result.changed, true);
  assert.equal(result.written, false);
  assert.equal(JSON.parse(await fs.readFile(output, "utf8")).locations[0].name, raw[0].arcadeName);
  result = await refreshSnapshot(options);
  assert.equal(result.preservedCoordinates, 1);
  let saved = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(saved.locations[0].lat, 29.651);
  assert.equal(saved.locations[0].coordinatePrecision, "store");
  assert.equal(saved.locations[0].name, "更名店");

  const renamedCitySupport = structuredClone(support);
  const tibet = renamedCitySupport.regions.find((region) => region.key === "西藏");
  const lhasa = tibet.cities.find((city) => city.name === "拉萨市");
  lhasa.name = "拉萨新名称";
  await fs.writeFile(localSupport, JSON.stringify(renamedCitySupport));
  result = await refreshSnapshot(options);
  assert.equal(result.officialChanged, false);
  assert.equal(result.hierarchyChanged, true);
  assert.equal(result.preservedCoordinates, 0);
  saved = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(saved.locations[0].city, "拉萨新名称");
  assert.equal(saved.locations[0].lat, null, "changed city context must invalidate saved coordinates");
  await fs.writeFile(localSupport, JSON.stringify(support));
  await fs.writeFile(output, JSON.stringify({
    ...geocoded,
    locations: geocoded.locations.map((location, index) => index === 0 ? { ...location, name: "更名店" } : location),
  }));

  renamed[0].address += "新址";
  await fs.writeFile(source, JSON.stringify(renamed));
  result = await refreshSnapshot(options);
  assert.equal(result.preservedCoordinates, 0);
  saved = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(saved.locations[0].lat, null);
  assert.equal(saved.locations[0].lng, null);
  assert.equal(saved.summary.mapped, 0);

  const alteredSupport = structuredClone(support);
  alteredSupport.generatedAt = "2026-09-18T00:00:00Z";
  alteredSupport.regions[0].lat += 0.001;
  await fs.writeFile(localSupport, JSON.stringify(alteredSupport));
  result = await refreshSnapshot(options);
  assert.equal(result.officialChanged, false);
  assert.equal(result.hierarchyChanged, true);
  assert.equal(result.written, true);

  await fs.writeFile(source, JSON.stringify([]));
  const lastGood = await fs.readFile(output, "utf8");
  await assert.rejects(refreshSnapshot(options));
  assert.equal(await fs.readFile(output, "utf8"), lastGood, "invalid feeds must preserve the last good snapshot");
} finally {
  const resolved = path.resolve(tempRoot);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("maimai-china-data-test-"));
  await fs.rm(resolved, { recursive: true });
}

const shipped = JSON.parse(await fs.readFile(new URL("../static/data/maimai_locations_china.json", import.meta.url), "utf8"));
validateSavedPayload(shipped);
assert.ok(shipped.locations.length > 3000);
assert.equal(shipped.summary.areaCount, 31);
assert.ok(shipped.locations.every((location) => location.lat === null && location.lng === null));
console.log(JSON.stringify({ passed: true, savedLocations: shipped.locations.length, provinces: shipped.summary.areaCount }));
