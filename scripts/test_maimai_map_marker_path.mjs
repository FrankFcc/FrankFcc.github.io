import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const currentPayload = JSON.parse(
  fs.readFileSync("static/data/maimai_locations.json", "utf8"),
);
const worldwidePayload = JSON.parse(
  fs.readFileSync("static/data/maimai_locations_worldwide.json", "utf8"),
);
const source = fs.readFileSync("static/js/maimai-map.js", "utf8");
const shortcodeSource = fs.readFileSync("layouts/shortcodes/maimai-map.html", "utf8");
const paramsSource = fs.readFileSync("config/_default/params.yaml", "utf8");
const workflowSource = fs.readFileSync(".github/workflows/publish.yaml", "utf8");
const vendorSource = fs.readFileSync(
  "static/vendor/googlemaps-markerclusterer/2.6.2/index.min.js",
  "utf8",
);

assert.match(shortcodeSource, /data-provider="baidu"/);
assert.match(shortcodeSource, /data-baidu-map/);
assert.match(shortcodeSource, /data-baidu-zoom-controls/);
assert.match(shortcodeSource, /data-baidu-zoom-in/);
assert.match(shortcodeSource, /data-baidu-zoom-out/);
assert.match(shortcodeSource, /data-china-map-back/);
assert.match(shortcodeSource, /data-china-map-overview/);
assert.match(
  shortcodeSource,
  /data-support-url="\/data\/maimai_china_region_hierarchy\.json"/,
);
assert.match(shortcodeSource, /HUGO_MAIMAI_BAIDU_MAPS_AK/);
assert.match(shortcodeSource, /HUGO_MAIMAI_GOOGLE_MAPS_KEY/);
assert.doesNotMatch(paramsSource, /AIza[0-9A-Za-z_-]{30,}/);
assert.doesNotMatch(shortcodeSource, /data-china-map-frame|Mainland China Gaode Map/);
assert.match(
  workflowSource,
  /HUGO_MAIMAI_GOOGLE_MAPS_KEY:\s*\$\{\{\s*secrets\.MAIMAI_GOOGLE_MAPS_KEY\s*\}\}/,
);
assert.match(
  workflowSource,
  /HUGO_MAIMAI_BAIDU_MAPS_AK:\s*\$\{\{\s*secrets\.MAIMAI_BAIDU_BROWSER_AK\s*\}\}/,
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

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
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
    this.listenerEntries = {};
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

  addEventListener(type, callback, options) {
    if (!this.listenerEntries[type]) {
      this.listenerEntries[type] = [];
      this.listeners[type] = (event = {}) => {
        for (const entry of this.listenerEntries[type]) {
          entry.callback.call(this, event);
          if (event.immediatePropagationStopped) break;
        }
      };
    }
    this.listenerEntries[type].push({ callback, options });
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  cloneNode() {
    const clone = new FakeElement({
      dataset: { ...this.dataset },
      value: this.value,
      textContent: this.textContent,
    });
    clone.attributes = { ...this.attributes };
    clone.hidden = this.hidden;
    this.classList.values.forEach((value) => clone.classList.add(value));
    return clone;
  }

  replaceWith(replacement) {
    Object.entries(elements).forEach(([selector, element]) => {
      if (element === this) elements[selector] = replacement;
    });
  }

  remove() {
    this.removed = true;
  }

  querySelector(selector) {
    return this.elements?.[selector] ?? null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-dataset]") return this.datasetButtons ?? [];
    return [];
  }
}

class FakeListElement extends FakeElement {
  constructor(options) {
    super(options);
    this.items = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.items = [];
    const articlePattern = /<article[\s\S]*?class="([^"]*maimai-map-item[^"]*)"[\s\S]*?data-id="([^"]+)"[\s\S]*?<\/article>/g;
    for (const match of this._innerHTML.matchAll(articlePattern)) {
      const item = new FakeElement({ dataset: { id: match[2] } });
      match[1].split(/\s+/).filter(Boolean).forEach((name) => item.classList.add(name));
      const focusMatch = match[0].match(
        /class="maimai-map-item-name"[\s\S]*?data-focus="([^"]+)"/,
      );
      assert.ok(focusMatch, `missing clickable store name for ${match[2]}`);
      const nameButton = new FakeElement({ dataset: { focus: focusMatch[1] } });
      nameButton.closest = (selector) => (selector === "[data-focus]" ? nameButton : null);
      item.nameButton = nameButton;
      this.items.push(item);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll(selector) {
    if (selector === ".maimai-map-item[data-id]") return this.items;
    return super.querySelectorAll(selector);
  }
}

const baiduZoomControlsElement = new FakeElement();
baiduZoomControlsElement.hidden = true;
const baiduZoomInElement = new FakeElement();
baiduZoomInElement.disabled = true;
const baiduZoomOutElement = new FakeElement();
baiduZoomOutElement.disabled = true;

const elements = {
  "[data-dataset-title]": new FakeElement(),
  "[data-stat-total]": new FakeElement(),
  "[data-stat-mapped]": new FakeElement(),
  "[data-stat-areas]": new FakeElement(),
  "[data-status]": new FakeElement(),
  "[data-search]": new FakeElement(),
  "[data-country]": new FakeElement(),
  "[data-subregion]": new FakeElement(),
  "[data-map-shell]": new FakeElement(),
  "[data-map]": new FakeElement(),
  "[data-china-map]": new FakeElement(),
  "[data-baidu-map]": new FakeElement(),
  "[data-baidu-zoom-controls]": baiduZoomControlsElement,
  "[data-baidu-zoom-in]": baiduZoomInElement,
  "[data-baidu-zoom-out]": baiduZoomOutElement,
  "[data-china-map-empty]": new FakeElement(),
  "[data-china-map-empty-title]": new FakeElement(),
  "[data-china-map-empty-message]": new FakeElement(),
  "[data-china-map-banner]": new FakeElement(),
  "[data-china-map-message]": new FakeElement(),
  "[data-china-map-back]": new FakeElement(),
  "[data-china-map-overview]": new FakeElement(),
  "[data-china-map-external]": new FakeElement(),
  "[data-list]": new FakeListElement(),
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
      provider: "google",
      csvUrl: "/data/maimai_locations.csv",
      kmlUrl: "/data/maimai_locations.kml",
    },
    textContent: "Japan + US",
  }),
  new FakeElement({
    dataset: {
      dataset: "china",
      dataUrl: "https://sega-register.wahlap.net/api/sega/maidx/rest/location",
      supportUrl: "/data/maimai_china_region_hierarchy.json",
      adapter: "wahlap",
      provider: "baidu",
      label: "Mainland China",
    },
    textContent: "Mainland China",
  }),
  new FakeElement({
    dataset: {
      dataset: "worldwide",
      dataUrl: "/data/maimai_locations_worldwide.json",
      provider: "google",
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
    baiduMapsAk: "test-baidu-ak",
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
const secondWeishiRawLocation = {
  ...chinaRawFixture[0],
  id: "2081921990512345091",
  arcadeName: `${chinaRawFixture[0].arcadeName} 2`,
  address: `${chinaRawFixture[0].address} 2`,
  placeId: "5001",
};
chinaRawFixture.push(secondWeishiRawLocation);
const activeDistrictRawLocations = [
  chinaRawFixture[0],
  secondWeishiRawLocation,
];
const activeDistrictLocationIds = activeDistrictRawLocations.map(
  (location) => `cn-wahlap-${location.id}`,
);
const firstProvinceRawLocations = chinaRawFixture.filter(
  (location) => location.province === chinaRawFixture[0].province,
);
const chinaSupportFixture = {
  source: {
    name: "Compact China hierarchy fixture",
    url: "https://example.test/china-hierarchy",
  },
  mapGroups: [
    {
      id: "cn-province-henan",
      key: "河南",
      name: "河南",
      lat: 34.765869,
      lng: 113.753394,
    },
    {
      id: "cn-province-zhejiang",
      key: "浙江",
      name: "浙江",
      lat: 30.266597,
      lng: 120.152585,
    },
  ],
  regions: [
    {
      key: "河南",
      name: "河南省",
      aliases: ["河南"],
      cities: [
        {
          key: "开封",
          name: "开封市",
          aliases: ["开封"],
          lat: 34.797239,
          lng: 114.307581,
          districts: [
            {
              key: "尉氏",
              name: "尉氏县",
              aliases: ["尉氏"],
              lat: 34.411437,
              lng: 114.193082,
            },
          ],
        },
        {
          key: "郑州",
          name: "郑州市",
          aliases: ["郑州"],
          lat: 34.7466,
          lng: 113.6254,
          districts: [],
        },
      ],
    },
    {
      key: "浙江",
      name: "浙江省",
      aliases: ["浙江"],
      cities: [
        {
          key: "金华",
          name: "金华市",
          aliases: ["金华"],
          lat: 29.07812,
          lng: 119.647444,
          districts: [
            {
              key: "义乌",
              name: "义乌市",
              aliases: ["义乌"],
              lat: 29.306841,
              lng: 120.075058,
            },
          ],
        },
      ],
    },
  ],
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
  if (url === "/data/maimai_china_region_hierarchy.json") {
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
const appendedScripts = [];
const baiduGeocodeCalls = [];
let baiduMapInstance = null;
let baiduMapCount = 0;
let baiduMarkerCount = 0;
let baiduOverviewMarkerCount = 0;
let baiduExactMarkerCount = 0;
let baiduInfoWindowInstance = null;
let managedTimerSequence = 0;
let managedNow = 1_000_000;
const managedLongTimers = new Map();
const managedRateTimers = new Map();

class ManagedDate extends Date {
  static now() {
    return managedNow;
  }
}

function managedSetTimeout(callback, delay = 0, ...args) {
  if (delay >= 10000) {
    const timer = { managed: true, id: ++managedTimerSequence };
    managedLongTimers.set(timer, { callback, delay, args });
    return timer;
  }
  if (delay >= 250) {
    const timer = { managedRate: true, id: ++managedTimerSequence };
    managedRateTimers.set(timer, { callback, delay, args });
    return timer;
  }
  return setTimeout(callback, delay, ...args);
}

function managedClearTimeout(timer) {
  if (timer?.managed) {
    managedLongTimers.delete(timer);
    return;
  }
  if (timer?.managedRate) {
    managedRateTimers.delete(timer);
    return;
  }
  clearTimeout(timer);
}

function fireManagedLongTimer(delay) {
  const match = [...managedLongTimers.entries()].find(([, timer]) => timer.delay === delay);
  assert.ok(match, `missing managed ${delay}ms timer`);
  const [timerId, timer] = match;
  managedLongTimers.delete(timerId);
  timer.callback(...timer.args);
}

function fireNextManagedRateTimer() {
  const match = managedRateTimers.entries().next().value;
  assert.ok(match, "missing managed rate-limit timer");
  const [timerId, timer] = match;
  managedRateTimers.delete(timerId);
  managedNow += timer.delay;
  timer.callback(...timer.args);
}

async function releaseRateLimitedGeocodes(expectedCallCount) {
  let guard = 0;
  while (baiduGeocodeCalls.length < expectedCallCount && guard < 50) {
    await settle(2);
    if (baiduGeocodeCalls.length >= expectedCallCount) break;
    assert.ok(
      managedRateTimers.size > 0,
      `expected a rate-limit timer before geocode call ${expectedCallCount}`,
    );
    fireNextManagedRateTimer();
    guard += 1;
  }
  await settle(2);
  assert.equal(baiduGeocodeCalls.length, expectedCallCount);
}

class FakeBaiduPoint {
  constructor(lng, lat) {
    this.lng = lng;
    this.lat = lat;
  }
}

class FakeBaiduMap {
  constructor(element, options) {
    baiduMapCount += 1;
    this.element = element;
    this.options = options;
    this.overlays = [];
    this.centerAndZoomCalls = [];
    this.clearOverlaysCalls = 0;
    this.checkResizeCalls = 0;
    this.scrollWheelEnabled = false;
    this.scrollWheelEnableArgument = undefined;
    this.scrollWheelDisableCalls = 0;
    this.pinchToZoomEnabled = false;
    this.keyboardEnabled = false;
    this.continuousZoomEnabled = false;
    this.doubleClickZoomEnabled = false;
    this.zoomInCalls = 0;
    this.zoomOutCalls = 0;
    this.listeners = {};
    baiduMapInstance = this;
  }

  centerAndZoom(point, zoom) {
    this.center = point;
    this.zoom = zoom;
    this.centerAndZoomCalls.push({ point, zoom });
    this.emitZoomEnd();
  }

  enableScrollWheelZoom(value) {
    this.scrollWheelEnableArgument = value;
    this.scrollWheelEnabled = value === true;
  }

  disableScrollWheelZoom() {
    this.scrollWheelDisableCalls += 1;
    this.scrollWheelEnabled = false;
  }

  enablePinchToZoom() {
    this.pinchToZoomEnabled = true;
  }

  enableKeyboard() {
    this.keyboardEnabled = true;
  }

  enableContinuousZoom() {
    this.continuousZoomEnabled = true;
  }

  enableDoubleClickZoom() {
    this.doubleClickZoomEnabled = true;
  }

  zoomIn() {
    this.zoomInCalls += 1;
    this.zoom += 1;
    this.emitZoomEnd();
  }

  zoomOut() {
    this.zoomOutCalls += 1;
    this.zoom -= 1;
    this.emitZoomEnd();
  }

  addEventListener(type, callback) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(callback);
  }

  getCenter() {
    return this.center;
  }

  getZoom() {
    return this.zoom;
  }

  getBounds() {
    const halfSpan = 20 / Math.max(this.zoom || 1, 1);
    return {
      containsPoint: (point) => (
        Math.abs(point.lat - this.center.lat) <= halfSpan
        && Math.abs(point.lng - this.center.lng) <= halfSpan
      ),
    };
  }

  emitZoomEnd() {
    (this.listeners.zoomend || []).forEach((callback) => {
      callback.call(this, { type: "zoomend", target: this });
    });
  }

  simulateUserZoom(zoom, center = this.center) {
    this.element.listeners.pointerdown?.({ type: "pointerdown", target: this.element });
    this.zoom = zoom;
    this.center = center;
    this.emitZoomEnd();
  }

  checkResize() {
    this.checkResizeCalls += 1;
  }

  setViewport(points, options) {
    this.viewportPoints = [...points];
    this.viewportOptions = options;
    this.emitZoomEnd();
  }

  clearOverlays() {
    this.overlays = [];
    this.clearOverlaysCalls += 1;
  }

  addOverlay(overlay) {
    this.overlays.push(overlay);
  }

  removeOverlay(overlay) {
    this.overlays = this.overlays.filter((item) => item !== overlay);
  }

  getOverlays() {
    return [...this.overlays];
  }

  openInfoWindow(infoWindow, point) {
    this.infoWindow = infoWindow;
    this.infoPoint = point;
  }

  closeInfoWindow() {
    this.infoWindow = null;
    this.infoPoint = null;
  }
}

class FakeBaiduGeocoder {
  getPoint(address, callback, city) {
    baiduGeocodeCalls.push({ address, callback, city });
  }
}

class FakeBaiduMarker {
  constructor(point, options = {}) {
    baiduMarkerCount += 1;
    this.point = point;
    this.options = options;
    this.listeners = {};
    this.isOverview = /:\s[\d,]+\slocations$/.test(options.title || "");
    if (this.isOverview) {
      baiduOverviewMarkerCount += 1;
    } else {
      baiduExactMarkerCount += 1;
    }
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  setLabel(label) {
    this.label = label;
  }

  getPosition() {
    return this.point;
  }

  openInfoWindow(infoWindow) {
    this.infoWindow = infoWindow;
  }
}

class FakeBaiduLabel {
  constructor(content, options) {
    this.content = content;
    this.options = options;
    this.listeners = {};
  }

  setStyle(style) {
    this.style = style;
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }
}

class FakeBaiduSize {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
}

class FakeBaiduInfoWindow {
  constructor(content, options) {
    this.content = content;
    this.options = options;
    baiduInfoWindowInstance = this;
  }
}

const fakeBMap = {
  Map: FakeBaiduMap,
  Point: FakeBaiduPoint,
  Geocoder: FakeBaiduGeocoder,
  Marker: FakeBaiduMarker,
  Label: FakeBaiduLabel,
  Size: FakeBaiduSize,
  InfoWindow: FakeBaiduInfoWindow,
};

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
  clearTimeout: managedClearTimeout,
  setTimeout: managedSetTimeout,
  requestAnimationFrame(callback) {
    callback();
  },
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
        trigger(map, eventName) {
          assert.equal(eventName, "resize");
          map.resizeTriggered = true;
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
  Date: ManagedDate,
  document: {
    querySelector(selector) {
      return selector === "[data-maimai-map]" ? root : null;
    },
    createElement(tagName) {
      const element = new FakeElement();
      element.tagName = String(tagName || "").toUpperCase();
      return element;
    },
    head: {
      appendChild(element) {
        appendedScripts.push(element);
        element.parentNode = this;
        return element;
      },
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
  setTimeout: managedSetTimeout,
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
assert.equal(fetchCounts.get("/data/maimai_china_region_hierarchy.json"), 1);
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

assert.equal(appendedScripts.length, 0);
datasetButtons[1].listeners.click();
await settle();
assert.equal(elements["[data-dataset-title]"].textContent, "舞萌DX Mainland China");
assert.equal(
  elements["[data-stat-total]"].textContent,
  `${chinaRawFixture.length} locations`,
);
assert.equal(elements["[data-stat-mapped]"].textContent, "2 province summaries");
assert.equal(elements["[data-stat-areas]"].textContent, "2 provinces");
assert.equal(clustererInstance.markers.length, 0);
assert.ok(
  elements["[data-status]"].textContent.includes(
    `${chinaRawFixture.length} live official locations`,
  ),
);
assert.match(elements["[data-status]"].textContent, /province overview/i);
assert.ok(elements["[data-list]"].innerHTML.includes("cn-wahlap-2081921990512345090"));
assert.ok(elements["[data-list]"].innerHTML.includes("maimai-map-item-name"));
assert.equal(elements["[data-exports]"].hidden, true);
assert.equal(elements["[data-map]"].hidden, true);
assert.equal(elements["[data-china-map]"].hidden, false);
assert.equal(elements["[data-map-shell]"].attributes["aria-label"], "maimai Mainland China Baidu Map");
assert.equal(baiduMapCount, 0);
assert.equal(appendedScripts.length, 1);
const initialBaiduScript = appendedScripts[0];
assert.equal(initialBaiduScript.tagName, "SCRIPT");
const initialBaiduScriptUrl = new URL(initialBaiduScript.src);
assert.equal(initialBaiduScriptUrl.origin, "https://api.map.baidu.com");
assert.equal(initialBaiduScriptUrl.searchParams.get("v"), "3.0");
assert.equal(initialBaiduScriptUrl.searchParams.get("type"), null);
assert.equal(initialBaiduScriptUrl.searchParams.get("ak"), root.dataset.baiduMapsAk);
const initialBaiduCallbackName = initialBaiduScriptUrl.searchParams.get("callback");
assert.match(initialBaiduCallbackName, /^__initMaimaiBaiduMap\d+$/);
assert.equal(typeof windowObject[initialBaiduCallbackName], "function");
assert.equal(initialBaiduScript.onload, undefined);
assert.notEqual(initialBaiduScript.removed, true);
assert.equal(managedLongTimers.size, 1);
fireManagedLongTimer(15000);
assert.equal(initialBaiduScript.removed, true);
assert.equal(typeof windowObject[initialBaiduCallbackName], "undefined");
assert.match(elements["[data-status]"].textContent, /could not load/i);
assert.equal(managedLongTimers.size, 0);

datasetButtons[1].listeners.click();
await settle();
assert.equal(appendedScripts.length, 2);
const failedBaiduScript = appendedScripts[1];
const failedBaiduCallbackName = new URL(failedBaiduScript.src).searchParams.get("callback");
assert.match(failedBaiduCallbackName, /^__initMaimaiBaiduMap\d+$/);
assert.notEqual(failedBaiduCallbackName, initialBaiduCallbackName);
failedBaiduScript.onerror();
assert.equal(failedBaiduScript.removed, true);
assert.equal(typeof windowObject[failedBaiduCallbackName], "undefined");
assert.match(elements["[data-status]"].textContent, /could not load/i);
assert.equal(managedLongTimers.size, 0);

datasetButtons[1].listeners.click();
await settle();
assert.equal(appendedScripts.length, 3);
const baiduScript = appendedScripts[2];
assert.equal(baiduScript.tagName, "SCRIPT");
const baiduScriptUrl = new URL(baiduScript.src);
assert.equal(baiduScriptUrl.origin, "https://api.map.baidu.com");
assert.equal(baiduScriptUrl.searchParams.get("v"), "3.0");
assert.equal(baiduScriptUrl.searchParams.get("type"), null);
assert.equal(baiduScriptUrl.searchParams.get("ak"), root.dataset.baiduMapsAk);
const baiduCallbackName = baiduScriptUrl.searchParams.get("callback");
assert.match(baiduCallbackName, /^__initMaimaiBaiduMap\d+$/);
assert.notEqual(baiduCallbackName, failedBaiduCallbackName);
assert.equal(typeof windowObject[baiduCallbackName], "function");

context.BMap = fakeBMap;
windowObject.BMap = fakeBMap;
windowObject[baiduCallbackName]();
await settle();
assert.equal(baiduMapCount, 1);
assert.equal(managedLongTimers.size, 0);
assert.equal(baiduMapInstance.element, elements["[data-baidu-map]"]);
assert.notEqual(baiduMapInstance.scrollWheelEnableArgument, true);
assert.equal(baiduMapInstance.scrollWheelEnabled, false);
assert.equal(baiduMapInstance.scrollWheelDisableCalls, 1);
assert.equal(baiduMapInstance.pinchToZoomEnabled, true);
assert.equal(baiduMapInstance.keyboardEnabled, true);
assert.equal(baiduMapInstance.continuousZoomEnabled, true);
assert.equal(baiduMapInstance.doubleClickZoomEnabled, true);
assert.equal(elements["[data-baidu-zoom-controls]"].hidden, false);
assert.equal(elements["[data-baidu-zoom-in]"].disabled, false);
assert.equal(elements["[data-baidu-zoom-out]"].disabled, false);
assert.equal(typeof elements["[data-baidu-zoom-in]"].listeners.click, "function");
assert.equal(typeof elements["[data-baidu-zoom-out]"].listeners.click, "function");
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.equal(baiduMapInstance.viewportPoints.length, chinaSupportFixture.mapGroups.length);
assert.deepEqual(
  baiduMapInstance.overlays.map((marker) => marker.options.title).sort(),
  chinaSupportFixture.mapGroups
    .map((group) => {
      const count = chinaRawFixture.filter((location) => location.province === group.key).length;
      return `${group.name}: ${count} locations`;
    })
    .sort(),
);
assert.ok(baiduMapInstance.overlays.every((marker) => marker.label));
assert.match(elements["[data-status]"].textContent, /province overview markers/i);
assert.equal(elements["[data-open-visible]"].textContent, "Open Baidu");
assert.equal(baiduMapInstance.listeners.zoomend.length, 1);
const baiduWheelListenerEntries = elements["[data-baidu-map]"].listenerEntries.wheel ?? [];
const baiduCustomWheelListener = baiduWheelListenerEntries.find(
  (entry) => entry.options?.capture === true && entry.options?.passive === false,
);
assert.ok(
  baiduCustomWheelListener,
  "Baidu fallback wheel handler must run in capture phase and be explicitly non-passive",
);

const geocodesBeforeAutomaticZoom = baiduGeocodeCalls.length;
const weishiOverviewPoint = new FakeBaiduPoint(114.193082, 34.411437);
baiduMapInstance.center = weishiOverviewPoint;
elements["[data-baidu-map]"].clientHeight = 600;
let baiduWheelTimeStamp = 1000;
const dispatchBaiduWheel = (deltaY, deltaMode = 0, elapsedMs = 200) => {
  baiduWheelTimeStamp += elapsedMs;
  const event = {
    type: "wheel",
    deltaY,
    deltaMode,
    timeStamp: baiduWheelTimeStamp,
    cancelable: true,
    defaultPrevented: false,
    propagationStopped: false,
    immediatePropagationStopped: false,
    target: elements["[data-baidu-map]"],
    currentTarget: elements["[data-baidu-map]"],
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    stopImmediatePropagation() {
      this.immediatePropagationStopped = true;
      this.propagationStopped = true;
    },
  };
  elements["[data-baidu-map]"].listeners.wheel(event);
  return event;
};
const clickBaiduZoomIn = () => {
  elements["[data-baidu-zoom-in]"].listeners.click({
    type: "click",
    currentTarget: elements["[data-baidu-zoom-in]"],
    preventDefault() {},
    stopPropagation() {},
  });
};
const clickBaiduZoomOut = () => {
  elements["[data-baidu-zoom-out]"].listeners.click({
    type: "click",
    currentTarget: elements["[data-baidu-zoom-out]"],
    preventDefault() {},
    stopPropagation() {},
  });
};
clickBaiduZoomIn();
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.match(elements["[data-status]"].textContent, /province overview markers/i);
clickBaiduZoomIn();
assert.equal(baiduMapInstance.zoom, 7);
assert.equal(elements["[data-subregion]"].value, chinaRawFixture[0].province);
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${firstProvinceRawLocations.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);

clickBaiduZoomIn();
clickBaiduZoomIn();
clickBaiduZoomIn();
assert.equal(baiduMapInstance.zoom, 10);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);
clickBaiduZoomIn();
assert.equal(baiduMapInstance.zoom, 11);
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${activeDistrictRawLocations.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(
  baiduMapInstance.overlays[0].options.title,
  `${chinaSupportFixture.regions[0].cities[0].districts[0].name}: `
    + `${activeDistrictRawLocations.length} locations`,
);
assert.match(elements["[data-status]"].textContent, /1 district overview marker/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);

clickBaiduZoomOut();
assert.equal(baiduMapInstance.zoom, 10);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.match(elements["[data-status]"].textContent, /1 district overview marker/i);

clickBaiduZoomOut();
assert.equal(baiduMapInstance.zoom, 9);
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${firstProvinceRawLocations.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);

clickBaiduZoomOut();
clickBaiduZoomOut();
clickBaiduZoomOut();
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(elements["[data-subregion]"].value, "");
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${chinaRawFixture.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.match(elements["[data-status]"].textContent, /province overview markers/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);
assert.equal(baiduMapInstance.zoomInCalls, 6);
assert.equal(baiduMapInstance.zoomOutCalls, 5);
assert.equal(baiduMapInstance.listeners.zoomend.length, 1);

const throttledZoomInCallsBefore = baiduMapInstance.zoomInCalls;
const firstThrottledWheel = dispatchBaiduWheel(-120);
assert.equal(firstThrottledWheel.defaultPrevented, true);
assert.equal(firstThrottledWheel.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 7);
assert.equal(baiduMapInstance.zoomInCalls, throttledZoomInCallsBefore + 1);
const rapidThrottledWheel = dispatchBaiduWheel(-120, 0, 80);
assert.equal(rapidThrottledWheel.defaultPrevented, true);
assert.equal(rapidThrottledWheel.propagationStopped, true);
assert.equal(
  baiduMapInstance.zoom,
  7,
  "a second wheel event inside the minimum step interval must not zoom",
);
assert.equal(baiduMapInstance.zoomInCalls, throttledZoomInCallsBefore + 1);
const resumedThrottledWheel = dispatchBaiduWheel(-120, 0, 161);
assert.equal(resumedThrottledWheel.defaultPrevented, true);
assert.equal(resumedThrottledWheel.propagationStopped, true);
assert.equal(
  baiduMapInstance.zoom,
  8,
  "accumulated wheel momentum may emit at most one step after the throttle interval",
);
assert.equal(baiduMapInstance.zoomInCalls, throttledZoomInCallsBefore + 2);
dispatchBaiduWheel(120);
dispatchBaiduWheel(120);
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(elements["[data-subregion]"].value, "");
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.match(elements["[data-status]"].textContent, /province overview markers/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);

const wheelZoomInCallsBefore = baiduMapInstance.zoomInCalls;
const wheelZoomOutCallsBefore = baiduMapInstance.zoomOutCalls;
const zeroWheel = dispatchBaiduWheel(0);
assert.equal(zeroWheel.defaultPrevented, false);
assert.equal(zeroWheel.propagationStopped, false);
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(baiduMapInstance.zoomInCalls, wheelZoomInCallsBefore);
assert.equal(baiduMapInstance.zoomOutCalls, wheelZoomOutCallsBefore);

const fullPixelWheelOut = dispatchBaiduWheel(120);
assert.equal(fullPixelWheelOut.defaultPrevented, true);
assert.equal(fullPixelWheelOut.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 5);
assert.equal(baiduMapInstance.zoomOutCalls, wheelZoomOutCallsBefore + 1);
const fullPixelWheelIn = dispatchBaiduWheel(-120);
assert.equal(fullPixelWheelIn.defaultPrevented, true);
assert.equal(fullPixelWheelIn.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(baiduMapInstance.zoomInCalls, wheelZoomInCallsBefore + 1);

const partialOppositeStart = dispatchBaiduWheel(-60);
assert.equal(partialOppositeStart.defaultPrevented, true);
assert.equal(partialOppositeStart.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 6);
const partialOppositeReset = dispatchBaiduWheel(60);
assert.equal(partialOppositeReset.defaultPrevented, true);
assert.equal(partialOppositeReset.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 6);
const partialOppositeComplete = dispatchBaiduWheel(60);
assert.equal(partialOppositeComplete.defaultPrevented, true);
assert.equal(partialOppositeComplete.propagationStopped, true);
assert.equal(
  baiduMapInstance.zoom,
  5,
  "reversing wheel direction must discard the earlier opposite-direction accumulation",
);
assert.equal(baiduMapInstance.zoomOutCalls, wheelZoomOutCallsBefore + 2);

dispatchBaiduWheel(-120);
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(baiduMapInstance.zoomInCalls, wheelZoomInCallsBefore + 2);
dispatchBaiduWheel(-30);
assert.equal(baiduMapInstance.zoom, 6);
dispatchBaiduWheel(-30);
assert.equal(baiduMapInstance.zoom, 6);
dispatchBaiduWheel(-30);
assert.equal(baiduMapInstance.zoom, 6);
const accumulatedTrackpadWheel = dispatchBaiduWheel(-30);
assert.equal(accumulatedTrackpadWheel.defaultPrevented, true);
assert.equal(accumulatedTrackpadWheel.propagationStopped, true);
assert.equal(
  baiduMapInstance.zoom,
  7,
  "small same-direction trackpad deltas must accumulate into one zoom step",
);
assert.equal(baiduMapInstance.zoomInCalls, wheelZoomInCallsBefore + 3);
assert.equal(elements["[data-subregion]"].value, chinaRawFixture[0].province);
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${firstProvinceRawLocations.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);

const lineModeWheel = dispatchBaiduWheel(-8, 1);
assert.equal(lineModeWheel.defaultPrevented, true);
assert.equal(lineModeWheel.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 8);
assert.equal(baiduMapInstance.zoomInCalls, wheelZoomInCallsBefore + 4);
const pageModeWheel = dispatchBaiduWheel(1, 2);
assert.equal(pageModeWheel.defaultPrevented, true);
assert.equal(pageModeWheel.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 7);
assert.equal(baiduMapInstance.zoomOutCalls, wheelZoomOutCallsBefore + 3);

dispatchBaiduWheel(-120);
dispatchBaiduWheel(-120);
dispatchBaiduWheel(-120);
const wheelIntoDistrict = dispatchBaiduWheel(-120);
assert.equal(wheelIntoDistrict.defaultPrevented, true);
assert.equal(wheelIntoDistrict.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 11);
assert.equal(baiduMapInstance.zoomInCalls, wheelZoomInCallsBefore + 8);
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${activeDistrictRawLocations.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.match(elements["[data-status]"].textContent, /1 district overview marker/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);

dispatchBaiduWheel(120);
const wheelBackToCity = dispatchBaiduWheel(120);
assert.equal(wheelBackToCity.defaultPrevented, true);
assert.equal(wheelBackToCity.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 9);
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${firstProvinceRawLocations.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);
dispatchBaiduWheel(120);
dispatchBaiduWheel(120);
const wheelBackToProvince = dispatchBaiduWheel(120);
assert.equal(wheelBackToProvince.defaultPrevented, true);
assert.equal(wheelBackToProvince.propagationStopped, true);
assert.equal(baiduMapInstance.zoom, 6);
assert.equal(baiduMapInstance.zoomOutCalls, wheelZoomOutCallsBefore + 8);
assert.equal(elements["[data-subregion]"].value, "");
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${chinaRawFixture.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.match(elements["[data-status]"].textContent, /province overview markers/i);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeAutomaticZoom);

baiduMapInstance.simulateUserZoom(11, weishiOverviewPoint);
assert.equal(baiduMapInstance.zoom, 9);
assert.equal(elements["[data-subregion]"].value, chinaRawFixture[0].province);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);
baiduMapInstance.simulateUserZoom(6, weishiOverviewPoint);
assert.equal(elements["[data-subregion]"].value, "");
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);

const zhejiangProvinceMarker = baiduMapInstance.overlays.find(
  (marker) => marker.options.title.startsWith("浙江:"),
);
assert.ok(zhejiangProvinceMarker);
const geocodesBeforeYiwuInference = baiduGeocodeCalls.length;
zhejiangProvinceMarker.listeners.click();
assert.equal(elements["[data-visible-count]"].textContent, "1 locations");
assert.equal(baiduGeocodeCalls.length, geocodesBeforeYiwuInference);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].options.title, "金华市: 1 locations");
elements["[data-china-map-back]"].listeners.click();
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${chinaRawFixture.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);

const firstProvinceOverviewMarker = baiduMapInstance.overlays.find(
  (marker) => marker.options.title.startsWith(`${chinaRawFixture[0].province}:`),
);
assert.ok(firstProvinceOverviewMarker);
const provinceBadgeStyle = firstProvinceOverviewMarker.label.style;
const geocodesBeforeProvinceSelection = baiduGeocodeCalls.length;
firstProvinceOverviewMarker.listeners.click();
assert.equal(elements["[data-subregion]"].value, "河南");
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${firstProvinceRawLocations.length} locations`,
);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeProvinceSelection);
assert.equal(baiduMapInstance.overlays.length, 2);
assert.ok(baiduMapInstance.overlays.every((marker) => marker.isOverview));
const kaifengCityMarker = baiduMapInstance.overlays.find(
  (marker) => marker.options.title === `开封市: ${activeDistrictRawLocations.length} locations`,
);
const zhengzhouCityMarker = baiduMapInstance.overlays.find(
  (marker) => marker.options.title === "郑州市: 1 locations",
);
assert.ok(kaifengCityMarker);
assert.ok(zhengzhouCityMarker);
const cityBadgeStyle = kaifengCityMarker.label.style;
assert.equal(provinceBadgeStyle.backgroundColor, "#c24f22");
assert.equal(cityBadgeStyle.backgroundColor, "#256f9c");
assert.ok(parseInt(provinceBadgeStyle.fontSize, 10) > parseInt(cityBadgeStyle.fontSize, 10));
assert.equal(elements["[data-china-map-back]"].hidden, false);
assert.equal(elements["[data-china-map-back]"].textContent, "Back to provinces");
assert.equal(elements["[data-china-map-overview]"].hidden, false);
assert.equal(clustererInstance.markers.length, 0);
assert.match(elements["[data-status]"].textContent, /2 city overview markers/i);

kaifengCityMarker.listeners.click();
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${activeDistrictRawLocations.length} locations`,
);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeProvinceSelection);
assert.equal(baiduMapInstance.overlays.length, 1);
const weishiDistrictMarker = baiduMapInstance.overlays[0];
assert.equal(
  weishiDistrictMarker.options.title,
  `尉氏县: ${activeDistrictRawLocations.length} locations`,
);
assert.equal(weishiDistrictMarker.isOverview, true);
const districtBadgeStyle = weishiDistrictMarker.label.style;
assert.equal(districtBadgeStyle.backgroundColor, "#3b7d5b");
assert.ok(parseInt(cityBadgeStyle.fontSize, 10) > parseInt(districtBadgeStyle.fontSize, 10));
assert.ok(parseInt(cityBadgeStyle.lineHeight, 10) > parseInt(districtBadgeStyle.lineHeight, 10));
assert.equal(baiduMapInstance.zoom, 12);
assert.equal(elements["[data-china-map-back]"].textContent, "Back to cities");
assert.match(elements["[data-status]"].textContent, /1 district overview marker/i);

weishiDistrictMarker.listeners.click();
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${activeDistrictRawLocations.length} locations`,
);
assert.equal(baiduGeocodeCalls.length, geocodesBeforeProvinceSelection + 1);
assert.equal(
  baiduGeocodeCalls[geocodesBeforeProvinceSelection].address,
  activeDistrictRawLocations[0].address,
);
assert.equal(baiduGeocodeCalls[geocodesBeforeProvinceSelection].city, "开封市");
assert.equal(baiduMapInstance.overlays.length, 0);
assert.equal(baiduExactMarkerCount, 0);
assert.equal(elements["[data-china-map-back]"].textContent, "Back to districts");
assert.match(elements["[data-status]"].textContent, /0 of 2 address-matched store markers/i);
assert.equal(managedLongTimers.size, 1);
assert.equal(managedRateTimers.size, 1);

// Exiting while a district batch is pending must cancel queued work and make
// the already-issued callback stale.
const staleDistrictCallback = baiduGeocodeCalls[geocodesBeforeProvinceSelection].callback;
elements["[data-china-map-back]"].listeners.click();
assert.equal(managedLongTimers.size, 0);
assert.equal(managedRateTimers.size, 0);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].isOverview, true);
assert.equal(
  baiduMapInstance.overlays[0].options.title,
  `尉氏县: ${activeDistrictRawLocations.length} locations`,
);
const districtStatusAfterExit = elements["[data-status]"].textContent;
const districtCenterAfterExit = baiduMapInstance.center;
staleDistrictCallback(new FakeBaiduPoint(114.15, 34.45));
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].isOverview, true);
assert.equal(baiduMapInstance.center, districtCenterAfterExit);
assert.equal(elements["[data-status]"].textContent, districtStatusAfterExit);

// Re-enter and release the rate-limited active-district requests. Clicking a
// queued store in the list must prioritize it without issuing a duplicate.
const districtMarkerAfterStaleExit = baiduMapInstance.overlays[0];
const geocodesBeforeResolvedDistrict = baiduGeocodeCalls.length;
districtMarkerAfterStaleExit.listeners.click();
assert.equal(baiduGeocodeCalls.length, geocodesBeforeResolvedDistrict + 1);
assert.equal(managedRateTimers.size, 1);
const activeStoreItems = activeDistrictLocationIds.map((id) => (
  elements["[data-list]"].items.find((item) => item.dataset.id === id)
));
assert.ok(activeStoreItems.every(Boolean));
elements["[data-list]"].listeners.click({
  target: activeStoreItems[1].nameButton,
});
assert.equal(
  baiduGeocodeCalls.length,
  geocodesBeforeResolvedDistrict + 1,
  "selecting a queued district store must not duplicate its geocode request",
);
await releaseRateLimitedGeocodes(
  geocodesBeforeResolvedDistrict + activeDistrictRawLocations.length,
);
const resolvedDistrictCalls = baiduGeocodeCalls.slice(geocodesBeforeResolvedDistrict);
assert.deepEqual(
  resolvedDistrictCalls.map((call) => call.address).sort(),
  activeDistrictRawLocations.map((location) => location.address).sort(),
);
assert.ok(resolvedDistrictCalls.every((call) => call.city === "开封市"));
assert.ok(
  resolvedDistrictCalls.every((call) => (
    activeDistrictRawLocations.some((location) => location.address === call.address)
  )),
  "only stores inside the active district may be geocoded",
);
assert.equal(managedLongTimers.size, activeDistrictRawLocations.length);

const pointByAddress = new Map([
  [
    activeDistrictRawLocations[0].address,
    new FakeBaiduPoint(114.193082, 34.411437),
  ],
  [
    activeDistrictRawLocations[1].address,
    new FakeBaiduPoint(114.203082, 34.421437),
  ],
]);
// Resolve out of order to prove that asynchronous Baidu callbacks do not
// affect marker completeness or list selection.
resolvedDistrictCalls[1].callback(pointByAddress.get(resolvedDistrictCalls[1].address));
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].isOverview, false);
resolvedDistrictCalls[0].callback(pointByAddress.get(resolvedDistrictCalls[0].address));
assert.equal(managedLongTimers.size, 0);
assert.equal(managedRateTimers.size, 0);
assert.equal(baiduMapInstance.overlays.length, activeDistrictRawLocations.length);
assert.ok(baiduMapInstance.overlays.every((marker) => !marker.isOverview));
assert.deepEqual(
  baiduMapInstance.overlays.map((marker) => marker.options.title).sort(),
  activeDistrictRawLocations.map((location) => location.arcadeName).sort(),
);
assert.match(elements["[data-status]"].textContent, /showing 2 address-matched store markers/i);
assert.equal(
  baiduExactMarkerCount,
  activeDistrictRawLocations.length,
  "province, city, and district summaries must not create exact store markers",
);

const geocodesAfterDistrictBatch = baiduGeocodeCalls.length;
const firstExactMarker = baiduMapInstance.overlays.find(
  (marker) => marker.options.title === activeDistrictRawLocations[0].arcadeName,
);
assert.ok(firstExactMarker);
firstExactMarker.listeners.click();
assert.equal(baiduMapInstance.overlays.length, activeDistrictRawLocations.length);
assert.equal(baiduGeocodeCalls.length, geocodesAfterDistrictBatch);
assert.ok(baiduMapInstance.infoWindow.content.includes(activeDistrictRawLocations[0].arcadeName));
assert.ok(baiduMapInstance.infoWindow.content.includes(activeDistrictRawLocations[0].address));
assert.equal(activeStoreItems[0].classList.contains("is-selected"), true);
assert.equal(activeStoreItems[0].attributes["aria-current"], "true");
assert.equal(elements["[data-china-map-back]"].textContent, "Back to district stores");

elements["[data-list]"].listeners.click({
  target: activeStoreItems[1].nameButton,
});
assert.equal(baiduMapInstance.overlays.length, activeDistrictRawLocations.length);
assert.equal(baiduGeocodeCalls.length, geocodesAfterDistrictBatch);
assert.equal(
  baiduMapInstance.center,
  pointByAddress.get(activeDistrictRawLocations[1].address),
);
assert.ok(baiduMapInstance.zoom >= 15);
assert.ok(baiduMapInstance.infoWindow.content.includes(activeDistrictRawLocations[1].arcadeName));
assert.equal(activeStoreItems[0].classList.contains("is-selected"), false);
assert.equal(activeStoreItems[1].classList.contains("is-selected"), true);

// First Back only clears store selection. The second Back exits the exact
// layer and restores the district summary marker.
elements["[data-china-map-back]"].listeners.click();
assert.equal(baiduMapInstance.overlays.length, activeDistrictRawLocations.length);
assert.ok(baiduMapInstance.overlays.every((marker) => !marker.isOverview));
assert.equal(
  elements["[data-list]"].items.filter((item) => item.classList.contains("is-selected")).length,
  0,
);
assert.equal(elements["[data-china-map-back]"].textContent, "Back to districts");
assert.equal(baiduGeocodeCalls.length, geocodesAfterDistrictBatch);
elements["[data-china-map-back]"].listeners.click();
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].isOverview, true);
assert.equal(
  baiduMapInstance.overlays[0].options.title,
  `尉氏县: ${activeDistrictRawLocations.length} locations`,
);

// Successful address matches remain cached for this page session.
const cachedDistrictMarker = baiduMapInstance.overlays[0];
cachedDistrictMarker.listeners.click();
assert.equal(baiduGeocodeCalls.length, geocodesAfterDistrictBatch);
assert.equal(managedLongTimers.size, 0);
assert.equal(managedRateTimers.size, 0);
assert.equal(baiduMapInstance.overlays.length, activeDistrictRawLocations.length);
assert.ok(baiduMapInstance.overlays.every((marker) => !marker.isOverview));
assert.deepEqual(
  baiduMapInstance.overlays.map((marker) => marker.point),
  activeDistrictRawLocations.map((location) => pointByAddress.get(location.address)),
);

// Zooming out to 12 exits the store layer; zooming back to 14 automatically
// restores every cached exact marker without another request. The zoomed map
// may be centered on a store far from the administrative-center summary pin,
// so automatic district selection must also use the nearest global fallback.
const offCenterStorePoint = new FakeBaiduPoint(124.193082, 44.411437);
baiduMapInstance.simulateUserZoom(12, weishiOverviewPoint);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].isOverview, true);
assert.equal(baiduGeocodeCalls.length, geocodesAfterDistrictBatch);
baiduMapInstance.simulateUserZoom(14, offCenterStorePoint);
assert.equal(baiduMapInstance.overlays.length, activeDistrictRawLocations.length);
assert.ok(baiduMapInstance.overlays.every((marker) => !marker.isOverview));
assert.equal(baiduGeocodeCalls.length, geocodesAfterDistrictBatch);
baiduMapInstance.simulateUserZoom(12, offCenterStorePoint);
assert.equal(baiduMapInstance.overlays.length, 1);
assert.equal(baiduMapInstance.overlays[0].isOverview, true);

elements["[data-china-map-overview]"].listeners.click();
assert.equal(elements["[data-subregion]"].value, "");
assert.equal(
  elements["[data-visible-count]"].textContent,
  `${chinaRawFixture.length} locations`,
);
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.ok(baiduMapInstance.overlays.every((marker) => marker.isOverview));
assert.equal(elements["[data-china-map-back]"].hidden, true);
assert.equal(elements["[data-china-map-overview]"].hidden, true);

// A pending batch in another district must also be inert after switching away
// from the China dataset.
const zhejiangMarkerForStaleBatch = baiduMapInstance.overlays.find(
  (marker) => marker.options.title.startsWith("浙江:"),
);
assert.ok(zhejiangMarkerForStaleBatch);
zhejiangMarkerForStaleBatch.listeners.click();
const jinhuaMarkerForStaleBatch = baiduMapInstance.overlays[0];
jinhuaMarkerForStaleBatch.listeners.click();
const yiwuMarkerForStaleBatch = baiduMapInstance.overlays[0];
const geocodesBeforeDatasetSwitchBatch = baiduGeocodeCalls.length;
yiwuMarkerForStaleBatch.listeners.click();
assert.equal(baiduGeocodeCalls.length, geocodesBeforeDatasetSwitchBatch + 1);
assert.equal(managedLongTimers.size, 1);
const pendingChinaCallback = baiduGeocodeCalls.at(-1).callback;

datasetButtons[0].listeners.click();
await settle();
assert.equal(managedLongTimers.size, 0);
assert.equal(managedRateTimers.size, 0);
assert.equal(fetchCounts.get("/data/maimai_locations.json"), 1);
assert.equal(clustererInstance.markers.length, currentMapped);
assert.equal(elements["[data-map]"].hidden, false);
assert.equal(elements["[data-china-map]"].hidden, true);
assert.equal(baiduMapInstance.overlays.length, 0);
const inactiveBaiduZoom = baiduMapInstance.zoom;
const inactiveBaiduZoomInCalls = baiduMapInstance.zoomInCalls;
const inactiveBaiduZoomOutCalls = baiduMapInstance.zoomOutCalls;
const inactiveBaiduWheel = dispatchBaiduWheel(120);
assert.equal(inactiveBaiduWheel.defaultPrevented, false);
assert.equal(inactiveBaiduWheel.propagationStopped, false);
assert.equal(baiduMapInstance.zoom, inactiveBaiduZoom);
assert.equal(baiduMapInstance.zoomInCalls, inactiveBaiduZoomInCalls);
assert.equal(baiduMapInstance.zoomOutCalls, inactiveBaiduZoomOutCalls);
const restoredGoogleStatus = elements["[data-status]"].textContent;
pendingChinaCallback(new FakeBaiduPoint(120.075058, 29.306841));
assert.equal(elements["[data-status]"].textContent, restoredGoogleStatus);
assert.equal(baiduMapInstance.overlays.length, 0);
assert.equal(elements["[data-exports]"].hidden, false);
assert.equal(elements["[data-export-csv]"].href, "/data/maimai_locations.csv");

const baiduResizeCallsBeforeReturn = baiduMapInstance.checkResizeCalls;
datasetButtons[1].listeners.click();
await settle();
assert.equal(appendedScripts.length, 3);
assert.equal(baiduMapCount, 1);
assert.equal(baiduMapInstance.listeners.zoomend.length, 1);
assert.equal(elements["[data-china-map]"].hidden, false);
assert.ok(baiduMapInstance.checkResizeCalls > baiduResizeCallsBeforeReturn);
assert.equal(baiduMapInstance.overlays.length, chinaSupportFixture.mapGroups.length);
assert.ok(baiduMapInstance.overlays.every((marker) => marker.isOverview));
assert.equal(
  elements["[data-list]"].items.filter((item) => item.classList.contains("is-selected")).length,
  0,
);
datasetButtons[2].listeners.click();
await settle();
assert.equal(elements["[data-map]"].hidden, false);
assert.equal(elements["[data-china-map]"].hidden, true);
assert.equal(clustererInstance.markers.length, worldwidePayload.mapGroups.length);
datasetButtons[0].listeners.click();
await settle();
assert.equal(clustererInstance.markers.length, currentMapped);
assert.equal(mapInstance.resizeTriggered, true);
const currentFocusedItem = elements["[data-list]"].items.find((item) => {
  const location = currentPayload.locations.find((candidate) => candidate.id === item.dataset.id);
  return location && typeof location.lat === "number" && typeof location.lng === "number";
});
assert.ok(currentFocusedItem);
const currentFocusedLocation = currentPayload.locations.find(
  (location) => location.id === currentFocusedItem.dataset.id,
);
elements["[data-list]"].listeners.click({ target: currentFocusedItem.nameButton });
const currentFocusedMarker = clustererInstance.markers.find(
  (marker) => marker.options.title === currentFocusedLocation.name,
);
assert.ok(currentFocusedMarker);
currentFocusedMarker.map = mapInstance;
mapInstance.idleCallback();
assert.equal(mapInstance.zoom, 15);
assert.equal(mapInstance.position.lat, currentFocusedLocation.lat);
assert.equal(mapInstance.position.lng, currentFocusedLocation.lng);
assert.equal(infoWindowInstance.openOptions.anchor, currentFocusedMarker);

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

const missingKeyBaiduZoomControls = new FakeElement();
missingKeyBaiduZoomControls.hidden = true;
const missingKeyBaiduZoomIn = new FakeElement();
missingKeyBaiduZoomIn.disabled = true;
const missingKeyBaiduZoomOut = new FakeElement();
missingKeyBaiduZoomOut.disabled = true;

const missingKeyElements = {
  "[data-dataset-title]": new FakeElement(),
  "[data-stat-total]": new FakeElement(),
  "[data-stat-mapped]": new FakeElement(),
  "[data-stat-areas]": new FakeElement(),
  "[data-status]": new FakeElement(),
  "[data-search]": new FakeElement(),
  "[data-country]": new FakeElement(),
  "[data-subregion]": new FakeElement(),
  "[data-map-shell]": new FakeElement(),
  "[data-map]": new FakeElement(),
  "[data-china-map]": new FakeElement(),
  "[data-baidu-map]": new FakeElement(),
  "[data-baidu-zoom-controls]": missingKeyBaiduZoomControls,
  "[data-baidu-zoom-in]": missingKeyBaiduZoomIn,
  "[data-baidu-zoom-out]": missingKeyBaiduZoomOut,
  "[data-china-map-empty]": new FakeElement(),
  "[data-china-map-empty-title]": new FakeElement(),
  "[data-china-map-empty-message]": new FakeElement(),
  "[data-china-map-banner]": new FakeElement(),
  "[data-china-map-message]": new FakeElement(),
  "[data-china-map-back]": new FakeElement(),
  "[data-china-map-overview]": new FakeElement(),
  "[data-china-map-external]": new FakeElement(),
  "[data-list]": new FakeListElement(),
  "[data-visible-count]": new FakeElement(),
  "[data-open-visible]": new FakeElement(),
  "[data-source]": new FakeElement(),
  "[data-exports]": new FakeElement(),
  "[data-export-label]": new FakeElement(),
  "[data-export-csv]": new FakeElement(),
  "[data-export-kml]": new FakeElement(),
};
const missingKeyChinaButton = new FakeElement({
  dataset: {
    dataset: "china",
    dataUrl: "https://sega-register.wahlap.net/api/sega/maidx/rest/location",
    supportUrl: "/data/maimai_china_region_hierarchy.json",
    adapter: "wahlap",
    provider: "baidu",
    label: "Mainland China",
  },
  textContent: "Mainland China",
});
const missingKeyRoot = new FakeElement({
  dataset: {
    maimaiMap: "",
    defaultDataset: "china",
    baiduMapsAk: "",
  },
});
missingKeyRoot.elements = missingKeyElements;
missingKeyRoot.datasetButtons = [missingKeyChinaButton];
const missingKeyScripts = [];
const missingKeyOpenedUrls = [];
const missingKeyWindow = {
  location: { search: "" },
  open(url) {
    missingKeyOpenedUrls.push(url);
  },
  clearTimeout,
  setTimeout,
  requestAnimationFrame(callback) {
    callback();
  },
};
const missingKeyContext = vm.createContext({
  console,
  document: {
    querySelector(selector) {
      return selector === "[data-maimai-map]" ? missingKeyRoot : null;
    },
    createElement(tagName) {
      const element = new FakeElement();
      element.tagName = String(tagName || "").toUpperCase();
      return element;
    },
    head: {
      appendChild(element) {
        missingKeyScripts.push(element);
        return element;
      },
    },
  },
  fetch: async (url) => {
    if (url === "https://sega-register.wahlap.net/api/sega/maidx/rest/location") {
      return { ok: true, json: async () => chinaRawFixture };
    }
    if (url === "/data/maimai_china_region_hierarchy.json") {
      return { ok: true, json: async () => chinaSupportFixture };
    }
    throw new Error(`unexpected missing-key fetch ${url}`);
  },
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
  },
  setTimeout,
  URLSearchParams,
  window: missingKeyWindow,
});
const baiduMapCountBeforeMissingKey = baiduMapCount;
const baiduGeocodeCountBeforeMissingKey = baiduGeocodeCalls.length;
const baiduMarkerCountBeforeMissingKey = baiduMarkerCount;
vm.runInContext(source, missingKeyContext, { filename: "static/js/maimai-map.js" });
await settle();
assert.equal(missingKeyElements["[data-dataset-title]"].textContent, "舞萌DX Mainland China");
assert.equal(
  missingKeyElements["[data-visible-count]"].textContent,
  `${chinaRawFixture.length} locations`,
);
assert.equal(missingKeyElements["[data-china-map]"].hidden, false);
assert.equal(missingKeyScripts.length, 0);
assert.equal(baiduMapCount, baiduMapCountBeforeMissingKey);
assert.equal(missingKeyElements["[data-baidu-zoom-controls]"].hidden, true);
assert.equal(missingKeyElements["[data-baidu-zoom-in]"].disabled, true);
assert.equal(missingKeyElements["[data-baidu-zoom-out]"].disabled, true);
assert.match(missingKeyElements["[data-status]"].textContent, /Baidu/i);
assert.match(missingKeyElements["[data-status]"].textContent, /AK|key|external|unavailable/i);
const missingKeyFirstItem = missingKeyElements["[data-list]"].items.find(
  (item) => item.dataset.id === "cn-wahlap-2081921990512345090",
);
assert.ok(missingKeyFirstItem);
missingKeyElements["[data-list]"].listeners.click({ target: missingKeyFirstItem.nameButton });
assert.equal(missingKeyScripts.length, 0);
assert.equal(baiduMapCount, baiduMapCountBeforeMissingKey);
assert.equal(baiduGeocodeCalls.length, baiduGeocodeCountBeforeMissingKey);
assert.equal(baiduMarkerCount, baiduMarkerCountBeforeMissingKey);
assert.equal(missingKeyOpenedUrls.length, 0);
assert.match(missingKeyElements["[data-china-map-external]"].href, /baidu/i);
assert.ok(
  decodeURIComponent(missingKeyElements["[data-china-map-external]"].href)
    .includes(chinaRawFixture[0].address),
);
assert.equal(
  missingKeyElements["[data-list]"].items
    .filter((item) => item.classList.contains("is-selected")).length,
  1,
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
      chinaBulkStoreMarkers: 0,
      chinaProvinceOverviewGroups: chinaSupportFixture.mapGroups.length,
      baiduScriptsLoaded: appendedScripts.length,
      baiduGeocodeCalls: baiduGeocodeCalls.length,
      baiduOverviewMarkersCreated: baiduOverviewMarkerCount,
      baiduExactMarkersCreated: baiduExactMarkerCount,
      baiduActiveOverlays: baiduMapInstance.overlays.length,
      missingBaiduKeyScripts: missingKeyScripts.length,
      inactiveSlowLoadIgnored: elements["[data-dataset-title]"].textContent
        !== "舞萌DX Mainland China",
      currentFetchesAfterReturn: fetchCounts.get("/data/maimai_locations.json"),
      clusteredMarkerObjectsCreated: clusteredMarkerCount,
      appDirectMarkerAttachCount: directAttachBeforeFallback,
      focusWaitedForIdle: idleListenerCount >= 3,
      vendoredViewportHighZoomClusters: realViewportClusters.length,
      fallbackMarkerCount,
      fallbackAttachCount,
      directMarkerDetachCount,
    },
    null,
    2,
  ),
);
