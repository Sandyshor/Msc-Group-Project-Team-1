// Crib Crew journey planner — click two points on the map, get routes from the FastAPI /route endpoint.
// The backend serves this page (online and on 127.0.0.1:8000), so the API is on the same address ("").
// Only the Vite dev server (npm run dev, port 5173) needs to point at the backend on port 8000.
const API_BASE = location.port === "5173" ? "http://127.0.0.1:8000" : "";
const DUBLIN_CENTRE = [53.3498, -6.2603];
const DUBLIN_BOUNDS = L.latLngBounds([53.24, -6.48], [53.46, -6.0]);
// First view: the city centre and Dublin Airport together
const START_VIEW = [[53.330, -6.300], [53.430, -6.215]];
const START_PADDING = { paddingTopLeft: [30, 90], paddingBottomRight: [30, 70] };  // clear of the hint and legend
const DUBLIN_TZ = "Europe/Dublin";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DRAW_MS = 1100;          // time to draw the whole selected route
const TRAVEL_MS = 6500;        // one lap of the travelling dot

const mapHint = document.getElementById("mapHint");
const mapLegend = document.getElementById("mapLegend");
const amenityStatus = document.getElementById("amenityStatus");
const resetBtn = document.getElementById("routeResetBtn");
const timeType = document.getElementById("timeType");
const timeInput = document.getElementById("timeInput");
const statusBox = document.getElementById("routeStatus");
const errorBox = document.getElementById("routeError");
const resultBox = document.getElementById("routeResult");
const emptyBox = document.getElementById("routeEmpty");
const tabsBox = document.getElementById("routeTabs");
const summaryBox = document.getElementById("routeSummary");
const stepsList = document.getElementById("routeSteps");

const MODE_STYLE = {
  WALK: { label: "Walk", color: "#5f6f67", weight: 5 },
  BICYCLE: { label: "Cycle", color: "#e08a12", weight: 7 },
  BUS: { label: "Bus", color: "#1d63a8", weight: 7 },
  TRAM: { label: "Luas", color: "#2f8f46", weight: 7 },
  RAIL: { label: "Train", color: "#7a3e9d", weight: 7 },
};
const LUAS_RED = "#d0362b";

let startMarker = null;
let endMarker = null;
let itineraries = [];
let queryMode = "transit";
let selected = 0;
let requestSeq = 0;
let inFlight = null;
let traveller = null;
let travelFrame = null;
let travelTimer = null;

// Basemap. Stadia needs no key on localhost/127.0.0.1. Online it only serves domains registered in the
// Stadia dashboard (Authentication Configuration) - no key goes in this file. An unregistered domain gets
// "401 Invalid Authentication" picture tiles, which the fallback below cannot detect.
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const STADIA_ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/attribution/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ' + OSM_ATTRIBUTION;
const BASEMAP = { url: "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png", maxZoom: 20, attribution: STADIA_ATTRIBUTION };
// Used automatically if Stadia refuses the tiles (e.g. the Azure domain isn't registered yet).
const FALLBACK_BASEMAP = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19, attribution: OSM_ATTRIBUTION, className: "tiles-osm" };

const map = L.map("routeMap", { zoomControl: false, zoomSnap: 0.25 }).setView(DUBLIN_CENTRE, 11);
if (REDUCED_MOTION) map.fitBounds(START_VIEW, START_PADDING);
L.control.zoom({ position: "bottomright" }).addTo(map);
let baseLayer = null;
let usingFallback = false;
setBasemap();
const altLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
if (!REDUCED_MOTION) setTimeout(() => map.flyToBounds(START_VIEW, { ...START_PADDING, duration: 1.6 }), 250);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// Google encoded polyline (precision 5), as returned by OTP's legGeometry.points.
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of ["lat", "lng"]) {
      let result = 0, shift = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === "lat") lat += delta; else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// Approximate metres between two [lat, lng] points (fine at city scale).
function metres(a, b) {
  const dy = (b[0] - a[0]) * 110540;
  const dx = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

function formatTime(iso) {
  return iso ? new Intl.DateTimeFormat("en-IE", { timeZone: DUBLIN_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
}

function formatMinutes(minutes) {
  const m = Math.max(1, Math.round(minutes));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function formatDistance(km) {
  return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km.toFixed(1)} km`;
}

// Current Dublin time as a datetime-local value (YYYY-MM-DDTHH:MM).
function dublinNowInputValue() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: DUBLIN_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function legColor(leg) {
  if (leg.mode === "TRAM" && /red/i.test(leg.line || "")) return LUAS_RED;
  return (MODE_STYLE[leg.mode] || MODE_STYLE.BUS).color;
}

function lineLabel(leg) {
  if (leg.mode === "RAIL" && /dart/i.test(leg.line || "")) return "DART";
  const base = (MODE_STYLE[leg.mode] || { label: leg.mode }).label;
  return leg.line ? `${base} ${leg.line}` : base;
}

function placeName(name) {
  if (name === "Destination") return "your destination";
  if (name === "Start") return "your start point";
  return name;
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

// Decoded points per leg, cached on the itinerary.
function legPoints(itinerary) {
  if (!itinerary._points) itinerary._points = itinerary.legs.map(leg => (leg.geometry ? decodePolyline(leg.geometry) : []));
  return itinerary._points;
}

// ---------------------------------------------------------------- basemap
function setBasemap() {
  baseLayer?.remove();
  const cfg = usingFallback ? FALLBACK_BASEMAP : BASEMAP;
  baseLayer = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution, className: cfg.className || "" });
  if (!usingFallback) watchForRefusal(baseLayer);
  baseLayer.addTo(map).bringToBack();
}

// If Stadia rejects every tile (unregistered domain, rate limit), switch to OpenStreetMap so the map still works.
function watchForRefusal(layer) {
  let loaded = 0, failed = 0;
  layer.on("tileload", () => { loaded++; });
  layer.on("tileerror", () => {
    if (++failed >= 4 && loaded === 0 && !usingFallback) {
      usingFallback = true;
      console.warn("Stadia Maps refused the map tiles; using OpenStreetMap instead. Register this site's domain in the Stadia Maps dashboard.");
      setBasemap();
    }
  });
}

// ---------------------------------------------------------------- markers and hint
function pinIcon(label, cls) {
  return L.divIcon({
    className: "",
    html: `<div class="route-pin ${cls}"><i class="pin-pulse"></i><span></span><b>${label}</b></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });
}

function ripple(latlng) {
  if (REDUCED_MOTION) return;
  const marker = L.marker(latlng, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<span class="click-ripple"></span>', iconSize: [0, 0] }) }).addTo(map);
  setTimeout(() => marker.remove(), 700);
}

function setHint(html, loading = false) {
  mapHint.classList.toggle("is-loading", loading);
  mapHint.innerHTML = (loading ? '<span class="spinner" aria-hidden="true"></span>' : "") + html;
  mapHint.classList.remove("hint-swap");
  void mapHint.offsetWidth;  // restart the swap animation
  mapHint.classList.add("hint-swap");
}

function updateHint() {
  if (!startMarker) setHint("Click the map, a 🎓 university or a famous place to set your <strong>start</strong> point");
  else if (!endMarker) setHint("Now click to set your <strong>destination</strong>");
  else setHint("Drag either pin to change the route");
}

function addMarker(latlng, isStart) {
  const marker = L.marker(latlng, {
    draggable: true,
    autoPan: true,
    riseOnHover: true,
    icon: pinIcon(isStart ? "A" : "B", isStart ? "pin-start" : "pin-end"),
    title: isStart ? "Start" : "Destination",
  }).addTo(map);
  marker.on("dragstart", () => marker.getElement()?.classList.add("is-dragging"));
  marker.on("dragend", () => {
    marker.getElement()?.classList.remove("is-dragging");
    ripple(marker.getLatLng());
    planRoute();
  });
  return marker;
}

function choosePoint(latlng) {
  if (!startMarker) {
    ripple(latlng);
    startMarker = addMarker(latlng, true);
  } else if (!endMarker) {
    ripple(latlng);
    endMarker = addMarker(latlng, false);
    planRoute();
  }
  if (!inFlight || !endMarker) updateHint();
}

map.on("click", event => choosePoint(event.latlng));

// ---------------------------------------------------------------- universities and famous places
// Curated, local coordinate lists keep the planner independent of backend commute-data centroids.
// Clicking a marker uses it as the start or destination, or moves the destination there once both
// pins are set. Points within 60 m of each other share a marker.
const universityLayer = L.layerGroup().addTo(map);
const placeLayer = L.layerGroup().addTo(map);
const cityLandmarkLayer = L.layerGroup();

function useLandmark(latlng) {
  if (startMarker && endMarker) {
    endMarker.setLatLng(latlng);
    ripple(latlng);
    planRoute();
  } else {
    choosePoint(latlng);
  }
}

function addLandmarks(list, layer, kind) {
  const groups = [];
  list.forEach(item => {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
    const latlng = L.latLng(item.lat, item.lon);
    const group = groups.find(g => map.distance(g.latlng, latlng) < 60);
    if (group) group.items.push(item);
    else groups.push({ latlng, items: [item] });
  });
  groups.forEach(({ latlng, items }) => {
    const icon = items[0].icon || "🎓";
    const label = items.map(item => escapeHtml(item.name) +
      (item.category && !item.name.includes(item.category)
        ? ` <span class="landmark-category">${escapeHtml(item.category)}</span>` : "")).join("<br>");
    const extra = items.some(item => item.category === "Airport") ? " landmark-airport" : "";
    L.marker(latlng, {
      icon: L.divIcon({ className: "", html: `<div class="landmark landmark-${kind}${extra}" aria-hidden="true">${escapeHtml(icon)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: items.map(item => item.name).join(" / "),
      keyboard: true,
    })
      .bindTooltip(label, { direction: "top", offset: [0, -14], className: "landmark-tooltip" })
      .on("click", () => useLandmark(latlng))
      .addTo(layer);
  });
}

function loadLandmarks(url, layer, kind) {
  fetch(url, { headers: { Accept: "application/json" } })
    .then(response => {
      if (!response.ok) throw new Error(`Could not load map places (${response.status})`);
      return response.json();
    })
    .then(list => {
      if (!Array.isArray(list)) throw new Error("Map places response must be a list");
      addLandmarks(list, layer, kind);
      if (kind === "place") {
        addLandmarks(
          list.filter(item => !["Airport", "Rail station"].includes(item.category)),
          cityLandmarkLayer,
          "landmark",
        );
        if (map.hasLayer(cityLandmarkLayer)) updateAmenities();
      }
    })
    .catch(error => console.error(`Could not load ${kind} locations from ${url}.`, error));
}

loadLandmarks("universities.json", universityLayer, "uni");
loadLandmarks("places.json", placeLayer, "place");

// The supplied OSM CSV is the source of truth for mapped local amenities.
const AMENITY_CATEGORIES = {
  supermarkets: {
    label: "Supermarkets",
    icon: "🛒",
    color: "#2f7b50",
    csvCategory: "Supermarkets",
  },
  groceries: {
    label: "Groceries & convenience",
    icon: "🧺",
    color: "#58835a",
    csvCategory: "Groceries",
  },
  pharmacies: {
    label: "Pharmacies",
    icon: "💊",
    color: "#7054a0",
    csvCategory: "Pharmacies",
  },
  hospitals: {
    label: "Hospitals",
    icon: "🏥",
    color: "#bd4138",
    csvCategory: "Hospitals",
  },
  shopping: {
    label: "Shopping centres",
    icon: "🛍️",
    color: "#bd7627",
    csvCategory: "Shopping_Malls",
  },
  parks: {
    label: "Parks",
    icon: "🌳",
    color: "#4b8550",
    csvCategory: "Parks",
  },
  landmarks: {
    label: "City landmarks",
    icon: "🏛️",
    color: "#a65c3b",
  },
};
const amenityLayers = Object.fromEntries(
  Object.entries(AMENITY_CATEGORIES).map(([key]) => [key, L.layerGroup()]),
);
amenityLayers.landmarks = cityLandmarkLayer;
const amenityOverlayNames = Object.fromEntries(
  Object.entries(AMENITY_CATEGORIES).map(([key, category]) => [`${category.icon} ${category.label}`, amenityLayers[key]]),
);
const overlays = {
  "🎓 Universities": universityLayer,
  "📍 Famous places": placeLayer,
  ...amenityOverlayNames,
};
L.control.layers(null, overlays, {
  position: "topright",
  collapsed: window.matchMedia("(max-width: 650px)").matches,
}).addTo(map);

let amenityRecords = null;
let amenityLoad = null;

function activeAmenityKeys() {
  return Object.keys(AMENITY_CATEGORIES).filter(key => map.hasLayer(amenityLayers[key]));
}

function setAmenityStatus(message = "") {
  amenityStatus.textContent = message;
  amenityStatus.hidden = !message;
  amenityStatus.classList.toggle("is-error", message.startsWith("Could not load"));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      if (row.some(value => value.length)) rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index++;
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value.length)) rows.push(row);
  }
  if (rows.length < 2) throw new Error("Amenities CSV contains no place records");

  const headers = rows[0].map(header => header.trim().replace(/^\uFEFF/, ""));
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  for (const required of ["Area", "name", "category", "latitude", "longitude"]) {
    if (indexes[required] === undefined) throw new Error(`Amenities CSV is missing the ${required} column`);
  }

  return rows.slice(1).map(values => {
    const latitude = Number(values[indexes.latitude]);
    const longitude = Number(values[indexes.longitude]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Amenities CSV contains an invalid latitude or longitude");
    }
    return {
      area: values[indexes.Area],
      name: values[indexes.name],
      category: values[indexes.category],
      latitude,
      longitude,
    };
  });
}

function loadAmenityRecords() {
  if (!amenityLoad) {
    amenityLoad = fetch("amenities_osm.csv", { headers: { Accept: "text/csv" } })
      .then(response => {
        if (!response.ok) throw new Error(`Amenities CSV request failed (${response.status})`);
        return response.text();
      })
      .then(parseCsv)
      .then(records => {
        amenityRecords = records;
        return records;
      })
      .catch(error => {
        amenityLoad = null;
        throw error;
      });
  }
  return amenityLoad;
}

function renderAmenities(keys) {
  keys.forEach(key => amenityLayers[key].clearLayers());
  const bounds = map.getBounds();
  const enabledCsvCategories = new Map(
    keys.filter(key => AMENITY_CATEGORIES[key].csvCategory)
      .map(key => [AMENITY_CATEGORIES[key].csvCategory, key]),
  );
  const seenPlaces = new Set();
  let count = 0;

  amenityRecords.forEach(record => {
    const key = enabledCsvCategories.get(record.category);
    if (
      !key ||
      !DUBLIN_BOUNDS.contains([record.latitude, record.longitude]) ||
      !bounds.contains([record.latitude, record.longitude])
    ) return;
    const category = AMENITY_CATEGORIES[key];
    const name = record.name.trim() || `Unnamed ${category.label.toLowerCase()}`;
    const placeKey = `${key}|${name.toLocaleLowerCase()}|${record.latitude.toFixed(5)}|${record.longitude.toFixed(5)}`;
    if (seenPlaces.has(placeKey)) return;
    seenPlaces.add(placeKey);

    const icon = L.divIcon({
      className: "amenity-marker-icon",
      html: `<span class="amenity-marker amenity-${key}" aria-hidden="true">${category.icon}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    const latlng = L.latLng(record.latitude, record.longitude);
    const marker = L.marker(latlng, {
      icon,
      title: `${name} · ${category.label} · ${record.area}`,
      keyboard: true,
    })
      .bindTooltip(`${escapeHtml(name)}<small>${escapeHtml(category.label)} · ${escapeHtml(record.area)}</small>`, {
        direction: "top",
        offset: [0, -14],
        className: "landmark-tooltip amenity-tooltip",
      })
      .on("click", () => useLandmark(latlng));

    marker.addTo(amenityLayers[key]);
    count++;
  });
  return count;
}

async function updateAmenities() {
  const keys = activeAmenityKeys();
  if (!keys.length) {
    Object.values(amenityLayers).forEach(layer => layer.clearLayers());
    setAmenityStatus();
    return;
  }
  if (keys.every(key => !AMENITY_CATEGORIES[key].csvCategory)) {
    setAmenityStatus(`Showing ${cityLandmarkLayer.getLayers().length} curated city landmarks.`);
    return;
  }
  if (map.getZoom() < 12) {
    keys.filter(key => AMENITY_CATEGORIES[key].csvCategory)
      .forEach(key => amenityLayers[key].clearLayers());
    setAmenityStatus("Zoom in to level 12 to see local amenities.");
    return;
  }
  if (!amenityRecords) setAmenityStatus("Loading local amenities from amenities_osm.csv…");
  try {
    if (!amenityRecords) await loadAmenityRecords();
    const currentKeys = activeAmenityKeys();
    const count = renderAmenities(currentKeys);
    const csvCategories = currentKeys.map(key => AMENITY_CATEGORIES[key].csvCategory).filter(Boolean);
    const csvCount = amenityRecords.filter(record => csvCategories.includes(record.category)).length;
    setAmenityStatus(`Showing ${count} places in this map view (${csvCount} matching CSV records). Source: amenities_osm.csv, based on OpenStreetMap data.`);
  } catch (error) {
    console.error("Could not load nearby places from amenities_osm.csv.", error);
    setAmenityStatus("Could not load amenities_osm.csv. Check the planner data file and reload.");
  }
}

map.on("overlayadd overlayremove", event => {
  if (Object.values(amenityLayers).includes(event.layer)) updateAmenities();
});
map.on("moveend", updateAmenities);

// ---------------------------------------------------------------- panel states
function showLoading() {
  statusBox.innerHTML = `
    <div class="skeleton-tabs"><span></span><span></span><span></span></div>
    <div class="skeleton-grid">${"<span></span>".repeat(6)}</div>
    <div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div>`;
  statusBox.hidden = false;
  setHint("Finding the best routes…", true);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearMessages() {
  statusBox.hidden = true;
  statusBox.innerHTML = "";
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function clearRoute() {
  stopTraveller();
  routeLayer.clearLayers();
  altLayer.clearLayers();
  itineraries = [];
  resultBox.hidden = true;
  mapLegend.hidden = true;
  tabsBox.innerHTML = "";
  summaryBox.innerHTML = "";
  stepsList.innerHTML = "";
}

function errorMessage(status, detail) {
  const code = detail?.code;
  const message = typeof detail === "string" ? detail : detail?.message;
  if (code === "OUTSIDE_DUBLIN") return `${message} Drag the pin back inside the Dublin area.`;
  if (code === "NO_ROUTE") return `No route found. ${message} Try a different time or travel mode.`;
  if (code === "OTP_UNAVAILABLE") return "The journey planner is offline — OpenTripPlanner isn't running or isn't reachable. Start it and try again.";
  if (code === "OTP_ERROR") return message;
  if (Array.isArray(detail)) return detail.map(item => item?.msg).filter(Boolean).join(", ");
  return message || `The route request failed (${status}).`;
}

async function planRoute() {
  if (!startMarker || !endMarker) return;
  const seq = ++requestSeq;
  inFlight?.abort();
  inFlight = new AbortController();

  const from = startMarker.getLatLng();
  const to = endMarker.getLatLng();
  const params = new URLSearchParams({
    from_lat: from.lat.toFixed(6), from_lon: from.lng.toFixed(6),
    to_lat: to.lat.toFixed(6), to_lon: to.lng.toFixed(6),
    mode: currentMode(),
  });
  if (timeType.value !== "now" && timeInput.value) {
    params.set("when", timeInput.value);
    params.set("arrive_by", String(timeType.value === "arrive"));
  }

  clearMessages();
  clearRoute();
  emptyBox.hidden = true;
  showLoading();

  try {
    const response = await fetch(`${API_BASE}/route?${params}`, { headers: { Accept: "application/json" }, signal: inFlight.signal });
    const payload = await response.json().catch(() => null);
    if (seq !== requestSeq) return;
    if (!response.ok) throw new Error(errorMessage(response.status, payload?.detail));
    if (!payload || !Array.isArray(payload.itineraries) || !payload.itineraries.length) {
      throw new Error("The backend returned an empty response. Check the FastAPI terminal.");
    }
    clearMessages();
    itineraries = payload.itineraries;
    queryMode = payload.query.mode;
    selected = 0;
    renderTabs();
    renderItinerary();
    resultBox.hidden = false;
    updateHint();
  } catch (error) {
    if (error.name === "AbortError" || seq !== requestSeq) return;
    clearMessages();
    updateHint();
    showError(error instanceof TypeError
      ? `Can't reach the Crib Crew server at ${API_BASE || location.origin}. Make sure the backend is running.`
      : error.message);
  } finally {
    if (seq === requestSeq) inFlight = null;
  }
}

// ---------------------------------------------------------------- tabs, summary, steps
function tabLabel(itinerary) {
  if (queryMode === "walk") return "Walk";
  if (queryMode === "bike") return "Bike";
  if (itinerary.walk_only) return "Walk only";
  return itinerary.legs.filter(leg => leg.mode !== "WALK").map(lineLabel).join(" → ");
}

function tabChips(itinerary) {
  const legs = itinerary.legs.filter(leg => leg.mode !== "WALK");
  if (!legs.length) return `<i class="chip chip-walk" style="--c:${MODE_STYLE.WALK.color}">Walk</i>`;
  return legs.map(leg => `<i class="chip" style="--c:${legColor(leg)}">${escapeHtml(leg.mode === "BICYCLE" ? "Bike" : (leg.line || lineLabel(leg)))}</i>`).join("");
}

function renderTabs() {
  tabsBox.innerHTML = itineraries.map((itinerary, i) => `
    <button type="button" role="tab" class="route-tab" data-index="${i}" aria-selected="${i === selected}" style="--i:${i}" title="${escapeHtml(tabLabel(itinerary))}">
      <strong>${escapeHtml(formatMinutes(itinerary.total_minutes))}</strong>
      <span class="tab-chips">${tabChips(itinerary)}</span>
      <span class="tab-label">${escapeHtml(tabLabel(itinerary))}</span>
    </button>`).join("");
}

function selectItinerary(index) {
  if (index === selected || !itineraries[index]) return;
  selected = index;
  tabsBox.querySelectorAll(".route-tab").forEach(btn => btn.setAttribute("aria-selected", String(Number(btn.dataset.index) === selected)));
  renderItinerary();
}

tabsBox.addEventListener("click", event => {
  const tab = event.target.closest(".route-tab");
  if (tab) selectItinerary(Number(tab.dataset.index));
});

function stepText(leg) {
  const to = escapeHtml(placeName(leg.to));
  if (leg.mode === "WALK") return `Walk ${formatDistance(leg.distance_km)} to <strong>${to}</strong>`;
  if (leg.mode === "BICYCLE") return `Cycle ${formatDistance(leg.distance_km)} to <strong>${to}</strong>`;
  return `<strong>${escapeHtml(lineLabel(leg))}</strong> for ${formatMinutes(leg.minutes)} to <strong>${to}</strong>`;
}

function stepDetail(leg) {
  if (leg.mode === "WALK" || leg.mode === "BICYCLE") return `${formatMinutes(leg.minutes)}`;
  const towards = leg.headsign ? ` towards ${escapeHtml(leg.headsign)}` : "";
  return `Board at ${escapeHtml(leg.from)} at ${formatTime(leg.departure)}${towards} · ${formatDistance(leg.distance_km)}`;
}

function renderPanel(itinerary) {
  summaryBox.innerHTML = [
    ["Total time", formatMinutes(itinerary.total_minutes)],
    ["Distance", formatDistance(itinerary.total_distance_km)],
    ["Walking", formatDistance(itinerary.walking_km)],
    ["Transfers", String(itinerary.transfers)],
    ["Leave", formatTime(itinerary.departure)],
    ["Arrive", formatTime(itinerary.arrival)],
  ].map(([label, value], i) => `<div style="--i:${i}"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

  stepsList.innerHTML = itinerary.legs.map((leg, i) => `
    <li class="route-step${leg.mode === "WALK" ? " is-walk" : ""}" style="--leg-color: ${legColor(leg)}; --i:${i}">
      <span class="step-dot" aria-hidden="true"></span>
      <div><p>${stepText(leg)}</p><small>${stepDetail(leg)}</small></div>
      <time>${formatTime(leg.departure)}</time>
    </li>`).join("");
}

// ---------------------------------------------------------------- map drawing
function drawAlternatives() {
  altLayer.clearLayers();
  itineraries.forEach((itinerary, i) => {
    if (i === selected) return;
    const points = legPoints(itinerary).flat();
    if (!points.length) return;
    L.polyline(points, { color: "#ffffff", weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(altLayer);
    L.polyline(points, { color: "#8d9a93", weight: 6, opacity: 0.75, lineCap: "round", lineJoin: "round", className: "route-alt" })
      .bindTooltip(`${formatMinutes(itinerary.total_minutes)} · ${escapeHtml(tabLabel(itinerary))} — click to choose`, { sticky: true, className: "route-tooltip" })
      .on("click", event => { L.DomEvent.stopPropagation(event); selectItinerary(i); })
      .addTo(altLayer);
  });
}

// Animate a path drawing itself on. pathLength="1" keeps the dash maths valid while Leaflet re-projects on zoom.
function animateDraw(layer, delay, duration) {
  const el = layer.getElement();
  if (!el || REDUCED_MOTION) return;
  el.setAttribute("pathLength", "1");
  el.style.strokeDasharray = "1";
  el.style.strokeDashoffset = "1";
  el.style.animation = `route-draw ${duration}ms cubic-bezier(.45,.05,.35,1) ${delay}ms forwards`;
}

function animateFade(layer, delay, duration) {
  const el = layer.getElement();
  if (!el || REDUCED_MOTION) return;
  el.style.opacity = "0";
  el.style.animation = `route-fade ${duration}ms ease ${delay}ms forwards`;
}

function renderItinerary() {
  const itinerary = itineraries[selected];
  if (!itinerary) return;
  renderPanel(itinerary);
  drawAlternatives();
  stopTraveller();
  routeLayer.clearLayers();

  const pointsByLeg = legPoints(itinerary);
  const lengths = pointsByLeg.map(pts => pts.slice(1).reduce((sum, p, k) => sum + metres(pts[k], p), 0));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const bounds = L.latLngBounds([startMarker.getLatLng(), endMarker.getLatLng()]);
  let delay = 0;

  itinerary.legs.forEach((leg, i) => {
    const points = pointsByLeg[i];
    if (!points.length) return;
    const color = legColor(leg);
    const style = MODE_STYLE[leg.mode] || MODE_STYLE.BUS;
    const duration = Math.max(160, (lengths[i] / total) * DRAW_MS);
    const tooltip = leg.mode === "WALK" ? `Walk ${formatDistance(leg.distance_km)} · ${formatMinutes(leg.minutes)}` : `${lineLabel(leg)} · ${formatMinutes(leg.minutes)}`;

    if (leg.mode === "WALK") {
      const dots = L.polyline(points, { color, weight: style.weight, opacity: 0.95, dashArray: "0.1 10", lineCap: "round", lineJoin: "round" })
        .bindTooltip(tooltip, { sticky: true, className: "route-tooltip" }).addTo(routeLayer);
      animateFade(dots, delay, duration);
    } else {
      const casing = L.polyline(points, { color: "#ffffff", weight: style.weight + 5, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
      const glow = L.polyline(points, { color, weight: style.weight + 10, opacity: 0.16, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
      const line = L.polyline(points, { color, weight: style.weight, opacity: 1, lineCap: "round", lineJoin: "round" })
        .bindTooltip(tooltip, { sticky: true, className: "route-tooltip" }).addTo(routeLayer);
      [casing, glow, line].forEach(layer => animateDraw(layer, delay, duration));

      if (leg.mode !== "BICYCLE") {
        [[points[0], leg.from, delay], [points[points.length - 1], leg.to, delay + duration]].forEach(([point, name, at]) => {
          L.marker(point, {
            keyboard: false,
            icon: L.divIcon({ className: "", html: `<span class="stop-dot" style="--c:${color}; --d:${Math.round(at)}ms"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
          }).bindTooltip(escapeHtml(name), { className: "route-tooltip", direction: "top", offset: [0, -8] }).addTo(routeLayer);
        });
      }
    }
    points.forEach(p => bounds.extend(p));
    delay += duration;
  });

  mapLegend.hidden = false;
  if (REDUCED_MOTION) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  else map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 16, duration: 0.9 });
  travelTimer = setTimeout(() => startTraveller(itinerary, pointsByLeg), REDUCED_MOTION ? 0 : delay + 300);
}

// ---------------------------------------------------------------- travelling dot
function startTraveller(itinerary, pointsByLeg) {
  if (REDUCED_MOTION) return;
  const track = [];  // {p, d (cumulative metres), color}
  let distance = 0;
  pointsByLeg.forEach((points, i) => {
    const color = legColor(itinerary.legs[i]);
    points.forEach(p => {
      if (track.length) distance += metres(track[track.length - 1].p, p);
      track.push({ p, d: distance, color });
    });
  });
  if (track.length < 2 || distance === 0) return;

  traveller = L.marker(track[0].p, {
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
    icon: L.divIcon({ className: "", html: '<span class="traveller"><i></i></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  }).addTo(routeLayer);
  const el = traveller.getElement()?.querySelector(".traveller");
  const startedAt = performance.now();
  let k = 0;

  const step = now => {
    const t = ((now - startedAt) % (TRAVEL_MS + 900)) / TRAVEL_MS;  // short pause at the destination
    const eased = t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const target = eased * distance;
    if (target < track[k].d) k = 0;
    while (k < track.length - 2 && track[k + 1].d < target) k++;
    const a = track[k], b = track[k + 1];
    const f = b.d > a.d ? (target - a.d) / (b.d - a.d) : 0;
    traveller.setLatLng([a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f]);
    el?.style.setProperty("--c", b.color);
    travelFrame = requestAnimationFrame(step);
  };
  travelFrame = requestAnimationFrame(step);
}

function stopTraveller() {
  clearTimeout(travelTimer);
  cancelAnimationFrame(travelFrame);
  traveller?.remove();
  traveller = null;
}

// ---------------------------------------------------------------- controls
function resetRoute() {
  requestSeq++;
  inFlight?.abort();
  inFlight = null;
  startMarker?.remove();
  endMarker?.remove();
  startMarker = endMarker = null;
  clearRoute();
  clearMessages();
  emptyBox.hidden = false;
  updateHint();
}

resetBtn.addEventListener("click", resetRoute);
document.querySelectorAll('input[name="mode"]').forEach(radio => radio.addEventListener("change", planRoute));
timeType.addEventListener("change", () => {
  timeInput.hidden = timeType.value === "now";
  if (!timeInput.hidden && !timeInput.value) timeInput.value = dublinNowInputValue();
  planRoute();
});
timeInput.addEventListener("change", planRoute);
updateHint();
