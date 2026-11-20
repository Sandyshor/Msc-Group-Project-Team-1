// The side panel for a place clicked on the district map, like Google Maps: a photo and description, the address,
// Directions / Start here buttons, how far the universities are, the nearest Luas, train and bus stops, what's
// within 500 m, and the district it's in. Descriptions come from the site's own data (famous places, attractions,
// residences); a landmark or campus without one gets the first lines of its Wikipedia article (checked to be the
// same place by its coordinates).
import { useEffect, useState } from 'react';
import { streetAddress, streetName } from './placeNames';
import { rentFor } from './rents';
import { strongColor } from './mapShared';
import { universities as campusList } from './cityPlaces';
import { campusGuide, attractionGuide } from '../pages/CityGuide';
import { API_BASE } from './journey';
import { DAYS, dayText, openStatus, parseOpeningHours, readableHours, todayIndex } from './openingHours';
import './PlacePanel.css';

const BIKES_STATUS_URL = 'https://api.cyclocity.fr/contracts/dublin/gbfs/v2/station_status.json';
const WALK_M_PER_MIN = 80;

const KIND_LABEL = {
  campus: 'University or college campus', residence: 'Student residence', bus: 'Bus stop', bike: 'Dublin Bikes station',
  point: 'Dropped pin', search: 'Search result', landmark: 'Landmark', famous: 'Famous place', amenity: 'Place',
};
const KIND_ICON = {
  campus: '🎓', residence: '🏠', bus: '🚌', luas: '🚊', rail: '🚆', bike: '🚲', point: '📍', search: '📍', landmark: '🏛️', famous: '⭐', amenity: '🏪',
};

// Icon by the kind of place OpenStreetMap or the map says it is
const TYPE_ICON = {
  'Hair salon': '💇', Salon: '💇', 'Beauty salon': '💅', 'Nail salon': '💅', Barber: '💈', Café: '☕', Restaurant: '🍽️', 'Asian restaurant': '🍜',
  'Fast food': '🍔', Pub: '🍺', Bar: '🍸', Park: '🌳', Garden: '🌷', Playground: '🛝', Pharmacy: '💊', Gym: '🏋️', Supermarket: '🛒',
  Grocery: '🧺', 'Convenience shop': '🧺', Hospital: '🏥', "Doctor's surgery (GP)": '🩺', Dentist: '🦷', Library: '📚', Bank: '🏦',
  Cinema: '🎬', Theatre: '🎭', Museum: '🏛️', 'Shopping centre': '🛍️', 'Clothes shop': '👕', Bakery: '🥐', Hotel: '🏨', 'Post office': '📮',
};

// Soft colour behind the icon when a place has no photo at all
const TYPE_TINT = {
  'Hair salon': '#f3dbe6', Salon: '#f3dbe6', 'Beauty salon': '#f3dbe6', 'Nail salon': '#f3dbe6', Barber: '#e3e0f2', Café: '#efe1d1',
  Restaurant: '#f6dfcf', 'Asian restaurant': '#f6dfcf', 'Fast food': '#f6dfcf', Pub: '#efe3c8', Bar: '#efe3c8', Park: '#d8ecd6', Garden: '#e1efd6',
  Playground: '#d8ecd6', Pharmacy: '#e6ddf1', Gym: '#e0dcf4', Supermarket: '#d7e6f3', Grocery: '#d7e6f3', 'Convenience shop': '#d7e6f3',
  Hospital: '#f3d9d7', bus: '#fbefc4', luas: '#f3d9d7', rail: '#dcefd0', bike: '#d6e6f5', residence: '#e7dcf0', campus: '#dbe8e2',
};

// Irish chains with no logo file on Wikimedia Commons: drawn with the map's brand word logo instead
const BRAND_BADGES = [[/^daybreak\b/i, 'daybreak', 'DAYBREAK'], [/^gala\b/i, 'gala', 'GALA'], [/^polonez\b/i, 'polonez', 'POLONEZ'], [/^day[- ]?today\b/i, 'daytoday', 'DAY-TODAY'], [/^boots\b/i, 'boots', 'Boots']];

const norm = (v) => String(v || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
const euro = (v) => `€${Math.round(v).toLocaleString('en-IE')}`;
function metres(a, b) {
  const dy = (b[0] - a[0]) * 110540;
  const dx = (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
const distanceText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
const walkText = (m) => `${Math.max(1, Math.round((m * 1.25) / WALK_M_PER_MIN))} min walk`; // streets are ~25% longer than a straight line
const shortCampus = (name) => name
  .replace('Technological University Dublin — ', 'TU Dublin ')
  .replace('University College Dublin — ', 'UCD ')
  .replace('Dublin City University — ', 'DCU ')
  .replace(/ Campus$/, '');
const titleCase = (v) => String(v || '').toLowerCase().replace(/(^|[\s&-])\w/g, (c) => c.toUpperCase());

// The site's own information about a place with this name (attractions page, Universities page, district places)
function siteInfo(place, placesByDistrict) {
  // a spot clicked on the map only borrows its nearest place's name for the subtitle, never its photo or address
  if (place.kind === 'point') return { description: '', image: '', address: '', url: '', category: '' };
  const names = (place.names || [place.name]).map(norm);
  const matches = (n) => names.some((x) => x === norm(n) || (norm(n).length > 6 && x.startsWith(norm(n))));
  const attraction = attractionGuide.find((a) => matches(a.name));
  const campus = campusGuide.find((c) => matches(c.name));
  const districtPlace = Object.values(placesByDistrict || {}).flat().find((p) => matches(p.name) && p.description);
  return {
    description: place.description || attraction?.detail || districtPlace?.description || '',
    image: place.image || attraction?.image || campus?.image || districtPlace?.image || '',
    address: attraction?.location || campus?.location || '',
    url: attraction?.url || campus?.url || '',
    category: attraction ? titleCase(attraction.category) : '',
  };
}

// Student residences, for a residence picked in the search box (the map pins already carry their details)
let residences = null;
const loadResidences = () => (residences ??= fetch('/data/student-residences.json').then((r) => (r.ok ? r.json() : {})).then((d) => d.residences || []).catch(() => []));

// First lines of the Wikipedia article about a named place: the article's title must be the place's name and the
// article must be about a spot within 1 km (so "Beckett House" never gets the Samuel Beckett Bridge article)
async function wikipediaSummary(name, lat, lng, signal) {
  const core = norm(name.split(' — ')[0]).replace(/ campus$/, '');
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `${name} Dublin`, gsrlimit: '4',
    prop: 'extracts|pageimages|coordinates|info', exintro: '1', explaintext: '1', exsentences: '3', piprop: 'thumbnail', pithumbsize: '640', inprop: 'url',
  });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal });
  if (!r.ok) return null;
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  const sameName = (title) => { const t = norm(title.replace(/\s*\(.*\)$/, '')); return t === core || (t.length > 5 && core.startsWith(t)) || (core.length > 5 && t.startsWith(core)); };
  const page = pages.find((p) => p.extract && sameName(p.title) && p.coordinates?.[0] && metres([lat, lng], [p.coordinates[0].lat, p.coordinates[0].lon]) < 1000);
  return page ? { extract: page.extract, image: page.thumbnail?.source || '', url: page.fullurl, title: page.title } : null;
}

// "indian;pizza" -> "Indian, Pizza"
const listText = (v) => String(v || '').split(';').map((x) => x.trim().replace(/_/g, ' ')).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(', ');
const urlOf = (v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);
const telOf = (v) => String(v || '').split(';')[0].trim();
// What a place offers, from its OpenStreetMap tags, as short phrases
function offers(t) {
  const out = [];
  if (t.cuisine) out.push(`🍽️ ${listText(t.cuisine)}`);
  if (['yes', 'only'].includes(t['diet:vegan'])) out.push('🌱 Vegan options'); else if (['yes', 'only'].includes(t['diet:vegetarian'])) out.push('🥗 Vegetarian options');
  if (['yes', 'only'].includes(t['diet:halal'])) out.push('Halal options');
  if (t.wheelchair === 'yes') out.push('♿ Wheelchair accessible'); else if (t.wheelchair === 'limited') out.push('♿ Partly wheelchair accessible'); else if (t.wheelchair === 'no') out.push('Not wheelchair accessible');
  if (t.takeaway === 'yes' || t.takeaway === 'only') out.push(t.takeaway === 'only' ? 'Takeaway only' : 'Takeaway');
  if (t.delivery === 'yes') out.push('Delivery');
  if (t.outdoor_seating === 'yes') out.push('Outdoor seating');
  if (['wlan', 'yes'].includes(t.internet_access)) out.push('📶 Wi-Fi');
  if (t.toilets === 'yes') out.push('Toilets');
  if (t.fee === 'no') out.push('Free entry'); else if (t.fee === 'yes') out.push('Entry fee');
  if (t['payment:contactless'] === 'yes' || t['payment:cards'] === 'yes') out.push('💳 Cards accepted');
  if (t['payment:cash'] === 'no') out.push('Card only');
  if (t.dog === 'yes') out.push('🐕 Dogs welcome');
  if (t.unisex === 'yes') out.push('Unisex');
  if (t.drive_through === 'yes') out.push('Drive-through');
  if (t.student === 'yes') out.push('🎓 Student discount');
  return out;
}

const unnamedName = (name) => !name || /^(Near |Dropped pin)/.test(name);

export default function PlacePanel({ place, data, mapApi, placesByDistrict, selectedId, hasDirections, onOpen, onClose, onDirectionsTo, onDirectionsFrom, onRoute, onOpenDistrict }) {
  const [address, setAddress] = useState('');
  const [wiki, setWiki] = useState(null);
  const [near, setNear] = useState(null);
  const [bike, setBike] = useState('');
  const [found, setFound] = useState(null); // a searched residence's details
  const [osm, setOsm] = useState(null); // opening hours, phone, website... from OpenStreetMap (GET /place-info)
  const key = `${place.lat},${place.lng},${place.name}`;
  const info = siteInfo(place, placesByDistrict);
  const res = place.residence || found;
  // the shop, salon, park... OpenStreetMap knows at this spot
  const transport = ['bus', 'luas', 'rail', 'bike'].includes(place.kind);
  const o = transport ? null : osm?.place; // a stop's own details are shown below; OpenStreetMap only adds its photo
  // a spot clicked on the map is titled by its street address (its nearest named place is shown underneath),
  // unless it was right on a shop or inside a park: then it's that place, like Google Maps
  const spotIsPlace = place.kind === 'point' && o?.name;
  const unnamed = (name) => (place.kind === 'point' && !spotIsPlace) || unnamedName(name);

  useEffect(() => {
    setAddress(''); setWiki(null); setNear(null); setBike(''); setFound(null); setOsm(null);
    const ctrl = new AbortController();
    let alive = true;
    // opening hours and contact details (not for bus, Luas, train and bike stations: the panel has their own details)
    {
      setOsm({ loading: true });
      const named = place.kind !== 'point' && !unnamedName(place.name);
      const params = new URLSearchParams({ lat: place.lat.toFixed(6), lng: place.lng.toFixed(6) });
      if (named) params.set('name', (place.names?.[0] || place.name).split(' — ')[0]);
      fetch(`${API_BASE}/place-info?${params}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => { if (alive) setOsm(d); })
        .catch(() => { if (alive) setOsm({ error: true }); });
    }
    if (place.kind === 'residence' && !place.residence) loadResidences().then((list) => { if (alive) setFound(list.find((r) => norm(r.name) === norm(place.name)) || null); });
    // the street address (OpenStreetMap), unless the site already has one
    if (!res?.address && !info.address) (unnamed(place.name) ? streetName : streetAddress)(place.lat, place.lng).then((a) => { if (alive && a) setAddress(a); });
    mapApi?.nearby(place.lat, place.lng).then((n) => { if (alive) setNear(n); }).catch(() => {});
    // Wikipedia when the site has no description, or only a line or two
    if (info.description.length < 160 && !unnamed(place.name) && ['campus', 'landmark', 'famous', 'search'].includes(place.kind)) {
      wikipediaSummary(place.names?.[0] || place.name, place.lat, place.lng, ctrl.signal).then((w) => { if (alive) setWiki(w); }).catch(() => {});
    }
    if (place.kind === 'bike' && place.dock) {
      setBike('Checking live availability…');
      fetch(BIKES_STATUS_URL).then((r) => r.json()).then((j) => {
        const x = (j.data?.stations || []).find((st) => String(st.station_id) === String(place.dock.id));
        if (!alive) return;
        if (!x) setBike('No live data for this station right now.');
        else if (!x.is_installed || !x.is_renting) setBike('This station is closed at the moment.');
        else {
          const ebikes = x.vehicle_types_available?.find((v) => v.vehicle_type_id === 'electrical')?.count ?? 0;
          setBike(`${x.num_bikes_available} bikes${ebikes ? ` (${ebikes} electric)` : ''} · ${x.num_docks_available} free stands`);
        }
      }).catch(() => { if (alive) setBike('Live availability could not be loaded.'); });
    }
    return () => { alive = false; ctrl.abort(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A spot that turned out to be a park or named place: its Wikipedia description, as for places clicked by name
  useEffect(() => {
    if (!spotIsPlace || info.description || wiki) return undefined;
    let alive = true;
    wikipediaSummary(o.name, place.lat, place.lng).then((w) => { if (alive) setWiki(w); }).catch(() => {});
    return () => { alive = false; };
  }, [spotIsPlace, o?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // On a phone the panel slides up from the bottom: bring the map to the top of the screen so it stays visible above it
  useEffect(() => {
    if (window.innerWidth > 1100) return;
    const map = document.querySelector('.district-map');
    const top = map?.getBoundingClientRect().top ?? 0;
    if (map && (top < 0 || top > 120)) map.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [key]);

  // Escape closes the panel
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const code = place.district;
  const profile = code && data.profiles[code];
  const fullAddress = res?.address || info.address || address;
  const title = spotIsPlace ? o.name : unnamed(place.name) ? (address || place.name || 'Dropped pin') : place.name;
  const subtitle = !spotIsPlace && unnamed(place.name) && address && place.name && place.name !== 'Dropped pin' ? (place.name.startsWith('Near ') ? place.name : `Near ${place.name}`) : '';
  const tags = o?.tags || {};
  const osmStreet = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const osmWebsite = urlOf(tags.website || tags['contact:website'] || tags.url);
  const phone = telOf(tags.phone || tags['contact:phone'] || tags.mobile || tags['contact:mobile']);
  const email = tags.email || tags['contact:email'];
  const booking = urlOf(tags.booking || tags['website:booking'] || (/^https?:/.test(tags.reservation || '') ? tags.reservation : ''));
  const hoursText = tags.opening_hours;
  const week = parseOpeningHours(hoursText);
  const status = openStatus(week);
  const today = todayIndex();
  const offerList = offers(tags);
  const social = [['Instagram', tags['contact:instagram']], ['Facebook', tags['contact:facebook']]].filter(([, v]) => v)
    .map(([label, v]) => [label, /^https?:/.test(v) ? v : `https://www.${label.toLowerCase()}.com/${v.replace(/^@/, '')}`]);
  const kicker = place.kind === 'luas' ? `Luas stop · ${place.line} line`
    : place.kind === 'rail' ? (place.dart ? 'DART and rail station' : 'Rail station')
      : (place.kind === 'point' || place.kind === 'amenity' || place.kind === 'search') && o?.type ? o.type
      : place.kind === 'amenity' || place.kind === 'search' ? (place.category || KIND_LABEL[place.kind])
        : place.kind === 'campus' ? KIND_LABEL.campus
          : info.category || (place.kind === 'landmark' && place.category) || KIND_LABEL[place.kind] || 'Place';
  // the site's own photo, else the place's photo from OpenStreetMap / its website (backend), else Wikipedia's
  const fetched = osm?.place?.photo || osm?.photo;
  const osmPhoto = !info.image && fetched?.url ? fetched : null;
  const image = info.image || osmPhoto?.url || wiki?.image || '';
  const description = info.description || wiki?.extract || '';
  const wikiExtra = info.description && wiki?.extract && !wiki.extract.startsWith(info.description.slice(0, 30)) ? wiki.extract : '';
  const website = res?.website || info.url || '';
  const here = [place.lat, place.lng];
  const campuses = campusList
    .map((c) => ({ ...c, m: metres(here, c.coordinates) }))
    .filter((c) => c.m > 120) // not the campus itself
    .sort((a, b) => a.m - b.m)
    .slice(0, 5);
  const point = { lat: place.lat, lng: place.lng, label: title };
  const roomRent = profile && rentFor(data, code, 'single');
  const safety = profile && data.safety?.[code];
  const line = place.kind === 'luas' && data.lines?.[place.line?.toLowerCase()];
  const busRoutes = place.kind === 'bus' ? [...new Set((place.stops || []).flatMap((x) => String(x.routes || '').split(';').map((r) => r.trim()).filter(Boolean)))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : [];
  const busRefs = place.kind === 'bus' ? (place.stops || []).map((x) => x.ref).filter(Boolean) : [];
  const googleMaps = `https://www.google.com/maps/search/?api=1&query=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;

  return (
    <aside className="profile-card side-panel place-panel" aria-label={`Details: ${title}`} key={key}>
      <div className="pp-top">
        <button type="button" className="pp-back" onClick={onClose}>
          ← {hasDirections ? 'Back to directions' : selectedId ? `Back to ${selectedId} profile` : 'Back'}
        </button>
        <button type="button" className="pp-close" aria-label="Close details" onClick={onClose}>×</button>
      </div>

      {BRAND_BADGES.find(([re]) => re.test(title)) && !info.image ? (() => {
        const [, key, text] = BRAND_BADGES.find(([re]) => re.test(title));
        return <div className="pp-brand-badge" role="img" aria-label={`${title} logo`}><span className={`jp-brand-logo jp-brand-logo-${key}`}>{text}</span></div>;
      })() : image ? (
        <div className={`pp-photo${osmPhoto?.logo ? ' is-logo' : ''}`}>
          <img src={image} alt={osmPhoto?.logo ? `${title} logo` : title} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.parentElement.hidden = true; }} />
          {osmPhoto && (osmPhoto.page
            ? <a className="pp-photo-credit" href={osmPhoto.page} target="_blank" rel="noopener noreferrer">{osmPhoto.logo ? 'Logo' : osmPhoto.street ? 'Street view' : 'Photo'} · {osmPhoto.source}</a>
            : <span className="pp-photo-credit">{osmPhoto.street ? 'Street view' : 'Photo'} · {osmPhoto.source}</span>)}
        </div>
      ) : (
        <div className={`pp-photo pp-photo-icon${osm?.loading && !wiki ? ' is-loading' : ''}`} aria-hidden="true" style={{ '--tint': TYPE_TINT[o?.type || place.category] || TYPE_TINT[place.kind] || '#dfe9dc' }}>
          <span>{TYPE_ICON[o?.type || place.category] || KIND_ICON[place.kind] || '📍'}</span>
        </div>
      )}

      <div className="pp-body">
        <p className="pp-kicker">{kicker}{code && profile ? ` · ${code}` : ''}</p>
        <h2 className="pp-title">{title}</h2>
        {subtitle && <p className="pp-sub">{subtitle}</p>}
        {(fullAddress || osmStreet) && (fullAddress || osmStreet) !== title && <p className="pp-address"><span aria-hidden="true">📍</span>{fullAddress || osmStreet}</p>}
        {status && <p className={`pp-status${status.open ? ' is-open' : ' is-closed'}${status.closingSoon ? ' is-soon' : ''}`}><b>{status.text.split(' · ')[0]}</b>{status.text.includes(' · ') ? ` · ${status.text.split(' · ')[1]}` : ''}</p>}

        <div className="pp-actions">
          <button type="button" className="pp-act is-primary" onClick={() => onDirectionsTo(point)}>
            <span className="pp-act-icon" aria-hidden="true">➜</span>Directions
          </button>
          <button type="button" className="pp-act" onClick={() => onDirectionsFrom(point)}>
            <span className="pp-act-icon" aria-hidden="true">◎</span>Start here
          </button>
          {profile && code !== selectedId && (
            <button type="button" className="pp-act" onClick={() => onOpenDistrict(code)}>
              <span className="pp-act-icon" aria-hidden="true">▦</span>{code} profile
            </button>
          )}
          {(website || osmWebsite) && (
            <a className="pp-act" href={website || osmWebsite} target="_blank" rel="noopener noreferrer">
              <span className="pp-act-icon" aria-hidden="true">↗</span>Website
            </a>
          )}
          {phone && (
            <a className="pp-act" href={`tel:${phone.replace(/[^+\d]/g, '')}`}>
              <span className="pp-act-icon" aria-hidden="true">✆</span>Call
            </a>
          )}
        </div>

        {osm?.loading && (
          <section className="pp-section">
            <h3>Opening hours and contact</h3>
            <div className="pp-skeleton"><span /><span /></div>
          </section>
        )}

        {o && (
          <section className="pp-section pp-hours">
            <h3>{o.appointment ? 'Opening hours and appointments' : 'Opening hours and contact'}</h3>
            {week ? (
              <table className="pp-week">
                <tbody>
                  {week.map((ranges, d) => (
                    <tr key={DAYS[d]} className={d === today ? 'is-today' : ''}><th scope="row">{DAYS[d]}</th><td>{dayText(ranges)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : hoursText ? <p className="pp-line">{readableHours(hoursText)}</p>
              : (
                <div className="pp-nohours">
                  <p className="pp-note">{o.key === 'leisure' && /park|garden|nature/.test(o.value || '') ? `Opening hours aren’t listed for ${o.name}. Many city parks close at dusk, so check before an evening visit.` : `Opening hours aren’t listed for ${o.name} on OpenStreetMap.`}</p>
                  <a className="pp-act" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.name} ${fullAddress || osmStreet || 'Dublin'}`)}`} target="_blank" rel="noopener noreferrer">🕒 Hours and reviews on Google Maps ↗</a>
                </div>
              )}
            {o.appointment && (
              <div className="pp-book">
                {booking || osmWebsite || phone
                  ? <p><b>Booking an appointment:</b> {booking || osmWebsite ? 'book online' : ''}{(booking || osmWebsite) && phone ? ' or ' : ''}{phone ? `call ${phone}` : ''}. Walk-ins may be possible, but booking ahead is safer.</p>
                  : <p><b>Booking an appointment:</b> no booking link or phone number is listed. Drop in to book, or find their contact details on Google Maps.</p>}
                <div className="pp-book-actions">
                  {(booking || osmWebsite) && <a className="pp-act is-primary" href={booking || osmWebsite} target="_blank" rel="noopener noreferrer">📅 Book online</a>}
                  {phone && <a className="pp-act" href={`tel:${phone.replace(/[^+\d]/g, '')}`}>✆ Call to book</a>}
                </div>
              </div>
            )}
            {!o.appointment && /^(yes|required|recommended)$/.test(tags.reservation || '') && (
              <p className="pp-line"><b>Reservations:</b> {tags.reservation === 'required' ? 'needed, book ahead' : tags.reservation === 'recommended' ? 'recommended' : 'taken'}{phone ? ` (call ${phone})` : ''}.</p>
            )}
            <dl className="pp-facts">
              {phone && <div><dt>Phone</dt><dd><a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a></dd></div>}
              {osmWebsite && <div><dt>Website</dt><dd><a href={osmWebsite} target="_blank" rel="noopener noreferrer">{osmWebsite.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></dd></div>}
              {email && <div><dt>Email</dt><dd><a href={`mailto:${email}`}>{email}</a></dd></div>}
              {social.map(([label, url]) => <div key={label}><dt>{label}</dt><dd><a href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\/(www\.)?/, '')}</a></dd></div>)}
              {tags.operator && tags.operator !== o.name && <div><dt>Run by</dt><dd>{tags.operator}</dd></div>}
              {tags.level && <div><dt>Floor</dt><dd>{tags.level === '0' ? 'Ground floor' : `Level ${tags.level}`}</dd></div>}
            </dl>
          </section>
        )}

        {o && offerList.length > 0 && (
          <section className="pp-section">
            <h3>Good to know</h3>
            <div className="pp-chips">{offerList.map((x) => <span key={x} className="pp-count">{x}</span>)}</div>
            {tags.description && <p className="pp-line pp-osm-desc">{tags.description}</p>}
          </section>
        )}

        {osm?.inside && (!o || osm.inside.name !== o.name) && (
          <p className="pp-inside">Inside <b>{osm.inside.name}</b>{osm.inside.type ? ` · ${osm.inside.type}` : ''}</p>
        )}

        {description && (
          <section className="pp-section">
            <p className="pp-desc">{description}</p>
            {wikiExtra && <p className="pp-desc pp-desc-more">{wikiExtra}</p>}
            {(!info.description || wikiExtra) && wiki && <a className="pp-credit" href={wiki.url} target="_blank" rel="noopener noreferrer">From Wikipedia: {wiki.title} ↗</a>}
          </section>
        )}

        {res && (
          <section className="pp-section">
            <h3>Rooms and prices</h3>
            <dl className="pp-facts">
              {res.from && <div><dt>Price</dt><dd>{euro(res.from)}{res.to && res.to !== res.from ? ` – ${euro(res.to)}` : ''} a month</dd></div>}
              {res.rooms && <div><dt>Rooms</dt><dd>{res.rooms}</dd></div>}
              {res.operator && <div><dt>Run by</dt><dd>{res.operator}</dd></div>}
            </dl>
            {res.approx && <p className="pp-note">The pin is placed approximately; check the address on the residence's website.</p>}
          </section>
        )}

        {place.kind === 'bus' && (busRefs.length > 0 || busRoutes.length > 0) && (
          <section className="pp-section">
            <h3>Bus stop</h3>
            {busRefs.length > 0 && <p className="pp-line">Stop number{busRefs.length > 1 ? 's' : ''} {busRefs.join(', ')}</p>}
            {busRoutes.length > 0 && <div className="pp-chips">{busRoutes.map((r) => <span key={r} className="pp-route">{r}</span>)}</div>}
          </section>
        )}

        {place.kind === 'luas' && line && (
          <section className="pp-section">
            <h3>Luas {place.line} line</h3>
            <p className="pp-line">A tram about every {line.peak || line.interval} minutes at peak times{line.peak && line.interval ? `, every ${line.interval} minutes off-peak` : ''}.</p>
          </section>
        )}

        {place.kind === 'bike' && (
          <section className="pp-section">
            <h3>Dublin Bikes</h3>
            {place.dock?.address && place.dock.address !== place.name && <p className="pp-line">{place.dock.address}</p>}
            <p className="pp-line"><b>{bike}</b></p>
            {place.dock?.capacity && <p className="pp-note">{place.dock.capacity} stands in total.</p>}
          </section>
        )}

        <section className="pp-section">
          <h3>Distance to universities</h3>
          <p className="pp-note">Straight-line distance. Press <b>Route</b> for travel times by bus, Luas, train, walking or bike.</p>
          <ul className="pp-list">
            {campuses.map((c) => (
              <li key={c.id}>
                <span className="pp-li-icon" aria-hidden="true">🎓</span>
                <span className="pp-li-text"><b>{shortCampus(c.name)}</b><small>{distanceText(c.m)}</small></span>
                <button type="button" className="pp-mini" aria-label={`Route from ${title} to ${c.name}`}
                  onClick={() => onRoute(point, { lat: c.coordinates[0], lng: c.coordinates[1], label: c.name })}>Route</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="pp-section">
          <h3>Getting around</h3>
          {!near && <div className="pp-skeleton"><span /><span /><span /></div>}
          {near && (
            <ul className="pp-list">
              {near.luas && near.luas.m < 2500 && (
                <li><span className="pp-li-icon" aria-hidden="true">🚊</span><span className="pp-li-text"><b>{near.luas.name}</b><small>Luas {near.luas.line} line · {distanceText(near.luas.m)} · {walkText(near.luas.m)}</small></span></li>
              )}
              {near.rail && near.rail.m < 2500 && (
                <li><span className="pp-li-icon" aria-hidden="true">🚆</span><span className="pp-li-text"><b>{near.rail.name}</b><small>{near.rail.dart ? 'DART and rail' : 'Rail'} · {distanceText(near.rail.m)} · {walkText(near.rail.m)}</small></span></li>
              )}
              {near.bus && near.bus.m < 1500 && place.kind !== 'bus' && (
                <li><span className="pp-li-icon" aria-hidden="true">🚌</span><span className="pp-li-text"><b>{near.bus.name}</b><small>Bus stop{near.bus.ref ? ` ${near.bus.ref}` : ''} · {distanceText(near.bus.m)} · {walkText(near.bus.m)}</small></span></li>
              )}
              {!(near.luas?.m < 2500) && !(near.rail?.m < 2500) && !(near.bus?.m < 1500) && <li className="pp-empty">No Luas, train or bus stop found close by.</li>}
            </ul>
          )}
        </section>

        {near?.counts && (
          <section className="pp-section">
            <h3>Within 500 m</h3>
            {near.counts.length
              ? <div className="pp-chips">{near.counts.map(([label, n]) => <span key={label} className="pp-count"><b>{n}</b> {n === 1 ? label.replace(/s( &|$)/, '$1').replace('Pharmacie', 'Pharmacy') : label.toLowerCase()}</span>)}</div>
              : <p className="pp-note">No shops, cafés or other places listed within 500 m.</p>}
          </section>
        )}

        {profile && (
          <section className="pp-section pp-district" style={{ '--hue': strongColor(profile.hue) }}>
            <h3>In {code} · {profile.name}</h3>
            <dl className="pp-facts">
              {roomRent && <div><dt>Single room</dt><dd>{euro(roomRent.value)} a month</dd></div>}
              {safety?.score != null && <div><dt>Safety score</dt><dd>{Math.round(safety.score)} / 100 · {safety.tier}</dd></div>}
              <div><dt>Side</dt><dd>{profile.side || 'County Dublin'}</dd></div>
            </dl>
            {code !== selectedId
              ? <button type="button" className="pp-wide" onClick={() => onOpenDistrict(code)}>Open the {code} profile: rent, safety and amenities</button>
              : <button type="button" className="pp-wide" onClick={onClose}>Back to the {code} profile</button>}
          </section>
        )}

        {osm?.nearby?.length > 0 && (
          <section className="pp-section">
            <h3>Places here</h3>
            <ul className="pp-list">
              {osm.nearby.slice(0, 6).map((n) => {
                const st = openStatus(parseOpeningHours(n.tags?.opening_hours));
                return (
                  <li key={`${n.name}${n.lat}`}>
                    <button type="button" className="pp-near" onClick={() => onOpen?.({ kind: 'amenity', name: n.name, category: n.type, lat: n.lat, lng: n.lng })}>
                      <span className="pp-li-text"><b>{n.name}</b><small>{[n.type, n.distance_m != null ? distanceText(n.distance_m) : '', st?.text.split(' · ')[0]].filter(Boolean).join(' · ')}</small></span>
                      <span aria-hidden="true">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {o && (
          <p className="pp-osm-credit">
            Opening hours and contact details come from OpenStreetMap and can be out of date, so check with the place before you go.{' '}
            <a href={o.osm} target="_blank" rel="noopener noreferrer">See it on OpenStreetMap ↗</a>
          </p>
        )}
        {osm?.error && <p className="pp-osm-credit">Opening hours couldn&rsquo;t be loaded right now. Try again in a moment.</p>}

        <p className="pp-foot">
          <a href={googleMaps} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>
          <span>{place.lat.toFixed(5)}, {place.lng.toFixed(5)}</span>
        </p>
      </div>
    </aside>
  );
}
