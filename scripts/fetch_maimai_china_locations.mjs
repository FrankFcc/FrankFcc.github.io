#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import chinaData from "../static/js/maimai-china-data.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_URL = "https://sega-register.wahlap.net/api/sega/maidx/rest/location";

function hierarchySignature(payload) {
  return JSON.stringify({
    hierarchyGeneratedAt: payload.hierarchyGeneratedAt,
    chinaRegions: payload.chinaRegions,
    mapGroups: payload.mapGroups,
  });
}

export async function refreshSnapshot(options = {}) {
  const output = path.resolve(options.output || path.join(repository, "static/data/maimai_locations_china.json"));
  const supportPath = path.resolve(options.support || path.join(repository, "static/data/maimai_china_region_hierarchy.json"));
  const support = JSON.parse(await fs.readFile(supportPath, "utf8"));
  let sourceText;
  if (options.source) {
    sourceText = await fs.readFile(path.resolve(options.source), "utf8");
  } else {
    const response = await fetch(SOURCE_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Official list request failed: HTTP ${response.status}`);
    sourceText = await response.text();
  }
  const raw = chinaData.parseOfficialJson(sourceText);
  const next = chinaData.normalize(raw, support, { id: "china", sourceUrl: SOURCE_URL });
  let previous = null;
  try {
    previous = chinaData.validateSavedPayload(JSON.parse(await fs.readFile(output, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const officialChanged = !previous
    || chinaData.canonicalOfficialList(raw) !== chinaData.canonicalSavedList(previous);
  const hierarchyChanged = !previous || hierarchySignature(next) !== hierarchySignature(previous);
  if (!officialChanged && !hierarchyChanged) {
    return { changed: false, written: false, count: previous.locations.length, output };
  }

  // A geocoded point is only reusable for the same store, source address, and
  // province/city context used by the runtime geocoder.
  // Region reference centers are never copied into individual store coordinates.
  const oldById = new Map((previous?.locations || []).map((location) => [location.sourceId, location]));
  let preservedCoordinates = 0;
  next.locations.forEach((location) => {
    const old = oldById.get(location.sourceId);
    if (old && old.lat !== null && old.coordinateSystem === "BD-09"
        && old.sourceProvince === location.sourceProvince && old.address === location.address
        && old.city === location.city && old.subregion === location.subregion) {
      location.lat = old.lat;
      location.lng = old.lng;
      location.coordinateSystem = "BD-09";
      ["coordinatePrecision", "coordinateSource", "geocodedAt"].forEach((field) => {
        if (old[field] != null) location[field] = old[field];
      });
      location.needsGeocode = false;
      preservedCoordinates += 1;
    }
  });
  next.summary.mapped = preservedCoordinates;
  next.summary.needsGeocode = next.locations.length - preservedCoordinates;
  chinaData.validateSavedPayload(next);
  if (!options.check) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(next)}\n`, "utf8");
  }
  return {
    changed: true,
    written: !options.check,
    count: next.locations.length,
    officialChanged,
    hierarchyChanged,
    preservedCoordinates,
    output,
  };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") options.check = true;
    else if (["--source", "--output", "--support"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a file path`);
      options[argument.slice(2)] = value;
    } else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log("Usage: node scripts/fetch_maimai_china_locations.mjs [--check] [--source FILE] [--output FILE] [--support FILE]");
      console.log("Checks the official list against the saved snapshot; writes only changed stores or hierarchy data.");
    } else {
      const result = await refreshSnapshot(options);
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
