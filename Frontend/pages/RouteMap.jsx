// "Getting there" on the results page: an interactive Stadia map from a match to the university.
// By default the trip starts at the match's neighbourhood centre (times and distance from the recommender).
// Click anywhere (or drag pin A) to start from that spot instead: the route, time and distance come from the
// journey planner (GET /route, OpenTripPlanner); if it isn't reachable, the straight-line distance is shown
// with an estimated time. "Back to …" returns to the neighbourhood centre.
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

// Nearby transport for the card (same files as the district map)
const BIKES_INFO_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_information.json'
const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json'
const jsonCache = {}
const getJson = (url) => (jsonCache[url] ??= fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => { delete jsonCache[url]; return null }))
const naturalSort = (a, b) => a.localeCompare(b, 'en', { numeric: true })

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

const pinIcon = (className, label) => L.divIcon({
  className: 'route-pin-wrap', html: `<span class="route-pin ${className}">${label}</span>`, iconSize: [32, 32], iconAnchor: [16, 16],
})

function RouteMap({ fromLat, fromLon, fromName, toLat, toLon, toName, mode, defaultMinutes, defaultKm, defaultWords }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const startRef = useRef(null)
  const [start, setStart] = useState(null) // null = the neighbourhood centre; else { lat, lng, name }
  const [trip, setTrip] = useState({ status: 'idle' }) // route for a picked start: minutes, km, estimate?
  const [near, setNear] = useState(null) // nearby transport for the card: bus routes, Luas/rail stop, bike docks
  const [tripBuses, setTripBuses] = useState({ direct: false, lines: [] }) // bus lines the planned trip uses
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
    mapRef.current = map
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

  // draw the trip (and, for a picked spot, ask the journey planner for its time and distance)
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map) return undefined
    const controller = new AbortController()
    const from = start ? [start.lat, start.lng] : [fromLat, fromLon]
    const to = [toLat, toLon]
    const fromLabel = start ? start.name : fromName

    function draw(lines, { fit = true, animate = true } = {}) {
      stopTraveller()
      layer.clearLayers()
      const lengths = lines.map(({ points }) => points.slice(1).reduce((sum, p, i) => sum + km(points[i], p), 0))
      const total = lengths.reduce((x, y) => x + y, 0) || 1
      let delay = 0
      lines.forEach(({ points, colour, dashed, stops }, i) => {
        const duration = Math.max(160, (lengths[i] / total) * DRAW_MS)
        if (dashed) {
          const dots = L.polyline(points, { color: colour, weight: 5, opacity: 0.95, dashArray: '0.1 10', lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
          if (animate) animateFade(dots, delay, duration)
        } else {
          const casing = L.polyline(points, { color: '#ffffff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
          const glow = L.polyline(points, { color: colour, weight: 16, opacity: 0.16, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
          const line = L.polyline(points, { color: colour, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
          if (animate) [casing, glow, line].forEach((l) => animateDraw(l, delay, duration))
          // where you get on and off: little stop rings that pop in as the line reaches them
          if (stops) {
            [[points[0], stops[0], delay], [points[points.length - 1], stops[1], delay + duration]].forEach(([point, name, at]) => {
              const m = L.marker(point, { keyboard: false, icon: L.divIcon({ className: '', html: `<span class="route-stop-dot" style="--c:${colour}; --d:${animate ? Math.round(at) : 0}ms"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(layer)
              if (name) m.bindTooltip(name, { direction: 'top', offset: [0, -8] })
            })
          }
        }
        delay += duration
      })
      const a = L.marker(from, { icon: pinIcon('route-pin-from', 'A'), draggable: true, title: `${fromLabel} (drag to move)`, zIndexOffset: 500 })
        .bindTooltip(`${fromLabel}<br><small>Drag or click the map to start elsewhere</small>`, { direction: 'top', offset: [0, -14] })
        .on('dragend', () => { const p = a.getLatLng(); setStart({ lat: p.lat, lng: p.lng, name: 'Point on the map', lookup: true }) })
        .addTo(layer)
      startRef.current = a
      L.marker(to, { icon: pinIcon('route-pin-to', 'B'), title: toName, zIndexOffset: 400 }).bindTooltip(toName, { direction: 'top', offset: [0, -14] }).addTo(layer)
      if (fit) {
        const all = lines.flatMap((line) => line.points)
        map.fitBounds(L.latLngBounds(all.length ? all : [from, to]), { padding: [36, 36], maxZoom: 15 })
      }
      if (animate) animRef.current.timer = setTimeout(() => startTraveller(lines), REDUCED_MOTION ? 0 : delay + 300)
    }

    const straightKm = km(from, to)
    draw([{ points: [from, to], colour: '#9aa79f', dashed: true }], { animate: false })
    if (start) setTrip({ status: 'loading' })
    setTripBuses({ direct: false, lines: [] })
    const query = new URLSearchParams({
      from_lat: from[0], from_lon: from[1], to_lat: to[0], to_lon: to[1],
      mode: ROUTE_MODES[mode], when: nextWeekdayNine(), arrive_by: 'true',
    })
    fetch(`${API_URL}/route?${query}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((plan) => {
        const best = [...plan.itineraries].sort((a, b) => a.total_minutes - b.total_minutes)[0]
        const lines = best.legs.filter((leg) => leg.geometry).map((leg) => ({
          points: decodePolyline(leg.geometry),
          colour: LEG_COLOURS[leg.mode] ?? TRANSIT_COLOUR,
          dashed: leg.mode === 'WALK',
          stops: leg.mode !== 'WALK' && leg.mode !== 'BICYCLE' ? [leg.from, leg.to] : null,
        }))
        if (!lines.length) throw new Error('no route line')
        draw(lines)
        const rides = best.legs.filter((leg) => leg.mode !== 'WALK' && leg.mode !== 'BICYCLE')
        setTripBuses({ direct: rides.length === 1, lines: [...new Set(rides.filter((leg) => leg.mode === 'BUS' && leg.line).map((leg) => leg.line))] })
        if (start) setTrip({ status: 'done', minutes: Math.round(best.total_minutes), km: best.total_distance_km, transfers: best.transfers })
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

  // Nearby transport for the card (not drawn on the map): bus routes and the nearest Luas/rail stop,
  // or the closest Dublin Bikes docks when cycling
  useEffect(() => {
    let live = true
    setNear(null)
    const from = start ? [start.lat, start.lng] : [fromLat, fromLon]
    const to = [toLat, toLon]
    const metres = (a, b) => Math.round(km(a, b) * 1000)
    if (mode === 'public_transport') {
      Promise.all([
        getJson('/data/luas-red-stops.geojson'), getJson('/data/luas-green-stops.geojson'),
        getJson('/data/dublin-rail-stations.geojson'), getJson('/data/dublin-bus-stops.geojson'),
      ]).then(([redStops, greenStops, railStations, bus]) => {
        if (!live) return
        const stations = []
        ;[[redStops, 'Luas Red Line'], [greenStops, 'Luas Green Line']].forEach(([gj, label]) => (gj?.features || []).forEach((f) => {
          const [lng, lat] = f.geometry.coordinates
          stations.push({ name: f.properties.name, kind: label, lat, lng })
        }))
        ;(railStations?.features || []).forEach((f) => {
          const [lng, lat] = f.geometry.coordinates
          stations.push({ name: f.properties.name, kind: f.properties.dart ? 'DART / rail' : 'Rail', lat, lng })
        })
        // only the buses that go to the university: a route with a stop within 500 m of the start AND within 500 m of the university
        const atStart = new Set()
        const atUni = new Set()
        ;(bus?.features || []).forEach((f) => {
          if (!f.properties.routes) return
          const [lng, lat] = f.geometry.coordinates
          const nearStart = metres(from, [lat, lng]) <= 500
          const nearUni = metres(to, [lat, lng]) <= 500
          if (!nearStart && !nearUni) return
          f.properties.routes.split(';').forEach((r) => {
            const v = r.trim()
            if (!v || /^(none|n\/a|unknown)$/i.test(v)) return
            if (nearStart) atStart.add(v)
            if (nearUni) atUni.add(v)
          })
        })
        const direct = [...atStart].filter((r) => atUni.has(r)).sort(naturalSort)
        const nearest = stations.map((st) => ({ ...st, m: metres(from, [st.lat, st.lng]) })).sort((a, b) => a.m - b.m)[0]
        setNear({ kind: 'transit', busRoutes: direct, station: nearest })
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
  }, [mode, start?.lat, start?.lng, fromLat, fromLon, toLat, toLon]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the pin's tooltip in step with the street name when it arrives
  useEffect(() => { startRef.current?.setTooltipContent(`${start ? start.name : fromName}<br><small>Drag or click the map to start elsewhere</small>`) }, [start?.name, fromName])

  const fmtKm = (v) => (v == null ? '' : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`)
  const words = MODE_WORDS[mode]
  const placeName = start ? start.name : fromName
  // direct buses: from the stop data, plus the planner's bus when its trip needs no change
  // (newer BusConnects lines such as E1 aren't in the stop data yet)
  const directBuses = near?.kind === 'transit'
    ? [...new Set([...(tripBuses.direct ? tripBuses.lines : []), ...near.busRoutes])].sort(naturalSort)
    : []

  return (
    <div className="route-map-wrap">
      <div className="route-card" aria-live="polite">
        <div className="route-ends">
          <span className="route-end"><i className="route-dot route-dot-from">A</i><span><small>From</small>{start ? start.name : fromName}</span></span>
          <span className="route-end"><i className="route-dot route-dot-to">B</i><span><small>To</small>{toName}</span></span>
        </div>
        <div className="route-numbers">
          {!start && (defaultMinutes != null
            ? <><strong>{defaultMinutes} min</strong><span>{defaultWords || words}{defaultKm != null && ` · ${defaultKm} km`}</span></>
            : <span>No time for this place yet.</span>)}
          {start && trip.status === 'loading' && <span className="route-loading">Working out the trip…</span>}
          {start && trip.status === 'done' && <><strong>{trip.minutes} min</strong><span>{words} · {fmtKm(trip.km)}{trip.transfers ? ` · ${trip.transfers} change${trip.transfers > 1 ? 's' : ''}` : ''}</span></>}
          {start && trip.status === 'estimate' && <><strong>≈ {trip.minutes} min</strong><span>{words} · {fmtKm(trip.km)} in a straight line (estimate)</span></>}
        </div>
        {near?.kind === 'transit' && (
          <div className="route-near">
            {directBuses.length > 0 ? (
              <p><b>Buses to {toName}</b><span className="route-chips">{directBuses.slice(0, 14).map((r) => <i key={r}>{r}</i>)}{directBuses.length > 14 && <em>+{directBuses.length - 14} more</em>}</span></p>
            ) : tripBuses.lines.length > 0 && (
              <p><b>No direct bus · this trip uses</b><span className="route-chips">{tripBuses.lines.map((r) => <i key={r}>{r}</i>)}</span></p>
            )}
            {near.station && <p><b>Nearest {near.station.kind.startsWith('Luas') ? 'Luas' : 'rail'} stop</b><span>{near.station.name} · {fmtKm(near.station.m / 1000)} from {placeName}</span></p>}
          </div>
        )}
        {near?.kind === 'bikes' && near.a && (
          <div className="route-near">
            <p><b>Dublin Bikes near {placeName}</b><span>{near.a.name} · {fmtKm(near.a.m / 1000)}{near.a.bikes != null && ` · ${near.a.bikes} bike${near.a.bikes === 1 ? '' : 's'} free`}</span></p>
            {near.b && <p><b>Near the university</b><span>{near.b.name} · {fmtKm(near.b.m / 1000)}{near.b.stands != null && ` · ${near.b.stands} free stand${near.b.stands === 1 ? '' : 's'}`}</span></p>}
          </div>
        )}
        {start && (
          <button type="button" className="route-reset" onClick={() => setStart(null)}>↺ Back to {fromName}</button>
        )}
      </div>
      <div className="route-map-box">
        <div ref={boxRef} className="route-map" aria-label={`Map of the trip from ${start ? start.name : fromName} to ${toName}. Click the map to start from another place.`} />
        <span className="route-map-hint">Click anywhere to see the trip from there</span>
      </div>
      {trip.status === 'estimate' && (
        <p className="route-map-note">The journey planner isn't reachable right now, so the time is an estimate from the straight-line distance.</p>
      )}
    </div>
  )
}

export default RouteMap
