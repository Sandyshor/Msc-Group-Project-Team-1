// Loads the Google Maps JavaScript API once (key and map ID from the build settings: VITE_GOOGLE_MAPS_API_KEY and
// VITE_GOOGLE_MAP_ID, never written in the code). Without a key, or when Google refuses it (wrong website, daily
// limit reached), the district page keeps its own map instead.
export const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
export const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID';
export const hasGoogleMaps = () => Boolean(GOOGLE_KEY);

let loading = null;
const failureListeners = new Set();
let failed = false;

// Google calls this global function when the key is refused (not allowed on this website, API not enabled,
// billing or quota problems). The map then shows Google's error, so the page switches to its own map.
if (typeof window !== 'undefined') {
  window.gm_authFailure = () => {
    failed = true;
    failureListeners.forEach((fn) => fn());
  };
}

export function onGoogleFailure(fn) {
  if (failed) fn();
  failureListeners.add(fn);
  return () => failureListeners.delete(fn);
}

export function loadGoogleMaps() {
  if (!GOOGLE_KEY) return Promise.reject(new Error('No Google Maps key'));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const callback = '__fmdGoogleMapsReady';
    window[callback] = () => resolve(window.google.maps);
    const script = document.createElement('script');
    const params = new URLSearchParams({ key: GOOGLE_KEY, v: 'weekly', loading: 'async', callback, language: 'en', region: 'IE' });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => { loading = null; reject(new Error('Google Maps could not load')); };
    document.head.appendChild(script);
  });
  return loading;
}

// Place details from Google (Places API, New), for a place clicked on the Google map. The fields are kept to
// what the side panel shows, and answers are kept for the visit, so a place clicked twice is asked for once.
const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'primaryTypeDisplayName', 'types', 'businessStatus',
  'googleMapsURI', 'nationalPhoneNumber', 'internationalPhoneNumber', 'websiteURI', 'regularOpeningHours', 'utcOffsetMinutes', 'rating',
  'userRatingCount', 'priceLevel', 'photos', 'reviews', 'editorialSummary'];
const details = new Map();

// Is a place open now (Dublin time), from Google's opening periods (day 0 = Sunday)? null when unknown.
function openAt(periods) {
  if (!periods?.length) return null;
  if (periods.length === 1 && periods[0].open && !periods[0].close) return true; // open 24/7
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const now = day * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
  const WEEK = 7 * 1440;
  return periods.some(({ open, close }) => {
    if (!open || !close) return false;
    const from = open.day * 1440 + open.hour * 60 + open.minute;
    let to = close.day * 1440 + close.hour * 60 + close.minute;
    if (to <= from) to += WEEK; // closes after midnight on Saturday night, or the next week
    return (now >= from && now < to) || (now + WEEK >= from && now + WEEK < to);
  });
}

export async function googlePlace(placeId) {
  if (details.has(placeId)) return details.get(placeId);
  const job = (async () => {
    const { Place } = await window.google.maps.importLibrary('places');
    const place = new Place({ id: placeId, requestedLanguage: 'en', requestedRegion: 'IE' });
    await place.fetchFields({ fields: PLACE_FIELDS });
    const openNow = openAt(place.regularOpeningHours?.periods);
    const photo = place.photos?.[0];
    return {
      id: place.id,
      name: place.displayName,
      address: place.formattedAddress,
      lat: place.location?.lat(),
      lng: place.location?.lng(),
      type: place.primaryTypeDisplayName,
      types: place.types || [],
      status: place.businessStatus,
      url: place.googleMapsURI,
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber,
      website: place.websiteURI,
      hours: place.regularOpeningHours?.weekdayDescriptions || null,
      openNow,
      rating: place.rating,
      ratings: place.userRatingCount,
      price: place.priceLevel,
      summary: place.editorialSummary,
      photo: photo ? { url: photo.getURI({ maxWidth: 800 }), by: (photo.authorAttributions || []).map((a) => ({ name: a.displayName, url: a.uri })) } : null,
      reviews: (place.reviews || []).slice(0, 3).map((r) => ({
        author: r.authorAttribution?.displayName, authorUrl: r.authorAttribution?.uri, rating: r.rating,
        when: r.relativePublishTimeDescription, text: r.text,
      })),
    };
  })();
  details.set(placeId, job);
  job.catch(() => details.delete(placeId));
  return job;
}

// The Google place for one of our own pins (a campus, famous place, shop or residence), found by its name near its
// spot: the search asks only for the place's id, then its details are loaded as for a place clicked on Google's map.
// A place found more than 600 m away is someone else's (same name elsewhere) and is left out.
const found = new Map();
const metresBetween = (a, b) => {
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
};

export async function findGooglePlace(name, lat, lng) {
  const key = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
  if (found.has(key)) return found.get(key);
  const job = (async () => {
    const { Place } = await window.google.maps.importLibrary('places');
    const { places } = await Place.searchByText({
      textQuery: name, fields: ['id'], maxResultCount: 1, language: 'en', region: 'ie',
      locationBias: { center: { lat, lng }, radius: 500 },
    });
    const id = places?.[0]?.id;
    if (!id) return null;
    const d = await googlePlace(id);
    return d.lat != null && metresBetween({ lat, lng }, { lat: d.lat, lng: d.lng }) <= 600 ? d : null;
  })();
  found.set(key, job);
  job.catch(() => found.delete(key));
  return job;
}
