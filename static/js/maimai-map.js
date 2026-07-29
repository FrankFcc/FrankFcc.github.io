(function () {
  const root = document.querySelector("[data-maimai-map]");
  if (!root) return;

  const datasetButtons = Array.from(root.querySelectorAll("[data-dataset]"));
  const datasetConfigs = new Map(datasetButtons.map((button) => [
    button.dataset.dataset,
    {
      id: button.dataset.dataset,
      label: button.dataset.label || button.textContent.trim(),
      dataUrl: button.dataset.dataUrl,
      supportUrl: button.dataset.supportUrl || "",
      sourceUrl: button.dataset.sourceUrl || "",
      adapter: button.dataset.adapter || "json",
      provider: button.dataset.provider || "google",
      csvUrl: button.dataset.csvUrl || "",
      kmlUrl: button.dataset.kmlUrl || "",
    },
  ]));

  const els = {
    datasetTitle: root.querySelector("[data-dataset-title]"),
    total: root.querySelector("[data-stat-total]"),
    mapped: root.querySelector("[data-stat-mapped]"),
    areas: root.querySelector("[data-stat-areas]"),
    status: root.querySelector("[data-status]"),
    search: root.querySelector("[data-search]"),
    country: root.querySelector("[data-country]"),
    subregion: root.querySelector("[data-subregion]"),
    mapShell: root.querySelector("[data-map-shell]"),
    map: root.querySelector("[data-map]"),
    chinaMap: root.querySelector("[data-china-map]"),
    baiduMap: root.querySelector("[data-baidu-map]"),
    baiduZoomControls: root.querySelector("[data-baidu-zoom-controls]"),
    baiduZoomIn: root.querySelector("[data-baidu-zoom-in]"),
    baiduZoomOut: root.querySelector("[data-baidu-zoom-out]"),
    chinaMapEmpty: root.querySelector("[data-china-map-empty]"),
    chinaMapEmptyTitle: root.querySelector("[data-china-map-empty-title]"),
    chinaMapEmptyMessage: root.querySelector("[data-china-map-empty-message]"),
    chinaMapBanner: root.querySelector("[data-china-map-banner]"),
    chinaMapMessage: root.querySelector("[data-china-map-message]"),
    chinaMapBack: root.querySelector("[data-china-map-back]"),
    chinaMapOverview: root.querySelector("[data-china-map-overview]"),
    chinaMapExternal: root.querySelector("[data-china-map-external]"),
    list: root.querySelector("[data-list]"),
    visibleCount: root.querySelector("[data-visible-count]"),
    openVisible: root.querySelector("[data-open-visible]"),
    source: root.querySelector("[data-source]"),
    exports: root.querySelector("[data-exports]"),
    exportLabel: root.querySelector("[data-export-label]"),
    exportCsv: root.querySelector("[data-export-csv]"),
    exportKml: root.querySelector("[data-export-kml]"),
  };

  const state = {
    datasetId: root.dataset.defaultDataset || datasetButtons[0]?.dataset.dataset || "current",
    provider: "google",
    payload: null,
    payloadCache: new Map(),
    locations: [],
    filtered: [],
    mapItems: [],
    country: "",
    query: "",
    subregion: "",
    chinaOverviewLevel: "province",
    chinaProvinceKey: "",
    chinaCityKey: "",
    chinaDistrictKey: "",
    map: null,
    info: null,
    infoLocationId: null,
    markers: new Map(),
    clusterer: null,
    selectedLocationId: null,
    baiduMapInstance: null,
    baiduGeocoder: null,
    baiduMarker: null,
    baiduInfo: null,
    baiduPoint: null,
    baiduOverviewMarkers: new Map(),
    baiduOverviewInfo: null,
    baiduZoomToken: 0,
    baiduPreserveViewport: false,
    baiduProgrammaticZoomEvents: 0,
    baiduReady: false,
    baiduRequested: false,
    baiduLoading: false,
    baiduLoadFailed: false,
    baiduLoadAttempt: 0,
    baiduLoadTimer: null,
    baiduScript: null,
    baiduGeocoding: false,
    baiduGeocodeTimer: null,
    baiduFocusToken: 0,
    baiduPendingLocationId: null,
    baiduFocusedLocationId: null,
    apiReady: false,
    googleRequested: false,
    loadSequence: 0,
    loadingDatasetId: null,
  };

  const BAIDU_HOME_URL = "https://map.baidu.com/";
  const BAIDU_URI_SOURCE = "webapp.frankfcc.maimai";
  const CHINA_CITY_ZOOM = 7;
  const CHINA_DISTRICT_ZOOM = 11;
  const CHINA_PROVINCE_MAX_ZOOM = 6;
  const CHINA_CITY_MAX_ZOOM = 9;
  let searchTimer = null;

  function getApiKey() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("googleMapsKey") || params.get("mapsKey");
    if (fromUrl) {
      localStorage.setItem("maimaiGoogleMapsKey", fromUrl);
      return fromUrl;
    }
    if (root.dataset.googleMapsKey) return root.dataset.googleMapsKey.trim();
    return localStorage.getItem("maimaiGoogleMapsKey") || "";
  }

  function getBaiduApiKey() {
    return root.dataset.baiduMapsAk?.trim() || "";
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setLoadError(config, error) {
    const sourceLink = config.sourceUrl
      ? ` <a href="${escapeHtml(config.sourceUrl)}" target="_blank" rel="noopener">Open the official locator</a>.`
      : "";
    els.status.innerHTML = `Could not load ${escapeHtml(config.label)} location data: `
      + `${escapeHtml(error.message)}.${sourceLink}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function hasCoordinates(location) {
    return typeof location?.lat === "number"
      && Number.isFinite(location.lat)
      && typeof location?.lng === "number"
      && Number.isFinite(location.lng);
  }

  function googleMapsUrl(location) {
    const query = location.aggregate
      ? `maimai ${location.name}`
      : `${location.name} ${location.address}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function usesChinaMap() {
    return state.provider === "baidu";
  }

  function baiduSearchUrl(location) {
    if (!location) return BAIDU_HOME_URL;
    const params = new URLSearchParams({
      address: location.address,
      output: "html",
      src: BAIDU_URI_SOURCE,
    });
    return `https://api.map.baidu.com/geocoder?${params.toString()}`;
  }

  function locationMapUrl(location) {
    return usesChinaMap() ? baiduSearchUrl(location) : googleMapsUrl(location);
  }

  function locationAreaLabel(location) {
    return [
      location.country,
      location.subregion,
      location.city,
      location.district,
    ].filter(Boolean).join(" / ");
  }

  function markerColor(location) {
    if (state.datasetId === "china") return "#d46a2f";
    if (state.datasetId === "worldwide") return "#3b7d5b";
    if (location.country === "Japan") return "#d84a3a";
    return "#256f9c";
  }

  function mappedTotal(payload) {
    if (typeof payload.summary?.mapped === "number") return payload.summary.mapped;
    return payload.locations.filter(hasCoordinates).length;
  }

  function areaTotal(payload) {
    if (typeof payload.summary?.areaCount === "number") return payload.summary.areaCount;
    return new Set(payload.locations.map((location) => location.country).filter(Boolean)).size;
  }

  function updateStats(payload) {
    const total = payload.summary?.total ?? payload.locations.length;
    const mapped = mappedTotal(payload);
    const areas = areaTotal(payload);
    els.total.textContent = `${total.toLocaleString()} locations`;
    if (payload.mapMode === "region-summary") {
      els.mapped.textContent = usesChinaMap()
        ? `${payload.mapGroups.length.toLocaleString()} province summaries`
        : `${payload.mapGroups.length.toLocaleString()} map groups`;
      els.areas.textContent = `${areas.toLocaleString()} provinces`;
    } else {
      els.mapped.textContent = `${mapped.toLocaleString()} mapped`;
      els.areas.textContent = `${areas.toLocaleString()} areas`;
    }
  }

  function renderSource() {
    if (!state.payload) {
      els.source.textContent = "";
      return;
    }
    const generated = state.payload.generatedAt
      ? new Date(state.payload.generatedAt).toLocaleString()
      : "unknown";
    const sources = (state.payload.sources || [])
      .map((source) => (
        `<a href="${escapeHtml(source.locator || source.url)}" target="_blank" rel="noopener">`
        + `${escapeHtml(source.name)}</a>`
      ))
      .join(" / ");
    const refreshLabel = state.payload.live ? "Live data loaded" : "Dataset refreshed";
    const note = state.payload.notes?.[0]
      ? ` ${escapeHtml(state.payload.notes[0])}`
      : "";
    els.source.innerHTML = `Source: ${sources}. ${refreshLabel} ${escapeHtml(generated)}.${note}`;
  }

  function updateExports(config) {
    const available = Boolean(config.csvUrl && config.kmlUrl);
    els.exports.hidden = !available;
    if (!available) return;
    els.exportLabel.textContent = `${config.label} data`;
    els.exportCsv.href = config.csvUrl;
    els.exportKml.href = config.kmlUrl;
  }

  function populateCountries() {
    const countries = Array.from(new Set(
      state.locations.map((location) => location.country).filter(Boolean),
    )).sort((a, b) => a.localeCompare(b));
    state.country = countries.length === 1 ? countries[0] : "";
    els.country.innerHTML = '<option value="">All countries / areas</option>' + countries
      .map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`)
      .join("");
    els.country.value = state.country;
    els.country.disabled = countries.length <= 1;
  }

  function populateSubregions() {
    const subregions = Array.from(new Set(
      state.locations
        .filter((location) => !state.country || location.country === state.country)
        .map((location) => location.subregion)
        .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b));
    const previous = state.subregion;
    els.subregion.innerHTML = '<option value="">All provinces / areas</option>' + subregions
      .map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`)
      .join("");
    if (subregions.includes(previous)) {
      els.subregion.value = previous;
    } else {
      state.subregion = "";
      els.subregion.value = "";
    }
    els.subregion.disabled = subregions.length === 0;
  }

  function usesGroupedOverview() {
    if (!state.payload) return false;
    if (state.payload.mapMode === "region-summary") return true;
    return state.payload.mapMode === "grouped-overview" && !state.country;
  }

  function chinaRegionKey(region) {
    return String(region?.key || region?.code || region?.name || "");
  }

  function chinaProvinceRegion(provinceKey = state.chinaProvinceKey || state.subregion) {
    return (state.payload?.chinaRegions || []).find(
      (region) => chinaRegionKey(region) === provinceKey,
    ) || null;
  }

  function chinaCityRegion(
    cityKey = state.chinaCityKey,
    province = chinaProvinceRegion(),
  ) {
    return (province?.cities || []).find(
      (region) => chinaRegionKey(region) === cityKey,
    ) || null;
  }

  function buildChinaOverviewItems() {
    let definitions = [];
    let field = "subregion";
    const level = state.chinaOverviewLevel;

    if (level === "province") {
      definitions = state.payload?.chinaRegions?.length
        ? state.payload.chinaRegions
        : (state.payload?.mapGroups || []);
    } else if (level === "city") {
      definitions = chinaProvinceRegion()?.cities || [];
      field = "cityKey";
    } else {
      definitions = chinaCityRegion()?.districts || [];
      field = "districtKey";
    }

    const counts = new Map();
    state.filtered.forEach((location) => {
      const key = location[field];
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const items = definitions
      .filter((region) => counts.has(chinaRegionKey(region)))
      .map((region) => {
        const key = chinaRegionKey(region);
        const count = counts.get(key);
        return {
          ...region,
          id: `cn-${level}-${key}-${count}`,
          key,
          count,
          aggregate: true,
          overviewLevel: level,
          address: `Approximate ${level}-center summary marker`,
        };
      });
    const unmatchedCount = level === "province"
      ? 0
      : state.filtered.filter((location) => !location[field]).length;
    const fallbackCenter = level === "city"
      ? chinaProvinceRegion()
      : chinaCityRegion();
    if (unmatchedCount && hasCoordinates(fallbackCenter)) {
      const parentKey = chinaRegionKey(fallbackCenter);
      items.push({
        id: `cn-${level}-other-${parentKey}-${unmatchedCount}`,
        key: `other-${level}-${parentKey}`,
        name: "Other areas",
        lat: fallbackCenter.lat,
        lng: fallbackCenter.lng,
        count: unmatchedCount,
        aggregate: true,
        unmatched: true,
        overviewLevel: level,
        address: `Unmatched locations summarized at the approximate parent ${level}-center`,
      });
    }
    return items;
  }

  function buildMapItems() {
    if (!usesGroupedOverview()) return state.filtered.filter(hasCoordinates);
    if (usesChinaMap() && state.payload?.mapMode === "region-summary") {
      return buildChinaOverviewItems();
    }

    const groupField = state.payload.groupField
      || (state.payload.mapMode === "region-summary" ? "subregion" : "country");
    const counts = new Map();
    state.filtered.forEach((location) => {
      const key = location[groupField];
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return (state.payload.mapGroups || [])
      .filter((group) => counts.has(group.key))
      .map((group) => {
        const count = counts.get(group.key);
        return {
          ...group,
          id: `${group.id}-${count}`,
          count,
          aggregate: true,
          address: state.payload.mapMode === "region-summary"
            ? "Approximate province-center summary marker"
            : "Official country / area summary marker",
        };
      });
  }

  function applyFilters() {
    if (!state.payload) return;
    const query = state.query.trim().toLowerCase();
    state.filtered = state.locations.filter((location) => {
      if (state.country && location.country !== state.country) return false;
      if (state.subregion && location.subregion !== state.subregion) return false;
      if (usesChinaMap() && state.chinaCityKey && location.cityKey !== state.chinaCityKey) {
        return false;
      }
      if (
        usesChinaMap()
        && state.chinaDistrictKey
        && location.districtKey !== state.chinaDistrictKey
      ) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        location.name,
        location.address,
        location.country,
        location.subregion,
        location.city,
        location.district,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    if (
      state.selectedLocationId
      && !state.filtered.some((location) => location.id === state.selectedLocationId)
    ) {
      state.selectedLocationId = null;
      if (usesChinaMap()) {
        cancelBaiduGeocode();
        clearBaiduMarker();
      }
    }
    state.mapItems = buildMapItems();
    renderList();
    renderMarkers();
    updateBounds();
  }

  function renderList() {
    els.visibleCount.textContent = `${state.filtered.length.toLocaleString()} locations`;
    els.openVisible.href = state.filtered.length === 1
      ? locationMapUrl(state.filtered[0])
      : (
        usesChinaMap()
          ? BAIDU_HOME_URL
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`maimai ${state.payload?.label || ""}`)}`
      );
    els.openVisible.textContent = usesChinaMap() ? "Open Baidu" : "Open search";

    const visibleItems = state.filtered.slice(0, 250);
    els.list.innerHTML = visibleItems.map((location) => {
      const selected = location.id === state.selectedLocationId;
      const focusLabel = usesChinaMap()
        ? "Show on Baidu"
        : (hasCoordinates(location) ? "Focus" : "Search map");
      const providerLabel = usesChinaMap() ? "Baidu Map" : "Google Maps";
      return `
      <article
        class="maimai-map-item${selected ? " is-selected" : ""}"
        data-id="${escapeHtml(location.id)}"
        ${selected ? 'aria-current="true"' : ""}
      >
        <span>${escapeHtml(locationAreaLabel(location))}</span>
        <button
          type="button"
          class="maimai-map-item-name"
          data-focus="${escapeHtml(location.id)}"
          aria-label="Show ${escapeHtml(location.name)} on the map"
        >${escapeHtml(location.name)}</button>
        <p>${escapeHtml(location.address)}</p>
        <div>
          <button type="button" data-focus="${escapeHtml(location.id)}">${focusLabel}</button>
          <a href="${locationMapUrl(location)}" target="_blank" rel="noopener">${providerLabel}</a>
        </div>
      </article>
    `;
    }).join("");

    if (state.filtered.length > visibleItems.length) {
      els.list.insertAdjacentHTML(
        "beforeend",
        `<p class="maimai-map-list-note">${(state.filtered.length - visibleItems.length).toLocaleString()} more hidden by list limit. Use search or area filters.</p>`,
      );
    }
  }

  function markSelectedLocation(id) {
    state.selectedLocationId = id;
    els.list.querySelectorAll(".maimai-map-item[data-id]").forEach((item) => {
      const selected = item.dataset.id === id;
      item.classList.toggle("is-selected", selected);
      if (selected) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }

  function setChinaMapMessage(text, loading = false) {
    if (!els.chinaMapMessage) return;
    els.chinaMapBanner?.classList.toggle("is-loading", loading);
    els.chinaMapMessage.textContent = text;
  }

  function setChinaEmpty(title, message) {
    if (els.chinaMapEmptyTitle) els.chinaMapEmptyTitle.textContent = title;
    if (els.chinaMapEmptyMessage) els.chinaMapEmptyMessage.textContent = message;
  }

  function clearBaiduOverviewMarkers() {
    if (state.baiduMapInstance) {
      state.baiduOverviewMarkers.forEach(({ marker }) => {
        state.baiduMapInstance.removeOverlay?.(marker);
      });
      if (state.baiduOverviewInfo && !state.baiduMarker) {
        state.baiduMapInstance.closeInfoWindow?.();
      }
    }
    state.baiduOverviewMarkers.clear();
    state.baiduOverviewInfo = null;
  }

  function clearBaiduMarker() {
    if (state.baiduMapInstance && state.baiduMarker) {
      state.baiduMapInstance.removeOverlay?.(state.baiduMarker);
    }
    state.baiduMapInstance?.closeInfoWindow?.();
    state.baiduMarker = null;
    state.baiduInfo = null;
    state.baiduPoint = null;
    state.baiduFocusedLocationId = null;
  }

  function clearBaiduGeocodeTimer() {
    if (state.baiduGeocodeTimer) {
      window.clearTimeout(state.baiduGeocodeTimer);
      state.baiduGeocodeTimer = null;
    }
  }

  function cancelBaiduGeocode() {
    state.baiduFocusToken += 1;
    clearBaiduGeocodeTimer();
    state.baiduGeocoding = false;
    state.baiduPendingLocationId = null;
  }

  function cancelBaiduOverviewZoom() {
    state.baiduZoomToken += 1;
  }

  function noteBaiduUserViewportIntent() {
    state.baiduProgrammaticZoomEvents = 0;
    cancelBaiduOverviewZoom();
  }

  function centerBaiduMap(point, zoom) {
    if (!state.baiduMapInstance) return;
    state.baiduProgrammaticZoomEvents += 1;
    state.baiduMapInstance.centerAndZoom(point, zoom);
  }

  function updateBaiduZoomControls() {
    const enabled = Boolean(
      usesChinaMap()
      && state.baiduReady
      && state.baiduMapInstance,
    );
    if (els.baiduZoomControls) els.baiduZoomControls.hidden = !enabled;
    if (els.baiduZoomIn) els.baiduZoomIn.disabled = !enabled;
    if (els.baiduZoomOut) els.baiduZoomOut.disabled = !enabled;
  }

  function changeBaiduZoom(direction) {
    const map = state.baiduMapInstance;
    if (!usesChinaMap() || !state.baiduReady || !map) return;
    noteBaiduUserViewportIntent();
    if (direction > 0 && typeof map.zoomIn === "function") {
      map.zoomIn();
      return;
    }
    if (direction < 0 && typeof map.zoomOut === "function") {
      map.zoomOut();
      return;
    }
    const currentZoom = Number(map.getZoom?.());
    if (Number.isFinite(currentZoom) && typeof map.setZoom === "function") {
      map.setZoom(currentZoom + (direction > 0 ? 1 : -1));
    }
  }

  function fitBaiduMap(points) {
    if (!state.baiduMapInstance?.setViewport) return;
    state.baiduProgrammaticZoomEvents += 1;
    state.baiduMapInstance.setViewport(points, { margins: [48, 48, 48, 48] });
  }

  function resetChinaHierarchy() {
    state.chinaOverviewLevel = "province";
    state.chinaProvinceKey = "";
    state.chinaCityKey = "";
    state.chinaDistrictKey = "";
  }

  function resetChinaMap() {
    cancelBaiduOverviewZoom();
    cancelBaiduGeocode();
    clearBaiduMarker();
    clearBaiduOverviewMarkers();
    els.chinaMap?.classList.toggle("is-loaded", state.baiduReady);
    updateBaiduZoomControls();
    if (els.chinaMapEmpty) els.chinaMapEmpty.hidden = state.baiduReady;
    if (els.chinaMapBanner) els.chinaMapBanner.hidden = true;
    if (els.chinaMapBack) els.chinaMapBack.hidden = true;
    if (els.chinaMapOverview) els.chinaMapOverview.hidden = true;
    if (els.chinaMapExternal) els.chinaMapExternal.href = BAIDU_HOME_URL;
    setChinaMapMessage(
      "Use +/−, the mouse wheel, or pinch to expand provinces into cities and districts. "
      + "Select a store name for one exact marker.",
    );

    if (state.baiduReady) {
      setChinaEmpty(
        "Baidu Map is ready",
        "Province, city, and district summaries appear one level at a time.",
      );
    } else if (state.baiduLoading) {
      setChinaEmpty("Baidu Map loading", "The official store list remains available while the map loads.");
    } else if (state.baiduLoadFailed) {
      setChinaEmpty(
        "Baidu Map could not load",
        "Use a store's external Baidu link while the map service is unavailable.",
      );
    } else if (!getBaiduApiKey()) {
      setChinaEmpty(
        "Baidu Browser AK required",
        "Add the domain-restricted Baidu Browser AK to enable the interactive China map.",
      );
    } else {
      setChinaEmpty("Baidu Map is ready", "The map will load only when Mainland China is selected.");
    }
  }

  function showMapProvider(provider) {
    const showChina = provider === "baidu";
    els.map.hidden = showChina;
    els.map.setAttribute("aria-hidden", String(showChina));
    els.chinaMap.hidden = !showChina;
    els.chinaMap.setAttribute("aria-hidden", String(!showChina));
    els.mapShell.setAttribute(
      "aria-label",
      showChina ? "maimai Mainland China Baidu Map" : `${state.payload?.label || "maimai"} Google Map`,
    );
    if (showChina) {
      loadBaiduMaps(getBaiduApiKey());
      if (state.baiduReady) {
        window.requestAnimationFrame(() => state.baiduMapInstance?.checkResize?.());
      }
    } else {
      resetChinaMap();
    }
    if (!showChina && state.apiReady && window.google?.maps?.event) {
      window.requestAnimationFrame(() => {
        google.maps.event.trigger(state.map, "resize");
        updateBounds();
      });
    }
  }

  function clearBaiduLoadTimer() {
    if (state.baiduLoadTimer) {
      window.clearTimeout(state.baiduLoadTimer);
      state.baiduLoadTimer = null;
    }
  }

  function failBaiduLoad(script, callbackName) {
    if (state.baiduReady || state.baiduScript !== script) return;
    clearBaiduLoadTimer();
    state.baiduScript = null;
    state.baiduRequested = false;
    state.baiduLoading = false;
    state.baiduLoadFailed = true;
    script.remove?.();
    try {
      delete window[callbackName];
    } catch (error) {
      window[callbackName] = undefined;
    }
    if (usesChinaMap()) {
      resetChinaMap();
      updateMapStatus();
    }
  }

  function loadBaiduMaps(key) {
    if (state.baiduReady || window.BMap?.Map) {
      if (!state.baiduReady) initBaiduMaps();
      return;
    }
    if (!key) {
      if (usesChinaMap()) {
        resetChinaMap();
        updateMapStatus();
      }
      return;
    }
    if (state.baiduRequested) return;

    state.baiduRequested = true;
    state.baiduLoading = true;
    state.baiduLoadFailed = false;
    if (usesChinaMap()) resetChinaMap();
    const callbackName = `__initMaimaiBaiduMap${++state.baiduLoadAttempt}`;
    const script = document.createElement("script");
    script.id = "maimai-baidu-jsapi";
    script.src = `https://api.map.baidu.com/api?v=3.0&ak=${encodeURIComponent(key)}&callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    script.defer = true;
    state.baiduScript = script;
    window[callbackName] = function () {
      if (state.baiduScript !== script) return;
      clearBaiduLoadTimer();
      state.baiduScript = null;
      try {
        delete window[callbackName];
      } catch (error) {
        window[callbackName] = undefined;
      }
      initBaiduMaps();
    };
    script.onerror = function () {
      failBaiduLoad(script, callbackName);
    };
    state.baiduLoadTimer = window.setTimeout(
      () => failBaiduLoad(script, callbackName),
      15000,
    );
    document.head.appendChild(script);
  }

  function initBaiduMaps() {
    if (state.baiduReady) return;
    state.baiduLoading = false;
    if (!window.BMap?.Map || !els.baiduMap) {
      state.baiduRequested = false;
      state.baiduLoadFailed = true;
      if (usesChinaMap()) {
        resetChinaMap();
        updateMapStatus();
      }
      return;
    }
    try {
      state.baiduMapInstance = new BMap.Map(els.baiduMap);
      state.baiduMapInstance.addEventListener?.("zoomend", scheduleBaiduOverviewZoomSync);
      ["wheel", "pointerdown", "touchstart", "keydown"].forEach((eventName) => {
        els.baiduMap.addEventListener(eventName, noteBaiduUserViewportIntent, true);
      });
      centerBaiduMap(new BMap.Point(104.2, 35.9), 5);
      state.baiduMapInstance.enableScrollWheelZoom?.();
      state.baiduMapInstance.enableDoubleClickZoom?.();
      state.baiduMapInstance.enablePinchToZoom?.();
      state.baiduMapInstance.enableKeyboard?.();
      state.baiduMapInstance.enableContinuousZoom?.();
      state.baiduGeocoder = new BMap.Geocoder();
      state.baiduReady = true;
      state.baiduLoadFailed = false;
      els.chinaMap?.classList.add("is-loaded");
      updateBaiduZoomControls();
      if (els.chinaMapEmpty) els.chinaMapEmpty.hidden = true;
      if (usesChinaMap()) {
        renderBaiduOverviewMarkers();
        const pending = state.locations.find(
          (location) => location.id === state.baiduPendingLocationId,
        );
        if (pending && state.selectedLocationId === pending.id) {
          if (els.chinaMapOverview) els.chinaMapOverview.hidden = false;
          geocodeBaiduLocation(pending, state.baiduFocusToken);
        } else {
          updateMapStatus();
        }
      }
    } catch (error) {
      console.warn("Baidu Map initialization failed.", error);
      state.baiduRequested = false;
      state.baiduLoading = false;
      state.baiduLoadFailed = true;
      if (usesChinaMap()) {
        resetChinaMap();
        updateMapStatus();
      }
    }
  }

  function styleBaiduOverviewLabel(marker, location, onSelect) {
    if (
      typeof BMap.Label !== "function"
      || typeof BMap.Size !== "function"
      || typeof marker.setLabel !== "function"
    ) return;
    const styles = {
      province: {
        backgroundColor: "#c24f22",
        fontSize: "12px",
        lineHeight: "24px",
        minWidth: "24px",
        offset: new BMap.Size(17, -14),
        padding: "2px 7px",
      },
      city: {
        backgroundColor: "#256f9c",
        fontSize: "11px",
        lineHeight: "20px",
        minWidth: "20px",
        offset: new BMap.Size(17, -11),
        padding: "1px 6px",
      },
      district: {
        backgroundColor: "#3b7d5b",
        fontSize: "10px",
        lineHeight: "17px",
        minWidth: "17px",
        offset: new BMap.Size(17, -9),
        padding: "0 5px",
      },
    };
    const levelStyle = styles[location.overviewLevel] || styles.province;
    const label = new BMap.Label(String(location.count), {
      offset: levelStyle.offset,
    });
    label.setStyle?.({
      backgroundColor: levelStyle.backgroundColor,
      border: "2px solid #ffffff",
      borderRadius: "999px",
      boxShadow: "0 2px 7px rgba(0, 0, 0, 0.28)",
      color: "#ffffff",
      cursor: "pointer",
      fontSize: levelStyle.fontSize,
      fontWeight: "700",
      lineHeight: levelStyle.lineHeight,
      minWidth: levelStyle.minWidth,
      padding: levelStyle.padding,
      textAlign: "center",
      whiteSpace: "nowrap",
    });
    label.addEventListener?.("click", onSelect);
    marker.setLabel(label);
  }

  function updateChinaNavigation() {
    if (!usesChinaMap()) return;
    const selectedStore = Boolean(state.selectedLocationId);
    const atProvinceOverview = state.chinaOverviewLevel === "province"
      && !state.chinaProvinceKey;
    const showBanner = selectedStore || !atProvinceOverview;
    if (els.chinaMapBanner) els.chinaMapBanner.hidden = !showBanner;
    if (els.chinaMapBack) {
      els.chinaMapBack.hidden = !showBanner;
      if (selectedStore) {
        els.chinaMapBack.textContent = "Back to overview";
      } else if (
        state.chinaOverviewLevel === "district"
        && state.chinaDistrictKey
      ) {
        els.chinaMapBack.textContent = "All districts";
      } else if (state.chinaOverviewLevel === "district") {
        els.chinaMapBack.textContent = "Back to cities";
      } else {
        els.chinaMapBack.textContent = "Back to provinces";
      }
    }
    if (els.chinaMapOverview) {
      els.chinaMapOverview.hidden = atProvinceOverview || !state.baiduReady;
    }
  }

  function setChinaOverviewMessage() {
    const markerCount = state.mapItems.length;
    const markerWord = markerCount === 1 ? "marker" : "markers";
    if (state.chinaOverviewLevel === "province") {
      setChinaMapMessage(
        `Showing ${markerCount.toLocaleString()} province ${markerWord}. `
        + `Use + to zoom to level ${CHINA_CITY_ZOOM} near one, or select it, to show its city markers.`,
      );
      return;
    }
    if (state.chinaOverviewLevel === "city") {
      const province = chinaProvinceRegion();
      setChinaMapMessage(
        `Showing ${markerCount.toLocaleString()} city ${markerWord} in `
        + `${province?.name || state.subregion}. Use + to zoom to level ${CHINA_DISTRICT_ZOOM} `
        + "near one, or select it, to show district markers.",
      );
      return;
    }
    const city = chinaCityRegion();
    if (state.chinaDistrictKey) {
      const district = state.mapItems[0];
      setChinaMapMessage(
        `Showing the ${district?.name || "selected district"} overview. `
        + "Select a store name for one exact marker.",
      );
      return;
    }
    setChinaMapMessage(
      `Showing ${markerCount.toLocaleString()} district ${markerWord} in `
      + `${city?.name || "the selected city"}. Zoom out for cities, or select a district `
      + "to filter the store list.",
    );
  }

  function baiduOverviewDistanceSquared(center, point) {
    const meanLatitude = ((center.lat + point.lat) / 2) * (Math.PI / 180);
    const dx = (center.lng - point.lng) * Math.cos(meanLatitude);
    const dy = center.lat - point.lat;
    return (dx * dx) + (dy * dy);
  }

  function chinaOverviewNavigationPoints(location) {
    const points = [];
    const addPoint = (region) => {
      if (hasCoordinates(region)) points.push(region);
    };
    if (location.overviewLevel === "province") {
      const province = chinaProvinceRegion(location.key);
      (province?.cities || []).forEach((city) => {
        const districts = (city.districts || []).filter(hasCoordinates);
        if (districts.length) {
          points.push(...districts);
        } else {
          addPoint(city);
        }
      });
      if (!points.length) addPoint(province);
    } else if (location.overviewLevel === "city") {
      const city = chinaCityRegion(location.key);
      const districts = (city?.districts || []).filter(hasCoordinates);
      if (districts.length) {
        points.push(...districts);
      } else {
        addPoint(city);
      }
    }
    if (!points.length) addPoint(location);
    return points;
  }

  function baiduBoundsContainPoint(bounds, point) {
    if (!bounds) return true;
    if (typeof bounds.containsPoint === "function") {
      return bounds.containsPoint(new BMap.Point(point.lng, point.lat));
    }
    const southWest = bounds.getSouthWest?.();
    const northEast = bounds.getNorthEast?.();
    if (!southWest || !northEast) return true;
    return point.lat >= southWest.lat
      && point.lat <= northEast.lat
      && point.lng >= southWest.lng
      && point.lng <= northEast.lng;
  }

  function nearestBaiduOverviewLocation() {
    const center = state.baiduMapInstance?.getCenter?.();
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
    const bounds = state.baiduMapInstance.getBounds?.();
    let nearest = null;
    state.mapItems.forEach((location) => {
      if (!location.aggregate || location.unmatched) return;
      const navigationPoints = chinaOverviewNavigationPoints(location);
      const nearbyPoints = bounds
        ? navigationPoints.filter((point) => baiduBoundsContainPoint(bounds, point))
        : navigationPoints;
      if (!nearbyPoints.length) return;
      const distance = nearbyPoints.reduce(
        (best, point) => Math.min(best, baiduOverviewDistanceSquared(center, point)),
        Number.POSITIVE_INFINITY,
      );
      if (!nearest || distance < nearest.distance) nearest = { location, distance };
    });
    return nearest?.location || null;
  }

  function applyChinaFiltersPreservingViewport() {
    state.baiduPreserveViewport = true;
    try {
      applyFilters();
    } finally {
      state.baiduPreserveViewport = false;
    }
  }

  function restoreChinaProvinceOverviewAtCurrentViewport() {
    state.subregion = "";
    resetChinaHierarchy();
    els.subregion.value = "";
    applyChinaFiltersPreservingViewport();
  }

  function restoreChinaCityOverviewAtCurrentViewport() {
    state.chinaOverviewLevel = "city";
    state.chinaCityKey = "";
    state.chinaDistrictKey = "";
    applyChinaFiltersPreservingViewport();
  }

  function syncBaiduOverviewToZoom() {
    if (
      !usesChinaMap()
      || !state.baiduReady
      || !state.baiduMapInstance
      || state.payload?.mapMode !== "region-summary"
      || state.selectedLocationId
      || state.baiduMarker
      || state.baiduGeocoding
      || state.baiduPendingLocationId
    ) return;

    const zoom = Number(state.baiduMapInstance.getZoom?.());
    if (!Number.isFinite(zoom)) return;

    if (zoom <= CHINA_PROVINCE_MAX_ZOOM) {
      if (state.chinaOverviewLevel !== "province" || state.chinaProvinceKey) {
        restoreChinaProvinceOverviewAtCurrentViewport();
      }
      return;
    }
    if (
      state.chinaOverviewLevel === "district"
      && zoom <= CHINA_CITY_MAX_ZOOM
    ) {
      restoreChinaCityOverviewAtCurrentViewport();
      return;
    }

    if (
      state.chinaOverviewLevel === "province"
      && zoom >= CHINA_CITY_ZOOM
    ) {
      const province = nearestBaiduOverviewLocation();
      if (!province) return;
      selectBaiduOverview(province, { automatic: true });
      if (zoom > CHINA_CITY_MAX_ZOOM) {
        centerBaiduMap(state.baiduMapInstance.getCenter(), CHINA_CITY_MAX_ZOOM);
      }
      return;
    }
    if (
      state.chinaOverviewLevel === "city"
      && zoom >= CHINA_DISTRICT_ZOOM
    ) {
      const city = nearestBaiduOverviewLocation();
      if (city) selectBaiduOverview(city, { automatic: true });
    }
  }

  function scheduleBaiduOverviewZoomSync() {
    if (state.baiduProgrammaticZoomEvents > 0) {
      state.baiduProgrammaticZoomEvents -= 1;
      cancelBaiduOverviewZoom();
      return;
    }
    const token = ++state.baiduZoomToken;
    const sequence = state.loadSequence;
    window.requestAnimationFrame(() => {
      if (
        token !== state.baiduZoomToken
        || sequence !== state.loadSequence
      ) return;
      syncBaiduOverviewToZoom();
    });
  }

  function openBaiduOverviewInfo(location) {
    const overview = state.baiduOverviewMarkers.get(location.key);
    if (!overview || !state.baiduMapInstance || typeof BMap.InfoWindow !== "function") return;
    const info = new BMap.InfoWindow(`
      <div class="maimai-map-info">
        <strong>${escapeHtml(overview.location.name)}</strong>
        <span>${overview.location.count.toLocaleString()} official locations</span>
        <p>Approximate ${escapeHtml(overview.location.overviewLevel)}-center overview. Select a store from the list for one address-matched marker.</p>
      </div>
    `, { width: 280 });
    state.baiduOverviewInfo = info;
    state.baiduMapInstance.openInfoWindow(info, overview.point);
  }

  function selectBaiduOverview(location, { automatic = false } = {}) {
    if (!automatic) cancelBaiduOverviewZoom();
    cancelBaiduGeocode();
    clearBaiduMarker();
    markSelectedLocation(null);

    if (location.unmatched) {
      openBaiduOverviewInfo(location);
      setChinaMapMessage(
        `${location.count.toLocaleString()} locations could not be assigned to a current `
        + `${location.overviewLevel} name and remain visible in the store list.`,
      );
      return;
    }
    if (location.overviewLevel === "province") {
      state.subregion = location.key;
      state.chinaProvinceKey = location.key;
      state.chinaCityKey = "";
      state.chinaDistrictKey = "";
      state.chinaOverviewLevel = "city";
      els.subregion.value = state.subregion;
    } else if (location.overviewLevel === "city") {
      state.chinaCityKey = location.key;
      state.chinaDistrictKey = "";
      state.chinaOverviewLevel = "district";
    } else {
      state.chinaDistrictKey = location.key;
    }
    applyChinaFiltersPreservingViewport();
    if (!automatic && hasCoordinates(location) && state.baiduMapInstance) {
      const zoom = location.overviewLevel === "province"
        ? 8
        : 12;
      centerBaiduMap(
        new BMap.Point(location.lng, location.lat),
        zoom,
      );
    }
    if (location.overviewLevel === "district") openBaiduOverviewInfo(location);
  }

  function renderBaiduOverviewMarkers() {
    if (
      !usesChinaMap()
      || !state.baiduReady
      || !state.baiduMapInstance
      || state.payload?.mapMode !== "region-summary"
      || state.selectedLocationId
    ) return;

    clearBaiduOverviewMarkers();
    const overviewItems = state.mapItems.filter(
      (location) => location.aggregate && hasCoordinates(location),
    );
    const points = [];
    overviewItems.forEach((location) => {
      const point = new BMap.Point(location.lng, location.lat);
      const marker = new BMap.Marker(point, {
        title: `${location.name}: ${location.count.toLocaleString()} locations`,
      });
      const onSelect = () => selectBaiduOverview(location);
      marker.addEventListener?.("click", onSelect);
      styleBaiduOverviewLabel(marker, location, onSelect);
      state.baiduMapInstance.addOverlay(marker);
      state.baiduOverviewMarkers.set(location.key, { location, marker, point });
      points.push(point);
    });

    if (!state.baiduPreserveViewport) {
      if (points.length === 1) {
        const zoom = state.chinaOverviewLevel === "province"
          ? 7
          : (state.chinaOverviewLevel === "city" ? 9 : 12);
        centerBaiduMap(points[0], zoom);
      } else if (points.length > 1 && state.baiduMapInstance.setViewport) {
        fitBaiduMap(points);
      } else if (points.length > 1) {
        centerBaiduMap(new BMap.Point(104.2, 35.9), 5);
      }
    }
    setChinaOverviewMessage();
    updateChinaNavigation();
  }

  function showChinaProvinceOverview() {
    if (!usesChinaMap()) return;
    cancelBaiduOverviewZoom();
    cancelBaiduGeocode();
    clearBaiduMarker();
    markSelectedLocation(null);
    state.query = "";
    state.subregion = "";
    resetChinaHierarchy();
    els.search.value = "";
    els.subregion.value = "";
    if (els.chinaMapExternal) els.chinaMapExternal.href = BAIDU_HOME_URL;
    applyFilters();
    if (state.baiduReady && state.baiduMapInstance) {
      centerBaiduMap(new BMap.Point(104.2, 35.9), 5);
    }
  }

  function showPreviousChinaOverview() {
    if (!usesChinaMap()) return;
    cancelBaiduOverviewZoom();
    cancelBaiduGeocode();
    clearBaiduMarker();
    if (state.selectedLocationId) {
      markSelectedLocation(null);
      if (els.chinaMapExternal) els.chinaMapExternal.href = BAIDU_HOME_URL;
      applyFilters();
      return;
    }
    if (state.chinaOverviewLevel === "district" && state.chinaDistrictKey) {
      state.chinaDistrictKey = "";
    } else if (state.chinaOverviewLevel === "district") {
      state.chinaOverviewLevel = "city";
      state.chinaCityKey = "";
    } else {
      state.subregion = "";
      resetChinaHierarchy();
      els.subregion.value = "";
    }
    applyFilters();
  }

  function geocodeBaiduLocation(location, token) {
    if (!state.baiduReady || !state.baiduGeocoder || !state.baiduMapInstance) return;
    if (
      state.baiduFocusedLocationId === location.id
      && state.baiduMarker
      && state.baiduPoint
    ) {
      centerBaiduMap(state.baiduPoint, 17);
      if (state.baiduInfo) {
        state.baiduMapInstance.openInfoWindow(state.baiduInfo, state.baiduPoint);
      }
      updateMapStatus();
      return;
    }

    const datasetSequence = state.loadSequence;
    clearBaiduGeocodeTimer();
    state.baiduPendingLocationId = location.id;
    state.baiduGeocoding = true;
    clearBaiduMarker();
    setChinaMapMessage(`Locating ${location.name} from its official Wahlap address...`, true);
    updateMapStatus();
    const requestIsCurrent = () => (
      token === state.baiduFocusToken
      && datasetSequence === state.loadSequence
      && state.datasetId === "china"
      && usesChinaMap()
      && state.selectedLocationId === location.id
    );
    const geocodeTimer = window.setTimeout(() => {
      if (state.baiduGeocodeTimer === geocodeTimer) {
        state.baiduGeocodeTimer = null;
      }
      if (!requestIsCurrent()) return;
      state.baiduFocusToken += 1;
      state.baiduGeocoding = false;
      state.baiduPendingLocationId = null;
      setChinaMapMessage(
        `Baidu took too long to locate ${location.name}. Use the external Baidu link or select the store again.`,
      );
      setStatus(
        `Baidu took too long to locate ${location.name}. Select the store again to retry; no bulk markers are loaded.`,
      );
    }, 12000);
    state.baiduGeocodeTimer = geocodeTimer;
    state.baiduGeocoder.getPoint(location.address, (point) => {
      if (!requestIsCurrent()) return;
      clearBaiduGeocodeTimer();

      state.baiduGeocoding = false;
      state.baiduPendingLocationId = null;
      if (!point) {
        setChinaMapMessage(
          `Baidu could not locate ${location.name} from the official address. Use “Open in Baidu”.`,
        );
        setStatus(
          `Baidu could not locate ${location.name}. The official Wahlap address and external Baidu link remain available.`,
        );
        return;
      }

      clearBaiduMarker();
      const marker = new BMap.Marker(point, { title: location.name });
      const info = new BMap.InfoWindow(`
        <div class="maimai-map-info">
          <strong>${escapeHtml(location.name)}</strong>
          <span>${escapeHtml(locationAreaLabel(location))}</span>
          <p>${escapeHtml(location.address)}</p>
          <a href="${baiduSearchUrl(location)}" target="_blank" rel="noopener">Open in Baidu Maps</a>
        </div>
      `, { width: 280 });
      state.baiduMapInstance.addOverlay(marker);
      centerBaiduMap(point, 17);
      state.baiduMapInstance.openInfoWindow(info, point);
      marker.addEventListener?.("click", () => {
        if (state.baiduMarker === marker && usesChinaMap()) {
          state.baiduMapInstance.openInfoWindow(info, point);
        }
      });
      state.baiduMarker = marker;
      state.baiduInfo = info;
      state.baiduPoint = point;
      state.baiduFocusedLocationId = location.id;
      setChinaMapMessage(
        `Showing one address-matched marker for ${location.name}. Verify it against the official Wahlap address.`,
      );
      updateMapStatus();
    }, location.city || location.subregion);
  }

  function focusChinaLocation(location) {
    cancelBaiduOverviewZoom();
    const url = baiduSearchUrl(location);
    const sameSelection = state.selectedLocationId === location.id;
    markSelectedLocation(location.id);
    showMapProvider("baidu");
    clearBaiduOverviewMarkers();
    if (els.chinaMapExternal) els.chinaMapExternal.href = url;
    updateChinaNavigation();

    if (!getBaiduApiKey() || state.baiduLoadFailed) {
      setChinaMapMessage(
        `The interactive Baidu map needs a valid Browser AK. Use “Open in Baidu” for ${location.name}.`,
      );
      updateMapStatus();
      return;
    }
    if (sameSelection && state.baiduGeocoding) return;
    if (sameSelection && state.baiduFocusedLocationId === location.id && state.baiduMarker) {
      geocodeBaiduLocation(location, state.baiduFocusToken);
      return;
    }

    const token = ++state.baiduFocusToken;
    state.baiduPendingLocationId = location.id;
    if (!state.baiduReady) {
      setChinaMapMessage(`Baidu Map is loading; ${location.name} will be selected when ready.`, true);
      updateMapStatus();
      return;
    }
    geocodeBaiduLocation(location, token);
  }

  function loadGoogleMaps(key) {
    if (!key || window.google?.maps) {
      if (window.google?.maps) initGoogleMaps();
      return;
    }
    window.gm_authFailure = function () {
      if (!usesChinaMap()) {
        setStatus("Google Maps rejected the key. The official location list remains available.");
      }
    };
    window.__initMaimaiGoogleMap = initGoogleMaps;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__initMaimaiGoogleMap`;
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      if (!usesChinaMap()) {
        setStatus("Google Maps could not be loaded. The official location list remains available.");
      }
    };
    document.head.appendChild(script);
  }

  function initGoogleMaps() {
    if (state.apiReady) return;
    state.apiReady = true;
    state.map = new google.maps.Map(els.map, {
      center: { lat: 34.8, lng: 120 },
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    state.info = new google.maps.InfoWindow();
    state.clusterer = createMarkerClusterer();
    els.map.classList.add("is-loaded");
    renderMarkers();
    updateBounds();
  }

  function createMarkerClusterer() {
    const clusterLibrary = window.markerClusterer;
    const MarkerClusterer = clusterLibrary?.MarkerClusterer;
    if (!MarkerClusterer) return null;
    try {
      const algorithm = clusterLibrary.SuperClusterViewportAlgorithm
        ? new clusterLibrary.SuperClusterViewportAlgorithm({
          maxZoom: 14,
          viewportPadding: 80,
        })
        : undefined;
      return new MarkerClusterer({
        map: state.map,
        markers: [],
        ...(algorithm
          ? { algorithm }
          : { algorithmOptions: { maxZoom: 14 } }),
      });
    } catch (error) {
      console.warn("Marker clustering is unavailable; using individual markers.", error);
      return null;
    }
  }

  function updateMapStatus() {
    if (!state.payload) return;
    if (usesChinaMap()) {
      if (!getBaiduApiKey()) {
        setStatus(
          `${state.filtered.length.toLocaleString()} live official locations are list-ready. `
          + "Add a domain-restricted Baidu Browser AK to enable the interactive map; no bulk markers are loaded.",
        );
        return;
      }
      if (state.baiduLoading || (!state.baiduReady && !state.baiduLoadFailed)) {
        setStatus(
          `${state.filtered.length.toLocaleString()} live official locations are list-ready. `
          + "Baidu Map is loading; the province overview will appear when ready.",
        );
        return;
      }
      if (state.baiduLoadFailed) {
        setStatus(
          `${state.filtered.length.toLocaleString()} live official locations are list-ready. `
          + "Baidu Map could not load; use the external Baidu links while the list remains available.",
        );
        return;
      }
      const selected = state.locations.find(
        (location) => location.id === state.selectedLocationId,
      );
      if (selected) {
        if (state.baiduGeocoding || state.baiduPendingLocationId === selected.id) {
          setStatus(
            `Locating ${selected.name} from its official Wahlap address. `
            + "Only this store is being geocoded; no bulk markers are loaded.",
          );
        } else if (state.baiduFocusedLocationId === selected.id && state.baiduMarker) {
          setStatus(
            `Showing one Baidu marker for ${selected.name}, matched from its official Wahlap address. `
            + "No other store markers are loaded; use Back to overview to return.",
          );
        } else {
          setStatus(
            `Select ${selected.name} again to retry its Baidu address match.`,
          );
        }
      } else {
        const overviewCount = state.mapItems.length;
        const markerLabel = overviewCount === 1 ? "marker" : "markers";
        const level = state.chinaOverviewLevel;
        const assignmentField = level === "province"
          ? "subregion"
          : (level === "city" ? "cityKey" : "districtKey");
        const listOnlyCount = state.filtered.filter(
          (location) => !location[assignmentField],
        ).length;
        const listOnlySuffix = listOnlyCount
          ? ` ${listOnlyCount.toLocaleString()} locations remain list-only at this level.`
          : "";
        const nextStep = level === "province"
          ? `Zoom to level ${CHINA_CITY_ZOOM} near a province, or select it, for its cities`
          : (
            level === "city"
              ? `Zoom to level ${CHINA_DISTRICT_ZOOM} near a city, or select it, for its districts`
              : "Zoom out for cities, or select a district to filter the store list"
          );
        setStatus(
          `${state.filtered.length.toLocaleString()} live official locations summarized into `
          + `${overviewCount.toLocaleString()} ${level} overview ${markerLabel}.`
          + `${listOnlySuffix} ${nextStep}, or select a store for one address-matched marker.`,
        );
      }
      return;
    }
    if (state.payload.mapMode === "region-summary") {
      setStatus(
        `${state.filtered.length.toLocaleString()} live official locations summarized into `
        + `${state.mapItems.length.toLocaleString()} province markers. `
        + "Wahlap does not publish exact store coordinates, so store actions use Google Maps search.",
      );
      return;
    }
    if (state.payload.mapMode === "grouped-overview" && !state.country) {
      setStatus(
        `${state.filtered.length.toLocaleString()} official locations summarized into `
        + `${state.mapItems.length.toLocaleString()} country / area markers. `
        + "Select a country / area to show exact clustered store markers.",
      );
      return;
    }
    const mappedCount = state.mapItems.length;
    const unmappedCount = state.filtered.length - mappedCount;
    const suffix = unmappedCount
      ? ` ${unmappedCount.toLocaleString()} filtered locations do not include official coordinates and remain list-only.`
      : "";
    const displayMode = state.clusterer
      ? "mapped locations grouped into zoomable clusters"
      : "Google Maps markers loaded";
    setStatus(`${mappedCount.toLocaleString()} ${displayMode} from the official coordinate dataset.${suffix}`);
  }

  function detachCachedMarkers() {
    for (const marker of state.markers.values()) marker.setMap?.(null);
    state.markers.clear();
  }

  function clearActiveMarkers() {
    if (state.info) state.info.close();
    state.infoLocationId = null;
    state.selectedLocationId = null;
    resetChinaMap();
    if (state.clusterer) {
      state.clusterer.clearMarkers(true);
      state.clusterer.render();
    }
    detachCachedMarkers();
  }

  function renderMarkers() {
    if (!state.payload) return;
    if (usesChinaMap()) {
      renderBaiduOverviewMarkers();
      updateMapStatus();
      return;
    }
    if (!state.apiReady || !state.map) return;

    if (usesGroupedOverview()) {
      if (state.infoLocationId) {
        state.info.close();
        state.infoLocationId = null;
      }
      detachCachedMarkers();
    }
    const visibleIds = new Set(state.mapItems.map((location) => location.id));
    if (state.infoLocationId && !visibleIds.has(state.infoLocationId)) {
      state.info.close();
      state.infoLocationId = null;
    }
    if (!state.clusterer) {
      for (const [id, marker] of state.markers) {
        if (!visibleIds.has(id)) marker.setMap(null);
      }
    }

    const visibleMarkers = [];
    state.mapItems.forEach((location) => {
      if (!hasCoordinates(location)) return;
      if (state.markers.has(location.id)) {
        const marker = state.markers.get(location.id);
        visibleMarkers.push(marker);
        if (!state.clusterer) marker.setMap(state.map);
        return;
      }
      const marker = new google.maps.Marker({
        position: { lat: location.lat, lng: location.lng },
        title: location.aggregate
          ? `${location.name}: ${location.count.toLocaleString()} locations`
          : location.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: location.aggregate ? 13 : 7,
          fillColor: markerColor(location),
          fillOpacity: 0.92,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        ...(location.aggregate
          ? {
            label: {
              text: String(location.count),
              color: "#ffffff",
              fontSize: "10px",
              fontWeight: "700",
            },
          }
          : {}),
      });
      marker.addListener("click", () => {
        if (location.aggregate) {
          selectMapGroup(location);
        } else {
          openInfo(location, marker);
        }
      });
      state.markers.set(location.id, marker);
      visibleMarkers.push(marker);
      if (!state.clusterer) marker.setMap(state.map);
    });
    if (state.clusterer) {
      state.clusterer.clearMarkers(true);
      state.clusterer.addMarkers(visibleMarkers, true);
      state.clusterer.render();
    }
    updateMapStatus();
  }

  function openInfo(location, marker) {
    state.infoLocationId = location.id;
    if (!location.aggregate) markSelectedLocation(location.id);
    if (location.aggregate) {
      state.info.setContent(`
        <div class="maimai-map-info">
          <strong>${escapeHtml(location.name)}</strong>
          <span>${location.count.toLocaleString()} locations</span>
          <p>${escapeHtml(location.address)}</p>
        </div>
      `);
    } else {
      state.info.setContent(`
        <div class="maimai-map-info">
          <strong>${escapeHtml(location.name)}</strong>
          <span>${escapeHtml(locationAreaLabel(location))}</span>
          <p>${escapeHtml(location.address)}</p>
          <a href="${googleMapsUrl(location)}" target="_blank" rel="noopener">Open in Google Maps</a>
        </div>
      `);
    }
    state.info.open({ anchor: marker, map: state.map });
  }

  function updateBounds() {
    if (usesChinaMap() || !state.apiReady || !state.map) return;
    const bounds = new google.maps.LatLngBounds();
    const points = [];
    state.mapItems.forEach((location) => {
      if (hasCoordinates(location)) {
        const point = { lat: location.lat, lng: location.lng };
        bounds.extend(point);
        points.push(point);
      }
    });
    if (points.length === 1) {
      state.map.panTo(points[0]);
      state.map.setZoom(usesGroupedOverview() ? 6 : 13);
    } else if (points.length > 1) {
      state.map.fitBounds(bounds, 48);
    }
  }

  function selectMapGroup(location) {
    if (state.payload?.mapMode === "region-summary") {
      state.subregion = location.key;
      els.subregion.value = state.subregion;
    } else {
      state.country = location.key;
      els.country.value = state.country;
      state.subregion = "";
      populateSubregions();
    }
    applyFilters();
  }

  function focusLocation(id) {
    const location = state.locations.find((item) => item.id === id);
    if (!location) return;
    if (usesChinaMap()) {
      focusChinaLocation(location);
      return;
    }
    if (!hasCoordinates(location)) {
      window.open(googleMapsUrl(location), "_blank", "noopener");
      return;
    }
    markSelectedLocation(location.id);
    if (state.payload?.mapMode === "grouped-overview" && !state.country) {
      state.country = location.country;
      els.country.value = state.country;
      state.subregion = "";
      populateSubregions();
      applyFilters();
    }
    if (!state.apiReady || !state.map) {
      window.open(googleMapsUrl(location), "_blank", "noopener");
      return;
    }
    const marker = state.markers.get(location.id);
    if (!marker) {
      window.open(googleMapsUrl(location), "_blank", "noopener");
      return;
    }
    const markerIsVisible = marker.getMap?.() === state.map;
    const shouldWaitForMapIdle = Boolean(
      state.clusterer
        && !markerIsVisible
        && google.maps.event?.addListenerOnce,
    );
    if (shouldWaitForMapIdle) {
      const focusSequence = state.loadSequence;
      const focusDatasetId = state.datasetId;
      google.maps.event.addListenerOnce(state.map, "idle", () => {
        if (
          focusSequence === state.loadSequence
          && focusDatasetId === state.datasetId
          && state.markers.get(location.id) === marker
          && state.filtered.some((item) => item.id === location.id)
        ) {
          openInfo(location, marker);
        }
      });
    }
    state.map.panTo({ lat: location.lat, lng: location.lng });
    state.map.setZoom(15);
    if (!shouldWaitForMapIdle) openInfo(location, marker);
  }

  function normalizeStaticPayload(payload, config) {
    if (!payload || !Array.isArray(payload.locations)) {
      throw new Error("invalid location payload");
    }
    const locations = payload.locations.map((location) => ({
      ...location,
      id: String(location.id),
      country: location.country || location.region || "",
      subregion: location.subregion || "",
    }));
    return {
      ...payload,
      id: payload.id || config.id,
      label: payload.label || (
        config.id === "current" ? "maimai Japan + United States" : config.label
      ),
      mapMode: payload.mapMode || "locations",
      mapGroups: payload.mapGroups || [],
      summary: {
        ...(payload.summary || {}),
        total: payload.summary?.total ?? locations.length,
      },
      locations,
    };
  }

  function chinaRegionAliases(region) {
    const suffixPattern = /(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|自治县|自治旗|省直辖县级行政区划|市辖区|城区|地区|新区|盟|省|市|区|县|旗)$/u;
    const aliases = new Set([
      region?.name,
      region?.key,
      ...(Array.isArray(region?.aliases) ? region.aliases : []),
    ].filter(Boolean).map(String));
    Array.from(aliases).forEach((name) => {
      const shortName = name.replace(suffixPattern, "");
      if (shortName.length >= 2) aliases.add(shortName);
    });
    return Array.from(aliases).sort((a, b) => b.length - a.length);
  }

  function findChinaAddressRegion(address, regions, excludedAliases = null) {
    let best = null;
    (regions || []).forEach((region) => {
      chinaRegionAliases(region).forEach((alias) => {
        if (excludedAliases?.has(alias)) return;
        if (!address.includes(alias)) return;
        if (!best || alias.length > best.alias.length) {
          best = { region, alias };
        }
      });
    });
    return best;
  }

  function matchChinaAddressHierarchy(address, province) {
    const cities = province?.cities || [];
    const provinceAliases = new Set(chinaRegionAliases(province));
    const cityMatch = findChinaAddressRegion(address, cities, provinceAliases);
    let city = cityMatch?.region || null;
    let district = city
      ? findChinaAddressRegion(address, city.districts || [])?.region || null
      : null;

    if (!city) {
      let districtMatch = null;
      cities.forEach((candidateCity) => {
        const candidate = findChinaAddressRegion(address, candidateCity.districts || []);
        if (candidate && (!districtMatch || candidate.alias.length > districtMatch.alias.length)) {
          districtMatch = { ...candidate, city: candidateCity };
        }
      });
      if (districtMatch) {
        city = districtMatch.city;
        district = districtMatch.region;
      }
    }
    if (!city && cities.length === 1) {
      [city] = cities;
      district = findChinaAddressRegion(address, city.districts || [])?.region || null;
    }
    return { city, district };
  }

  function normalizeWahlapPayload(rawLocations, support, config) {
    if (!Array.isArray(rawLocations) || rawLocations.length === 0) {
      throw new Error("Wahlap returned an invalid location list");
    }
    const rawRegions = Array.isArray(support?.regions) ? support.regions : [];
    const provinceGroups = support?.mapGroups || [];
    const chinaRegions = provinceGroups.map((group) => {
      const matched = rawRegions.find((region) => (
        chinaRegionKey(region) === group.key
        || chinaRegionAliases(region).includes(group.key)
      ));
      return {
        ...(matched || {}),
        ...group,
        key: group.key,
        name: group.name,
        cities: matched?.cities || [],
      };
    });
    const provincesByKey = new Map(
      chinaRegions.map((province) => [province.key, province]),
    );
    const locations = rawLocations.map((item) => {
      if (!item || item.id == null || !item.province || !item.arcadeName || !item.address) {
        throw new Error("Wahlap location schema changed");
      }
      const subregion = String(item.province);
      const province = provincesByKey.get(subregion);
      const hierarchy = matchChinaAddressHierarchy(String(item.address), province);
      return {
        id: `cn-wahlap-${String(item.id)}`,
        sourceId: String(item.id),
        sourcePlaceId: item.placeId == null ? null : String(item.placeId),
        name: String(item.arcadeName),
        address: String(item.address),
        lat: null,
        lng: null,
        needsGeocode: true,
        source: "Wahlap maimai DX official location list",
        gameTitle: "舞萌DX / maimai DX Mainland China",
        country: "Mainland China",
        region: "Mainland China",
        subregion,
        city: hierarchy.city?.name || "",
        cityKey: chinaRegionKey(hierarchy.city),
        district: hierarchy.district?.name || "",
        districtKey: chinaRegionKey(hierarchy.district),
        officialLocatorUrl: "https://wc.wahlap.net/maidx/location/index.html",
        detailsUrl: "https://wc.wahlap.net/maidx/location/index.html",
      };
    });
    const provinces = new Set(locations.map((location) => location.subregion));
    const mapGroups = provinceGroups.filter((group) => provinces.has(group.key));
    if (mapGroups.length !== provinces.size) {
      throw new Error("China province-center coverage is incomplete");
    }
    if (rawRegions.length && chinaRegions.some((region) => region.cities.length === 0)) {
      throw new Error("China province-city-district hierarchy coverage is incomplete");
    }
    return {
      schemaVersion: 3,
      id: config.id,
      label: "舞萌DX Mainland China",
      mapMode: "region-summary",
      groupField: "subregion",
      generatedAt: new Date().toISOString(),
      live: true,
      sources: [
        {
          name: "Wahlap / SEGA 舞萌DX official location list",
          url: "https://wc.wahlap.net/maidx/location/index.html",
          locator: "https://wc.wahlap.net/maidx/location/index.html",
        },
        {
          name: support.source?.name || "Province-center reference coordinates",
          url: support.source?.url || "",
          locator: support.source?.url || "",
        },
      ],
      notes: [
        "Baidu shows one lightweight province, city, or district summary level at a time; only the selected store is geocoded into one temporary exact marker.",
      ],
      summary: {
        total: locations.length,
        mapped: 0,
        needsGeocode: locations.length,
        areaCount: provinces.size,
      },
      mapGroups,
      chinaRegions,
      locations,
    };
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadDataset(config) {
    if (state.payloadCache.has(config.id)) return state.payloadCache.get(config.id);
    const request = (async () => {
      if (config.adapter === "wahlap") {
        const [locations, support] = await Promise.all([
          fetchJson(config.dataUrl),
          fetchJson(config.supportUrl),
        ]);
        return normalizeWahlapPayload(locations, support, config);
      }
      return normalizeStaticPayload(await fetchJson(config.dataUrl), config);
    })();
    state.payloadCache.set(config.id, request);
    try {
      const payload = await request;
      state.payloadCache.set(config.id, payload);
      return payload;
    } catch (error) {
      state.payloadCache.delete(config.id);
      throw error;
    }
  }

  function setDatasetButtons(activeId) {
    datasetButtons.forEach((button) => {
      const active = button.dataset.dataset === activeId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function resetActiveDataset(config) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
    state.provider = config.provider;
    clearActiveMarkers();
    state.payload = null;
    state.locations = [];
    state.filtered = [];
    state.mapItems = [];
    state.country = "";
    state.query = "";
    state.subregion = "";
    resetChinaHierarchy();
    els.datasetTitle.textContent = config.label;
    els.total.textContent = "...";
    els.mapped.textContent = "...";
    els.areas.textContent = "...";
    els.search.value = "";
    els.search.disabled = true;
    els.country.innerHTML = '<option value="">All countries / areas</option>';
    els.country.disabled = true;
    els.subregion.innerHTML = '<option value="">All provinces / areas</option>';
    els.subregion.disabled = true;
    els.visibleCount.textContent = "0 locations";
    els.list.innerHTML = "";
    els.source.textContent = "";
    updateExports(config);
  }

  function activatePayload(payload, config) {
    state.provider = config.provider;
    state.payload = payload;
    state.locations = payload.locations;
    state.filtered = [];
    state.mapItems = [];
    state.country = "";
    state.query = "";
    state.subregion = "";
    resetChinaHierarchy();
    els.datasetTitle.textContent = payload.label;
    showMapProvider(state.provider);
    if (usesChinaMap()) {
      resetChinaMap();
      loadBaiduMaps(getBaiduApiKey());
    } else {
      els.map.setAttribute("aria-label", `${payload.label} Google Map`);
    }
    els.search.disabled = false;
    updateStats(payload);
    renderSource();
    populateCountries();
    populateSubregions();
    applyFilters();
    if (!usesChinaMap() && !state.googleRequested) {
      state.googleRequested = true;
      loadGoogleMaps(getApiKey());
    }
    if (!usesChinaMap() && !state.apiReady) {
      setStatus(`${payload.summary.total.toLocaleString()} official locations loaded. Google Maps loading...`);
    } else {
      updateMapStatus();
    }
  }

  async function selectDataset(datasetId) {
    const config = datasetConfigs.get(datasetId);
    if (!config) return;
    if (state.payload && datasetId === state.datasetId) {
      if (state.loadingDatasetId && state.loadingDatasetId !== datasetId) {
        state.loadSequence += 1;
        state.loadingDatasetId = null;
      } else if (!usesChinaMap()) {
        state.loadSequence += 1;
      }
      setDatasetButtons(datasetId);
      root.setAttribute("aria-busy", "false");
      if (usesChinaMap()) {
        showMapProvider(state.provider);
        updateMapStatus();
      } else if (state.apiReady) {
        updateMapStatus();
      } else {
        setStatus(
          `${state.payload.summary.total.toLocaleString()} official locations loaded. Google Maps loading...`,
        );
      }
      return;
    }
    const sequence = ++state.loadSequence;
    if (usesChinaMap()) cancelBaiduGeocode();
    state.loadingDatasetId = datasetId;
    const previousDatasetId = state.datasetId;
    setDatasetButtons(datasetId);
    root.setAttribute("aria-busy", "true");
    setStatus(`Loading ${config.label} location data...`);
    try {
      const payload = await loadDataset(config);
      if (sequence !== state.loadSequence) return;
      state.datasetId = datasetId;
      resetActiveDataset(config);
      activatePayload(payload, config);
    } catch (error) {
      if (sequence !== state.loadSequence) return;
      setDatasetButtons(previousDatasetId);
      setLoadError(config, error);
    } finally {
      if (sequence === state.loadSequence) {
        state.loadingDatasetId = null;
        root.setAttribute("aria-busy", "false");
      }
    }
  }

  function bindEvents() {
    datasetButtons.forEach((button) => {
      button.addEventListener("click", () => selectDataset(button.dataset.dataset));
    });
    els.search.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.query = els.search.value;
        applyFilters();
      }, 180);
    });
    els.country.addEventListener("change", () => {
      state.country = els.country.value;
      state.subregion = "";
      populateSubregions();
      applyFilters();
    });
    els.subregion.addEventListener("change", () => {
      if (usesChinaMap()) {
        cancelBaiduOverviewZoom();
        cancelBaiduGeocode();
        clearBaiduMarker();
        markSelectedLocation(null);
      }
      state.subregion = els.subregion.value;
      if (usesChinaMap() && state.subregion) {
        state.chinaOverviewLevel = "city";
        state.chinaProvinceKey = state.subregion;
        state.chinaCityKey = "";
        state.chinaDistrictKey = "";
      } else if (usesChinaMap()) {
        resetChinaHierarchy();
      }
      applyFilters();
      if (usesChinaMap() && state.baiduReady && state.baiduMapInstance) {
        if (state.subregion) {
          const province = chinaProvinceRegion();
          if (hasCoordinates(province)) {
            centerBaiduMap(
              new BMap.Point(province.lng, province.lat),
              8,
            );
          }
        } else {
          centerBaiduMap(new BMap.Point(104.2, 35.9), 5);
        }
      }
    });
    els.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-focus]");
      if (!button) return;
      focusLocation(button.dataset.focus);
    });
    els.chinaMapBack?.addEventListener("click", showPreviousChinaOverview);
    els.chinaMapOverview?.addEventListener("click", showChinaProvinceOverview);
    els.baiduZoomIn?.addEventListener("click", () => changeBaiduZoom(1));
    els.baiduZoomOut?.addEventListener("click", () => changeBaiduZoom(-1));
  }

  bindEvents();
  selectDataset(state.datasetId);
})();
