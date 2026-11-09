// Guided tour of the district page for newcomers: a slim bar over the top of the map with how the numbers work,
// then how to use the page (compare, journey, amenities, safety, rent, search: each one highlighted), then one
// simple sentence per district from D1 (where it is, which side of the Liffey, a couple of neighbourhoods), then a
// wrap-up. The page shows each district on the map and its full profile on the right.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { districtProfiles } from './districtProfiles';
import './DistrictTour.css';

const INTRO_MS = 8000;
const STOP_MS = 6000;
const FEATURE_MS = 8000;

// How to use the page. tab: the profile tab it opens (on an example district); spot: what gets highlighted.
const FEATURES = [
  { key: 'compare', icon: '⇄', title: 'Compare districts', spot: '.compare-button',
    text: <>Put any two districts <b>side by side</b>: rent, safety, amenities and distance to your campus. Tick what matters to you and it tells you which fits you better.</> },
  { key: 'journey', icon: '🚌', title: 'Journey', tab: 'journey', spot: '.profile-tabs [data-tab="journey"]',
    text: <>Type a <b>start and destination</b> (or click the map) to see bus, Luas, train, walking and cycling routes with times.</> },
  { key: 'amen', icon: '🛒', title: 'Amenities', tab: 'amen', spot: '.profile-tabs [data-tab="amen"]',
    text: <><b>Supermarkets, cafés, gyms, parks, pharmacies</b> and more in the district. Pick a supermarket chain to see its shops on the map.</> },
  { key: 'safety', icon: '🛡️', title: 'Safety', tab: 'safety', spot: '.profile-tabs [data-tab="safety"]',
    text: <>The district’s <b>safety score</b> and recorded crime by type. Switch on <b>Safety map</b> above the map to see it street by street.</> },
  { key: 'rent', icon: '€', title: 'Rent', tab: 'rent', spot: '.profile-tabs [data-tab="rent"]',
    text: <>Typical <b>monthly rents</b> for single and double rooms, studios and 1–3 bed homes.</> },
  { key: 'search', icon: '🔎', title: 'Search the map', spot: '.map-search .ps',
    text: <>Find a <b>university, place, street or district</b> (try “UCD” or “Temple Bar”) and get directions from or to it.</> },
];
const F = FEATURES.length;

const parse = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } };

// where the district sits, in plain words (D1/D2 centre; low numbers inner; high numbers outer)
function whereItIs(code) {
  const n = parseInt(code.slice(1), 10);
  if (n <= 2) return 'Dublin’s city centre';
  if (n <= 8) return 'an inner suburb close to the city centre';
  if (n <= 12) return 'a suburb a short trip from the centre';
  return 'an outer suburb';
}

// one simple sentence to picture the district (the profile card on the right has all the numbers)
function outline(code, data) {
  const p = data.profiles[code];
  const team = districtProfiles?.[code]?.name;
  const name = team && !/^Dublin\s/i.test(team) ? team : p.name;
  const areas = parse(p.areas).map((a) => a[0]).slice(0, 2);
  const north = p.side === 'Northside';
  return {
    name,
    north,
    text: `${name} is ${whereItIs(code)}, ${north ? 'north' : 'south'} of the River Liffey${areas.length ? ` – around ${areas.join(' and ')}` : ''}.`,
  };
}

export default function DistrictTour({ data, codes, onShow, onFeature, onEnd }) {
  // step -1 = intro, 0..F-1 = how to use the page, F..F+n-1 = districts, F+n = wrap-up
  const [step, setStep] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  // phones and tablets: the profile is below the map, so for its tab steps the page scrolls down to it and
  // the bar docks to the bottom of the screen; on the map steps it goes back over the map
  const [docked, setDocked] = useState(false);
  const n = codes.length;
  const last = F + n; // the wrap-up
  const feature = step >= 0 && step < F ? FEATURES[step] : null;
  const district = step >= F && step < last ? step - F : -1;
  const ms = step < 0 ? INTRO_MS : feature ? FEATURE_MS : STOP_MS;
  const running = !paused && !hover && step < last;
  const showRef = useRef(onShow);
  showRef.current = onShow;
  const featureRef = useRef(onFeature);
  featureRef.current = onFeature;

  useEffect(() => { if (district >= 0) showRef.current(codes[district]); }, [district, codes]);

  const stacked = () => window.innerWidth <= 1100; // profile card below the map
  const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
  // district stops (and the intro) happen on the map: bring it back into view
  useEffect(() => {
    if (feature || !stacked()) return;
    setDocked(false);
    const stage = document.querySelector('.map-stage');
    const r = stage?.getBoundingClientRect();
    if (r && (r.top < 0 || r.top > window.innerHeight * 0.5)) stage.scrollIntoView({ block: 'start', behavior: smooth() });
  }, [feature, district]);

  // a feature step: open its tab on the example district, then highlight the button it's about
  useEffect(() => {
    if (!feature) return undefined;
    featureRef.current?.(feature);
    let spot = null;
    const timer = setTimeout(() => {
      spot = document.querySelector(feature.spot);
      if (!spot) return;
      spot.classList.add('dt-spot');
      if (!stacked()) { spot.scrollIntoView({ block: 'nearest', behavior: smooth() }); return; }
      if (feature.tab) {
        // show the profile from its tabs, so the section starts at the top of the screen
        setDocked(true);
        document.querySelector('.pc .profile-tabs')?.scrollIntoView({ block: 'start', behavior: smooth() });
      } else {
        setDocked(false);
        spot.scrollIntoView({ block: 'center', behavior: smooth() });
      }
    }, 150);
    return () => { clearTimeout(timer); spot?.classList.remove('dt-spot'); };
  }, [feature]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setTimeout(() => setStep((s) => Math.min(s + 1, last)), ms);
    return () => clearTimeout(id);
  }, [running, step, ms, last]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, last));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, -1));
      else if (e.key === 'Escape') onEnd();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onEnd]);

  const stop = district >= 0 ? outline(codes[district], data) : null;

  const bar = (
    <aside className={`dt-bar${docked ? ' is-docked' : ''}`} role="region" aria-label="District tour" aria-live="polite"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="dt-row" key={step}>
        <span className={`dt-badge${stop ? (stop.north ? ' is-north' : ' is-south') : ''}${feature ? ' is-feature' : ''}`} aria-hidden="true">
          {stop ? codes[district] : feature ? feature.icon : step < 0 ? '💡' : '🎉'}
        </span>
        <div className="dt-copy">
          <span className="dt-label">
            {step < 0 && 'How Dublin’s districts work'}
            {feature && <><b className="is-feature">{feature.title}</b> · {step + 1} of {F}</>}
            {stop && <>Stop {district + 1} of {n} · <b className={stop.north ? 'is-north' : 'is-south'}>{stop.north ? 'Northside' : 'Southside'}</b></>}
            {step >= last && 'Tour complete'}
          </span>
          <p>
            {step < 0 && <><b>Odd numbers</b> are north of the River Liffey, <b>even numbers</b> south. <b>D1 &amp; D2</b> are the city centre – the higher the number, the further out.</>}
            {feature && feature.text}
            {stop && stop.text}
            {step >= last && <>That’s all {n} districts. Click any district to see its rent, amenities and safety, compare two districts, or try <a href="/questionnaire">Find my match</a>.</>}
          </p>
        </div>
      </div>

      <div className="dt-actions">
        {step < last ? (
          <>
            <button type="button" className="dt-icon" onClick={() => setStep((s) => Math.max(s - 1, -1))} disabled={step < 0} aria-label="Previous stop">‹</button>
            <button type="button" className="dt-icon" onClick={() => setPaused((v) => !v)} aria-label={paused ? 'Resume the tour' : 'Pause the tour'}>{paused ? '▶' : '❚❚'}</button>
            <button type="button" className="dt-next" onClick={() => setStep((s) => Math.min(s + 1, last))}>
              {step < 0 ? 'Next' : step === F - 1 ? 'Start with D1' : step === last - 1 ? 'Finish' : 'Next'} <span aria-hidden="true">›</span>
            </button>
            {(step < 0 || feature) && (
              <button type="button" className="dt-jump" onClick={() => setStep(F)} title="Skip to the district stops">Districts ›</button>
            )}
            <button type="button" className="dt-skip" onClick={onEnd}>Skip tour</button>
          </>
        ) : (
          <button type="button" className="dt-next" onClick={onEnd}>Explore the map <span aria-hidden="true">›</span></button>
        )}
      </div>

      <div className="dt-progress" aria-hidden="true">
        <span style={{ width: `${((Math.min(step, last - 1) + 1) / last) * 100}%` }} />
        {running && <i key={step} style={{ animationDuration: `${ms}ms` }} />}
      </div>
    </aside>
  );
  // docked at the bottom of the screen it goes on <body>: the map card around it would otherwise pin a
  // "fixed" bar to itself (it scrolls off-screen with the map)
  return docked ? createPortal(bar, document.body) : bar;
}
