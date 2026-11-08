// Guided tour of Dublin's postal districts for newcomers: a slim bar over the top of the map with how the numbers
// work, then one simple sentence per district from D1 (where it is, which side of the Liffey, a couple of
// neighbourhoods), then a wrap-up. The page shows each district on the map and its full profile on the right.
import { useEffect, useRef, useState } from 'react';
import { districtProfiles } from './districtProfiles';
import './DistrictTour.css';

const INTRO_MS = 8000;
const STOP_MS = 6000;

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

export default function DistrictTour({ data, codes, onShow, onEnd }) {
  // step -1 = intro, 0..n-1 = districts, n = wrap-up
  const [step, setStep] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const n = codes.length;
  const ms = step < 0 ? INTRO_MS : STOP_MS;
  const running = !paused && !hover && step < n;
  const showRef = useRef(onShow);
  showRef.current = onShow;

  useEffect(() => { if (step >= 0 && step < n) showRef.current(codes[step]); }, [step, n, codes]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setTimeout(() => setStep((s) => Math.min(s + 1, n)), ms);
    return () => clearTimeout(id);
  }, [running, step, ms, n]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, n));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, -1));
      else if (e.key === 'Escape') onEnd();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, onEnd]);

  const stop = step >= 0 && step < n ? outline(codes[step], data) : null;

  return (
    <aside className="dt-bar" role="region" aria-label="District tour" aria-live="polite"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="dt-row" key={step}>
        <span className={`dt-badge${stop ? (stop.north ? ' is-north' : ' is-south') : ''}`} aria-hidden="true">
          {stop ? codes[step] : step < 0 ? '💡' : '🎉'}
        </span>
        <div className="dt-copy">
          <span className="dt-label">
            {step < 0 && 'How Dublin’s districts work'}
            {stop && <>Stop {step + 1} of {n} · <b className={stop.north ? 'is-north' : 'is-south'}>{stop.north ? 'Northside' : 'Southside'}</b></>}
            {step >= n && 'Tour complete'}
          </span>
          <p>
            {step < 0 && <><b>Odd numbers</b> are north of the River Liffey, <b>even numbers</b> south. <b>D1 &amp; D2</b> are the city centre – the higher the number, the further out.</>}
            {stop && stop.text}
            {step >= n && <>That’s all {n} districts. Click any district to see its rent, amenities and safety, or try <a href="/questionnaire">Find my match</a>.</>}
          </p>
        </div>
      </div>

      <div className="dt-actions">
        {step < n ? (
          <>
            <button type="button" className="dt-icon" onClick={() => setStep((s) => Math.max(s - 1, -1))} disabled={step < 0} aria-label="Previous stop">‹</button>
            <button type="button" className="dt-icon" onClick={() => setPaused((v) => !v)} aria-label={paused ? 'Resume the tour' : 'Pause the tour'}>{paused ? '▶' : '❚❚'}</button>
            <button type="button" className="dt-next" onClick={() => setStep((s) => Math.min(s + 1, n))}>
              {step < 0 ? 'Start with D1' : step === n - 1 ? 'Finish' : 'Next'} <span aria-hidden="true">›</span>
            </button>
            <button type="button" className="dt-skip" onClick={onEnd}>Skip tour</button>
          </>
        ) : (
          <button type="button" className="dt-next" onClick={onEnd}>Explore the map <span aria-hidden="true">›</span></button>
        )}
      </div>

      <div className="dt-progress" aria-hidden="true">
        <span style={{ width: `${((Math.min(step, n - 1) + 1) / n) * 100}%` }} />
        {running && <i key={step} style={{ animationDuration: `${ms}ms` }} />}
      </div>
    </aside>
  );
}
