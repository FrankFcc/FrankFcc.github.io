import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const payload = JSON.parse(fs.readFileSync("static/data/maimai_locations.json", "utf8"));
const source = fs.readFileSync("static/js/maimai-map.js", "utf8");

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
const windowObject = {
  location: { search: "" },
  open() {},
  google: {
    maps: {
      SymbolPath: { CIRCLE: "circle" },
      Map: class {
        constructor(element, options) {
          this.element = element;
          this.options = options;
          this.fitBoundsCalls = 0;
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
        setContent(content) {
          this.content = content;
        }

        open() {}
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
        }

        setMap(map) {
          this.map = map;
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
assert.equal(
  elements["[data-status]"].textContent,
  "1,096 Google Maps markers loaded from the official coordinate dataset. 15 filtered locations do not include official coordinates and remain list-only.",
);
assert.equal(elements["[data-map]"].classList.contains("is-loaded"), true);
assert.equal(markerCount, payload.summary.total - payload.summary.needsGeocode);

console.log(
  JSON.stringify(
    {
      markerCount,
      expectedMarkers: payload.summary.total - payload.summary.needsGeocode,
      listOnlyLocations: payload.summary.needsGeocode,
    },
    null,
    2,
  ),
);
