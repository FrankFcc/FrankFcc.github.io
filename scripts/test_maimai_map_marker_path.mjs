import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const payload = JSON.parse(fs.readFileSync("static/data/maimai_locations.json", "utf8"));
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
  constructor({ dataset = {}, value = "" } = {}) {
    this.dataset = dataset;
    this.value = value;
    this.textContent = "";
    this._innerHTML = "";
    this.classList = new FakeClassList();
    this.listeners = {};
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

  querySelector(selector) {
    return this.elements?.[selector] ?? null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-region]") return this.tabs ?? [];
    return [];
  }
}

const elements = {
  "[data-stat-total]": new FakeElement(),
  "[data-stat-jp]": new FakeElement(),
  "[data-stat-us]": new FakeElement(),
  "[data-status]": new FakeElement(),
  "[data-search]": new FakeElement(),
  "[data-subregion]": new FakeElement(),
  "[data-map]": new FakeElement(),
  "[data-list]": new FakeElement(),
  "[data-visible-count]": new FakeElement(),
  "[data-open-visible]": new FakeElement(),
  "[data-source]": new FakeElement(),
};
const tabs = [
  new FakeElement({ dataset: { region: "all" } }),
  new FakeElement({ dataset: { region: "Japan" } }),
  new FakeElement({ dataset: { region: "United States" } }),
];
const root = new FakeElement({ dataset: { maimaiMap: "", dataUrl: "/data/maimai_locations.json" } });
root.elements = elements;
root.tabs = tabs;

let markerCount = 0;
let directMarkerAttachCount = 0;
let clustererInstance = null;
let viewportAlgorithmInstance = null;
let mapInstance = null;
let infoWindowInstance = null;
let idleListenerCount = 0;

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
  open() {},
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
        }

        getMap() {
          return this.map;
        }

        addListener() {}
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
  fetch: async () => ({
    ok: true,
    json: async () => payload,
  }),
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

vm.runInContext(source, context, { filename: "static/js/maimai-map.js" });

for (let i = 0; i < 5; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

assert.equal(elements["[data-stat-total]"].textContent, "1,111 total");
assert.equal(elements["[data-visible-count]"].textContent, "1,111 locations");
assert.equal((elements["[data-list]"].innerHTML.match(/<article/g) ?? []).length, 250);
assert.ok(elements["[data-list]"].innerHTML.includes("861 more hidden by list limit"));
assert.equal(
  elements["[data-status]"].textContent,
  "1,096 mapped locations grouped into zoomable clusters from the official coordinate dataset. 15 filtered locations do not include official coordinates and remain list-only.",
);
assert.equal(elements["[data-map]"].classList.contains("is-loaded"), true);
assert.equal(markerCount, payload.summary.total - payload.summary.needsGeocode);
assert.equal(directMarkerAttachCount, 0);
assert.ok(clustererInstance);
assert.ok(clustererInstance.options.map instanceof windowObject.google.maps.Map);
assert.equal(clustererInstance.options.algorithm, viewportAlgorithmInstance);
assert.equal(viewportAlgorithmInstance.options.maxZoom, 14);
assert.equal(viewportAlgorithmInstance.options.viewportPadding, 80);
assert.equal(clustererInstance.markers.length, markerCount);
assert.equal(clustererInstance.renderCalls, 1);

const mappedJapan = payload.locations.filter(
  (location) => location.country === "Japan"
    && typeof location.lat === "number"
    && typeof location.lng === "number",
).length;
tabs[1].listeners.click();
assert.equal(clustererInstance.markers.length, mappedJapan);
assert.equal(markerCount, payload.summary.total - payload.summary.needsGeocode);
assert.equal(elements["[data-visible-count]"].textContent, "1,017 locations");
assert.equal((elements["[data-list]"].innerHTML.match(/<article/g) ?? []).length, 250);

const mappedUs = payload.locations.filter(
  (location) => location.country === "United States"
    && typeof location.lat === "number"
    && typeof location.lng === "number",
).length;
tabs[2].listeners.click();
assert.equal(clustererInstance.markers.length, mappedUs);
assert.equal(markerCount, payload.summary.total - payload.summary.needsGeocode);
assert.equal(elements["[data-visible-count]"].textContent, "94 locations");
assert.equal((elements["[data-list]"].innerHTML.match(/<article/g) ?? []).length, 94);
assert.ok(!elements["[data-list]"].innerHTML.includes("more hidden by list limit"));
assert.equal(clustererInstance.clearCalls, 3);
assert.equal(clustererInstance.renderCalls, 3);

const focusedLocation = payload.locations.find(
  (location) => location.country === "United States"
    && typeof location.lat === "number"
    && typeof location.lng === "number",
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
assert.equal(infoWindowInstance.content, undefined);
const focusedMarker = clustererInstance.markers.find(
  (marker) => marker.options.title === focusedLocation.name,
);
focusedMarker.map = mapInstance;
mapInstance.idleCallback();
assert.ok(infoWindowInstance.content.includes(focusedLocation.name));
assert.equal(infoWindowInstance.openOptions.map, mapInstance);

infoWindowInstance.content = undefined;
elements["[data-list]"].listeners.click({
  target: {
    closest() {
      return { dataset: { focus: focusedLocation.id } };
    },
  },
});
assert.equal(idleListenerCount, 1);
assert.ok(infoWindowInstance.content.includes(focusedLocation.name));

tabs[1].listeners.click();
assert.equal(infoWindowInstance.closed, true);
assert.equal(clustererInstance.clearCalls, 4);
assert.equal(clustererInstance.renderCalls, 4);

const clusteredMarkerCount = markerCount;
const clustererRenderCalls = clustererInstance.renderCalls;
const filteredInfoWindowClosed = infoWindowInstance.closed;
const markerCountBeforeFallback = markerCount;
const directMarkerAttachCountBeforeFallback = directMarkerAttachCount;
windowObject.markerClusterer = null;
vm.runInContext(source, context, { filename: "static/js/maimai-map.js" });
for (let i = 0; i < 5; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const fallbackMarkerCount = markerCount - markerCountBeforeFallback;
const fallbackAttachCount = directMarkerAttachCount - directMarkerAttachCountBeforeFallback;
assert.equal(fallbackMarkerCount, payload.summary.total - payload.summary.needsGeocode);
assert.equal(fallbackAttachCount, fallbackMarkerCount);
assert.equal(
  elements["[data-status]"].textContent,
  "1,096 Google Maps markers loaded from the official coordinate dataset. 15 filtered locations do not include official coordinates and remain list-only.",
);

console.log(
  JSON.stringify(
    {
      clusteredMarkerCount,
      expectedMarkers: payload.summary.total - payload.summary.needsGeocode,
      listOnlyLocations: payload.summary.needsGeocode,
      appDirectMarkerAttachCount: directMarkerAttachCountBeforeFallback,
      mappedJapan,
      mappedUs,
      clustererRenderCalls,
      focusWaitedForIdle: idleListenerCount === 1,
      filteredInfoWindowClosed,
      vendoredViewportHighZoomClusters: realViewportClusters.length,
      fallbackMarkerCount,
      fallbackAttachCount,
    },
    null,
    2,
  ),
);
