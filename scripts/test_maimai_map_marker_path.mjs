import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const currentPayload = JSON.parse(
  fs.readFileSync("static/data/maimai_locations.json", "utf8"),
);
const worldwidePayload = JSON.parse(
  fs.readFileSync("static/data/maimai_locations_worldwide.json", "utf8"),
);
const chinaCenters = JSON.parse(
  fs.readFileSync("static/data/maimai_china_province_centers.json", "utf8"),
);
const source = fs.readFileSync("static/js/maimai-map.js", "utf8");
const vendorSource = fs.readFileSync(
  "static/vendor/googlemaps-markerclusterer/2.6.2/index.min.js",
  "utf8",
);

class VendorLatLng {
  constructor(lat, lng) {
    this.latitude = lat;
    this.longitude = lng;
  }

  lat() {
    return this.latitude;
  }

  lng() {
    return this.longitude;
  }

  toJSON() {
    return { lat: this.latitude, lng: this.longitude };
  }
}

class VendorLatLngBounds {
  constructor(southWest, northEast) {
    if (southWest && "south" in southWest) {
      this.south = southWest.south;
      this.west = southWest.west;
      this.north = southWest.north;
      this.east = southWest.east;
      return;
    }
    this.south = southWest.lat();
    this.west = southWest.lng();
    this.north = northEast.lat();
    this.east = northEast.lng();
  }

  getNorthEast() {
    return new VendorLatLng(this.north, this.east);
  }

  getSouthWest() {
    return new VendorLatLng(this.south, this.west);
  }

  contains(position) {
    return position.lat() >= this.south
      && position.lat() <= this.north
      && position.lng() >= this.west
      && position.lng() <= this.east;
  }
}

class VendorMarker {
  constructor(lat, lng) {
    this.position = new VendorLatLng(lat, lng);
  }

  getPosition() {
    return this.position;
  }

  getVisible() {
    return true;
  }

  setMap(map) {
    this.map = map;
  }
}

const vendorGoogle = {
  maps: {
    LatLng: VendorLatLng,
    LatLngBounds: VendorLatLngBounds,
    marker: null,
  },
};
const vendorContext = vm.createContext({
  console,
  google: vendorGoogle,
  requestAnimationFrame: (callback) => callback(),
  setTimeout,
});
vm.runInContext(vendorSource, vendorContext, {
  filename: "static/vendor/googlemaps-markerclusterer/2.6.2/index.min.js",
});
assert.equal(typeof vendorContext.markerClusterer?.MarkerClusterer, "function");
assert.equal(
  typeof vendorContext.markerClusterer?.SuperClusterViewportAlgorithm,
  "function",
);

const viewportBounds = new VendorLatLngBounds(
  new VendorLatLng(34, 135),
  new VendorLatLng(36, 138),
);
const viewportMap = {
  getBounds: () => viewportBounds,
  getZoom: () => 15,
};
const viewportProjection = {
  fromDivPixelToLatLng: ({ x, y }) => new VendorLatLng(-y / 10, x / 10),
  fromLatLngToDivPixel: (position) => ({
    x: position.lng() * 10,
    y: -position.lat() * 10,
  }),
};
const insideViewportMarker = new VendorMarker(35, 136);
const outsideViewportMarker = new VendorMarker(40, -100);
const realViewportAlgorithm = new vendorContext.markerClusterer.SuperClusterViewportAlgorithm({
  maxZoom: 14,
  viewportPadding: 0,
});
const realViewportClusters = realViewportAlgorithm.calculate({
  map: viewportMap,
  mapCanvasProjection: viewportProjection,
  markers: [insideViewportMarker, outsideViewportMarker],
}).clusters;
assert.equal(realViewportClusters.length, 1);
assert.equal(realViewportClusters[0].markers[0], insideViewportMarker);

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force) this.values.add(value);
    else this.values.delete(value);
  }
}

class FakeElement {
  constructor({ dataset = {}, value = "", textContent = "" } = {}) {
    this.dataset = dataset;
    this.value = value;
    this.textContent = textContent;
    this._innerHTML = "";
    this.classList = new FakeClassList();
    this.listeners = {};
    this.attributes = {};
    this.disabled = false;
    this.hidden = false;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  insertAdjacentHTML(_position, value) {
    this._innerHTML += String(value);
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector(selector) {
    return this.elements?.[selector] ?? null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-dataset]") return this.datasetButtons ?? [];
    return [];
  }
}

const elements = {
  "[data-dataset-title]": new FakeElement(),
  "[data-stat-total]": new FakeElement(),
  "[data-stat-mapped]": new FakeElement(),
  "[data-stat-areas]": new FakeElement(),
  "[data-status]": new FakeElement(),
  "[data-search]": new FakeElement(),
  "[data-country]": new FakeElement(),
  "[data-subregion]": new FakeElement(),
  "[data-map]": new FakeElement(),
  "[data-list]": new FakeElement(),
  "[data-visible-count]": new FakeElement(),
  "[data-open-visible]": new FakeElement(),
  "[data-source]": new FakeElement(),
  "[data-exports]": new FakeElement(),
  "[data-export-label]": new FakeElement(),
  "[data-export-csv]": new FakeElement(),
  "[data-export-kml]": new FakeElement(),
};
const datasetButtons = [
  new FakeElement({
    dataset: {
      dataset: "current",
      dataUrl: "/data/maimai_locations.json",
      label: "Japan + US",
      csvUrl: "/data/maimai_locations.csv",
      kmlUrl: "/data/maimai_locations.kml",
    },
    textContent: "Japan + US",
  }),
  new FakeElement({
    dataset: {
      dataset: "china",
      dataUrl: "https://sega-register.wahlap.net/api/sega/maidx/rest/location",
      supportUrl: "/data/maimai_china_province_centers.json",
      adapter: "wahlap",
      label: "Mainland China",
    },
    textContent: "Mainland China",
  }),
  new FakeElement({
    dataset: {
      dataset: "worldwide",
      dataUrl: "/data/maimai_locations_worldwide.json",
      label: "Worldwide",
      csvUrl: "/data/maimai_locations_worldwide.csv",
      kmlUrl: "/data/maimai_locations_worldwide.kml",
    },
    textContent: "Worldwide",
  }),
];
const root = new FakeElement({
  dataset: {
    maimaiMap: "",
    defaultDataset: "current",
  },
});
root.elements = elements;
root.datasetButtons = datasetButtons;

const chinaRawFixture = [
  {
    id: "2081921990512345090",
    province: "河南",
    arcadeName: "神兽大玩家河南尉氏店",
    address: "河南省开封市尉氏县城关镇建兴广场三楼7号",
    placeId: null,
  },
  {
    id: "2080205753323356161",
    province: "浙江",
    arcadeName: "悦界潮玩义乌佛堂宝龙店",
    address: "浙江省义乌市佛堂宝龙广场三楼",
    placeId: "5315",
  },
  {
    id: "2072228503426945025",
    province: "河南",
    arcadeName: "河南测试店",
    address: "河南省郑州市测试地址",
    placeId: "5000",
  },
];
const chinaSupportFixture = {
  source: chinaCenters.source,
  mapGroups: chinaCenters.mapGroups.filter(
    (group) => group.key === "河南" || group.key === "浙江",
  ),
};

let releaseChina;
const chinaGate = new Promise((resolve) => {
  releaseChina = resolve;
});
const fetchCounts = new Map();
const fetchMock = async (url) => {
  fetchCounts.set(url, (fetchCounts.get(url) || 0) + 1);
  if (url === "/data/maimai_locations.json") {
    return { ok: true, json: async () => currentPayload };
  }
  if (url === "/data/maimai_locations_worldwide.json") {
    return { ok: true, json: async () => worldwidePayload };
  }
  if (url === "/data/maimai_china_province_centers.json") {
    return { ok: true, json: async () => chinaSupportFixture };
  }
  if (url === "https://sega-register.wahlap.net/api/sega/maidx/rest/location") {
    await chinaGate;
    return { ok: true, json: async () => chinaRawFixture };
  }
  throw new Error(`unexpected fetch ${url}`);
};

let markerCount = 0;
let directMarkerAttachCount = 0;
let directMarkerDetachCount = 0;
let clustererInstance = null;
let viewportAlgorithmInstance = null;
let mapInstance = null;
let infoWindowInstance = null;
let idleListenerCount = 0;
const openedUrls = [];

class FakeMarkerClusterer {
  constructor(options) {
    this.options = options;
    this.markers = [...(options.markers ?? [])];
    this.clearCalls = 0;
    this.renderCalls = 0;
    clustererInstance = this;
  }

  clearMarkers(noDraw) {
    assert.equal(noDraw, true);
    this.markers = [];
    this.clearCalls += 1;
  }

  addMarkers(markers, noDraw) {
    assert.equal(noDraw, true);
    this.markers.push(...markers);
  }

  render() {
    this.renderCalls += 1;
  }
}

class FakeSuperClusterViewportAlgorithm {
  constructor(options) {
    this.options = options;
    viewportAlgorithmInstance = this;
  }
}

const windowObject = {
  location: { search: "" },
  open(url) {
    openedUrls.push(url);
  },
  clearTimeout,
  setTimeout,
  markerClusterer: {
    MarkerClusterer: FakeMarkerClusterer,
    SuperClusterViewportAlgorithm: FakeSuperClusterViewportAlgorithm,
  },
  google: {
    maps: {
      SymbolPath: { CIRCLE: "circle" },
      event: {
        addListenerOnce(map, eventName, callback) {
          assert.equal(eventName, "idle");
          idleListenerCount += 1;
          map.idleCallback = callback;
        },
      },
      Map: class {
        constructor(element, options) {
          this.element = element;
          this.options = options;
          this.fitBoundsCalls = 0;
          mapInstance = this;
        }

        fitBounds() {
          this.fitBoundsCalls += 1;
        }

        panTo(position) {
          this.position = position;
        }

        setZoom(zoom) {
          this.zoom = zoom;
        }
      },
      InfoWindow: class {
        constructor() {
          this.closed = false;
          infoWindowInstance = this;
        }

        setContent(content) {
          this.content = content;
        }

        open(options) {
          this.openOptions = options;
        }

        close() {
          this.closed = true;
        }
      },
      LatLngBounds: class {
        constructor() {
          this.points = [];
        }

        extend(position) {
          this.points.push(position);
        }
      },
      Marker: class {
        constructor(options) {
          markerCount += 1;
          this.options = options;
          assert.equal(options.map, undefined);
        }

        setMap(map) {
          this.map = map;
          if (map) directMarkerAttachCount += 1;
          else directMarkerDetachCount += 1;
        }

        getMap() {
          return this.map;
        }

        addListener(_name, callback) {
          this.clickCallback = callback;
        }
      },
    },
  },
};

const context = vm.createContext({
  console,
  document: {
    querySelector(selector) {
      return selector === "[data-maimai-map]" ? root : null;
    },
    createElement() {
      return new FakeElement();
    },
    head: {
      appendChild() {},
    },
  },
  fetch: fetchMock,
  google: windowObject.google,
  localStorage: {
    values: new Map(),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, String(value));
    },
  },
  setTimeout,
  URLSearchParams,
  window: windowObject,
});

async function settle(turns = 8) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

vm.runInContext(source, context, { filename: "static/js/maimai-map.js" });
await settle();

const currentMapped = currentPayload.locations.filter(
  (location) => typeof location.lat === "number" && typeof location.lng === "number",
).length;
assert.equal(fetchCounts.get("/data/maimai_locations.json"), 1);
assert.equal(fetchCounts.has("/data/maimai_locations_worldwide.json"), false);
assert.equal(fetchCounts.has("https://sega-register.wahlap.net/api/sega/maidx/rest/location"), false);
assert.equal(elements["[data-stat-total]"].textContent, "1,111 locations");
assert.equal(elements["[data-stat-mapped]"].textContent, "1,096 mapped");
assert.equal(elements["[data-stat-areas]"].textContent, "2 areas");
assert.equal(elements["[data-visible-count]"].textContent, "1,111 locations");
assert.equal((elements["[data-list]"].innerHTML.match(/<article/g) ?? []).length, 250);
assert.ok(elements["[data-list]"].innerHTML.includes("861 more hidden by list limit"));
assert.equal(
  elements["[data-status]"].textContent,
  "1,096 mapped locations grouped into zoomable clusters from the official coordinate dataset. 15 filtered locations do not include official coordinates and remain list-only.",
);
assert.equal(elements["[data-map]"].classList.contains("is-loaded"), true);
assert.equal(markerCount, currentMapped);
assert.equal(directMarkerAttachCount, 0);
assert.ok(clustererInstance);
assert.equal(clustererInstance.markers.length, currentMapped);
assert.equal(clustererInstance.options.algorithm, viewportAlgorithmInstance);
assert.equal(viewportAlgorithmInstance.options.maxZoom, 14);
assert.equal(viewportAlgorithmInstance.options.viewportPadding, 80);
assert.equal(root.attributes["aria-busy"], "false");

datasetButtons[1].listeners.click();
await settle(2);
datasetButtons[0].listeners.click();
await settle();
assert.equal(elements["[data-dataset-title]"].textContent, "maimai Japan + United States");
assert.equal(datasetButtons[0].attributes["aria-pressed"], "true");
releaseChina();
await settle();
assert.equal(elements["[data-dataset-title]"].textContent, "maimai Japan + United States");
assert.equal(clustererInstance.markers.length, currentMapped);

datasetButtons[1].listeners.click();
datasetButtons[2].listeners.click();
await settle();
assert.equal(fetchCounts.get("https://sega-register.wahlap.net/api/sega/maidx/rest/location"), 1);
assert.equal(fetchCounts.get("/data/maimai_china_province_centers.json"), 1);
assert.equal(fetchCounts.get("/data/maimai_locations_worldwide.json"), 1);
assert.equal(elements["[data-dataset-title]"].textContent, worldwidePayload.label);
assert.equal(
  elements["[data-stat-total]"].textContent,
  `${worldwidePayload.summary.total.toLocaleString()} locations`,
);
assert.equal(
  elements["[data-stat-mapped]"].textContent,
  `${worldwidePayload.summary.mapped.toLocaleString()} mapped`,
);
assert.equal(elements["[data-stat-areas]"].textContent, "14 areas");
assert.equal(clustererInstance.markers.length, 14);
assert.equal((elements["[data-list]"].innerHTML.match(/<article/g) ?? []).length, 250);
assert.ok(elements["[data-status]"].textContent.includes("14 country / area markers"));

assert.equal(elements["[data-dataset-title]"].textContent, worldwidePayload.label);
assert.equal(clustererInstance.markers.length, 14);

const northAmericaGroup = worldwidePayload.mapGroups.find(
  (group) => group.key === "North America",
);
const northAmericaSummaryMarker = clustererInstance.markers.find(
  (marker) => marker.options.title
    === `North America: ${northAmericaGroup.count.toLocaleString()} locations`,
);
assert.ok(northAmericaSummaryMarker);
northAmericaSummaryMarker.clickCallback();
assert.equal(elements["[data-country]"].value, "North America");
const northAmerica = worldwidePayload.locations.filter(
  (location) => location.country === "North America",
);
const mappedNorthAmerica = northAmerica.filter(
  (location) => typeof location.lat === "number" && typeof location.lng === "number",
).length;
assert.equal(elements["[data-visible-count]"].textContent, "110 locations");
assert.equal(clustererInstance.markers.length, mappedNorthAmerica);
assert.equal(
  elements["[data-status]"].textContent,
  `${mappedNorthAmerica.toLocaleString()} mapped locations grouped into zoomable clusters `
    + "from the official coordinate dataset. "
    + `${(northAmerica.length - mappedNorthAmerica).toLocaleString()} filtered locations `
    + "do not include official coordinates and remain list-only.",
);

const focusedLocation = northAmerica.find(
  (location) => typeof location.lat === "number" && typeof location.lng === "number",
);
elements["[data-list]"].listeners.click({
  target: {
    closest(selector) {
      assert.equal(selector, "[data-focus]");
      return { dataset: { focus: focusedLocation.id } };
    },
  },
});
assert.equal(mapInstance.zoom, 15);
assert.equal(mapInstance.position.lat, focusedLocation.lat);
assert.equal(mapInstance.position.lng, focusedLocation.lng);
assert.equal(idleListenerCount, 1);
const focusedMarker = clustererInstance.markers.find(
  (marker) => marker.options.title === focusedLocation.name,
);
const staleIdleCallback = mapInstance.idleCallback;
datasetButtons[2].listeners.click();
await settle();
staleIdleCallback();
assert.equal(infoWindowInstance.content, undefined);

elements["[data-list]"].listeners.click({
  target: {
    closest() {
      return { dataset: { focus: focusedLocation.id } };
    },
  },
});
assert.equal(idleListenerCount, 2);
focusedMarker.map = mapInstance;
mapInstance.idleCallback();
assert.ok(infoWindowInstance.content.includes(focusedLocation.name));

datasetButtons[1].listeners.click();
await settle();
assert.equal(elements["[data-dataset-title]"].textContent, "舞萌DX Mainland China");
assert.equal(elements["[data-stat-total]"].textContent, "3 locations");
assert.equal(elements["[data-stat-mapped]"].textContent, "2 map groups");
assert.equal(elements["[data-stat-areas]"].textContent, "2 provinces");
assert.equal(clustererInstance.markers.length, 2);
assert.ok(elements["[data-status]"].textContent.includes("3 live official locations"));
assert.ok(elements["[data-status]"].textContent.includes("2 province markers"));
assert.ok(elements["[data-list]"].innerHTML.includes("cn-wahlap-2081921990512345090"));
assert.equal(elements["[data-exports]"].hidden, true);

const henanSummaryMarker = clustererInstance.markers.find(
  (marker) => marker.options.title === "河南: 2 locations",
);
assert.ok(henanSummaryMarker);
henanSummaryMarker.clickCallback();
assert.equal(elements["[data-subregion]"].value, "河南");
assert.equal(elements["[data-visible-count]"].textContent, "2 locations");
assert.equal(clustererInstance.markers.length, 1);
assert.ok(elements["[data-status]"].textContent.includes("1 province markers"));
assert.equal(mapInstance.zoom, 6);

const openedBeforeChinaFocus = openedUrls.length;
elements["[data-list]"].listeners.click({
  target: {
    closest() {
      return { dataset: { focus: "cn-wahlap-2081921990512345090" } };
    },
  },
});
assert.equal(openedUrls.length, openedBeforeChinaFocus + 1);
assert.ok(openedUrls.at(-1).includes("google.com/maps/search"));

datasetButtons[0].listeners.click();
await settle();
assert.equal(fetchCounts.get("/data/maimai_locations.json"), 1);
assert.equal(clustererInstance.markers.length, currentMapped);
assert.equal(elements["[data-exports]"].hidden, false);
assert.equal(elements["[data-export-csv]"].href, "/data/maimai_locations.csv");

const clusteredMarkerCount = markerCount;
const markerCountBeforeFallback = markerCount;
const directAttachBeforeFallback = directMarkerAttachCount;
windowObject.markerClusterer = null;
vm.runInContext(source, context, { filename: "static/js/maimai-map.js" });
await settle();

const fallbackMarkerCount = markerCount - markerCountBeforeFallback;
const fallbackAttachCount = directMarkerAttachCount - directAttachBeforeFallback;
assert.equal(fallbackMarkerCount, currentMapped);
assert.equal(fallbackAttachCount, currentMapped);
assert.equal(
  elements["[data-status]"].textContent,
  "1,096 Google Maps markers loaded from the official coordinate dataset. 15 filtered locations do not include official coordinates and remain list-only.",
);

console.log(
  JSON.stringify(
    {
      currentMapped,
      worldwideTotal: worldwidePayload.summary.total,
      worldwideMapped: worldwidePayload.summary.mapped,
      worldwideOverviewMarkers: worldwidePayload.mapGroups.length,
      northAmericaMapped: mappedNorthAmerica,
      chinaLiveFixtureLocations: chinaRawFixture.length,
      chinaProvinceMarkers: chinaSupportFixture.mapGroups.length,
      inactiveSlowLoadIgnored: elements["[data-dataset-title]"].textContent
        !== "舞萌DX Mainland China",
      currentFetchesAfterReturn: fetchCounts.get("/data/maimai_locations.json"),
      clusteredMarkerObjectsCreated: clusteredMarkerCount,
      appDirectMarkerAttachCount: directAttachBeforeFallback,
      focusWaitedForIdle: idleListenerCount === 2,
      vendoredViewportHighZoomClusters: realViewportClusters.length,
      fallbackMarkerCount,
      fallbackAttachCount,
      directMarkerDetachCount,
    },
    null,
    2,
  ),
);
