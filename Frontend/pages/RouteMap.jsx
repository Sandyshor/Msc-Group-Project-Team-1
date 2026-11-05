// "Getting there" on the results page: the route from a match to the university by one way of travelling.
// The line comes from the journey planner (GET /route, OpenTripPlanner); if it isn't reachable, a straight
// line joins the two places instead. The times and distances shown beside the map are the recommender's.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// '' = same address as the website (Azure serves both); unset = the Render API.
const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'

// recommender travel mode -> /route mode
const ROUTE_MODES = { public_transport: 'transit', walk: 'walk', cycle: 'bike' }
const LEG_COLOURS = { WALK: '#5f6f67', BICYCLE: '#a8753f' }
const TRANSIT_COLOUR = '#173f32'

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

function pin(className, label) {
  return L.divIcon({ className: 'route-pin-wrap', html: `<span class="route-pin ${className}">${label}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] })
}

function RouteMap({ fromLat, fromLon, fromName, toLat, toLon, toName, mode }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const [straight, setStraight] = useState(false)

  useEffect(() => {
    const map = L.map(boxRef.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map) return undefined
    const controller = new AbortController()
    const ends = [[fromLat, fromLon], [toLat, toLon]]

    function draw(lines) {
      layer.clearLayers()
      L.marker(ends[0], { icon: pin('route-pin-from', 'A'), title: fromName }).bindTooltip(fromName).addTo(layer)
      L.marker(ends[1], { icon: pin('route-pin-to', 'B'), title: toName }).bindTooltip(toName).addTo(layer)
      lines.forEach(({ points, colour, dashed }) => {
        L.polyline(points, { color: colour, weight: 5, opacity: 0.85, dashArray: dashed ? '6 8' : null }).addTo(layer)
      })
      const all = lines.flatMap((line) => line.points)
      map.fitBounds(L.latLngBounds(all.length ? all : ends), { padding: [24, 24], maxZoom: 15 })
    }

    draw([{ points: ends, colour: '#9aa79f', dashed: true }])
    const query = new URLSearchParams({
      from_lat: fromLat, from_lon: fromLon, to_lat: toLat, to_lon: toLon,
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
        }))
        if (!lines.length) throw new Error('no route line')
        setStraight(false)
        draw(lines)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setStraight(true)
      })
    return () => controller.abort()
  }, [fromLat, fromLon, fromName, toLat, toLon, toName, mode])

  return (
    <div className="route-map-wrap">
      <div ref={boxRef} className="route-map" role="img" aria-label={`Route from ${fromName} to ${toName}`} />
      {straight && (
        <p className="route-map-note">The route line isn't available right now, so the map shows a straight line.</p>
      )}
    </div>
  )
}

export default RouteMap
