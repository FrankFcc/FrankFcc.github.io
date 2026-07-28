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
    chinaMapFrame: root.querySelector("[data-china-map-frame]"),
    chinaMapEmpty: root.querySelector("[data-china-map-empty]"),
    chinaMapBanner: root.querySelector("[data-china-map-banner]"),
    chinaMapMessage: root.querySelector("[data-china-map-message]"),
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
    map: null,
    info: null,
    infoLocationId: null,
    markers: new Map(),
    clusterer: null,
    selectedLocationId: null,
    chinaFrameLoading: false,
    chinaSearchLoaded: false,
    chinaRequestToken: 0,
    chinaLoadTimer: null,
    apiReady: false,
    googleRequested: false,
    loadSequence: 0,
  };

  const AMAP_CHINA_VIEWPORT = "73.5|18|135.1|53.6";
  const AMAP_HOME_URL = `https://ditu.amap.com/search?${new URLSearchParams({
    query: "中国",
    city: "中国",
    geoobj: AMAP_CHINA_VIEWPORT,
    zoom: "4",
  }).toString()}`;
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
    return state.provider === "amap";
  }

  function amapSearchUrl(location) {
    if (!location) return AMAP_HOME_URL;
    const params = new URLSearchParams({
      query: `${location.name} ${location.address}`.trim(),
      city: location.subregion || "中国",
      // A viewport parameter makes Gaode execute the search on first load. The
      // official address still determines the result and only one query is shown.
      geoobj: AMAP_CHINA_VIEWPORT,
      zoom: "4",
    });
    return `https://ditu.amap.com/search?${params.toString()}`;
  }

  function locationMapUrl(location) {
    return usesChinaMap() ? amapSearchUrl(location) : googleMapsUrl(location);
  }

  function locationAreaLabel(location) {
    return [location.country, location.subregion].filter(Boolean).join(" / ");
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
        ? "On-demand map"
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

  function buildMapItems() {
    if (!usesGroupedOverview()) return state.filtered.filter(hasCoordinates);

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
      if (!query) return true;
      const haystack = [
        location.name,
        location.address,
        location.country,
        location.subregion,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
    if (
      state.selectedLocationId
      && !state.filtered.some((location) => location.id === state.selectedLocationId)
    ) {
      state.selectedLocationId = null;
      if (usesChinaMap()) resetChinaMap();
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
          ? AMAP_HOME_URL
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`maimai ${state.payload?.label || ""}`)}`
      );
    els.openVisible.textContent = usesChinaMap() ? "Open Gaode" : "Open search";

    const visibleItems = state.filtered.slice(0, 250);
    els.list.innerHTML = visibleItems.map((location) => {
      const selected = location.id === state.selectedLocationId;
      const focusLabel = usesChinaMap()
        ? "Show on Gaode"
        : (hasCoordinates(location) ? "Focus" : "Search map");
      const providerLabel = usesChinaMap() ? "Gaode Map" : "Google Maps";
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

  function clearChinaLoadTimer() {
    if (state.chinaLoadTimer) {
      window.clearTimeout(state.chinaLoadTimer);
      state.chinaLoadTimer = null;
    }
  }

  function resetChinaMap() {
    if (!els.chinaMapFrame) return;
    state.chinaRequestToken += 1;
    clearChinaLoadTimer();
    state.chinaFrameLoading = false;
    state.chinaSearchLoaded = false;
    els.chinaMapFrame.removeAttribute("src");
    els.chinaMapFrame.hidden = true;
    els.chinaMap?.classList.remove("is-active", "is-loaded");
    if (els.chinaMapEmpty) els.chinaMapEmpty.hidden = false;
    if (els.chinaMapBanner) els.chinaMapBanner.hidden = true;
    if (els.chinaMapExternal) els.chinaMapExternal.href = AMAP_HOME_URL;
    setChinaMapMessage(
      "Select a store name on the right to open one Gaode address search.",
    );
  }

  function showMapProvider(provider) {
    const showChina = provider === "amap";
    els.map.hidden = showChina;
    els.map.setAttribute("aria-hidden", String(showChina));
    els.chinaMap.hidden = !showChina;
    els.chinaMap.setAttribute("aria-hidden", String(!showChina));
    els.mapShell.setAttribute(
      "aria-label",
      showChina ? "maimai Mainland China Gaode Map" : `${state.payload?.label || "maimai"} Google Map`,
    );
    if (!showChina) resetChinaMap();
    if (!showChina && state.apiReady && window.google?.maps?.event) {
      window.requestAnimationFrame(() => {
        google.maps.event.trigger(state.map, "resize");
        updateBounds();
      });
    }
  }

  function focusChinaLocation(location) {
    if (!els.chinaMapFrame) {
      window.open(amapSearchUrl(location), "_blank", "noopener");
      return;
    }
    const url = amapSearchUrl(location);
    const sameRequest = state.selectedLocationId === location.id
      && els.chinaMapFrame.getAttribute("src") === url;
    markSelectedLocation(location.id);
    showMapProvider("amap");
    if (sameRequest) {
      updateMapStatus();
      return;
    }

    const token = ++state.chinaRequestToken;
    clearChinaLoadTimer();
    state.chinaFrameLoading = true;
    state.chinaSearchLoaded = false;
    els.chinaMap.classList.add("is-active");
    els.chinaMap.classList.remove("is-loaded");
    if (els.chinaMapEmpty) els.chinaMapEmpty.hidden = true;
    if (els.chinaMapBanner) els.chinaMapBanner.hidden = false;
    if (els.chinaMapExternal) els.chinaMapExternal.href = url;
    setChinaMapMessage(`Opening a Gaode search for ${location.name}...`, true);

    const previousFrame = els.chinaMapFrame;
    const frame = previousFrame.cloneNode(false);
    frame.hidden = false;
    frame.removeAttribute("src");
    frame.setAttribute("src", url);
    frame.addEventListener("load", () => {
      if (
        token !== state.chinaRequestToken
        || frame !== els.chinaMapFrame
        || !usesChinaMap()
        || state.selectedLocationId !== location.id
      ) {
        return;
      }
      clearChinaLoadTimer();
      state.chinaFrameLoading = false;
      state.chinaSearchLoaded = true;
      els.chinaMap?.classList.add("is-loaded");
      setChinaMapMessage(
        `Gaode navigation finished for ${location.name}. Verify the address, or use “Open in Gaode” if the frame is blank.`,
      );
      updateMapStatus();
    });
    els.chinaMapFrame = frame;
    previousFrame.replaceWith(frame);
    state.chinaLoadTimer = window.setTimeout(() => {
      if (
        token !== state.chinaRequestToken
        || frame !== els.chinaMapFrame
        || !state.chinaFrameLoading
      ) {
        return;
      }
      setChinaMapMessage(
        `Gaode is still loading ${location.name}. Use “Open in Gaode” if the frame stays blank.`,
        true,
      );
      setStatus(
        `Gaode is still loading the selected store search. No bulk markers were created; `
        + "the external Gaode link remains available.",
      );
    }, 12000);
    updateMapStatus();
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
      const selected = state.locations.find(
        (location) => location.id === state.selectedLocationId,
      );
      if (selected) {
        if (state.chinaFrameLoading) {
          setStatus(
            `Opening one Gaode search for ${selected.name} from its official Wahlap address. `
            + "No other store searches or bulk markers are loaded.",
          );
        } else if (state.chinaSearchLoaded) {
          setStatus(
            `Gaode frame navigation finished for ${selected.name}. Check the map against the `
            + "official Wahlap address; use the external link if the frame is blank or incorrect.",
          );
        } else {
          setStatus(
            `Select ${selected.name} again to reopen its Gaode address search.`,
          );
        }
      } else {
        setStatus(
          `${state.filtered.length.toLocaleString()} live official locations are list-ready. `
          + "Select a store name to open one Gaode address search; no bulk markers are loaded.",
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
    if (state.clusterer) {
      state.clusterer.clearMarkers(true);
      state.clusterer.render();
    }
    detachCachedMarkers();
  }

  function renderMarkers() {
    if (!state.payload) return;
    if (usesChinaMap()) {
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

  function normalizeWahlapPayload(rawLocations, support, config) {
    if (!Array.isArray(rawLocations) || rawLocations.length === 0) {
      throw new Error("Wahlap returned an invalid location list");
    }
    const locations = rawLocations.map((item) => {
      if (!item || item.id == null || !item.province || !item.arcadeName || !item.address) {
        throw new Error("Wahlap location schema changed");
      }
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
        subregion: String(item.province),
        officialLocatorUrl: "https://wc.wahlap.net/maidx/location/index.html",
        detailsUrl: "https://wc.wahlap.net/maidx/location/index.html",
      };
    });
    const provinces = new Set(locations.map((location) => location.subregion));
    const mapGroups = (support?.mapGroups || []).filter((group) => provinces.has(group.key));
    if (mapGroups.length !== provinces.size) {
      throw new Error("China province-center coverage is incomplete");
    }
    return {
      schemaVersion: 2,
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
        "Wahlap provides store addresses but no coordinates, so Gaode opens one store-address search only after a store is selected.",
      ],
      summary: {
        total: locations.length,
        mapped: 0,
        needsGeocode: locations.length,
        areaCount: provinces.size,
      },
      mapGroups,
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
    els.datasetTitle.textContent = payload.label;
    showMapProvider(state.provider);
    if (usesChinaMap()) {
      resetChinaMap();
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
    const sequence = ++state.loadSequence;
    if (state.payload && datasetId === state.datasetId) {
      setDatasetButtons(datasetId);
      root.setAttribute("aria-busy", "false");
      if (usesChinaMap() || state.apiReady) {
        updateMapStatus();
      } else {
        setStatus(
          `${state.payload.summary.total.toLocaleString()} official locations loaded. Google Maps loading...`,
        );
      }
      return;
    }
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
      if (sequence === state.loadSequence) root.setAttribute("aria-busy", "false");
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
      state.subregion = els.subregion.value;
      applyFilters();
    });
    els.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-focus]");
      if (!button) return;
      focusLocation(button.dataset.focus);
    });
  }

  bindEvents();
  selectDataset(state.datasetId);
})();
