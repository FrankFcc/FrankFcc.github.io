(function () {
  const root = document.querySelector("[data-maimai-map]");
  if (!root) return;

  const dataUrl = root.dataset.dataUrl || "/data/maimai_locations.json";
  const els = {
    total: root.querySelector("[data-stat-total]"),
    jp: root.querySelector("[data-stat-jp]"),
    us: root.querySelector("[data-stat-us]"),
    status: root.querySelector("[data-status]"),
    search: root.querySelector("[data-search]"),
    subregion: root.querySelector("[data-subregion]"),
    map: root.querySelector("[data-map]"),
    list: root.querySelector("[data-list]"),
    visibleCount: root.querySelector("[data-visible-count]"),
    openVisible: root.querySelector("[data-open-visible]"),
    source: root.querySelector("[data-source]"),
    tabs: Array.from(root.querySelectorAll("[data-region]")),
  };

  const state = {
    payload: null,
    locations: [],
    filtered: [],
    region: "all",
    query: "",
    subregion: "",
    map: null,
    info: null,
    markers: new Map(),
    apiReady: false,
  };

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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function googleMapsUrl(location) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.name} ${location.address}`)}`;
  }

  function markerColor(location) {
    if (location.country === "Japan") return "#d84a3a";
    return "#256f9c";
  }

  function updateStats(summary) {
    els.total.textContent = `${summary.total.toLocaleString()} total`;
    els.jp.textContent = `${summary.japan.toLocaleString()} Japan`;
    els.us.textContent = `${summary.unitedStates.toLocaleString()} US`;
  }

  function renderSource() {
    const generated = state.payload.generatedAt
      ? new Date(state.payload.generatedAt).toLocaleString()
      : "unknown";
    const sources = state.payload.sources
      .map((source) => `<a href="${source.locator}" target="_blank" rel="noopener">${escapeHtml(source.name)}</a>`)
      .join(" / ");
    els.source.innerHTML = `Source: ${sources}. Dataset refreshed ${escapeHtml(generated)}.`;
  }

  function populateSubregions() {
    const subregions = Array.from(new Set(
      state.locations
        .filter((location) => state.region === "all" || location.country === state.region)
        .map((location) => location.subregion)
        .filter(Boolean),
    )).sort((a, b) => a.localeCompare(b));
    const previous = els.subregion.value;
    els.subregion.innerHTML = '<option value="">All areas</option>' + subregions
      .map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`)
      .join("");
    if (subregions.includes(previous)) {
      els.subregion.value = previous;
    } else {
      state.subregion = "";
    }
  }

  function applyFilters() {
    const query = state.query.trim().toLowerCase();
    state.filtered = state.locations.filter((location) => {
      if (state.region !== "all" && location.country !== state.region) return false;
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
    renderList();
    renderMarkers();
    updateBounds();
  }

  function renderList() {
    els.visibleCount.textContent = `${state.filtered.length.toLocaleString()} locations`;
    els.openVisible.href = state.filtered.length === 1
      ? googleMapsUrl(state.filtered[0])
      : "https://www.google.com/maps/search/maimai";

    const visibleItems = state.filtered.slice(0, 250);
    els.list.innerHTML = visibleItems.map((location) => `
      <article class="maimai-map-item" data-id="${escapeHtml(location.id)}">
        <span>${escapeHtml(location.country)} / ${escapeHtml(location.subregion)}</span>
        <strong>${escapeHtml(location.name)}</strong>
        <p>${escapeHtml(location.address)}</p>
        <div>
          <button type="button" data-focus="${escapeHtml(location.id)}">Focus</button>
          <a href="${googleMapsUrl(location)}" target="_blank" rel="noopener">Google Maps</a>
        </div>
      </article>
    `).join("");

    if (state.filtered.length > visibleItems.length) {
      els.list.insertAdjacentHTML(
        "beforeend",
        `<p class="maimai-map-list-note">${(state.filtered.length - visibleItems.length).toLocaleString()} more hidden by list limit. Use search or area filters.</p>`,
      );
    }
  }

  function loadGoogleMaps(key) {
    if (!key || window.google?.maps) {
      if (window.google?.maps) initGoogleMaps();
      return;
    }
    window.gm_authFailure = function () {
      setStatus("Google Maps rejected the key. The official location list remains available.");
    };
    window.__initMaimaiGoogleMap = initGoogleMaps;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__initMaimaiGoogleMap`;
    script.async = true;
    script.defer = true;
    script.onerror = function () {
      setStatus("Google Maps could not be loaded. The official location list remains available.");
    };
    document.head.appendChild(script);
  }

  function initGoogleMaps() {
    if (state.apiReady) return;
    state.apiReady = true;
    state.map = new google.maps.Map(els.map, {
      center: { lat: 36.2, lng: 139.1 },
      zoom: 5,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    state.info = new google.maps.InfoWindow();
    els.map.classList.add("is-loaded");
    renderMarkers();
    updateBounds();
  }

  function hasCoordinates(location) {
    return typeof location.lat === "number" && typeof location.lng === "number";
  }

  function updateMapStatus(unmappedCount) {
    const mappedCount = state.filtered.length - unmappedCount;
    const suffix = unmappedCount
      ? ` ${unmappedCount.toLocaleString()} filtered locations do not include official coordinates and remain list-only.`
      : "";
    setStatus(`${mappedCount.toLocaleString()} Google Maps markers loaded from the official coordinate dataset.${suffix}`);
  }

  function renderMarkers() {
    if (!state.apiReady || !state.map) return;
    const visibleIds = new Set(state.filtered.map((location) => location.id));
    for (const [id, marker] of state.markers) {
      if (!visibleIds.has(id)) marker.setMap(null);
    }

    let unmappedCount = 0;
    state.filtered.forEach((location) => {
      if (!hasCoordinates(location)) {
        unmappedCount += 1;
        return;
      }
      if (state.markers.has(location.id)) {
        state.markers.get(location.id).setMap(state.map);
        return;
      }
      const marker = new google.maps.Marker({
        map: state.map,
        position: { lat: location.lat, lng: location.lng },
        title: location.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: markerColor(location),
          fillOpacity: 0.92,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      marker.addListener("click", () => openInfo(location, marker));
      state.markers.set(location.id, marker);
    });
    updateMapStatus(unmappedCount);
  }

  function openInfo(location, marker) {
    state.info.setContent(`
      <div class="maimai-map-info">
        <strong>${escapeHtml(location.name)}</strong>
        <span>${escapeHtml(location.country)} / ${escapeHtml(location.subregion)}</span>
        <p>${escapeHtml(location.address)}</p>
        <a href="${googleMapsUrl(location)}" target="_blank" rel="noopener">Open in Google Maps</a>
      </div>
    `);
    state.info.open({ anchor: marker, map: state.map });
  }

  function updateBounds() {
    if (!state.apiReady || !state.map) return;
    const bounds = new google.maps.LatLngBounds();
    let count = 0;
    state.filtered.forEach((location) => {
      if (typeof location.lat === "number" && typeof location.lng === "number") {
        bounds.extend({ lat: location.lat, lng: location.lng });
        count += 1;
      }
    });
    if (count > 0) state.map.fitBounds(bounds, 48);
  }

  function focusLocation(id) {
    const location = state.locations.find((item) => item.id === id);
    if (!location || !state.apiReady || !state.map) {
      if (location) window.open(googleMapsUrl(location), "_blank", "noopener");
      return;
    }
    const marker = state.markers.get(location.id);
    if (!marker || !hasCoordinates(location)) {
      window.open(googleMapsUrl(location), "_blank", "noopener");
      return;
    }
    state.map.panTo({ lat: location.lat, lng: location.lng });
    state.map.setZoom(15);
    openInfo(location, marker);
  }

  function bindEvents() {
    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        els.tabs.forEach((item) => item.classList.toggle("is-active", item === tab));
        state.region = tab.dataset.region || "all";
        populateSubregions();
        applyFilters();
      });
    });
    els.search.addEventListener("input", () => {
      state.query = els.search.value;
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

  fetch(dataUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      state.payload = payload;
      state.locations = payload.locations;
      updateStats(payload.summary);
      renderSource();
      populateSubregions();
      bindEvents();
      applyFilters();
      setStatus(`${payload.summary.total.toLocaleString()} official locations loaded.`);
      loadGoogleMaps(getApiKey());
    })
    .catch((error) => {
      setStatus(`Could not load maimai location data: ${error.message}`);
    });
})();
