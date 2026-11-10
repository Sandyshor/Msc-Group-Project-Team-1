// "Getting there" on the results page: an interactive Stadia map from a match to the university.
// By default the trip starts at the match's neighbourhood centre (times and distance from the recommender).
// Click anywhere (or drag pin A) to start from that spot instead: the route, time and distance come from the
// journey planner (GET /route, OpenTripPlanner); if it isn't reachable, the straight-line distance is shown
// with an estimated time. "Back to …" returns to the neighbourhood centre.
//
// By public transport the student can switch between the fastest trip and a trip by bus (often the fastest is
// the Luas or a train). Around the start the map names the nearest Luas stop and train station, the bus stops
// whose buses go to the university (with their route numbers), and the student residences in the area.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { streetName } from '../District Profile/placeNames'

// '' = same address as the website (Azure serves both); unset = the Render API.
const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'

// recommender travel mode -> /route mode
const ROUTE_MODES = { public_transport: 'transit', walk: 'walk', cycle: 'bike' }
const MODE_WORDS = { public_transport: 'by public transport', walk: 'on foot', cycle: 'by bike' }
// rough door-to-door speeds for the estimate when no route is available (km/h, along roads ≈ 1.3 × straight line)
const SPEED_KMH = { public_transport: 16, walk: 4.8, cycle: 14 }
const LEG_COLOURS = { WALK: '#5f6f67', BICYCLE: '#a8753f', TRAM: '#2f8f46', RAIL: '#7a3e9d', BUS: '#1d63a8' }
const TRANSIT_COLOUR = '#173f32'
const LUAS_COLOURS = { 'Luas Red Line': '#e0312b', 'Luas Green Line': '#00a651' }
// how far around the start the map looks for stops and residences
const STATION_M = 1500
const BUS_STOP_M = 450
const UNI_STOP_M = 700 // big campuses (DCU, UCD) have their stops at the edges
const RESIDENCE_M = 1500
// route animation, as in the District Profile journey planner: legs draw in turn, then a dot travels the trip
const DRAW_MS = 1100
const TRAVEL_MS = 6500
const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Same basemap as the district map and the journey planner (Stadia; OpenStreetMap if Stadia refuses)
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
const STADIA = {
  url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', maxZoom: 20,
  attribution: `&copy; <a href="https://stadiamaps.com/attribution/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ${OSM_ATTRIBUTION}`,
}
const OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_ATTRIBUTION }

// Nearby transport and residences (same files as the district map)
const BIKES_INFO_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_information.json'
const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json'
const RESIDENCES_URL = '/data/student-residences.json'
const jsonCache = {}
const getJson = (url) => (jsonCache[url] ??= fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => { delete jsonCache[url]; return null }))
const naturalSort = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const BUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a2 2 0 0 1 2 2V16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16V5.5a2 2 0 0 1 2-2Z" fill="#173f37"/><path d="M6 6h12v5.5H6z" fill="#fff"/><circle cx="8" cy="14.5" r="1.3" fill="#ffd34d"/><circle cx="16" cy="14.5" r="1.3" fill="#ffd34d"/></svg>'

// Google encoded polyline (precision 5), as returned by OTP's legGeometry.points - as in the journey planner.
function decodePolyline(encoded) {
  const points = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng']) {
      let result = 0
      let shift = 0
      let byte
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 'lat') lat += delta
      else lng += delta
    }
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

// The commute times are for arriving by 9am on a weekday, so the route is planned the same way
function nextWeekdayNine() {
  const day = new Date()
  do day.setDate(day.getDate() + 1)
  while (day.getDay() === 0 || day.getDay() === 6)
  const pad = (n) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T09:00`
}

function km(a, b) {
  const R = 6371, r = Math.PI / 180
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
const fmtKm = (v) => (v == null ? '' : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`)

const pinIcon = (className, label) => L.divIcon({
  className: 'route-pin-wrap', html: `<span class="route-pin ${className}">${label}</span>`, iconSize: [32, 32], iconAnchor: [16, 16],
})
// Labels that are always shown can't overlap on a small map: keep the most useful one where two collide
// (where you get on/off, then the Luas/train station, then bus stops); the rest show on hover.
const TIP_ORDER = ['rm-board-tip', 'rm-station-tip', 'rm-bus-tip']
function declutterTips(box) {
  if (!box) return
  const tips = [...box.querySelectorAll('.leaflet-tooltip.rm-perm')]
  tips.forEach((t) => t.classList.remove('rm-tip-hidden'))
  const rank = (t) => TIP_ORDER.findIndex((c) => t.classList.contains(c))
  const kept = []
  tips.sort((a, b) => rank(a) - rank(b)).forEach((t) => {
    const r = t.getBoundingClientRect()
    if (kept.some((q) => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top)) t.classList.add('rm-tip-hidden')
    else kept.push(r)
  })
}
const ctxIcon = (html, size = 24) => L.divIcon({ className: 'rm-ctx', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })

// what the bus/fastest buttons say: "Luas Green", "Bus 11 → 46A"
function rideWords(itinerary) {
  const rides = itinerary.legs.filter((leg) => leg.mode !== 'WALK' && leg.mode !== 'BICYCLE')
  if (!rides.length) return 'Walk'
  return rides.map(rideName).join(' → ')
}
// a leg's name for people: "Bus 39A", "Luas Green", "DART", "Train" (not the timetable's long line names)
function rideName(leg) {
  if (leg.mode === 'BUS') return `Bus ${leg.line || ''}`.trim()
  if (leg.mode === 'TRAM') return `Luas ${leg.line || ''}`.trim()
  if (leg.mode === 'RAIL') return /dart/i.test(leg.line || '') ? 'DART' : 'Train'
  return leg.line || leg.mode
}
const isAllBus = (itinerary) => {
  const rides = itinerary.legs.filter((leg) => leg.mode !== 'WALK')
  return rides.length > 0 && rides.every((leg) => leg.mode === 'BUS')
}

function RouteMap({ fromLat, fromLon, fromName, toLat, toLon, toName, area, mode, defaultMinutes, defaultKm, defaultWords }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null) // the trip
  const ctxRef = useRef(null) // stops and residences around it
  const startRef = useRef(null)
  const [start, setStart] = useState(null) // null = the neighbourhood centre; else { lat, lng, name }
  const [plans, setPlans] = useState(null) // { fastest, bus } itineraries from the journey planner, or null
  const [choice, setChoice] = useState('fastest')
  const [trip, setTrip] = useState({ status: 'idle' }) // route for a picked start: minutes, km, estimate?
  const [near, setNear] = useState(null) // nearby transport: stations, bus stops (both ends), bike docks
  const [homes, setHomes] = useState([]) // student residences around the start
  const animRef = useRef({ timer: null, frame: null, traveller: null })

  function stopTraveller() {
    const a = animRef.current
    clearTimeout(a.timer)
    cancelAnimationFrame(a.frame)
    a.traveller?.remove()
    a.traveller = null
  }

  // draw a line in from start to end (SVG stroke trick), starting after `delay` ms
  function animateDraw(layer, delay, duration) {
    const node = layer.getElement()
    if (!node || REDUCED_MOTION) return
    node.setAttribute('pathLength', '1')
    node.style.strokeDasharray = '1'
    node.style.strokeDashoffset = '1'
    node.style.animation = `route-draw ${duration}ms cubic-bezier(.45,.05,.35,1) ${delay}ms forwards`
  }
  function animateFade(layer, delay, duration) {
    const node = layer.getElement()
    if (!node || REDUCED_MOTION) return
    node.style.opacity = '0'
    node.style.animation = `route-fade ${duration}ms ease ${delay}ms forwards`
  }

  // a pulsing dot that travels the whole trip on a loop, taking each leg's colour
  function startTraveller(lines) {
    if (REDUCED_MOTION || !layerRef.current) return
    const track = []
    let distance = 0
    lines.forEach(({ points, colour }) => points.forEach((p) => {
      if (track.length) distance += km(track[track.length - 1].p, p)
      track.push({ p, d: distance, colour })
    }))
    if (track.length < 2 || distance === 0) return
    const a = animRef.current
    a.traveller = L.marker(track[0].p, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<span class="route-traveller"><i></i></span>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(layerRef.current)
    const node = a.traveller.getElement()?.querySelector('.route-traveller')
    const startedAt = performance.now()
    let k = 0
    const step = (now) => {
      const t = ((now - startedAt) % (TRAVEL_MS + 900)) / TRAVEL_MS
      const eased = t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      const target = eased * distance
      if (target < track[k].d) k = 0
      while (k < track.length - 2 && track[k + 1].d < target) k++
      const p = track[k], q = track[k + 1]
      const f = q.d > p.d ? (target - p.d) / (q.d - p.d) : 0
      a.traveller.setLatLng([p.p[0] + (q.p[0] - p.p[0]) * f, p.p[1] + (q.p[1] - p.p[1]) * f])
      node?.style.setProperty('--c', q.colour)
      a.frame = requestAnimationFrame(step)
    }
    a.frame = requestAnimationFrame(step)
  }

  // the map, once
  useEffect(() => {
    const map = L.map(boxRef.current, { scrollWheelZoom: false, zoomControl: false, attributionControl: false })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    let base = null
    let fallback = false
    const setBase = () => {
      base?.remove()
      const cfg = fallback ? OSM : STADIA
      base = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution }).addTo(map)
      if (!fallback) {
        let ok = 0, bad = 0
        base.on('tileload', () => { ok++ })
        base.on('tileerror', () => { if (++bad >= 4 && !ok && !fallback) { fallback = true; setBase() } })
      }
    }
    setBase()
    // wheel zoom only after the map is clicked, so scrolling the page doesn't zoom it by accident
    map.on('focus click', () => map.scrollWheelZoom.enable())
    map.on('blur mouseout', () => map.scrollWheelZoom.disable())
    map.on('click', (event) => setStart({ lat: event.latlng.lat, lng: event.latlng.lng, name: 'Point on the map', lookup: true }))
    // stop and residence names show from street level, so the wider view stays readable
    const zoomClass = () => boxRef.current?.classList.toggle('rm-near', map.getZoom() >= 15)
    map.on('zoomend', zoomClass)
    let tidy
    map.on('zoomend moveend', () => { clearTimeout(tidy); tidy = setTimeout(() => declutterTips(boxRef.current), 60) })
    mapRef.current = map
    ctxRef.current = L.layerGroup().addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    return () => { stopTraveller(); map.remove(); mapRef.current = null }
  }, [])

  // a new match: back to its centre
  useEffect(() => { setStart(null) }, [fromLat, fromLon])

  // name a picked spot by its street (same address lookup as the district map)
  useEffect(() => {
    if (!start?.lookup) return undefined
    let live = true
    streetName(start.lat, start.lng).then((name) => {
      if (live && name) setStart((s) => (s && s.lat === start.lat && s.lng === start.lng ? { ...s, name, lookup: false } : s))
    })
    return () => { live = false }
  }, [start?.lat, start?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const from = start ? [start.lat, start.lng] : [fromLat, fromLon]
  const to = [toLat, toLon]
  const fromLabel = start ? start.name : fromName

  function draw(lines, { fit = true, animate = true } = {}) {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    stopTraveller()
    layer.clearLayers()
    const lengths = lines.map(({ points }) => points.slice(1).reduce((sum, p, i) => sum + km(points[i], p), 0))
    const total = lengths.reduce((x, y) => x + y, 0) || 1
    let delay = 0
    lines.forEach(({ points, colour, dashed, stops, line }, i) => {
      const duration = Math.max(160, (lengths[i] / total) * DRAW_MS)
      if (dashed) {
        const dots = L.polyline(points, { color: colour, weight: 5, opacity: 0.95, dashArray: '0.1 10', lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
        if (animate) animateFade(dots, delay, duration)
      } else {
        const casing = L.polyline(points, { color: '#ffffff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
        const glow = L.polyline(points, { color: colour, weight: 16, opacity: 0.16, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
        const polyline = L.polyline(points, { color: colour, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
        if (animate) [casing, glow, polyline].forEach((l) => animateDraw(l, delay, duration))
        // where you get on and off: named stop rings that pop in as the line reaches them
        if (stops) {
          [[points[0], stops[0], delay, 'Get on'], [points[points.length - 1], stops[1], delay + duration, 'Get off']].forEach(([point, name, at, verb]) => {
            const m = L.marker(point, { keyboard: false, zIndexOffset: 300, icon: L.divIcon({ className: '', html: `<span class="route-stop-dot" style="--c:${colour}; --d:${animate ? Math.round(at) : 0}ms"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(layer)
            if (name) m.bindTooltip(`<b>${verb}${line ? ` · ${escapeHtml(line)}` : ''}</b><br>${escapeHtml(name)}`, { direction: 'top', offset: [0, -8], permanent: true, className: 'rm-board-tip rm-perm' })
          })
        }
      }
      delay += duration
    })
    const a = L.marker(from, { icon: pinIcon('route-pin-from', 'A'), draggable: true, title: `${fromLabel} (drag to move)`, zIndexOffset: 500 })
      .bindTooltip(`${escapeHtml(fromLabel)}<br><small>Drag or click the map to start elsewhere</small>`, { direction: 'top', offset: [0, -14] })
      .on('dragend', () => { const p = a.getLatLng(); setStart({ lat: p.lat, lng: p.lng, name: 'Point on the map', lookup: true }) })
      .addTo(layer)
    startRef.current = a
    L.marker(to, { icon: pinIcon('route-pin-to', 'B'), title: toName, zIndexOffset: 400 }).bindTooltip(escapeHtml(toName), { direction: 'top', offset: [0, -14] }).addTo(layer)
    if (fit) {
      const all = lines.flatMap((l) => l.points)
      map.fitBounds(L.latLngBounds(all.length ? all : [from, to]), { padding: [36, 36], maxZoom: 15 })
    }
    if (animate) animRef.current.timer = setTimeout(() => startTraveller(lines), REDUCED_MOTION ? 0 : delay + 300)
    setTimeout(() => declutterTips(boxRef.current), animate && !REDUCED_MOTION ? delay + 80 : 80)
  }

  const linesOf = (itinerary) => itinerary.legs.filter((leg) => leg.geometry).map((leg) => ({
    points: decodePolyline(leg.geometry),
    colour: LEG_COLOURS[leg.mode] ?? TRANSIT_COLOUR,
    dashed: leg.mode === 'WALK',
    stops: leg.mode !== 'WALK' && leg.mode !== 'BICYCLE' ? [leg.from, leg.to] : null,
    line: rideName(leg),
  }))

  // ask the journey planner for the trip (by public transport also for a trip by bus) when the ends change
  useEffect(() => {
    const controller = new AbortController()
    const straightKm = km(from, to)
    draw([{ points: [from, to], colour: '#9aa79f', dashed: true }], { animate: false })
    setPlans(null)
    setChoice('fastest')
    if (start) setTrip({ status: 'loading' })
    const ask = (routeMode) => fetch(`${API_URL}/route?${new URLSearchParams({
      from_lat: from[0], from_lon: from[1], to_lat: to[0], to_lon: to[1],
      mode: routeMode, when: nextWeekdayNine(), arrive_by: 'true',
    })}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((plan) => [...plan.itineraries].sort((x, y) => x.total_minutes - y.total_minutes)[0])
    const busToo = mode === 'public_transport'
    Promise.all([ask(ROUTE_MODES[mode]), busToo ? ask('bus').catch((e) => { if (e.name === 'AbortError') throw e; return null }) : null])
      .then(([fastest, bus]) => {
        if (!fastest?.legs?.some((leg) => leg.geometry)) throw new Error('no route line')
        // the bus button only when it is a different trip (and really a bus trip)
        const busPlan = bus && !isAllBus(fastest) && isAllBus(bus) ? bus : null
        setPlans({ fastest, bus: busPlan })
        if (start) setTrip({ status: 'done' })
        else setTrip({ status: 'idle', routeShown: true })
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        draw([{ points: [from, to], colour: TRANSIT_COLOUR }], { fit: false })
        // no route service: straight-line distance and an estimated time
        const road = straightKm * 1.3
        if (start) setTrip({ status: 'estimate', km: straightKm, minutes: Math.max(1, Math.round((road / SPEED_KMH[mode]) * 60 + (mode === 'public_transport' ? 8 : 0))) })
        else setTrip({ status: 'idle', routeShown: false })
      })
    return () => controller.abort()
  }, [start?.lat, start?.lng, fromLat, fromLon, toLat, toLon, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = plans ? (choice === 'bus' && plans.bus ? plans.bus : plans.fastest) : null
  // draw the chosen trip
  useEffect(() => { if (chosen) draw(linesOf(chosen)) }, [chosen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nearby transport and residences, drawn around the start: the nearest Luas stop and train station, the bus
  // stops whose buses also stop near the university, and the student residences in the area
  useEffect(() => {
    let live = true
    setNear(null)
    const metres = (a, b) => Math.round(km(a, b) * 1000)
    getJson(RESIDENCES_URL).then((d) => {
      if (!live) return
      const list = (d?.residences || []).map((r) => ({ ...r, m: metres(from, [r.lat, r.lon]) }))
        .filter((r) => r.m <= RESIDENCE_M || (area && r.district === area))
        .sort((a, b) => a.m - b.m)
      setHomes(list)
    })
    if (mode === 'public_transport') {
      Promise.all([
        getJson('/data/luas-red-stops.geojson'), getJson('/data/luas-green-stops.geojson'),
        getJson('/data/dublin-rail-stations.geojson'), getJson('/data/dublin-bus-stops.geojson'),
      ]).then(([redStops, greenStops, railStations, bus]) => {
        if (!live) return
        const stations = []
        ;[[redStops, 'Luas Red Line'], [greenStops, 'Luas Green Line']].forEach(([gj, label]) => (gj?.features || []).forEach((f) => {
          const [lng, lat] = f.geometry.coordinates
          stations.push({ name: f.properties.name, kind: label, lat, lng, m: metres(from, [lat, lng]) })
        }))
        ;(railStations?.features || []).forEach((f) => {
          const [lng, lat] = f.geometry.coordinates
          stations.push({ name: f.properties.name, kind: f.properties.dart ? 'DART' : 'Train', lat, lng, m: metres(from, [lat, lng]) })
        })
        // only the buses that go to the university: a route with a stop within 450 m of the start AND of the university
        const stopsAtStart = []
        const stopsAtUni = []
        ;(bus?.features || []).forEach((f) => {
          if (!f.properties.routes) return
          const [lng, lat] = f.geometry.coordinates
          const routes = f.properties.routes.split(';').map((r) => r.trim()).filter((v) => v && !/^(none|n\/a|unknown)$/i.test(v))
          if (!routes.length) return
          const mStart = metres(from, [lat, lng])
          const mUni = metres(to, [lat, lng])
          const stop = { name: f.properties.name, ref: f.properties.ref, lat, lng, routes }
          if (mStart <= BUS_STOP_M) stopsAtStart.push({ ...stop, m: mStart })
          if (mUni <= UNI_STOP_M) stopsAtUni.push({ ...stop, m: mUni })
        })
        const atUni = new Set(stopsAtUni.flatMap((s) => s.routes))
        const atStart = new Set(stopsAtStart.flatMap((s) => s.routes))
        const direct = [...atStart].filter((r) => atUni.has(r)).sort(naturalSort)
        const directSet = new Set(direct)
        // near the start: the three nearest stops, whatever their buses (the ones to the university marked);
        // near the university: the stops of those direct buses
        const withDirect = (st) => ({ ...st, routes: [...st.routes].sort(naturalSort), direct: st.routes.filter((r) => directSet.has(r)).sort(naturalSort) })
        const nearStart = stopsAtStart.map(withDirect).sort((a, b) => a.m - b.m).slice(0, 3)
        const nearUni = stopsAtUni.map(withDirect).filter((st) => st.direct.length).sort((a, b) => a.m - b.m).slice(0, 2)
        const sorted = stations.sort((a, b) => a.m - b.m)
        const luas = sorted.find((s) => s.kind.startsWith('Luas'))
        const rail = sorted.find((s) => !s.kind.startsWith('Luas'))
        setNear({
          kind: 'transit', busRoutes: direct,
          busStops: nearStart, uniStops: nearUni,
          luas: luas && luas.m <= STATION_M ? luas : null,
          rail: rail && rail.m <= STATION_M ? rail : null,
          station: sorted[0],
        })
      })
    } else if (mode === 'cycle') {
      Promise.all([getJson(BIKES_INFO_URL), fetch(BIKES_STATUS_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)]).then(([info, status]) => {
        if (!live || !info) return
        const live_ = Object.fromEntries((status?.data?.stations || []).map((x) => [String(x.station_id), x]))
        const docks = (info.data?.stations || []).map((d) => {
          const st = live_[String(d.station_id)]
          return { name: d.name.toLowerCase().replace(/(^|[\s'(-])\S/g, (c) => c.toUpperCase()), lat: d.lat, lng: d.lon, bikes: st?.num_bikes_available, stands: st?.num_docks_available }
        })
        const closest = (p) => docks.map((d) => ({ ...d, m: metres(p, [d.lat, d.lng]) })).sort((a, b) => a.m - b.m)[0]
        setNear({ kind: 'bikes', a: closest(from), b: closest(to) })
      })
    }
    return () => { live = false }
  }, [mode, start?.lat, start?.lng, fromLat, fromLon, toLat, toLon, area]) // eslint-disable-line react-hooks/exhaustive-deps

  // draw the stops and residences
  useEffect(() => {
    const layer = ctxRef.current
    if (!layer) return
    layer.clearLayers()
    homes.forEach((r) => {
      const price = r.from ? `<br>From <b>€${Math.round(r.from).toLocaleString('en-IE')}</b> a month` : ''
      L.marker([r.lat, r.lon], { icon: ctxIcon(`<span class="rm-home">🏠</span><span class="rm-label rm-home-label">${escapeHtml(r.name)}</span>`, 22), title: `${r.name} (student residence)`, zIndexOffset: 50 })
        .bindPopup(`<div class="rm-pop"><small>Student residence</small><strong>${escapeHtml(r.name)}</strong>${r.operator ? `<span>${escapeHtml(r.operator)}</span>` : ''}${r.address ? `<span>${escapeHtml(r.address)}</span>` : ''}${price}${r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ''}</div>`, { maxWidth: 240 })
        .addTo(layer)
    })
    if (near?.kind === 'transit') {
      const station = (s, html, tip) => s && L.marker([s.lat, s.lng], { icon: ctxIcon(html, 26), zIndexOffset: 200, title: s.name })
        .bindTooltip(tip, { direction: 'top', offset: [0, -12], permanent: true, className: 'rm-tip rm-station-tip rm-perm' }).addTo(layer)
      if (near.luas) {
        const c = LUAS_COLOURS[near.luas.kind]
        station(near.luas, `<span class="rm-luas" style="--c:${c}">L</span>`, `<b>Luas · ${escapeHtml(near.luas.name)}</b><br>${near.luas.kind.replace('Luas ', '')} · ${fmtKm(near.luas.m / 1000)}`)
      }
      if (near.rail) station(near.rail, '<span class="rm-rail">🚆</span>', `<b>${near.rail.kind} · ${escapeHtml(near.rail.name)}</b><br>${fmtKm(near.rail.m / 1000)}`)
      const routeList = (s) => s.routes.map((r) => (s.direct.includes(r) ? `<b>${escapeHtml(r)}</b>` : escapeHtml(r))).join(', ')
      const busStop = (s, where, nearest) => L.marker([s.lat, s.lng], { icon: ctxIcon(`<span class="rm-bus">${BUS_SVG}</span>`, 24), zIndexOffset: 150, title: `${s.name} bus stop` })
        .bindTooltip(`<b>${escapeHtml(s.name)}${s.ref ? ` · stop ${escapeHtml(s.ref)}` : ''}</b> · ${fmtKm(s.m / 1000)}<br>Bus ${routeList(s)}${s.direct.length ? `<br><small>${s.direct.join(', ')} ${escapeHtml(where)}</small>` : ''}`,
          { direction: 'top', offset: [0, -12], permanent: nearest, className: nearest ? 'rm-tip rm-bus-tip rm-perm' : 'rm-tip' })
        .addTo(layer)
      near.busStops.forEach((s, i) => busStop(s, `to ${toName}`, i === 0))
      near.uniStops.forEach((s) => busStop(s, `near ${toName}`, false))
    }
    if (near?.kind === 'bikes') {
      ;[[near.a, 'near the start'], [near.b, 'near the university']].forEach(([d, where]) => d && L.marker([d.lat, d.lng], { icon: ctxIcon('<span class="route-bike">🚲</span>', 22), title: d.name })
        .bindTooltip(`<b>Dublin Bikes · ${escapeHtml(d.name)}</b><br>${where}${d.bikes != null ? ` · ${d.bikes} bikes free` : ''}`, { direction: 'top', offset: [0, -10], className: 'rm-tip' }).addTo(layer))
    }
    setTimeout(() => declutterTips(boxRef.current), 80)
  }, [near, homes, toName])

  // keep the pin's tooltip in step with the street name when it arrives
  useEffect(() => { startRef.current?.setTooltipContent(`${escapeHtml(start ? start.name : fromName)}<br><small>Drag or click the map to start elsewhere</small>`) }, [start?.name, fromName])

  const words = MODE_WORDS[mode]
  const placeName = start ? start.name : fromName
  const rides = chosen ? chosen.legs.filter((leg) => leg.mode !== 'WALK' && leg.mode !== 'BICYCLE') : []
  const chosenBuses = [...new Set(rides.filter((leg) => leg.mode === 'BUS' && leg.line).map((leg) => leg.line))]
  // direct buses: from the stop data, plus the planner's bus when its trip needs no change
  // (newer BusConnects lines such as E1 aren't in the stop data yet)
  const directBuses = near?.kind === 'transit'
    ? [...new Set([...(rides.length === 1 ? chosenBuses : []), ...near.busRoutes])].sort(naturalSort)
    : []
  const showPlanned = start || choice === 'bus'
  const nearestBus = near?.kind === 'transit' ? near.busStops[0] : null

  return (
    <div className="route-map-wrap">
      <div className="route-card" aria-live="polite">
        <div className="route-ends">
          <span className="route-end"><i className="route-dot route-dot-from">A</i><span><small>From</small>{placeName}</span></span>
          <span className="route-end"><i className="route-dot route-dot-to">B</i><span><small>To</small>{toName}</span></span>
        </div>
        {plans?.bus && (
          <div className="rm-options" role="radiogroup" aria-label="Which trip to show">
            {[['fastest', plans.fastest], ['bus', plans.bus]].map(([key, it]) => (
              <button type="button" key={key} role="radio" aria-checked={choice === key} onClick={() => setChoice(key)}>
                <small>{key === 'fastest' ? 'Fastest' : 'By bus'}</small>
                <b>{Math.round(it.total_minutes)} min</b>
                <span>{rideWords(it)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="route-numbers">
          {!showPlanned && (defaultMinutes != null
            ? <><strong>{defaultMinutes} min</strong><span>{defaultWords || words}{defaultKm != null && ` · ${defaultKm} km`}</span></>
            : <span>No time for this place yet.</span>)}
          {showPlanned && trip.status === 'loading' && <span className="route-loading">Working out the trip…</span>}
          {showPlanned && chosen && trip.status !== 'loading' && (
            <><strong>{Math.round(chosen.total_minutes)} min</strong><span>{choice === 'bus' ? 'by bus' : words} · {fmtKm(chosen.total_distance_km)}{chosen.transfers ? ` · ${chosen.transfers} change${chosen.transfers > 1 ? 's' : ''}` : ''}</span></>
          )}
          {start && trip.status === 'estimate' && <><strong>≈ {trip.minutes} min</strong><span>{words} · {fmtKm(trip.km)} in a straight line (estimate)</span></>}
        </div>
        {near?.kind === 'transit' && (
          <div className="route-near">
            {directBuses.length > 0 ? (
              <p><b>Buses to {toName}</b><span className="route-chips">{directBuses.slice(0, 14).map((r) => <i key={r}>{r}</i>)}{directBuses.length > 14 && <em>+{directBuses.length - 14} more</em>}</span></p>
            ) : chosenBuses.length > 0 && (
              <p><b>No direct bus · this trip uses</b><span className="route-chips">{chosenBuses.map((r) => <i key={r}>{r}</i>)}</span></p>
            )}
            {nearestBus && <p><b>Nearest bus stop</b><span>{nearestBus.name}{nearestBus.ref ? ` (stop ${nearestBus.ref})` : ''} · {fmtKm(nearestBus.m / 1000)} · bus {nearestBus.routes.slice(0, 10).join(', ')}{nearestBus.routes.length > 10 ? ' …' : ''}</span></p>}
            {near.luas && <p><b>Nearest Luas stop</b><span>{near.luas.name} · {near.luas.kind.replace('Luas ', '')} · {fmtKm(near.luas.m / 1000)} from {placeName}</span></p>}
            {near.rail && <p><b>Nearest {near.rail.kind === 'DART' ? 'DART' : 'train'} station</b><span>{near.rail.name} · {fmtKm(near.rail.m / 1000)} from {placeName}</span></p>}
            {!near.luas && !near.rail && near.station && <p><b>Nearest Luas or train stop</b><span>{near.station.name} · {fmtKm(near.station.m / 1000)} from {placeName}</span></p>}
          </div>
        )}
        {near?.kind === 'bikes' && near.a && (
          <div className="route-near">
            <p><b>Dublin Bikes near {placeName}</b><span>{near.a.name} · {fmtKm(near.a.m / 1000)}{near.a.bikes != null && ` · ${near.a.bikes} bike${near.a.bikes === 1 ? '' : 's'} free`}</span></p>
            {near.b && <p><b>Near the university</b><span>{near.b.name} · {fmtKm(near.b.m / 1000)}{near.b.stands != null && ` · ${near.b.stands} free stand${near.b.stands === 1 ? '' : 's'}`}</span></p>}
          </div>
        )}
        {homes.length > 0 && (
          <div className="route-near">
            <p><b>Student residences nearby</b><span>{homes.length} on the map: {homes.slice(0, 3).map((r) => r.name).join(', ')}{homes.length > 3 ? ` and ${homes.length - 3} more` : ''}</span></p>
          </div>
        )}
        {start && (
          <button type="button" className="route-reset" onClick={() => setStart(null)}>↺ Back to {fromName}</button>
        )}
      </div>
      <div className="route-map-box">
        <div ref={boxRef} className="route-map" aria-label={`Map of the trip from ${placeName} to ${toName}. Click the map to start from another place.`} />
        <span className="route-map-hint">Click anywhere to see the trip from there</span>
      </div>
      <p className="route-legend rm-legend" aria-label="Map key">
        <span><i className="rm-key-a">A</i>Start</span>
        <span><i className="rm-key-b">B</i>University</span>
        {near?.kind === 'transit' && <span><i className="rm-key-bus" />Bus stop</span>}
        {near?.luas && <span><i className="rm-key-luas" style={{ '--c': LUAS_COLOURS[near.luas.kind] }}>L</i>Luas stop</span>}
        {near?.rail && <span><i className="rm-key-rail">🚆</i>{near.rail.kind === 'DART' ? 'DART' : 'Train'} station</span>}
        {homes.length > 0 && <span><i className="rm-key-home">🏠</i>Student residence</span>}
      </p>
      {trip.status === 'estimate' && (
        <p className="route-map-note">The journey planner isn't reachable right now, so the time is an estimate from the straight-line distance.</p>
      )}
    </div>
  )
}

export default RouteMap
