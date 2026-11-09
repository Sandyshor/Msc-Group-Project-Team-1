// Compare two districts side by side: rent, safety, getting to campus, amenities and who lives there.
// The better figure on each row gets a tick, and the user can say what matters to them to get a
// plain "which one fits you better, and why" answer.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AMENITY_TYPES, COUNTY_AREAS, DUBLIN_DISTRICTS, heatColor, safetyLabel, strongColor, textOnHeat } from './mapShared';
import './Compare.css';

const eur = (v) => `€${Math.round(v).toLocaleString('en-IE')}`;
const num = (v) => Number(v).toLocaleString('en-IE');

const PRIORITIES = [
  ['budget', 'Low rent'],
  ['safety', 'Safety'],
  ['campus', 'Close to campus'],
  ['amenities', 'Shops & things to do'],
  ['students', 'Student life'],
];

// Rent for one size: the district's own listings first, then the RTB average, then the Daft.ie report
function rentFor(data, code, kind) {
  const r = data.rent?.[code] || {};
  const rtb = data.rtb?.[code]?.district || {};
  const report = data.roomReport?.areas?.[code] || {};
  const pick = (listing, rtbValue, reportValue) => {
    if (listing?.median) return { value: listing.median, note: `${listing.n} listing${listing.n > 1 ? 's' : ''}` };
    if (rtbValue) return { value: rtbValue, note: 'RTB average' };
    if (reportValue) return { value: reportValue, note: 'Daft.ie report' };
    return null;
  };
  if (kind === 'single') return pick(r.rooms?.single, null, report.single);
  if (kind === 'double') return pick(r.rooms?.double, null, report.double);
  if (kind === '1 bed') return pick(r.homes?.['1 bed'], rtb['1 bed'], report.oneBed);
  if (kind === '2 bed') return pick(r.homes?.['2 bed'], rtb['2 bed'], report.twoBed);
  if (kind === 'all') return rtb.all ? { value: rtb.all, note: 'RTB 2025, all homes' } : null;
  return null;
}

// Every row of the table. better: 'low' or 'high' wins the tick; null = just information.
function buildRows(data, counts, uni) {
  const census = (code) => data.census?.[code];
  const amen = (code) => counts?.[code] || data.amenCounts?.[code];
  const rent = (kind) => (code) => {
    const x = rentFor(data, code, kind);
    return x && { value: x.value, text: eur(x.value), note: x.note };
  };
  return [
    { group: 'Rent per month', key: 'single', label: 'Single room', better: 'low', get: rent('single'), priority: 'budget' },
    { group: 'Rent per month', key: 'double', label: 'Double room', better: 'low', get: rent('double'), priority: 'budget' },
    { group: 'Rent per month', key: '1bed', label: '1-bed apartment', better: 'low', get: rent('1 bed'), priority: 'budget' },
    { group: 'Rent per month', key: '2bed', label: '2-bed apartment', better: 'low', get: rent('2 bed'), priority: 'budget' },
    { group: 'Rent per month', key: 'rtb', label: 'Official average (RTB)', better: 'low', get: rent('all'), priority: 'budget' },
    {
      group: 'Safety', key: 'safety', label: 'Safety score', better: 'high', priority: 'safety',
      get: (code) => {
        const s = data.safety?.[code]?.score;
        return typeof s === 'number' ? { value: s, text: s.toFixed(0), note: safetyLabel(s), score: s } : null;
      },
    },
    {
      group: 'Getting around', key: 'walk', label: uni ? `Walking distance to ${uni}` : 'Walking distance to campus', better: 'low', priority: 'campus',
      get: (code) => {
        const w = uni && data.walk?.[code]?.[uni];
        return w ? { value: w.km, text: `${w.km.toFixed(1)} km`, note: `about ${w.min} min from ${w.center}` } : null;
      },
    },
    {
      group: 'Getting around', key: 'luas', label: 'Luas stops', better: 'high',
      get: (code) => ({ value: data.stops.filter((s) => s.d === code).length, text: String(data.stops.filter((s) => s.d === code).length) }),
    },
    ...AMENITY_TYPES.map(([k, label]) => ({
      group: 'Amenities in the district', key: k, label, better: 'high', priority: 'amenities',
      get: (code) => { const c = amen(code); return c ? { value: c[k] ?? 0, text: num(c[k] ?? 0) } : null; },
    })),
    {
      group: 'Who lives here', key: 'pop', label: 'Population', better: null,
      get: (code) => { const c = census(code); return c ? { value: c.Population, text: num(c.Population) } : null; },
    },
    {
      group: 'Who lives here', key: 'students', label: 'Students', better: 'high', priority: 'students',
      get: (code) => {
        const c = census(code);
        if (!c) return null;
        const share = Math.round((c.Students / c.Population) * 100);
        return { value: share, text: `${share}%`, note: `${num(c.Students)} students` };
      },
    },
    {
      group: 'Who lives here', key: 'young', label: 'Aged 20–29', better: 'high', priority: 'students',
      get: (code) => {
        const c = census(code);
        if (!c) return null;
        const share = Math.round((c.Age_20_29 / c.Population) * 100);
        return { value: share, text: `${share}%`, note: `${num(c.Age_20_29)} people` };
      },
    },
    {
      group: 'Who lives here', key: 'intl', label: 'Born outside Ireland', better: 'high', priority: 'students',
      get: (code) => { const c = census(code); return c ? { value: c['Non_Irish_%'], text: `${c['Non_Irish_%']}%` } : null; },
    },
    {
      group: 'Who lives here', key: 'apts', label: 'Live in apartments', better: null,
      get: (code) => { const c = census(code); return c ? { value: c['Apartments_%'], text: `${c['Apartments_%']}%` } : null; },
    },
  ];
}

// 'a', 'b' or null (tie / missing / information only)
function winner(row, va, vb) {
  if (!row.better || !va || !vb || va.value === vb.value) return null;
  const aBetter = row.better === 'low' ? va.value < vb.value : va.value > vb.value;
  return aBetter ? 'a' : 'b';
}

// A short reason with both numbers, e.g. "cheaper rent (single room €700 vs €900)"
const PHRASE = { budget: 'is cheaper', safety: 'is safer', campus: 'is closer to campus', amenities: 'has more shops and places', students: 'has more student life' };
function reason(row, win, va, vb) {
  const [w, l] = win === 'a' ? [va, vb] : [vb, va];
  const what = row.label[0].toLowerCase() + row.label.slice(1);
  return `${PHRASE[row.priority]} (${what} ${w.text} vs ${l.text})`;
}

// "a, b and c"
const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || '');

function verdict(rows, cells, a, b, chosen) {
  const tally = { a: 0, b: 0 };
  const why = { a: [], b: [] };
  chosen.forEach((p) => {
    const mine = rows.filter((r) => r.priority === p && cells[r.key].win);
    if (!mine.length) return;
    let wa = 0;
    let wb = 0;
    mine.forEach((r) => { if (cells[r.key].win === 'a') wa++; else wb++; });
    if (wa === wb) return;
    const side = wa > wb ? 'a' : 'b';
    tally[side]++;
    // the clearest example for this priority
    const example = mine.find((r) => cells[r.key].win === side);
    why[side].push(reason(example, side, cells[example.key].a, cells[example.key].b));
  });
  if (!tally.a && !tally.b) return { text: `On what you picked, ${a} and ${b} are about even. Look at the rows below for the details.` };
  if (tally.a === tally.b) return { text: `It's a close call: ${a} ${and(why.a)}, while ${b} ${and(why.b)}.` };
  const [best, other] = tally.a > tally.b ? ['a', 'b'] : ['b', 'a'];
  const name = { a, b };
  return {
    best: name[best],
    text: `${name[best]} fits you better: it ${and(why[best])}.`
      + (why[other].length ? ` ${name[other]} ${and(why[other])}.` : ''),
  };
}

export default function CompareDistricts({ data, amenityCounts, first, onOpen, onClose }) {
  const codes = [...DUBLIN_DISTRICTS, ...COUNTY_AREAS].filter((c) => data.profiles[c]);
  const [a, setA] = useState(first && data.profiles[first] ? first : 'D7');
  const [b, setB] = useState(() => (first === 'D8' ? 'D7' : 'D8'));
  const [uni, setUni] = useState(() => { try { return localStorage.getItem('compare-uni') || ''; } catch { return ''; } });
  const [chosen, setChosen] = useState(['budget', 'safety', 'amenities']);
  const dialog = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = scroll; };
  }, [onClose]);

  useEffect(() => { try { localStorage.setItem('compare-uni', uni); } catch { /* storage blocked */ } }, [uni]);

  const rows = buildRows(data, amenityCounts, uni);
  const cells = {};
  rows.forEach((r) => {
    const va = r.get(a);
    const vb = r.get(b);
    cells[r.key] = { a: va, b: vb, win: winner(r, va, vb) };
  });
  // only rows where both districts have a figure
  const shown = rows.filter((r) => cells[r.key].a && cells[r.key].b);
  const wins = { a: 0, b: 0 };
  shown.forEach((r) => { if (cells[r.key].win) wins[cells[r.key].win]++; });
  const result = a !== b ? verdict(rows, cells, a, b, chosen) : { text: 'Pick two different districts.' };
  const groups = [...new Set(shown.map((r) => r.group))];
  const toggle = (p) => setChosen((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));
  const label = (c) => `${c} · ${data.profiles[c].name}`;

  const picker = (value, onChange, other, side) => (
    <label className={`cmp-pick is-${side}`} style={{ '--c': strongColor(data.profiles[value].hue) }}>
      <small>District {side === 'a' ? 'A' : 'B'}</small>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`District ${side === 'a' ? 'A' : 'B'}`}>
        {codes.map((c) => <option key={c} value={c} disabled={c === other}>{label(c)}</option>)}
      </select>
    </label>
  );

  // on <body>, so no map or card around it can trap or clip it
  return createPortal(
    <div className="cmp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={dialog} className="cmp" role="dialog" aria-modal="true" aria-labelledby="cmp-title" tabIndex={-1}>
        <header className="cmp-head">
          <div>
            <p className="cmp-eyebrow">Side by side</p>
            <h2 id="cmp-title">Compare two districts</h2>
          </div>
          <button type="button" className="cmp-close" onClick={onClose} aria-label="Close comparison">×</button>
        </header>

        <div className="cmp-pickers">
          {picker(a, setA, b, 'a')}
          <button type="button" className="cmp-swap" onClick={() => { setA(b); setB(a); }} aria-label="Swap districts" title="Swap">⇄</button>
          {picker(b, setB, a, 'b')}
        </div>

        <div className="cmp-prefs">
          <p><b>What matters to you?</b> Pick any.</p>
          <div className="cmp-chips">
            {PRIORITIES.map(([k, l]) => (
              <button type="button" key={k} aria-pressed={chosen.includes(k)} onClick={() => toggle(k)}>{chosen.includes(k) ? '✓ ' : ''}{l}</button>
            ))}
          </div>
          {chosen.includes('campus') && (
            <select className="cmp-uni" value={uni} onChange={(e) => setUni(e.target.value)} aria-label="Your university">
              <option value="">Choose your university…</option>
              {(data.unis || []).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          <div className={`cmp-verdict${result.best ? ' has-best' : ''}`} aria-live="polite">
            <span aria-hidden="true">{result.best ? '🏆' : '⚖️'}</span>
            <p>{result.text}</p>
          </div>
          {chosen.includes('campus') && !uni && <p className="cmp-note">Choose your university to compare the distance to campus.</p>}
        </div>

        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <thead>
              <tr>
                <th scope="col"><span className="cmp-sr">Measure</span></th>
                <th scope="col" style={{ '--c': strongColor(data.profiles[a].hue) }}>{a}<small>{data.profiles[a].name}</small><em>{wins.a} better</em></th>
                <th scope="col" style={{ '--c': strongColor(data.profiles[b].hue) }}>{b}<small>{data.profiles[b].name}</small><em>{wins.b} better</em></th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr className="cmp-group"><th colSpan={3} scope="colgroup">{g}</th></tr>
                {shown.filter((r) => r.group === g).map((r) => {
                  const c = cells[r.key];
                  const cell = (v, side) => (
                    <td className={c.win === side ? 'is-win' : ''}>
                      {v ? (
                        <>
                          {r.key === 'safety'
                            ? <b className="cmp-score" style={{ background: heatColor(v.score), color: textOnHeat(v.score) }}>{v.text}</b>
                            : <b>{v.text}</b>}
                          {c.win === side && <i aria-label="better">✓</i>}
                        </>
                      ) : null}
                    </td>
                  );
                  return (
                    <tr key={r.key} className={r.priority && chosen.includes(r.priority) ? 'is-priority' : ''}>
                      <th scope="row">{r.label}</th>
                      {cell(c.a, 'a')}
                      {cell(c.b, 'b')}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>

        <footer className="cmp-foot">
          <p>✓ marks the better figure. Rows you care about are highlighted.</p>
          <div>
            <button type="button" onClick={() => onOpen(a)}>Open {a} profile</button>
            <button type="button" onClick={() => onOpen(b)}>Open {b} profile</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
