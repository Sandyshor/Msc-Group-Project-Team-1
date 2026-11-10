import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import JourneyPlannerPanel from './JourneyPlannerPanel';
import { CHAINS, chainInfo } from './shopChains';
import { ACTIVE_DISTRICTS, AMENITY_TYPES, HEAT_STOPS, SAFETY_BANDS, ICONS, iconFor, strongColor, bannerColor, safetyLabel, safetyPlain, heatColor, textOnHeat } from './mapShared';
import './ProfileCard.css';

export const TABS = [['places', 'Places'], ['journey', 'Journey'], ['rent', 'Rent'], ['amen', 'Amenities'], ['safety', 'Safety'], ['area', 'Area']];
const eur = (v) => `€${Math.round(v).toLocaleString('en-IE')}`;
const num = (v) => Number(v).toLocaleString('en-IE');
const Icon = ({ name, html, ...rest }) => <span {...rest} dangerouslySetInnerHTML={{ __html: html || iconFor(name) }} />;

/* ---------------- profile card sections ---------------- */

// The district's neighbourhoods: the first six, and the rest behind "+N more"
function Hoods({ areas }) {
  const [all, setAll] = useState(false);
  const FIRST = 6;
  const shown = all ? areas : areas.slice(0, FIRST);
  return (
    <ul className="pc-hoods" aria-label="Neighbourhoods">
      {shown.map((a) => <li key={a[0]}>{a[0]}</li>)}
      {areas.length > FIRST && (
        <li className="pc-hoods-more">
          <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'Show less' : `+${areas.length - FIRST} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

function EmptyNote({ children }) {
  return <p className="empty-note">Not collected yet: {children}</p>;
}

function SectionTitle({ eyebrow, title, icon, extra }) {
  return (
    <div className="section-title-row">
      <div>
        <p className="section-eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {extra || (icon && <Icon className="section-icon" html={ICONS[icon]} />)}
    </div>
  );
}


const WIKI_TITLES = {
  'Croke Park': 'Croke Park', 'The Spire': 'Spire of Dublin', GPO: 'General Post Office, Dublin',
  'Custom House': 'Custom House, Dublin', 'Moore Street Market': 'Moore Street', 'Garden of Remembrance': 'Garden of Remembrance (Dublin)',
  'Trinity College': 'Trinity College Dublin', "St Stephen's Green": "St Stephen's Green", 'Grafton Street': 'Grafton Street',
  'National Gallery': 'National Gallery of Ireland', 'Merrion Square': 'Merrion Square',
  'Casino at Marino': 'Casino at Marino', 'Clontarf Promenade': 'Clontarf, Dublin', 'Bull Island': 'North Bull Island', 'Fairview Park': 'Fairview Park',
  'Herbert Park': 'Herbert Park', 'Aviva Stadium': 'Aviva Stadium', "St Anne's Park": "St. Anne's Park", 'North Bull Island': 'North Bull Island',
  'Rathmines Town Hall': 'Rathmines', Ranelagh: 'Ranelagh, Dublin', 'Phoenix Park': 'Phoenix Park',
  'National Museum at Collins Barracks': 'Collins Barracks', 'Kilmainham Gaol': 'Kilmainham Gaol', 'Guinness Storehouse': 'Guinness Storehouse',
  'National Botanic Gardens': 'National Botanic Gardens (Ireland)', Ballyfermot: 'Ballyfermot', 'Cherry Orchard': 'Cherry Orchard, Dublin',
  'Bushy Park': 'Bushy Park, Dublin', 'Terenure Village': 'Terenure', "Harold's Cross Park": "Harold's Cross", 'Kimmage Cross': 'Kimmage',
  'Tolka Valley Park': 'River Tolka', 'Finglas Village': 'Finglas',
  'Drimnagh Castle': 'Drimnagh Castle', 'CHI at Crumlin': "Children's Health Ireland at Crumlin", 'Crumlin Village': 'Crumlin, Dublin',
  'Grand Canal Way': 'Grand Canal (Ireland)',
  'Howth Harbour': 'Howth', 'Howth Castle': 'Howth Castle', 'Sutton Strand': 'Sutton, Dublin', 'Howth Cliff Path': 'Howth Head',
  'Rathfarnham Castle': 'Rathfarnham Castle', 'Dodder Linear Park': 'River Dodder', 'Churchtown Village': 'Churchtown, Dublin',
  'Blanchardstown Centre': 'Blanchardstown Centre', 'National Aquatic Centre': 'National Aquatic Centre', 'Castleknock Village': 'Castleknock',
  'TU Dublin Blanchardstown': 'Technological University Dublin', 'Dunsink Observatory': 'Dunsink Observatory',
  'Marlay Park': 'Marlay Park', 'Dundrum Town Centre': 'Dundrum Town Centre',
  'Northside Shopping Centre': 'Coolock', 'Darndale Park': 'Darndale', 'Clarehall Shopping Centre': 'Clarehall',
  'Leopardstown Racecourse': 'Leopardstown Racecourse', 'Cabinteely Park': 'Cabinteely', 'Sandyford Business District': 'Sandyford',
  'Ticknock Forest': 'Ticknock',
  'Chapelizod Village': 'Chapelizod', 'Waterstown Park': 'Palmerstown', 'Palmerstown Village': 'Palmerstown', 'Liffey Valley Centre': 'Liffey Valley',
  'Clondalkin Round Tower': 'Clondalkin Round Tower', 'Corkagh Park': 'Corkagh Park',
  'The Square Tallaght': 'The Square, Tallaght', 'Tallaght University Hospital': 'Tallaght University Hospital', 'Tallaght Stadium': 'Tallaght Stadium',
  'Sean Walsh Park': 'Tallaght', 'TU Dublin Tallaght': 'Technological University Dublin',
};

const wikiCache = {};
function fetchWikiPhoto(title) {
  if (!wikiCache[title]) {
    wikiCache[title] = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && d.type !== 'disambiguation' ? (d.thumbnail?.source || d.originalimage?.source || null) : null))
      .catch(() => null);
  }
  return wikiCache[title];
}

function PlaceImage({ place }) {
  const [src, setSrc] = useState(place.image || null);
  const [triedWiki, setTriedWiki] = useState(false);

  const loadWikipediaPhoto = () => {
    if (triedWiki) { setSrc(null); return; }
    setTriedWiki(true);
    const titles = [WIKI_TITLES[place.name], place.name].filter(Boolean);
    (async () => {
      for (const t of titles) {
        const photo = await fetchWikiPhoto(t);
        if (photo) { setSrc(photo); return; }
      }
      setSrc(null);
    })();
  };

  // Checked photos (place-images.json) are used as they are; only unchecked places fall back to a Wikipedia lookup
  useEffect(() => { if (!place.image && !place.photoChecked) loadWikipediaPhoto(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!src) return <div className="place-image place-image-fallback"><Icon name={place.cat} /></div>;
  return (
    <img className="place-image" src={src} alt={place.name} loading="lazy" referrerPolicy="no-referrer"
      title={place.imageCredit ? `Photo: ${place.imageCredit}` : undefined}
      onError={place.photoChecked ? () => setSrc(null) : loadWikipediaPhoto} />
  );
}

function PlacesSection({ code, places, hoverPlace, onHoverPlace, onPlaceClick }) {
  if (!places.length) return <EmptyNote>famous places for {code}</EmptyNote>;
  return (
    <section className="profile-section">
      <SectionTitle eyebrow="FAMOUS PLACES" title="Places to know" extra={<span className="place-count">{places.length} places</span>} />
      <div className="places-list">
        {places.map((place, i) => (
          <button
            type="button"
            key={place.name}
            className={`place-card ${hoverPlace === i ? 'is-active' : ''}`}
            style={{ '--place-index': i }}
            onMouseEnter={() => onHoverPlace(i)}
            onMouseLeave={() => onHoverPlace(null)}
            onClick={() => onPlaceClick(code, i)}
          >
            <PlaceImage place={place} />
            <div className="place-content">
              <h4>{place.name}</h4>
              <p>{place.description}</p>
              {!place.lngLat && <p className="place-nomap">Not on the map yet (add coordinates)</p>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// Purpose-built student residences in the district (same list as the map's Student housing pins)
let residencesLoad = null;
const loadResidences = () => (residencesLoad ??= fetch('/data/student-residences.json').then((r) => (r.ok ? r.json() : null)).then((d) => d?.residences || []).catch(() => { residencesLoad = null; return []; }));

function ResidencesSection({ code }) {
  const [all, setAll] = useState(null);
  useEffect(() => { let live = true; loadResidences().then((list) => { if (live) setAll(list); }); return () => { live = false; }; }, []);
  const here = (all || []).filter((r) => r.district === code).sort((a, b) => (a.from ?? 1e9) - (b.from ?? 1e9));
  if (!here.length) return null;
  return (
    <section className="profile-section">
      <SectionTitle eyebrow="STUDENT HOUSING" title={`Student residences in ${code}`} icon="village" extra={<span className="place-count">{here.length}</span>} />
      <ul className="pc-residences">
        {here.map((r) => (
          <li key={r.name}>
            <span className="pc-res-name">
              {r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer">{r.name}</a> : r.name}
              <small>{[r.operator, r.address].filter(Boolean).join(' · ')}</small>
            </span>
            {r.from && <b>from €{Math.round(r.from).toLocaleString('en-IE')}</b>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RentSection({ code, data, rentMode, setRentMode }) {
  const r = data.rent[code] || { rooms: {}, homes: {} };
  const rtb = data.rtb[code];
  const listing = rentMode === 'rooms' ? r.rooms : r.homes;
  const keys = rentMode === 'rooms' ? ['single', 'double'] : ['studio', '1 bed', '2 bed', '3 bed', '4+ bed'];
  const have = keys.filter((k) => listing?.[k]);
  // No listings of this kind here: fall back to report averages instead of an empty box.
  // Rooms: the Daft.ie report's averages for the area's part of Dublin.
  // Whole homes: RTB 2025 averages when RTB has both the 1- and 2-bed figure, else the Daft.ie report's.
  const report = data.roomReport?.areas?.[code];
  const rtbHomes = rtb?.district?.['1 bed'] && rtb?.district?.['2 bed'] ? rtb.district : null;
  let fallback = null;
  if (!have.length && rentMode === 'rooms' && report) {
    fallback = {
      eyebrow: 'DAFT REPORT 2026 Q1',
      tiles: [['Single sharing', report.single, 'single room'], ['Double room', report.double, 'one person'], ['Double sharing · est.', report.sharing, 'per person · twin room']],
    };
  } else if (!have.length && rentMode === 'homes' && (rtbHomes || report?.oneBed)) {
    fallback = rtbHomes
      ? { eyebrow: 'RTB 2025', tiles: [['1 bed', rtbHomes['1 bed'], 'average'], ['2 bed', rtbHomes['2 bed'], 'average'], ...(rtbHomes['3 bed'] ? [['3 bed', rtbHomes['3 bed'], 'average']] : [])] }
      : { eyebrow: 'DAFT REPORT 2026 Q1', tiles: [['1 bed apartment', report.oneBed, 'average'], ['2 bed apartment', report.twoBed, 'average']] };
  }
  const areas = Object.entries(rtb?.areas || {}).filter(([, v]) => v.all).sort((a, b) => a[1].all - b[1].all);
  const hasRtb = rtb?.district && Object.keys(rtb.district).length > 0;
  return (
    <>
      <section className="profile-section">
        <SectionTitle eyebrow={fallback ? fallback.eyebrow : 'DAFT LISTINGS'} title="Monthly rent" icon="village" />
        <div className="seg-toggle" role="group" aria-label="Rent type">
          <button type="button" aria-pressed={rentMode === 'rooms'} onClick={() => setRentMode('rooms')}>Rooms</button>
          <button type="button" aria-pressed={rentMode === 'homes'} onClick={() => setRentMode('homes')}>Whole homes</button>
        </div>
        {have.length > 0 && (
          <div className="rent-grid">
            {have.map((k) => {
              const x = listing[k];
              return (
                <div className="rent-tile" key={k}>
                  <span>{k[0].toUpperCase() + k.slice(1)} · median</span>
                  <strong>{eur(x.median)}</strong>
                  <small>{x.n} listing{x.n > 1 ? 's' : ''} · {eur(x.min)}–{eur(x.max)}</small>
                </div>
              );
            })}
          </div>
        )}
        {fallback && (
          <div className="rent-grid">
            {fallback.tiles.map(([label, value, note]) => (
              <div className="rent-tile" key={label}><span>{label}</span><strong>{eur(value)}</strong><small>{note} · per month</small></div>
            ))}
          </div>
        )}
      </section>
      {hasRtb && (
        <section className="profile-section">
          <SectionTitle eyebrow="RTB 2025" title="Official average rent" icon="landmark" />
          <div className="rent-grid">
            {/* sizes already shown above (whole homes from RTB) aren't repeated */}
            {[['all', 'All homes'], ['1 bed', '1 bed'], ['2 bed', '2 bed'], ['3 bed', '3 bed']].filter(([k]) => rtb.district[k] && !(fallback?.eyebrow === 'RTB 2025' && k !== 'all')).map(([k, l]) => (
              <div className="rent-tile" key={k}><span>{l}</span><strong>{eur(rtb.district[k])}</strong><small>per month</small></div>
            ))}
          </div>
          {areas.length > 0 && (
            <div className="rtb-areas">
              {areas.map(([n, v]) => <div key={n}><span>{n}</span><b>{eur(v.all)}</b></div>)}
            </div>
          )}
          <p className="section-description top-gap">
            RTB average monthly rent, 2025, all property types{(rtb.derived || []).length ? '. District figure is the mean of its RTB areas.' : '.'}
          </p>
        </section>
      )}
      <ResidencesSection code={code} />
    </>
  );
}

function AmenitiesSection({ code, data, chain, setChain, shops, verifiedCounts }) {
  const counts = verifiedCounts?.[code] || data.amenCounts[code];
  // Only this district's shops: the map shows the same ones
  const inHere = (k) => shops.filter((x) => x.chain === k && x.district === code).length;
  const picked = chain ? chainInfo(chain) : null;
  return (
    <>
      <section className="profile-section">
        <SectionTitle eyebrow="SUPERMARKETS" title="Find a chain on the map" icon="cart" />
        <p className="section-description">Pick a chain to see its shops in {code} on the map. The number is how many there are in {code}.</p>
        <div className="chain-picker top-gap">
          {CHAINS.map(([k, label, colour]) => (
            <button
              type="button"
              key={k}
              aria-pressed={chain === k}
              disabled={!inHere(k) && chain !== k}
              style={chain === k ? { background: colour } : undefined}
              onClick={() => setChain(chain === k ? null : k)}
            >
              <i style={{ background: colour }} />{label}<small>{inHere(k)}</small>
            </button>
          ))}
        </div>
        {picked && (
          <p className="chain-result">
            {inHere(chain)
              ? <><b>{inHere(chain)} {picked[1]}</b> in {code}, shown on the map.</>
              : <>No {picked[1]} in {code}.</>}
            <button type="button" className="chain-clear" onClick={() => setChain(null)}>Clear</button>
          </p>
        )}
      </section>

      <section className="profile-section">
        <SectionTitle eyebrow="WITHIN THE DISTRICT" title="Amenities" icon="cart" />
        {counts ? (
          <>
            <div className="amenities-grid">
              {AMENITY_TYPES.map(([k, label, icon, colour]) => (
                <div key={k} className="amenity-tile">
                  <Icon className="amenity-icon" style={{ color: colour }} html={ICONS[icon]} />
                  <span className="amenity-label">{label}</span>
                  <strong>{counts[k] ?? 0}</strong>
                </div>
              ))}
            </div>
            {counts.asian != null && <p className="section-description top-gap">Includes {counts.asian} Asian restaurants.</p>}
            {verifiedCounts?.[code] && <p className="section-description">Named places from OpenStreetMap, counted by where they are inside {code}.</p>}
          </>
        ) : <EmptyNote>amenity data for {code}</EmptyNote>}
      </section>
    </>
  );
}

const MODE_NAMES = { WALK: 'Walk', TRAM: 'Luas', BUS: 'Bus', RAIL: 'DART/rail' };
function AreaSection({ code, data }) {
  const c = data.census[code];
  if (!c) return <EmptyNote>census figures for {code}</EmptyNote>;
  const shared = Object.entries(data.census).filter(([, v]) => v.LEA === c.LEA).map(([d]) => d);
  return (
    <section className="profile-section">
      <SectionTitle eyebrow="CENSUS" title="Who lives here" icon="village" />
      <div className="rent-grid">
        <div className="rent-tile"><span>Population</span><strong>{num(c.Population)}</strong></div>
        <div className="rent-tile"><span>Students</span><strong>{num(c.Students)}</strong></div>
        <div className="rent-tile"><span>Aged 20–29</span><strong>{num(c.Age_20_29)}</strong></div>
        <div className="rent-tile"><span>Born outside Ireland</span><strong>{c['Non_Irish_%']}%</strong></div>
        <div className="rent-tile"><span>Live in apartments</span><strong>{c['Apartments_%']}%</strong></div>
        <div className="rent-tile"><span>Internet at home</span><strong>{c['Internet_Access_%']}%</strong></div>
      </div>
      <p className="section-description top-gap">
        {c.source === 'eds'
          ? `Census 2022 figures added up from the ${c.EDs} electoral division${c.EDs > 1 ? 's' : ''} that make up ${code} (${c.LEA} local electoral area${c.LEA.includes(',') ? 's' : ''}).`
          : `Figures for the ${c.LEA} local electoral area${shared.length > 1 ? `, which covers ${shared.join(', ')}. They are not exact for ${code} alone.` : '.'}`}
      </p>
    </section>
  );
}

const CRIME_TYPES = [
  ['violent', 'Violent crime and assault', 35],
  ['robbery', 'Robbery', 25],
  ['burglary_theft', 'Burglary and theft', 20],
  ['public_order', 'Public order', 15],
  ['damage', 'Criminal damage', 5],
];

// Colour key for the safety colours (shown at the top of the Safety tab)
function SafetyKey() {
  const samples = [62, 53, 45, 30];
  const ranges = ['57+', '50–57', '40–50', 'under 40'];
  return (
    <div className="safety-key in-tab" aria-label="Safety colours legend">
      <b>How safe is each area?</b>
      <span className="safety-key-bar" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([v, c]) => `${c} ${v}%`).join(', ')})` }}>
        <i style={{ left: '50%' }} />
      </span>
      <span className="safety-key-ends"><span>More crime</span><span>50 = Irish town average</span><span>Less crime</span></span>
      <ul>
        {SAFETY_BANDS.map(([, name], i) => (
          <li key={name}><i style={{ background: heatColor(samples[i]) }} />{name}<small>{ranges[i]}</small></li>
        ))}
      </ul>
    </div>
  );
}

function SafetySection({ code, data }) {
  const s = data.safety?.[code];
  if (!s || typeof s.score !== 'number') return <><SafetyKey /><EmptyNote>crime data for {code}</EmptyNote></>;
  const colour = heatColor(s.score);
  const rates = s.rates || {};
  const ireland = s.ireland || {};
  const hasRates = CRIME_TYPES.some(([k]) => rates[k] != null && ireland[k] != null);
  const compare = (local, ire) => {
    const ratio = local / ire;
    if (ratio >= 1.1) return [`${ratio.toFixed(1)}× more`, '#b3261e'];
    if (ratio <= 0.9) return [`${Math.round((1 - ratio) * 100)}% less`, '#2d6748'];
    return ['About the same', '#6c7d6c'];
  };
  return (
    <>
      <SafetyKey />

      <section className="profile-section">
        <SectionTitle eyebrow="RELATIVE CRIME SCORE" title="How safe is it?" icon="landmark" />
        <div className="safety-verdict" style={{ background: colour.replace('rgb', 'rgba').replace(')', ', 0.16)') }}>
          <strong style={{ background: colour, color: textOnHeat(s.score) }}>{s.score.toFixed(0)}</strong>
          <div>
            <b>{safetyLabel(s.score)}</b>
            <span>{safetyPlain(s.score)}. Score {s.score.toFixed(1)} / 100, where 50 is the recorded-crime rate of Ireland’s towns and cities.</span>
          </div>
        </div>
        <div className="safety-meter" aria-hidden="true">
          <span className="safety-meter-fill" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([v, c]) => `${c} ${v}%`).join(', ')})` }} />
          <span className="safety-meter-avg" style={{ left: '50%' }} title="Irish town and city average" />
          <span className="safety-meter-dot" style={{ left: `${Math.max(0, Math.min(100, s.score))}%` }} />
        </div>
        <div className="safety-meter-labels"><span>More crime</span><span>Irish town average = 50</span><span>Less crime</span></div>
        {s.checkShare > 0 && (
          <p className="safety-check">⚠ {Math.round(s.checkShare * 100)}% of residents in {code} live in areas marked “check the specific street before choosing” (Pobal deprivation index). Crime figures cover whole Garda station areas and can hide local problems.</p>
        )}
        {s.override && (
          <p className="safety-check">The {code} scores were set by the project team from local knowledge of the area, not calculated from the crime figures below.</p>
        )}
      </section>

      {hasRates && (
        <section className="profile-section">
          <SectionTitle eyebrow={`${(s.period || '').toUpperCase()} · PER 1,000 PEOPLE A YEAR`} title="Recorded crime" icon="landmark" />
          <table className="safety-rates">
            <thead><tr><th>Crime (weight)</th><th>{code}</th><th>Ireland</th><th>Compared</th></tr></thead>
            <tbody>
              {CRIME_TYPES.filter(([k]) => rates[k] != null && ireland[k] != null).map(([k, name, w]) => {
                const [text, c] = compare(rates[k], ireland[k]);
                return (
                  <tr key={k}>
                    <td>{name}<small>{w}% of the score</small></td>
                    <td>{Number(rates[k]).toFixed(2)}</td>
                    <td>{Number(ireland[k]).toFixed(2)}</td>
                    <td className="ratio" style={{ color: c }}>{text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="profile-section">
        <SectionTitle eyebrow="ALSO WORTH KNOWING" title="Around the area" icon="village" />
        <div className="rent-grid">
          {s.garda != null && <div className="rent-tile"><span>Nearest Garda station</span><strong>{Number(s.garda).toFixed(1)} km</strong><small>average from homes in {code}</small></div>}
          {s.night != null && <div className="rent-tile"><span>Night transport</span><strong>{Math.round(s.night * 100)}%</strong><small>of streets near a stop served 23:00–05:00</small></div>}
          {s.lit != null && <div className="rent-tile"><span>Street lighting</span><strong>{Math.round(s.lit * 100)}%</strong><small>of mapped streets are lit</small></div>}
        </div>
      </section>

      {s.hoods?.length > 0 && (
        <section className="profile-section">
          <SectionTitle eyebrow="NEIGHBOURHOODS" title={`Safety across ${code}`} extra={<span className="place-count">{s.hoods.length} areas</span>} />
          <div className="safety-hoods">
            {s.hoods.map(([name, score, check]) => (
              <div key={name}>
                <i style={{ background: heatColor(Number(score)) }} />
                <span>{name}</span>
                <b>{Number(score).toFixed(0)}{check && <em title="Check the specific street before choosing">⚠ check street</em>}</b>
              </div>
            ))}
          </div>
        </section>
      )}

      {s.stations?.length > 0 && (
        <section className="profile-section">
          <SectionTitle eyebrow="WHERE THE SCORE COMES FROM" title="Garda station areas" icon="landmark" />
          <div className="safety-stations">
            {s.stations.map(([name, share, score]) => (
              <div key={name}>
                <span>{name} <small>· {Number(score).toFixed(1)}</small></span>
                <span className="bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
                <b>{Math.round(share * 100)}%</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// District of a campus from its address, e.g. "Aungier Street, Dublin 2" → "D2"
const campusDistrict = (u) => {
  const m = String(u.location || '').match(/Dublin\s*(\d{1,2})(\s*W)?\b/i);
  return m ? `D${Number(m[1])}${m[2] ? 'W' : ''}` : null;
};

export default function DistrictProfile({
  selectedId, data, team, places, tab, setTab, rentMode, setRentMode, chain = null, setChain = () => {},
  hoverPlace, setHoverPlace, onPlaceClick, onSelect,
  trip, setTrip, onTripReset = () => {}, journeyQuickStarts = [], chainShops = [], amenityCounts = null, onCompare,
}) {
  const profile = data.profiles[selectedId];
  const index = ACTIVE_DISTRICTS.indexOf(selectedId);
  const step = (dir) => onSelect(ACTIVE_DISTRICTS[(index + dir + ACTIVE_DISTRICTS.length) % ACTIVE_DISTRICTS.length]);
  const sc = data.safety?.[selectedId]?.score;
  const accent = strongColor(profile.hue);
  // At-a-glance figures for the banner
  const rooms = data.rent?.[selectedId]?.rooms || {};
  const roomMedians = [rooms.single?.median, rooms.double?.median].filter(Boolean);
  const rtbAll = data.rtb?.[selectedId]?.district?.all;
  const reportRoom = data.roomReport?.areas?.[selectedId]?.single;
  const rentStat = roomMedians.length ? [eur(Math.min(...roomMedians)), 'room, per month']
    : reportRoom ? [eur(reportRoom), 'room, per month'] : rtbAll ? [eur(rtbAll), 'home, per month'] : ['—', 'not collected yet'];
  // Switching tab while scrolled down: bring the new tab's start up to just under the tab bar, instead of
  // leaving it half-way down (the card scrolls on laptops, the page on phones)
  const tabsRef = useRef(null);
  const firstTab = useRef(true);
  useLayoutEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    const tabs = tabsRef.current;
    const panel = tabs?.nextElementSibling;
    if (!panel) return;
    const gap = parseFloat(getComputedStyle(tabs).marginBottom) || 0;
    const behind = panel.getBoundingClientRect().top - (tabs.getBoundingClientRect().bottom + gap);
    if (behind >= -1) return; // already showing from its start
    let box = tabs.parentElement;
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
    if (box) box.scrollTop += behind; else window.scrollBy(0, behind);
  }, [tab]);
  const prev = ACTIVE_DISTRICTS[(index - 1 + ACTIVE_DISTRICTS.length) % ACTIVE_DISTRICTS.length];
  const next = ACTIVE_DISTRICTS[(index + 1) % ACTIVE_DISTRICTS.length];

  return (
    <aside className="profile-card pc" style={{ '--accent': accent, '--banner': bannerColor(profile.hue) }}>
      <div className="profile-banner">
        <div className="profile-banner-top">
          <span className="profile-kicker">{profile.county ? 'County Dublin · approximate area' : profile.side} · Eircode {profile.eircode}</span>
          <span className="district-pill">{selectedId}</span>
        </div>
        <h2>{team?.name || profile.name}</h2>
        {team?.description
          ? <p>{team.description}</p>
          : <Hoods areas={profile.areas} />}

        <div className="pc-stats">
          {typeof sc === 'number' && (
            <button type="button" onClick={() => setTab('safety')} title="See the Safety tab">
              <small>Safety</small>
              <b><i style={{ background: heatColor(sc), color: textOnHeat(sc) }}>{sc.toFixed(0)}</i></b>
              <span>{safetyLabel(sc)}</span>
            </button>
          )}
          <button type="button" onClick={() => setTab('rent')} title="See the Rent tab">
            <small>Rent from</small>
            <b>{rentStat[0]}</b>
            <span>{rentStat[1]}</span>
          </button>
          <button type="button" onClick={() => setTab('places')} title="See the Places tab">
            <small>Famous places</small>
            <b>{places.length}</b>
            <span>to explore</span>
          </button>
        </div>
        {onCompare && (
          <button type="button" className="pc-compare" onClick={onCompare}>
            <span aria-hidden="true">⇄</span> Compare {selectedId} with another district
          </button>
        )}
        <span className="banner-decoration">{selectedId.replace('D', '')}</span>
      </div>

      <div className="profile-body">
        <div className="profile-tabs" role="tablist" ref={tabsRef}>
          {TABS.map(([k, l]) => (
            <button type="button" role="tab" key={k} data-tab={k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'places' && <PlacesSection code={selectedId} places={places} hoverPlace={hoverPlace} onHoverPlace={setHoverPlace} onPlaceClick={onPlaceClick} />}
        {tab === 'rent' && <RentSection code={selectedId} data={data} rentMode={rentMode} setRentMode={setRentMode} />}
        {tab === 'amen' && <AmenitiesSection code={selectedId} data={data} chain={chain} setChain={setChain} shops={chainShops} verifiedCounts={amenityCounts} />}
        {tab === 'safety' && <SafetySection code={selectedId} data={data} />}
        {tab === 'journey' && trip && <JourneyPlannerPanel trip={trip} setTrip={setTrip} onReset={onTripReset} quickStarts={journeyQuickStarts} />}
        {tab === 'area' && <AreaSection code={selectedId} data={data} />}

        <nav className="district-navigation" aria-label="Other districts">
          <button type="button" onClick={() => step(-1)}><span>←</span> {prev} · {data.profiles[prev]?.name}</button>
          <button type="button" onClick={() => step(1)}>{next} · {data.profiles[next]?.name} <span>→</span></button>
        </nav>
      </div>
    </aside>
  );
}
