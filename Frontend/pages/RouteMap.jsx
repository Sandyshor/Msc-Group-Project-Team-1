// "Getting there" on the results page: a Google map from a match to the university.
// By default the trip starts at the match's neighbourhood centre (times and distance from the recommender).
// Type a start (an address, Eircode, residence, station...), use the browser's location, click anywhere or drag
// pin A to start from that spot instead; B is always the university. The route, time and distance come from
// Google's directions (the same as Google Maps; our own journey planner if Google doesn't answer); if no route
// comes back, the straight-line distance is shown with an estimated time. "Back to …" returns to the centre.
//
// By public transport the student can switch between the fastest trip and a trip by bus (often the fastest is
// the Luas or a train). Around the start the map names the nearest Luas stop and train station, the bus stops
// whose buses go to the university (with their route numbers), and the student residences in the area.
// (RouteMapLeaflet.jsx is the same map on our own basemap, used only when Google Maps can't load.)
import { useEffect, useRef, useState } from 'react'
import { streetName } from '../District Profile/placeNames'
import { spreadPins } from '../District Profile/spreadPins'
import PlaceSearch from '../District Profile/PlaceSearch'
import { fetchRoutes } from '../District Profile/journey'
import { GOOGLE_MAP_ID, loadGoogleMaps, onGoogleFailure } from '../District Profile/googleMaps'
import './RouteMap.css'

// recommender travel mode -> journey planner mode
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
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

// Nearby transport and residences (same files as the district map)
const BIKES_INFO_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_information.json'
const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json'
const RESIDENCES_URL = '/data/student-residences.json'
const jsonCache = {}
const getJson = (url) => (jsonCache[url] ??= fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => { delete jsonCache[url]; return null }))
const naturalSort = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const BUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a2 2 0 0 1 2 2V16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16V5.5a2 2 0 0 1 2-2Z" fill="#173f37"/><path d="M6 6h12v5.5H6z" fill="#fff"/><circle cx="8" cy="14.5" r="1.3" fill="#ffd34d"/><circle cx="16" cy="14.5" r="1.3" fill="#ffd34d"/></svg>'

// Google encoded polyline (precision 5), as the directions return it: [lat, lng] points
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

// The same pins as the district map: a white disc with an emoji and a coloured ring (bus stops: a yellow badge)
const RING = { home: '#7a3fa0', rail: '#7a3e9d', bike: '#1f6fb2' }
const discHtml = (emoji, ring, extra = '') => `<span class="rm-pm" style="--ring:${ring}">${emoji}</span>${extra}`
const BUS_ICON = `<span class="rm-busbadge">${BUS_SVG}</span>`
const inDublin = (lat, lng) => lat > 53.1 && lat < 53.65 && lng > -6.65 && lng < -5.95

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
// a step's place name: the planner's name, unless it is a bare "Origin"/"Destination" placeholder
const stopName = (place, fallback) => {
  const name = typeof place === 'string' ? place : place?.name
  return name && !/^(origin|destination|start|end)$/i.test(name) ? name : fallback || 'the next stop'
}
const legDetail = (leg) => [leg.minutes != null ? `${Math.max(1, Math.round(leg.minutes))} min` : '', leg.distance_km != null ? fmtKm(leg.distance_km) : ''].filter(Boolean).join(' · ')
const isAllBus = (itinerary) => {
  const rides = itinerary.legs.filter((leg) => leg.mode !== 'WALK')
  return rides.length > 0 && rides.every((leg) => leg.mode === 'BUS')
}

function RouteMap({ fromLat, fromLon, fromName, toLat, toLon, toName, area, mode, defaultMinutes, defaultKm, defaultWords, onUnavailable }) {
  const boxRef = useRef(null)
  const tipRef = useRef(null)
  const mapRef = useRef(null) // { g, map, proj, Marker }
  const trip_ = useRef([]) // the trip's lines and markers
  const ctx_ = useRef([]) // stops, stations and residences around it
  const homeLines = useRef([])
  const startRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [start, setStart] = useState(null) // null = the neighbourhood centre; else { lat, lng, name }
  const [plans, setPlans] = useState(null) // { fastest, bus } itineraries, or null
  const [choice, setChoice] = useState('fastest')
  const [showAllNearbyRoutes, setShowAllNearbyRoutes] = useState(false)
  const [trip, setTrip] = useState({ status: 'idle' }) // route for a picked start: minutes, km, estimate?
  const [near, setNear] = useState(null) // nearby transport: stations, bus stops (both ends), bike docks
  const [homes, setHomes] = useState([]) // student residences around the start (listed under the map)
  const [allHomes, setAllHomes] = useState([]) // every residence (drawn on the map: the same pins wherever A is)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState('')
  const animRef = useRef({ timer: null, frame: null, traveller: null, token: null })
  const homeTip = (r) => {
    const who = [r.operator, r.address].filter(Boolean).map(escapeHtml).join(' · ')
    return `<div class="rm-pop rm-card"><small>Student residence</small><strong>${escapeHtml(r.name)}</strong>${who ? `<span>${who}</span>` : ''}`
      + `${r.from || r.rooms ? `<span>${r.from ? `From <b>€${Math.round(r.from).toLocaleString('en-IE')}</b> a month` : ''}${r.from && r.rooms ? ' · ' : ''}${r.rooms ? escapeHtml(r.rooms) : ''}</span>` : ''}`
      + '<em class="rm-hint">Click the pin to start your trip here (A) and see the distance to the university</em></div>'
  }
  const homeMarkers = useRef([]) // nearby pins (residences, stops, stations: drawn at their true spot, then moved aside if they'd cover something)

  // ------------------------------------------------------------ Google map helpers
  const showTip = (html, rect) => {
    const tip = tipRef.current
    const box = boxRef.current?.parentElement
    if (!tip || !box) return
    const b = box.getBoundingClientRect()
    tip.innerHTML = html
    tip.hidden = false
    const w = tip.offsetWidth
    const x = Math.min(Math.max(6, rect.left - b.left + rect.width / 2 - w / 2), b.width - w - 6)
    const above = rect.top - b.top - tip.offsetHeight - 8
    tip.style.transform = `translate(${x}px, ${above < 6 ? rect.bottom - b.top + 8 : above}px)`
  }
  const hideTip = () => { if (tipRef.current) tipRef.current.hidden = true }
  const pointRect = (e) => ({ left: e.domEvent.clientX, right: e.domEvent.clientX, top: e.domEvent.clientY, bottom: e.domEvent.clientY, width: 0 })

  // a marker made of our HTML, centred on its point
  function marker([lat, lng], html, { title = '', zIndex = 0, onClick, tip, draggable = false } = {}) {
    const m = mapRef.current
    const el = document.createElement('div')
    el.className = 'rm-anchor'
    el.innerHTML = `<div class="rm-c">${html}</div>`
    if (tip) {
      el.addEventListener('mouseenter', () => showTip(typeof tip === 'function' ? tip() : tip, el.firstElementChild.getBoundingClientRect()))
      el.addEventListener('mouseleave', hideTip)
    }
    const mk = new m.Marker({ position: { lat, lng }, content: el, title, zIndex, gmpClickable: Boolean(onClick), gmpDraggable: draggable, map: m.map })
    if (onClick) mk.addEventListener('gmp-click', () => { hideTip(); onClick() })
    return mk
  }
  const line = (points, opts) => new mapRef.current.g.Polyline({ path: points.map(([lat, lng]) => ({ lat, lng })), clickable: false, map: mapRef.current.map, ...opts })
  const removeAll = (list) => { list.forEach((x) => { if ('setMap' in x) x.setMap(null); else x.map = null }); list.length = 0 }
  const toPoint = (lat, lng) => mapRef.current?.proj.getProjection()?.fromLatLngToContainerPixel(new mapRef.current.g.LatLng(lat, lng))
  const toLatLng = (x, y) => { const ll = mapRef.current.proj.getProjection().fromContainerPixelToLatLng(new mapRef.current.g.Point(x, y)); return { lat: ll.lat(), lng: ll.lng() } }
  const posOf = (mk) => { const p = mk.position; return { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng } }
  function fitTo(points, padding = 36, maxZoom = 15) {
    const m = mapRef.current
    if (!m || !points.length) return
    const bounds = new m.g.LatLngBounds()
    points.forEach(([lat, lng]) => bounds.extend({ lat, lng }))
    m.map.fitBounds(bounds, padding)
    m.g.event.addListenerOnce(m.map, 'idle', () => { if (m.map.getZoom() > maxZoom) m.map.setZoom(maxZoom) })
  }

  // Pins that would overlap are moved apart on screen, with a dotted line where one really is. Residences only make
  // room for each other and B (so they stay put when A moves); bus stops and stations step aside from A, B, the trip's
  // stops and the residences. Re-run when the zoom or the drawing changes.
  function arrangeHomes() {
    const m = mapRef.current
    if (!m || !m.proj.getProjection()) return
    removeAll(homeLines.current)
    if (!homeMarkers.current.length) return
    const shown = homeMarkers.current.filter((mk) => !mk.hidden)
    const homesOnly = shown.filter((mk) => mk.isHome)
    const stops = shown.filter((mk) => !mk.isHome)
    const spotOf = (mk) => { const p = toPoint(mk.trueLatLng.lat, mk.trueLatLng.lng); return { x: p.x, y: p.y, r: 13, from: p } }
    const homeSpots = homesOnly.map(spotOf)
    const b = toPoint(toLat, toLon)
    spreadPins(homeSpots, [{ x: b.x, y: b.y, r: 16 }], 3) // B (the university) never moves, so this never shifts them
    const fixed = homeSpots.map(({ x, y, r }) => ({ x, y, r }))
    trip_.current.forEach((mk) => {
      if (!('content' in mk) || mk === animRef.current.traveller) return
      const at = posOf(mk)
      const p = toPoint(at.lat, at.lng)
      if (p) fixed.push({ x: p.x, y: p.y, r: mk.size || 10 })
    })
    const stopSpots = stops.map(spotOf)
    spreadPins(stopSpots, fixed, 3)
    // a stop squeezed between two pins that can't move: the nearest free spot in rings around where it really is
    const taken = (q, i) => fixed.some((f) => Math.hypot(q.x - f.x, q.y - f.y) < q.r + f.r + 2)
      || stopSpots.some((o, k) => k !== i && Math.hypot(q.x - o.x, q.y - o.y) < q.r + o.r + 2)
    stopSpots.forEach((q, i) => {
      if (!taken(q, i)) return
      for (let ring = 1; ring <= 8; ring++) {
        const found = Array.from({ length: 12 }, (_, k) => ({ x: q.from.x + Math.cos(k * Math.PI / 6) * ring * 14, y: q.from.y + Math.sin(k * Math.PI / 6) * ring * 14, r: q.r }))
          .find((c) => !taken(c, i))
        if (found) { q.x = found.x; q.y = found.y; return }
      }
    })
    ;[[homesOnly, homeSpots], [stops, stopSpots]].forEach(([markers, spots]) => markers.forEach((mk, i) => {
      const at = toLatLng(spots[i].x, spots[i].y)
      mk.position = at
      if (Math.hypot(spots[i].x - spots[i].from.x, spots[i].y - spots[i].from.y) > 5) {
        homeLines.current.push(line([[mk.trueLatLng.lat, mk.trueLatLng.lng], [at.lat, at.lng]], { strokeColor: mk.ring || RING.home, strokeOpacity: 0, zIndex: 4,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeWeight: 1.5, scale: 2 }, offset: '0', repeat: '6px' }] }))
      }
    }))
    declutter()
  }

  // Names that would overlap on a small map: residences' names only when zoomed right in, and only those with room
  function declutter() {
    const box = boxRef.current
    if (!box) return
    const labels = [...box.querySelectorAll('.rm-home-label, .rm-board-label')]
    labels.forEach((label) => label.classList.remove('rm-label-hidden'))
    const kept = []
    labels.sort((a, b) => (b.classList.contains('rm-board-label') ? 1 : 0) - (a.classList.contains('rm-board-label') ? 1 : 0)).forEach((label) => {
      const r = label.getBoundingClientRect()
      if (!r.width || !r.height) return
      if (kept.some((q) => r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 3 && r.bottom > q.top - 3)) label.classList.add('rm-label-hidden')
      else kept.push(r)
    })
  }

  function stopTraveller() {
    const a = animRef.current
    clearTimeout(a.timer)
    cancelAnimationFrame(a.frame)
    if (a.traveller) a.traveller.map = null
    a.traveller = null
  }

  // grow lines along their path over `duration` ms, starting after `delay`
  function growLines(lines, points, delay, duration, token) {
    const path = points.map(([lat, lng]) => ({ lat, lng }))
    if (REDUCED_MOTION || path.length < 2) { lines.forEach((l) => l.setPath(path)); return }
    lines.forEach((l) => l.setPath([]))
    const cum = [0]
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + km(points[i - 1], points[i]))
    const total = cum[cum.length - 1] || 1
    const begin = performance.now() + delay
    const step = (now) => {
      if (animRef.current.token !== token) return
      const t = Math.min(1, Math.max(0, (now - begin) / duration))
      if (t > 0) {
        const target = easeInOut(t) * total
        let k = 1
        while (k < path.length - 1 && cum[k] < target) k++
        const a = path[k - 1], b = path[k]
        const f = cum[k] > cum[k - 1] ? Math.min(1, (target - cum[k - 1]) / (cum[k] - cum[k - 1])) : 1
        const partial = path.slice(0, k)
        partial.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f })
        lines.forEach((l) => l.setPath(partial))
      }
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // a pulsing dot that travels the whole trip on a loop, taking each leg's colour
  function startTraveller(lines, token) {
    if (REDUCED_MOTION || !mapRef.current || animRef.current.token !== token) return
    const track = []
    let distance = 0
    lines.forEach(({ points, colour }) => points.forEach((p) => {
      if (track.length) distance += km(track[track.length - 1].p, p)
      track.push({ p, d: distance, colour })
    }))
    if (track.length < 2 || distance === 0) return
    const a = animRef.current
    a.traveller = marker(track[0].p, '<span class="route-traveller"><i></i></span>', { zIndex: 1000 })
    const node = a.traveller.content.querySelector('.route-traveller')
    const startedAt = performance.now()
    let k = 0
    const step = (now) => {
      if (a.token !== token) return
      const t = ((now - startedAt) % (TRAVEL_MS + 900)) / TRAVEL_MS
      const target = (t >= 1 ? 1 : easeInOut(t)) * distance
      if (target < track[k].d) k = 0
      while (k < track.length - 2 && track[k + 1].d < target) k++
      const p = track[k], q = track[k + 1]
      const f = q.d > p.d ? (target - p.d) / (q.d - p.d) : 0
      a.traveller.position = { lat: p.p[0] + (q.p[0] - p.p[0]) * f, lng: p.p[1] + (q.p[1] - p.p[1]) * f }
      node?.style.setProperty('--c', q.colour)
      a.frame = requestAnimationFrame(step)
    }
    a.frame = requestAnimationFrame(step)
  }

  // the map, once
  useEffect(() => {
    let cancelled = false
    const offFailure = onGoogleFailure(() => onUnavailable?.())
    loadGoogleMaps().then(async (g) => {
      if (cancelled || !boxRef.current) return
      const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([g.importLibrary('maps'), g.importLibrary('marker')])
      if (cancelled) return
      const map = new Map(boxRef.current, {
        center: { lat: fromLat, lng: fromLon }, zoom: 13, mapId: GOOGLE_MAP_ID,
        clickableIcons: true, keyboardShortcuts: false, gestureHandling: 'cooperative',
        mapTypeControl: false, cameraControl: false, rotateControl: false, streetViewControl: true, fullscreenControl: true, zoomControl: true,
      })
      class Projection extends g.OverlayView { onAdd() { setTimeout(() => this.ready?.(), 0) } draw() {} onRemove() {} }
      const proj = new Projection()
      proj.setMap(map)
      mapRef.current = { g, map, proj, Marker: AdvancedMarkerElement }
      proj.ready = () => { if (!cancelled) arrangeHomes() }
      // a click anywhere (a Google place too) starts the trip there
      map.addListener('click', (e) => {
        if (e.placeId) e.stop() // no Google info window
        setStart({ lat: e.latLng.lat(), lng: e.latLng.lng(), name: 'Point on the map', lookup: true })
      })
      const zoomClass = () => {
        const box = boxRef.current
        if (!box) return
        const zoom = map.getZoom()
        box.classList.toggle('rm-overview', zoom < 13)
        box.classList.toggle('rm-near', zoom >= 15)
        box.classList.toggle('rm-close', zoom >= 17)
      }
      let lastZoom = null
      map.addListener('idle', () => {
        if (cancelled) return
        const z = map.getZoom()
        if (z !== lastZoom) { lastZoom = z; zoomClass(); arrangeHomes() } else declutter()
      })
      map.addListener('zoom_changed', hideTip)
      map.getStreetView().addListener('visible_changed', () => boxRef.current?.parentElement?.classList.toggle('is-streetview', map.getStreetView().getVisible()))
      zoomClass()
      setReady(true)
    }).catch(() => onUnavailable?.())
    return () => {
      cancelled = true
      offFailure()
      animRef.current.token = null
      stopTraveller()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // a new match: back to its centre
  useEffect(() => { setStart(null) }, [fromLat, fromLon])

  // name a picked spot by its street (Google's address for that spot)
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
    if (!mapRef.current) return
    const token = {}
    animRef.current.token = token
    stopTraveller()
    removeAll(trip_.current)
    hideTip()
    const lengths = lines.map(({ points }) => points.slice(1).reduce((sum, p, i) => sum + km(points[i], p), 0))
    const total = lengths.reduce((x, y) => x + y, 0) || 1
    let delay = 0
    lines.forEach(({ points, colour, dashed, stops, line: lineName }, i) => {
      const duration = Math.max(160, (lengths[i] / total) * DRAW_MS)
      const anim = animate ? [delay, duration] : [0, 0]
      if (dashed) {
        const dots = line(points, { strokeColor: colour, strokeOpacity: 0, zIndex: 11,
          icons: [{ icon: { path: mapRef.current.g.SymbolPath.CIRCLE, fillColor: colour, fillOpacity: 0.95, strokeWeight: 0, scale: 2.6 }, offset: '0', repeat: '10px' }] })
        trip_.current.push(dots)
        if (animate) growLines([dots], points, ...anim, token)
      } else {
        const casing = line(points, { strokeColor: '#ffffff', strokeWeight: 11, strokeOpacity: 1, zIndex: 9 })
        const glow = line(points, { strokeColor: colour, strokeWeight: 16, strokeOpacity: 0.16, zIndex: 8 })
        const main = line(points, { strokeColor: colour, strokeWeight: 6, strokeOpacity: 1, zIndex: 10 })
        trip_.current.push(casing, glow, main)
        if (animate) growLines([casing, glow, main], points, ...anim, token)
        // where you get on and off: named stop rings that pop in as the line reaches them (names when zoomed in)
        if (stops) {
          [[points[0], stops[0], delay, 'Get on'], [points[points.length - 1], stops[1], delay + duration, 'Get off']].forEach(([point, name, at, verb]) => {
            const label = name ? `<span class="rm-board-label"><b>${verb}${lineName ? ` · ${escapeHtml(lineName)}` : ''}</b><br>${escapeHtml(name)}</span>` : ''
            const mk = marker(point, `<span class="route-stop-dot" style="--c:${colour}; --d:${animate ? Math.round(at) : 0}ms"></span>${label}`, {
              zIndex: 300, tip: name ? `<b>${verb}${lineName ? ` · ${escapeHtml(lineName)}` : ''}</b><br>${escapeHtml(name)}` : '',
            })
            mk.size = 8
            trip_.current.push(mk)
          })
        }
      }
      delay += duration
    })
    const a = marker(from, '<span class="route-pin route-pin-from">A</span>', {
      title: `${fromLabel} (drag to move)`, zIndex: 500, draggable: true,
      tip: () => `${escapeHtml(start ? start.name : fromName)}<br><small>Drag or click the map to start elsewhere</small>`,
    })
    a.size = 16
    a.addListener('dragend', () => { const p = posOf(a); setStart({ lat: p.lat, lng: p.lng, name: 'Point on the map', lookup: true }) })
    startRef.current = a
    const b = marker(to, '<span class="route-pin route-pin-to">B</span>', { title: toName, zIndex: 400, tip: escapeHtml(toName) })
    b.size = 16
    trip_.current.push(a, b)
    if (fit) {
      const all = lines.flatMap((l) => l.points)
      fitTo(all.length ? all : [from, to])
    }
    if (animate) animRef.current.timer = setTimeout(() => startTraveller(lines, token), REDUCED_MOTION ? 0 : delay + 300)
    setTimeout(() => { if (mapRef.current) arrangeHomes() }, 0)
  }

  const linesOf = (itinerary) => itinerary.legs.filter((leg) => leg.geometry).map((leg) => ({
    points: decodePolyline(leg.geometry),
    colour: LEG_COLOURS[leg.mode] ?? TRANSIT_COLOUR,
    dashed: leg.mode === 'WALK',
    stops: leg.mode !== 'WALK' && leg.mode !== 'BICYCLE' ? [leg.from, leg.to].map((x) => (typeof x === 'string' ? x : x?.name)) : null,
    line: rideName(leg),
  }))

  // ask for the trip (by public transport also for a trip by bus) when the ends change
  useEffect(() => {
    if (!ready) return undefined
    const controller = new AbortController()
    const straightKm = km(from, to)
    draw([{ points: [from, to], colour: '#9aa79f', dashed: true }], { animate: false })
    setPlans(null)
    setChoice('fastest')
    setTrip({ status: 'loading' })
    const ask = (routeMode) => fetchRoutes({
      from: { lat: from[0], lng: from[1] }, to: { lat: to[0], lng: to[1] }, mode: routeMode, timeType: 'arrive', time: nextWeekdayNine(),
    }, controller.signal).then((list) => [...list].sort((x, y) => x.total_minutes - y.total_minutes)[0])
    const busToo = mode === 'public_transport'
    Promise.all([ask(ROUTE_MODES[mode]), busToo ? ask('bus').catch((e) => { if (e.name === 'AbortError') throw e; return null }) : null])
      .then(([fastest, bus]) => {
        if (!fastest?.legs?.some((leg) => leg.geometry)) throw new Error('no route line')
        // the bus button only when it is a different trip (and really a bus trip)
        const busPlan = bus && !isAllBus(fastest) && isAllBus(bus) ? bus : null
        // the bus-only trip can be the quicker one: then it is the fastest (no separate "By bus" button)
        if (busPlan && busPlan.total_minutes < fastest.total_minutes) setPlans({ fastest: busPlan, bus: null })
        else setPlans({ fastest, bus: busPlan })
        if (start) setTrip({ status: 'done' })
        else setTrip({ status: 'idle', routeShown: true })
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        draw([{ points: [from, to], colour: '#7d8a82', dashed: true }], { fit: false, animate: false }) // as the crow flies: not a real route
        // no route: straight-line distance and an estimated time
        const road = straightKm * 1.3
        if (start) setTrip({ status: 'estimate', km: straightKm, minutes: Math.max(1, Math.round((road / SPEED_KMH[mode]) * 60 + (mode === 'public_transport' ? 8 : 0))) })
        else setTrip({ status: 'unavailable' })
      })
    return () => controller.abort()
  }, [ready, start?.lat, start?.lng, fromLat, fromLon, toLat, toLon, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = plans ? (choice === 'bus' && plans.bus ? plans.bus : plans.fastest) : null
  // draw the chosen trip
  useEffect(() => { if (chosen && ready) draw(linesOf(chosen)) }, [chosen, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nearby transport and residences, drawn around the start: the nearest Luas stop and train station, the bus
  // stops whose buses also stop near the university, and the student residences in the area
  useEffect(() => {
    let live = true
    setNear(null)
    const metres = (a, b) => Math.round(km(a, b) * 1000)
    getJson(RESIDENCES_URL).then((d) => {
      if (!live) return
      setAllHomes((old) => (old.length ? old : d?.residences || []))
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
          busDataAvailable: Array.isArray(bus?.features),
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
    if (!ready || !mapRef.current) return
    removeAll(ctx_.current)
    homeMarkers.current = []
    allHomes.forEach((r) => {
      // hover: the residence's card; click: it becomes the start (A), so the trip and distance to the university are worked out
      const mk = marker([r.lat, r.lon], discHtml('🏠', RING.home, `<span class="rm-label rm-home-label">${escapeHtml(r.name)}</span>`), {
        title: `${r.name} (student residence)`, zIndex: 50, tip: () => homeTip(r),
        onClick: () => setStart({ lat: r.lat, lng: r.lon, name: r.name }),
      })
      mk.content.classList.add('rm-home-marker')
      mk.trueLatLng = { lat: r.lat, lng: r.lon }
      mk.isHome = true
      homeMarkers.current.push(mk)
      ctx_.current.push(mk)
    })
    // stops and stations: their names show on hover (always-on labels covered the pins around them)
    const nearbyPin = (lat, lng, html, title, tip, ring) => {
      const mk = marker([lat, lng], html, { title, zIndex: 150, tip })
      mk.content.classList.add('rm-ctx')
      mk.trueLatLng = { lat, lng }
      mk.ring = ring
      homeMarkers.current.push(mk)
      ctx_.current.push(mk)
      return mk
    }
    if (near?.kind === 'transit') {
      if (near.luas) {
        const c = LUAS_COLOURS[near.luas.kind]
        nearbyPin(near.luas.lat, near.luas.lng, discHtml('🚊', c), `${near.luas.name} Luas stop`,
          `<b>Luas · ${escapeHtml(near.luas.name)}</b><br>${near.luas.kind.replace('Luas ', '')} · ${fmtKm(near.luas.m / 1000)} from A`, c)
      }
      if (near.rail) {
        nearbyPin(near.rail.lat, near.rail.lng, discHtml('🚆', RING.rail), `${near.rail.name} station`,
          `<b>${near.rail.kind} · ${escapeHtml(near.rail.name)}</b><br>${fmtKm(near.rail.m / 1000)} from A`, RING.rail)
      }
      const routeList = (st) => st.routes.map((r) => (st.direct.includes(r) ? `<b>${escapeHtml(r)}</b>` : escapeHtml(r))).join(', ')
      const busStop = (st, where) => nearbyPin(st.lat, st.lng, BUS_ICON, `${st.name} bus stop`,
        `<b>${escapeHtml(st.name)}${st.ref ? ` · stop ${escapeHtml(st.ref)}` : ''}</b><br>${fmtKm(st.m / 1000)} from ${where} · bus ${routeList(st)}`
        + `${st.direct.length ? '<small>Buses in bold go to the university</small>' : ''}`, '#173f37')
      near.busStops.forEach((st) => busStop(st, 'A'))
      near.uniStops.forEach((st) => busStop(st, 'the university'))
    }
    if (near?.kind === 'bikes') {
      ;[[near.a, 'near the start'], [near.b, 'near the university']].forEach(([d, where]) => d && nearbyPin(d.lat, d.lng, discHtml('🚲', RING.bike), d.name,
        `<b>Dublin Bikes · ${escapeHtml(d.name)}</b><br>${where}${d.bikes != null ? ` · ${d.bikes} bikes free` : ''}`, RING.bike))
    }
    hideUnderA()
    arrangeHomes()
  }, [near, allHomes, toName, toLat, toLon, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // A on a residence (picked, or dropped within 25 m): that residence's pin hides, A stands for it
  function hideUnderA() {
    const [aLat, aLng] = start ? [start.lat, start.lng] : [fromLat, fromLon]
    homeMarkers.current.forEach((mk) => {
      if (!mk.isHome) return
      const hide = km([aLat, aLng], [mk.trueLatLng.lat, mk.trueLatLng.lng]) < 0.025
      mk.hidden = hide
      mk.content.style.opacity = hide ? '0' : ''
      mk.content.style.pointerEvents = hide ? 'none' : ''
    })
  }
  useEffect(() => { if (ready) { hideUnderA(); arrangeHomes() } }, [start?.lat, start?.lng, fromLat, fromLon, allHomes, near, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const words = MODE_WORDS[mode]
  const placeName = start ? start.name : fromName
  const rides = chosen ? chosen.legs.filter((leg) => leg.mode !== 'WALK' && leg.mode !== 'BICYCLE') : []
  const chosenBuses = [...new Set(rides.filter((leg) => leg.mode === 'BUS' && leg.line).map((leg) => leg.line))]
  const routeLegs = chosen?.legs ?? []
  // direct buses: from the stop data, plus the planner's bus when its trip needs no change
  // (newer BusConnects lines such as E1 aren't in the stop data yet)
  const directBuses = near?.kind === 'transit'
    ? [...new Set([...(rides.length === 1 ? chosenBuses : []), ...near.busRoutes])].sort(naturalSort)
    : []
  // the drawn route's own time (so it matches the steps), once the journey planner has answered
  const showPlanned = start || choice === 'bus' || Boolean(chosen)
  const nearestBus = near?.kind === 'transit' ? near.busStops[0] : null
  const otherNearbyBuses = nearestBus && near?.kind === 'transit'
    ? near.busRoutes.filter((route) => !nearestBus.direct.includes(route))
    : []

  useEffect(() => { setShowAllNearbyRoutes(false) }, [start?.lat, start?.lng, mode])

  // the browser's location as the start (asked for only when the button is pressed)
  function useMyLocation() {
    setLocError('')
    if (!navigator.geolocation) { setLocError('Your browser can\'t share your location. Type your start instead.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false)
      const { latitude: lat, longitude: lng } = pos.coords
      if (!inDublin(lat, lng)) { setLocError('You seem to be outside Dublin. Type your start instead.'); return }
      setStart({ lat, lng, name: 'Your location' })
    }, () => { setLocating(false); setLocError('Location is blocked or unavailable. Allow it for this site, or type your start.') }, { enableHighAccuracy: true, timeout: 10000 })
  }

  return (
    <div className="route-map-wrap">
      <div className="rm-trip">
        <div className="rm-trip-ends" role="group" aria-label="Your trip">
          <div className="rm-trip-a">
            <p className="rm-trip-label" aria-hidden="true"><span>🔎</span> Where are you starting from? <em>Type a place to change point A</em></p>
            <div className="rm-trip-a-row">
            <PlaceSearch
              className="rm-search is-a"
              badge="A"
              label="Start point"
              placeholder="Type an address, Eircode, residence or station"
              value={placeName}
              onPick={(p) => { setLocError(''); setStart({ lat: p.lat, lng: p.lng, name: p.label }) }}
              onClear={() => setStart(null)}
            />
            <button type="button" className="rm-locate" onClick={useMyLocation} disabled={locating} title="Start from where you are now">
              <span aria-hidden="true">◎</span> {locating ? 'Finding you…' : 'My location'}
            </button>
            </div>
          </div>
          <div className="rm-trip-b">
            <b className="rm-trip-badge" aria-hidden="true">B</b>
            <span><small>To your university</small>{toName}</span>
          </div>
        </div>
        {locError && <p className="rm-trip-error" role="alert">{locError}</p>}
        <div className="rm-trip-result" aria-live="polite">
          <div className="route-numbers">
            {!showPlanned && (defaultMinutes != null
              ? <><strong>{defaultMinutes} min</strong><span>{defaultWords || words}{defaultKm != null && ` · ${defaultKm} km`} from {fromName}</span></>
              : <span>No time for this place yet.</span>)}
            {showPlanned && trip.status === 'loading' && <span className="route-loading">Working out the trip…</span>}
            {showPlanned && chosen && trip.status !== 'loading' && (
              <><strong>{Math.round(chosen.total_minutes)} min</strong><span>{!start && `From ${fromName} · `}{choice === 'bus' ? 'by bus' : rides.length || mode !== 'public_transport' ? words : 'on foot'} · {fmtKm(chosen.total_distance_km)}{rides.length ? ` · ${rideWords(chosen)}` : ''}{chosen.transfers ? ` · ${chosen.transfers} change${chosen.transfers > 1 ? 's' : ''}` : ''}</span></>
            )}
            {!start && chosen && choice !== 'bus' && defaultMinutes != null && Math.abs(Math.round(chosen.total_minutes) - defaultMinutes) >= 4 && (
              <small className="rm-trip-note">The match list shows {defaultMinutes} min: a typical weekday trip from the neighbourhood. This map plans the route for 9am.</small>
            )}
            {start && trip.status === 'estimate' && <><strong>≈ {trip.minutes} min</strong><span>{words} · {fmtKm(trip.km)} in a straight line (estimate)</span></>}
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
          {start && (
            <button type="button" className="route-reset" onClick={() => setStart(null)}>↺ Back to {fromName}</button>
          )}
        </div>
      </div>
      <div className="route-map-box">
        <div ref={boxRef} className="route-map" role="region" aria-label={`Google map of the trip from ${placeName} to ${toName}. Click the map to start from another place.`} />
        <div ref={tipRef} className="rm-gtip" role="tooltip" hidden />
      </div>
      <p className="route-legend rm-legend" aria-label="Map key">
        <span><i className="rm-key-a">A</i>Start</span>
        <span><i className="rm-key-b">B</i>University</span>
        {near?.kind === 'transit' && near.busStops.length + near.uniStops.length > 0 && <span><i className="rm-key-bus" dangerouslySetInnerHTML={{ __html: BUS_SVG }} />Bus stop</span>}
        {near?.luas && <span><i className="rm-key-pm" style={{ '--ring': LUAS_COLOURS[near.luas.kind] }}>🚊</i>Luas stop</span>}
        {near?.rail && <span><i className="rm-key-pm" style={{ '--ring': RING.rail }}>🚆</i>{near.rail.kind === 'DART' ? 'DART' : 'Train'} station</span>}
        {near?.kind === 'bikes' && <span><i className="rm-key-pm" style={{ '--ring': RING.bike }}>🚲</i>Dublin Bikes</span>}
        {allHomes.length > 0 && <span><i className="rm-key-pm" style={{ '--ring': RING.home }}>🏠</i>Student residence</span>}
        <em>Click the map or a 🏠 to start from there</em>
      </p>
      <section className="route-bus-details" aria-live="polite">
          <div className="route-bus-details-heading">
            <h3>{chosen && !rides.length ? `${mode === 'cycle' ? 'Cycling' : 'Walking'} route from A to B` : 'Route from A to B'}</h3>
          </div>
          {chosen && routeLegs.length > 0 ? (
            <ol className="route-bus-itinerary">
              {routeLegs.map((leg, index) => (
                <li key={`${leg.line ?? leg.mode}-${index}`}>
                  <strong>{leg.mode === 'WALK' ? 'Walk' : leg.mode === 'BICYCLE' ? 'Cycle' : rideName(leg)}</strong>
                  <span>{leg.mode === 'WALK' || leg.mode === 'BICYCLE'
                    ? `From ${index === 0 ? placeName : stopName(leg.from, 'the stop')} to ${index === routeLegs.length - 1 ? toName
                      : routeLegs[index + 1] && !['WALK', 'BICYCLE'].includes(routeLegs[index + 1].mode) ? `the ${rideName(routeLegs[index + 1])} stop at ${stopName(leg.to, 'the stop')}` : stopName(leg.to, 'the next stop')}`
                    : `Board at ${stopName(leg.from, 'the stop shown on the map')}${leg.headsign ? ` towards ${leg.headsign}` : ''}; get off at ${stopName(leg.to, toName)}`}
                    {legDetail(leg) && <small> · {legDetail(leg)}</small>}</span>
                </li>
              ))}
            </ol>
          ) : chosen ? (
            <p>No route steps were returned for this trip.</p>
          ) : trip.status === 'loading' ? (
            <p role="status">Finding the route…</p>
          ) : trip.status === 'estimate' ? (
            <p role="status">The journey planner isn&rsquo;t answering right now, so the time above is an estimate from the straight-line distance. The nearby stops below still show which buses go to {toName}.</p>
          ) : (
            <p role="status">Step-by-step directions are unavailable right now. The nearby stops below show which buses go to {toName}.</p>
          )}

          {mode === 'cycle' && near?.kind === 'bikes' && near.a && (
            <>
              <h4>Dublin Bikes</h4>
              <p><b>Near A:</b> <span>{near.a.name} · {fmtKm(near.a.m / 1000)}{near.a.bikes != null && ` · ${near.a.bikes} bike${near.a.bikes === 1 ? '' : 's'} free`}</span></p>
              {near.b && <p><b>Near the university:</b> <span>{near.b.name} · {fmtKm(near.b.m / 1000)}{near.b.stands != null && ` · ${near.b.stands} free stand${near.b.stands === 1 ? '' : 's'}`}</span></p>}
            </>
          )}
          {mode === 'public_transport' && near?.kind === 'transit' && (near.luas || near.rail) && (
            <>
              <h4>Luas and trains near A</h4>
              {near.luas && <p><b>Luas:</b> <span>{near.luas.name} · {near.luas.kind.replace('Luas ', '')} · {fmtKm(near.luas.m / 1000)}</span></p>}
              {near.rail && <p><b>{near.rail.kind === 'DART' ? 'DART' : 'Train'}:</b> <span>{near.rail.name} · {fmtKm(near.rail.m / 1000)}</span></p>}
            </>
          )}
          {mode === 'public_transport' && <>
          <h4>Nearby bus stops</h4>
          {near?.kind !== 'transit' ? (
            <p role="status">Finding bus stops near point A…</p>
          ) : !near.busDataAvailable ? (
            <p>Nearby bus-stop data is currently unavailable.</p>
          ) : nearestBus ? (
            <>
              <div className="route-bus-stop">
                <strong>{nearestBus.name}{nearestBus.ref ? ` · Stop ${nearestBus.ref}` : ''}</strong>
                <span>{fmtKm(nearestBus.m / 1000)} from point A</span>
              </div>
              <p>
                <b>Routes from this stop serving near point B:</b>
                {nearestBus.direct.length
                  ? <span className="route-bus-chips">{nearestBus.direct.map((route) => <span className="route-bus-chip is-direct" key={route}>{route}</span>)}</span>
                  : <span>No direct route from this stop was found.</span>}
              </p>
              {nearestBus.routes.some((route) => !nearestBus.direct.includes(route)) && (
                <p>
                  <b>Other buses at this stop:</b>
                  <span className="route-bus-chips">{nearestBus.routes.filter((route) => !nearestBus.direct.includes(route)).map((route) => (
                    <span className="route-bus-chip" key={route}>{route}</span>
                  ))}</span>
                </p>
              )}
              {otherNearbyBuses.length > 0 && (
                <p>
                  <b>Direct routes from other nearby stops:</b>
                  <span className="route-bus-chips" id="nearby-bus-routes">{(showAllNearbyRoutes ? otherNearbyBuses : otherNearbyBuses.slice(0, 3)).map((route) => (
                    <span className="route-bus-chip is-direct" key={route}>{route}</span>
                  ))}</span>
                  {otherNearbyBuses.length > 3 && (
                    <button
                      type="button"
                      className="route-bus-more"
                      aria-expanded={showAllNearbyRoutes}
                      aria-controls="nearby-bus-routes"
                      onClick={() => setShowAllNearbyRoutes((shown) => !shown)}
                    >
                      {showAllNearbyRoutes ? 'Show fewer' : `View all ${otherNearbyBuses.length} routes`}
                    </button>
                  )}
                </p>
              )}
            </>
          ) : (
            <p>No bus stops were found within 450 m of point A.</p>
          )}
          </>}
          {homes.length > 0 && (
            <>
              <h4>Student residences nearby</h4>
              <p><span>{homes.length} on the map: {homes.slice(0, 3).map((r) => r.name).join(', ')}{homes.length > 3 ? ` and ${homes.length - 3} more` : ''}. Click one to start the trip there.</span></p>
            </>
          )}
      </section>
    </div>
  )
}

export default RouteMap
