import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("static/js/maimai-map.js", "utf8");
const cacheKey = "maimaiChinaBaiduPoints:v1";
const originalStartup = /  bindEvents\(\);\s+selectDataset\(state\.datasetId\);\s*\}\)\(\);\s*$/;
assert.match(source, originalStartup);
const instrumented = source.replace(originalStartup, `
  updateMapStatus = () => {};
  window.testMap = {
    state, baiduStoreCacheKey, savedBaiduStorePoint, rememberBaiduStorePoint,
    geocodeBaiduLocation, renderBaiduStoreMarkers, clearBaiduMarker,
    clearBaiduStoreLayer,
  };
})();`);

function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
}

function createPage(storage = memoryStorage(), now = Date.now()) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      dataset: {},
      textContent: "",
      classList: { toggle() {} },
      querySelectorAll: () => [],
    });
    return elements.get(selector);
  };
  const root = {
    dataset: { defaultDataset: "china", baiduMapsAk: "browser-key" },
    querySelectorAll: () => [],
    querySelector: element,
  };
  const timers = new Map();
  let timerId = 0;
  const window = {
    location: { search: "" },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const geocodes = [];
  const overlays = [];
  class Point {
    constructor(lng, lat) { this.lng = lng; this.lat = lat; }
  }
  const context = vm.createContext({
    document: { querySelector: () => root },
    window,
    localStorage: storage,
    URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    BMap: {
      Point,
      Marker: class {
        constructor(point) { this.point = point; }
        addEventListener() {}
      },
      InfoWindow: class {},
    },
  });
  vm.runInContext(instrumented, context, { filename: "static/js/maimai-map.js" });
  const api = window.testMap;
  Object.assign(api.state, {
    datasetId: "china",
    provider: "baidu",
    baiduReady: true,
    loadSequence: 1,
    baiduFocusToken: 1,
    payload: { mapMode: "region-summary" },
    baiduGeocoder: {
      getPoint(address, callback, city) { geocodes.push({ address, callback, city }); },
    },
    baiduMapInstance: {
      addOverlay(marker) { overlays.push(marker); },
      removeOverlay(marker) {
        const index = overlays.indexOf(marker);
        if (index >= 0) overlays.splice(index, 1);
      },
      centerAndZoom() {},
      openInfoWindow() {},
      closeInfoWindow() {},
    },
  });
  return { ...api, storage, Point, geocodes, overlays, timers };
}

const location = {
  id: "cn-store-1", sourceId: "1", name: "Test store", address: "A street 42",
  subregion: "Province A", city: "City A", district: "District A",
};
const point = { lng: 116.413, lat: 39.911 };
const pointValue = (value) => value && ({ lng: value.lng, lat: value.lat });
const select = (page, selected = location) => {
  page.state.selectedLocationId = selected.id;
  page.geocodeBaiduLocation(selected, page.state.baiduFocusToken);
};

const firstPage = createPage();
select(firstPage);
assert.equal(firstPage.geocodes.length, 1);
firstPage.geocodes[0].callback(new firstPage.Point(point.lng, point.lat));
assert.deepEqual(pointValue(firstPage.state.baiduPoint), point);
const serialized = JSON.parse(firstPage.storage.getItem(cacheKey));
assert.equal(serialized.schemaVersion, 1);
assert.equal(serialized.entries.length, 1);
assert.deepEqual(Object.keys(serialized.entries[0]).sort(), ["key", "lat", "lng", "savedAt"]);

const reloadedPage = createPage(firstPage.storage);
select(reloadedPage);
assert.equal(reloadedPage.geocodes.length, 0, "individual focus must reuse a saved point after reload");
assert.deepEqual(pointValue(reloadedPage.state.baiduPoint), point);
reloadedPage.clearBaiduMarker();
reloadedPage.state.chinaOverviewLevel = "store";
reloadedPage.state.filtered = [location];
reloadedPage.renderBaiduStoreMarkers();
assert.equal(reloadedPage.geocodes.length, 0, "district rendering must reuse the same saved point");
assert.equal(reloadedPage.state.baiduStoreMarkers.size, 1);
assert.deepEqual(pointValue(reloadedPage.state.baiduStoreMarkers.get(location.id).point), point);

for (const changed of [
  { address: "A street 43" }, { subregion: "Province B" }, { city: "City B" },
  { province: "Province B" }, { sourceId: "2" },
]) {
  const page = createPage(firstPage.storage);
  assert.equal(page.savedBaiduStorePoint({ ...location, ...changed }), null,
    `changed geocoding context must invalidate the saved point: ${JSON.stringify(changed)}`);
}

const movedPage = createPage(firstPage.storage);
select(movedPage);
select(movedPage, { ...location, address: "A street 43" });
assert.equal(movedPage.geocodes.length, 1,
  "a changed address must not reuse the currently focused marker for the old address");

const exactLocation = { ...location, coordinateSystem: "BD-09", lng: 121.481, lat: 31.236 };
const exactPage = createPage(firstPage.storage);
select(exactPage, exactLocation);
assert.equal(exactPage.geocodes.length, 0);
assert.deepEqual(pointValue(exactPage.state.baiduPoint), { lng: 121.481, lat: 31.236 },
  "explicit saved store coordinates take priority over an older address match");
const approximatePage = createPage();
assert.equal(approximatePage.savedBaiduStorePoint({
  ...exactLocation, coordinatePrecision: "administrative-center",
}), null, "an approximate regional center must never become a store pin");
assert.equal(approximatePage.savedBaiduStorePoint({
  ...exactLocation, coordinateSystem: "GCJ-02",
}), null, "coordinates in another coordinate system must not be used directly");

for (const storage of [
  memoryStorage(new Map([[cacheKey, "{invalid json"]])),
  { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } },
  { getItem() { return null; }, setItem() { throw new Error("quota exceeded"); } },
]) {
  const page = createPage(storage);
  assert.equal(page.savedBaiduStorePoint(location), null);
  select(page);
  page.geocodes[0].callback(new page.Point(point.lng, point.lat));
  page.clearBaiduMarker();
  select(page);
  assert.equal(page.geocodes.length, 1, "storage failures must retain successful points for the visit");
  assert.deepEqual(pointValue(page.state.baiduPoint), point);
}

const now = Date.now();
const staleKey = firstPage.baiduStoreCacheKey(location);
for (const invalid of [
  { ...point, savedAt: now - 366 * 24 * 60 * 60 * 1000 },
  { ...point, savedAt: now + 60 * 60 * 1000 },
  { lat: 91, lng: 116, savedAt: now },
  { lat: 39, lng: 181, savedAt: now },
  { lat: "39", lng: 116, savedAt: now },
]) {
  const storage = memoryStorage(new Map([[cacheKey, JSON.stringify({
    schemaVersion: 1, entries: [{ key: staleKey, ...invalid }],
  })]]));
  assert.equal(createPage(storage, now).savedBaiduStorePoint(location), null);
}

const failures = createPage();
select(failures);
failures.geocodes[0].callback(null);
assert.equal(failures.storage.getItem(cacheKey), null, "failed lookups must not be saved");
assert.equal(failures.rememberBaiduStorePoint(location, { lng: Infinity, lat: 39 }), false);
assert.equal(failures.rememberBaiduStorePoint(location, { lng: 181, lat: 39 }), false);

const switchedPage = createPage();
select(switchedPage);
switchedPage.state.datasetId = "worldwide";
switchedPage.state.provider = "google";
switchedPage.state.loadSequence += 1;
switchedPage.geocodes[0].callback(new switchedPage.Point(point.lng, point.lat));
assert.equal(switchedPage.overlays.length, 0);
assert.equal(switchedPage.storage.getItem(cacheKey), null,
  "a response from a previous dataset must not write the cache or render a marker");
const switchedCachedPage = createPage(firstPage.storage);
switchedCachedPage.state.datasetId = "worldwide";
switchedCachedPage.state.provider = "google";
select(switchedCachedPage);
assert.equal(switchedCachedPage.overlays.length, 0, "cache hits must respect the active dataset too");

const districtPage = createPage();
districtPage.state.chinaOverviewLevel = "store";
districtPage.state.filtered = [location];
districtPage.renderBaiduStoreMarkers();
assert.equal(districtPage.geocodes.length, 1);
districtPage.geocodes[0].callback(new districtPage.Point(point.lng, point.lat));
assert.equal(districtPage.state.baiduStoreMarkers.size, 1);
assert.deepEqual(pointValue(createPage(districtPage.storage).savedBaiduStorePoint(location)), point,
  "district lookup results must also survive a reload");

const switchedDistrict = createPage();
switchedDistrict.state.chinaOverviewLevel = "store";
switchedDistrict.state.filtered = [location];
switchedDistrict.renderBaiduStoreMarkers();
switchedDistrict.state.datasetId = "worldwide";
switchedDistrict.state.provider = "google";
switchedDistrict.state.loadSequence += 1;
switchedDistrict.clearBaiduStoreLayer();
switchedDistrict.geocodes[0].callback(new switchedDistrict.Point(point.lng, point.lat));
assert.equal(switchedDistrict.overlays.length, 0);
assert.equal(switchedDistrict.storage.getItem(cacheKey), null,
  "a stale district callback must not save or render coordinates after switching datasets");

const manyEntries = Array.from({ length: 5005 }, (_, index) => ({
  key: `entry-${index}`, ...point, savedAt: now - index,
}));
const boundedPage = createPage(memoryStorage(new Map([[cacheKey, JSON.stringify({
  schemaVersion: 1, entries: manyEntries,
})]])), now + 1);
boundedPage.rememberBaiduStorePoint(location, point);
const boundedSaved = JSON.parse(boundedPage.storage.getItem(cacheKey));
assert.equal(boundedSaved.entries.length, 5000);
assert.ok(boundedSaved.entries.some((entry) => entry.key === staleKey));
assert.ok(!boundedSaved.entries.some((entry) => entry.key === "entry-5004"));

console.log("Baidu coordinate cache tests passed: reloads, location edits, invalid storage, exact points, and dataset switches.");
