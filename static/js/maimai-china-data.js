(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MaimaiChinaData = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SOURCE_URL = "https://sega-register.wahlap.net/api/sega/maidx/rest/location";
  const LOCATOR_URL = "https://wc.wahlap.net/maidx/location/index.html";

  // JSON.parse rounds numeric IDs above 2^53. Quote those integer tokens before
  // parsing, without changing numbers or escaped characters inside JSON strings.
  function parseOfficialJson(text) {
    if (typeof text !== "string") throw new Error("Wahlap returned invalid JSON");
    const tokens = text.match(/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[^"\d-]+|[\s\S]/g) || [];
    return JSON.parse(tokens.map((token) => (
      /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))
        ? JSON.stringify(token) : token
    )).join(""));
  }

  function requiredText(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Wahlap location schema changed: invalid ${field}`);
    }
    return value.trim();
  }

  function identifier(value, field, optional = false) {
    if (optional && (value == null || value === "")) return null;
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new Error(`Wahlap location schema changed: unsafe ${field}`);
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Wahlap location schema changed: invalid ${field}`);
    }
    const result = String(value).trim();
    if (optional && !result) return null;
    if (!result) throw new Error(`Wahlap location schema changed: missing ${field}`);
    return result;
  }

  function officialRecords(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("Wahlap returned an invalid location list");
    }
    const seen = new Set();
    return raw.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Wahlap location schema changed");
      }
      const record = {
        id: identifier(item.id, "id"),
        province: requiredText(item.province, "province"),
        arcadeName: requiredText(item.arcadeName, "arcadeName"),
        address: requiredText(item.address, "address"),
        placeId: identifier(item.placeId, "placeId", true),
      };
      if (seen.has(record.id)) throw new Error(`Wahlap returned duplicate location ID ${record.id}`);
      seen.add(record.id);
      return record;
    });
  }

  function canonicalOfficialList(raw) {
    return JSON.stringify(officialRecords(raw).sort((a, b) => (
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    )));
  }

  function canonicalSavedList(payload) {
    if (!Array.isArray(payload?.locations)) throw new Error("Invalid saved China locations");
    return canonicalOfficialList(payload.locations.map((location) => ({
      id: location.sourceId,
      province: location.sourceProvince,
      arcadeName: location.name,
      address: location.address,
      placeId: location.sourcePlaceId,
    })));
  }

  function chinaRegionKey(region) {
    return String(region?.key || region?.code || region?.name || "");
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
        if (excludedAliases?.has(alias) || !address.includes(alias)) return;
        if (!best || alias.length > best.alias.length) best = { region, alias };
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

  function normalize(rawLocations, support, config = {}) {
    const records = officialRecords(rawLocations);
    const rawRegions = Array.isArray(support?.regions) ? support.regions : [];
    const provinceGroups = Array.isArray(support?.mapGroups) ? support.mapGroups : [];
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
        aliases: [...new Set([...chinaRegionAliases(matched), ...chinaRegionAliases(group)])],
        cities: matched?.cities || [],
      };
    });
    const provincesByKey = new Map(chinaRegions.flatMap((province) => (
      chinaRegionAliases(province).map((alias) => [alias, province])
    )));
    const locations = records.map((item) => {
      const province = provincesByKey.get(item.province);
      const hierarchy = matchChinaAddressHierarchy(item.address, province);
      return {
        id: `cn-wahlap-${item.id}`,
        sourceId: item.id,
        sourceProvince: item.province,
        sourcePlaceId: item.placeId,
        name: item.arcadeName,
        address: item.address,
        lat: null,
        lng: null,
        needsGeocode: true,
        source: "Wahlap maimai DX official location list",
        gameTitle: "舞萌DX / maimai DX Mainland China",
        country: "Mainland China",
        region: "Mainland China",
        subregion: province?.key || item.province,
        city: hierarchy.city?.name || "",
        cityKey: chinaRegionKey(hierarchy.city),
        district: hierarchy.district?.name || "",
        districtKey: chinaRegionKey(hierarchy.district),
        officialLocatorUrl: LOCATOR_URL,
        detailsUrl: LOCATOR_URL,
      };
    });
    const provinces = new Set(locations.map((location) => location.subregion));
    const mapGroups = provinceGroups.filter((group) => provinces.has(group.key));
    const missingProvinces = [...provinces].filter((key) => !provincesByKey.has(key));
    const coverageNote = missingProvinces.length
      ? `Province summaries are unavailable for ${missingProvinces.join(", ")}; `
        + "their stores remain searchable in the list and can be opened individually on Baidu. "
      : "";
    return {
      schemaVersion: 4,
      coordinateSystem: "BD-09",
      id: config.id || "china",
      label: "舞萌DX Mainland China",
      mapMode: "region-summary",
      groupField: "subregion",
      generatedAt: new Date().toISOString(),
      hierarchyGeneratedAt: support?.generatedAt || null,
      live: false,
      sourceUrl: config.sourceUrl || SOURCE_URL,
      sources: [
        { name: "Wahlap / SEGA 舞萌DX official location list", url: LOCATOR_URL, locator: LOCATOR_URL },
        {
          name: support?.source?.name || "Province-center reference coordinates",
          url: support?.source?.url || "",
          locator: support?.source?.url || "",
        },
      ],
      notes: [coverageNote + "Saved store addresses and province, city, and district assignments load immediately. The official list is checked for changes in the background. Exact Baidu store coordinates are saved after address matching."],
      summary: { total: locations.length, mapped: 0, needsGeocode: locations.length, areaCount: provinces.size },
      mapGroups,
      chinaRegions,
      locations,
    };
  }

  function validCoordinates(value, allowUnknown = false) {
    if (allowUnknown && value.lat === null && value.lng === null) return true;
    return typeof value.lat === "number" && Number.isFinite(value.lat)
      && value.lat >= -90 && value.lat <= 90
      && typeof value.lng === "number" && Number.isFinite(value.lng)
      && value.lng >= -180 && value.lng <= 180;
  }

  function validateRegions(regions, childField) {
    if (!Array.isArray(regions)) throw new Error("Invalid saved China regions");
    const keys = new Set();
    regions.forEach((region) => {
      if (!region || typeof region.key !== "string" || !region.key.trim()
          || typeof region.name !== "string" || !region.name.trim()
          || keys.has(region.key) || !validCoordinates(region)
          || (region.aliases != null && (!Array.isArray(region.aliases)
            || region.aliases.some((alias) => typeof alias !== "string")))) {
        throw new Error("Invalid saved China region");
      }
      keys.add(region.key);
      if (childField) validateRegions(region[childField], childField === "cities" ? "districts" : null);
    });
  }

  function validateSavedPayload(payload) {
    if (!payload || payload.schemaVersion !== 4 || payload.coordinateSystem !== "BD-09"
        || payload.id !== "china" || payload.live !== false
        || payload.mapMode !== "region-summary" || payload.groupField !== "subregion"
        || typeof payload.label !== "string"
        || typeof payload.generatedAt !== "string" || !Number.isFinite(Date.parse(payload.generatedAt))
        || (payload.hierarchyGeneratedAt !== null && (typeof payload.hierarchyGeneratedAt !== "string"
          || !Number.isFinite(Date.parse(payload.hierarchyGeneratedAt))))
        || typeof payload.sourceUrl !== "string" || !payload.sourceUrl.startsWith("https://")
        || !Array.isArray(payload.notes) || payload.notes.some((note) => typeof note !== "string")
        || !Array.isArray(payload.sources) || payload.sources.some((source) => !source
          || ["name", "url", "locator"].some((key) => typeof source[key] !== "string"))) {
      throw new Error("Invalid saved China location payload");
    }
    canonicalSavedList(payload);
    validateRegions(payload.chinaRegions, "cities");
    validateRegions(payload.mapGroups, null);
    const byProvince = new Map(payload.chinaRegions.map((region) => [region.key, region]));
    payload.locations.forEach((location) => {
      if (typeof location.sourceId !== "string" || location.id !== `cn-wahlap-${location.sourceId}`
          || typeof location.sourceProvince !== "string"
          || (location.sourcePlaceId !== null && typeof location.sourcePlaceId !== "string")
          || location.country !== "Mainland China" || location.region !== "Mainland China"
          || typeof location.subregion !== "string" || !location.subregion.trim()
          || ["city", "cityKey", "district", "districtKey"].some((key) => typeof location[key] !== "string")
          || !validCoordinates(location, true)
          || (location.lat !== null && location.coordinateSystem !== "BD-09")
          || location.aggregate === true
          || (location.coordinatePrecision != null && (typeof location.coordinatePrecision !== "string"
            || /center|approximate/i.test(location.coordinatePrecision)))
          || location.needsGeocode !== (location.lat === null)) {
        throw new Error("Invalid saved China location");
      }
      const province = byProvince.get(location.subregion);
      const city = province?.cities.find((region) => region.key === location.cityKey);
      const district = city?.districts.find((region) => region.key === location.districtKey);
      if ((location.cityKey && (!city || city.name !== location.city))
          || (location.districtKey && (!district || district.name !== location.district))
          || (!location.cityKey && location.city) || (!location.districtKey && location.district)) {
        throw new Error("Invalid saved China location region assignment");
      }
    });
    const mapped = payload.locations.filter((location) => location.lat !== null).length;
    if (payload.summary?.total !== payload.locations.length || payload.summary?.mapped !== mapped
        || payload.summary?.needsGeocode !== payload.locations.length - mapped
        || payload.summary?.areaCount !== new Set(payload.locations.map((location) => location.subregion)).size
        || payload.mapGroups.some((group) => !byProvince.has(group.key))) {
      throw new Error("Invalid saved China location summary");
    }
    return payload;
  }

  return { normalize, canonicalOfficialList, canonicalSavedList, validateSavedPayload, parseOfficialJson };
}));
