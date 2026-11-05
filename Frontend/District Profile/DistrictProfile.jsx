import { useEffect, useState } from 'react';
import { universities } from './cityPlaces';
import { ACTIVE_DISTRICTS, AMENITY_TYPES, HEAT_STOPS, SAFETY_BANDS, ICONS, iconFor, strongColor, bannerColor, safetyLabel, safetyPlain, heatColor, textOnHeat } from './DistrictMap';
const TABS = [['places', 'Places'], ['rent', 'Rent'], ['amen', 'Amenities'], ['safety', 'Safety'], ['commute', 'Commute'], ['area', 'Area'], ['unis', 'Universities']];
const eur = (v) => `€${Math.round(v).toLocaleString('en-IE')}`;
const num = (v) => Number(v).toLocaleString('en-IE');
const Icon = ({ name, html, ...rest }) => <span {...rest} dangerouslySetInnerHTML={{ __html: html || iconFor(name) }} />;



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

  const useWikipedia = () => {
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

  useEffect(() => { if (!place.image) useWikipedia(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!src) return <div className="place-image place-image-fallback"><Icon name={place.cat} /></div>;
  return <img className="place-image" src={src} alt={place.name} loading="lazy" onError={useWikipedia} />;
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

function RentSection({ code, data, rentMode, setRentMode }) {
  const r = data.rent[code] || { rooms: {}, homes: {} };
  const rtb = data.rtb[code];
  const listing = rentMode === 'rooms' ? r.rooms : r.homes;
  const keys = rentMode === 'rooms' ? ['single', 'double'] : ['studio', '1 bed', '2 bed', '3 bed', '4+ bed'];
  const have = keys.filter((k) => listing?.[k]);
  const areas = Object.entries(rtb?.areas || {}).filter(([, v]) => v.all).sort((a, b) => a[1].all - b[1].all);
  return (
    <>
      <section className="profile-section">
        <SectionTitle eyebrow="DAFT LISTINGS" title="Monthly rent" icon="village" />
        <div className="seg-toggle" role="group" aria-label="Rent type">
          <button type="button" aria-pressed={rentMode === 'rooms'} onClick={() => setRentMode('rooms')}>Rooms</button>
          <button type="button" aria-pressed={rentMode === 'homes'} onClick={() => setRentMode('homes')}>Whole homes</button>
        </div>
        {have.length ? (
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
        ) : <EmptyNote>{rentMode === 'rooms' ? 'room' : 'whole-property'} listings for {code}</EmptyNote>}
      </section>
      <section className="profile-section">
        <SectionTitle eyebrow="RTB 2025" title="Official average rent" icon="landmark" />
        {rtb?.district && Object.keys(rtb.district).length ? (
          <>
            <div className="rent-grid">
              {[['all', 'All homes'], ['1 bed', '1 bed'], ['2 bed', '2 bed'], ['3 bed', '3 bed']].filter(([k]) => rtb.district[k]).map(([k, l]) => (
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
          </>
        ) : <EmptyNote>RTB averages for {code}</EmptyNote>}
      </section>
    </>
  );
}

function AmenitiesSection({ code, data, hiddenAmenities, toggleAmenity }) {
  const counts = data.amenCounts[code];
  const hasPoints = Boolean(data.amenities[code]);
  if (!counts) return <EmptyNote>amenity data for {code}</EmptyNote>;
  return (
    <section className="profile-section">
      <SectionTitle eyebrow="WITHIN THE DISTRICT" title="Amenities" icon="cart" />
      <p className="section-description">
        {hasPoints ? 'Tap a category to show or hide its dots on the map.' : 'Counts only. Location points for this district have not been uploaded yet.'}
      </p>
      <div className="amenities-grid">
        {AMENITY_TYPES.map(([k, label, icon, colour]) => {
          const off = hiddenAmenities.has(k);
          return (
            <button type="button" key={k} className={`amenity-tile ${off ? 'is-off' : ''}`} aria-pressed={!off} disabled={!hasPoints} onClick={() => toggleAmenity(k)}>
              <Icon className="amenity-icon" style={{ color: colour }} html={ICONS[icon]} />
              <span className="amenity-label">{label}</span>
              <strong>{counts[k] ?? 0}</strong>
            </button>
          );
        })}
      </div>
      {counts.asian != null && <p className="section-description top-gap">Includes {counts.asian} Asian restaurants.</p>}
    </section>
  );
}

const MODE_NAMES = { WALK: 'Walk', TRAM: 'Luas', BUS: 'Bus', RAIL: 'DART/rail' };
function CommuteSection({ code, data, uni, setUni, onStopClick }) {
  const walk = data.walk[code]?.[uni];
  const pt = data.commute?.[code]?.[uni];
  const stops = data.stops.filter((s) => s.d === code);
  const lines = [...new Set(stops.map((s) => s.line))];
  return (
    <>
      <section className="profile-section">
        <SectionTitle eyebrow="GETTING TO CLASS" title="Commute" icon="university" />
        <label className="section-eyebrow" htmlFor="uni-select">YOUR UNIVERSITY</label>
        <select id="uni-select" className="uni-select" value={uni} onChange={(e) => setUni(e.target.value)}>
          {data.unis.map((u) => <option key={u}>{u}</option>)}
        </select>
        <div className="rent-grid top-gap">
          {pt && (
            <div className="rent-tile">
              <span>Public transport</span>
              <strong>{pt.center.min} min</strong>
              <small>{pt.center.tr ? `${pt.center.tr} transfer${pt.center.tr > 1 ? 's' : ''}` : 'No transfers'} · edges {pt.lo}–{pt.hi} min</small>
            </div>
          )}
          {walk ? (
            <div className="rent-tile">
              <span>Walking</span>
              <strong>{walk.min} min</strong>
              <small>{walk.km} km from {walk.center} · edges {walk.lo}–{walk.hi} min</small>
            </div>
          ) : <EmptyNote>walking time for this university</EmptyNote>}
        </div>
        {pt && (
          <div className="mode-chain">
            {pt.center.modes.split('→').map((m, i) => <span key={i}>{MODE_NAMES[m.trim()] || m.trim()}</span>)}
          </div>
        )}
        <p className="section-description top-gap">
          {pt ? 'Journey planner, weekday 8:00 departure, from the district centre.' : 'Public transport times are collected for TU Dublin Grangegorman so far.'}
        </p>
      </section>
      <section className="profile-section">
        <SectionTitle eyebrow="LUAS" title={`Stops in ${code}`} icon="landmark" />
        {stops.length ? (
          <>
            <div className="stop-chips">
              {stops.map((s) => (
                <button type="button" key={s.name} onClick={() => onStopClick(s.name)}>
                  <i className={s.line === 'Red' ? 'red-line' : 'green-line'} />{s.name}
                </button>
              ))}
            </div>
            <p className="section-description top-gap">
              {lines.map((l) => { const ln = data.lines[l.toLowerCase()] || {}; return `${l} Line every ${ln.peak || ln.interval} min at peak`; }).join(' · ')}
            </p>
          </>
        ) : <p className="empty-note">No Luas stop inside {code}. Check bus and DART links.</p>}
      </section>
    </>
  );
}

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
        Figures for the {c.LEA} local electoral area{shared.length > 1 ? `, which covers ${shared.join(', ')}. They are not exact for ${code} alone.` : '.'}
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

function SafetySection({ code, data }) {
  const s = data.safety?.[code];
  if (!s) return <EmptyNote>crime data for {code}</EmptyNote>;
  const colour = heatColor(s.score);
  const compare = (local, ireland) => {
    const ratio = local / ireland;
    if (ratio >= 1.1) return [`${ratio.toFixed(1)}× more`, '#b3261e'];
    if (ratio <= 0.9) return [`${Math.round((1 - ratio) * 100)}% less`, '#2d6748'];
    return ['About the same', '#6c7d6c'];
  };
  return (
    <>
      <section className="profile-section">
        <SectionTitle eyebrow="RELATIVE CRIME SCORE" title="How safe is it?" icon="landmark" />
        <div className="safety-verdict" style={{ background: `${colour.replace('rgb', 'rgba').replace(')', ', 0.16)')}` }}>
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

      <section className="profile-section">
        <SectionTitle eyebrow={`${s.period.toUpperCase()} · PER 1,000 PEOPLE A YEAR`} title="Recorded crime" icon="landmark" />
        <table className="safety-rates">
          <thead><tr><th>Crime (weight)</th><th>{code}</th><th>Ireland</th><th>Compared</th></tr></thead>
          <tbody>
            {CRIME_TYPES.map(([k, name, w]) => {
              const [text, c] = compare(s.rates[k], s.ireland[k]);
              return (
                <tr key={k}>
                  <td>{name}<small>{w}% of the score</small></td>
                  <td>{s.rates[k].toFixed(2)}</td>
                  <td>{s.ireland[k].toFixed(2)}</td>
                  <td className="ratio" style={{ color: c }}>{text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="section-description top-gap">“Ireland” is the rate across Ireland’s 105 town and city Garda stations. People = residents plus daytime workers and students.</p>
      </section>

      <section className="profile-section">
        <SectionTitle eyebrow="ALSO WORTH KNOWING" title="Around the area" icon="village" />
        <div className="rent-grid">
          <div className="rent-tile"><span>Nearest Garda station</span><strong>{s.garda.toFixed(1)} km</strong><small>average from homes in {code}</small></div>
          {s.night != null && <div className="rent-tile"><span>Night transport</span><strong>{Math.round(s.night * 100)}%</strong><small>of streets near a stop served 23:00–05:00</small></div>}
          {s.lit != null && <div className="rent-tile"><span>Street lighting</span><strong>{Math.round(s.lit * 100)}%</strong><small>of mapped streets are lit</small></div>}
        </div>
        <p className="section-description top-gap">Shown for context. These are not part of the crime score.</p>
      </section>

      {s.hoods?.length > 0 && (
        <section className="profile-section">
          <SectionTitle eyebrow="NEIGHBOURHOODS" title={`Safety across ${code}`} extra={<span className="place-count">{s.hoods.length} areas</span>} />
          <div className="safety-hoods">
            {s.hoods.map(([name, score, check]) => (
              <div key={name}>
                <i style={{ background: heatColor(score) }} />
                <span>{name}</span>
                <b>{score.toFixed(0)}{check && <em title="Check the specific street before choosing">⚠ check street</em>}</b>
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
                <span>{name} <small>· {score.toFixed(1)}</small></span>
                <span className="bar"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
                <b>{Math.round(share * 100)}%</b>
              </div>
            ))}
          </div>
          <p className="section-description top-gap">The district score is the average of these station areas, weighted by how many residents live in each.</p>
        </section>
      )}

      <p className="section-description top-gap">
        Score = 100 × R ÷ (R + L) for each crime type, where R is the Irish town and city rate and L the local rate; the five types are weighted as shown. Recorded crime only: not the chance of becoming a victim. Source: CSO recorded crime (CJA11), 2023–2025, and Census 2022.
      </p>
    </>
  );
}

// District of a campus from its address, e.g. "Aungier Street, Dublin 2" → "D2"
const campusDistrict = (u) => {
  const m = String(u.location || '').match(/Dublin\s*(\d{1,2})(\s*W)?\b/i);
  return m ? `D${Number(m[1])}${m[2] ? 'W' : ''}` : null;
};

function UniversitiesSection({ code, onCampusClick, onCampusHover }) {
  const here = universities.filter((u) => campusDistrict(u) === code);
  const others = universities.filter((u) => campusDistrict(u) !== code);
  const row = (u, i) => (
    <li key={u.id}>
      <button
        type="button"
        className="uni-row"
        style={{ '--place-index': i }}
        onClick={() => onCampusClick(u.id)}
        onMouseEnter={() => onCampusHover(u.id)}
        onMouseLeave={() => onCampusHover(null)}
        onFocus={() => onCampusHover(u.id)}
        onBlur={() => onCampusHover(null)}
      >
        <span className="uni-row-icon"><Icon html={ICONS.university} /></span>
        <span className="uni-row-text">
          <strong>{u.name}</strong>
          <small>{u.location}</small>
        </span>
        {campusDistrict(u) && <span className="uni-row-code">{campusDistrict(u)}</span>}
      </button>
      <a className="uni-row-link" href={u.url} target="_blank" rel="noreferrer" aria-label={`${u.name} website`}>↗</a>
    </li>
  );
  return (
    <>
      <section className="profile-section">
        <SectionTitle eyebrow="CAMPUS LIFE" title={here.length ? `Universities in ${code}` : `No campus in ${code}`} extra={<span className="place-count">{universities.length} campuses</span>} />
        {here.length ? <ul className="uni-list">{here.map(row)}</ul> : <p className="section-description">Pick a campus below to see where it is and how far it is from {code}.</p>}
      </section>
      <section className="profile-section">
        <SectionTitle eyebrow="ACROSS DUBLIN" title="All universities and colleges" icon="university" />
        <p className="section-description">Click a campus to show it on the map. ↗ opens its website.</p>
        <ul className="uni-list top-gap">{others.map((u, i) => row(u, i + here.length))}</ul>
      </section>
    </>
  );
}

export default function DistrictProfile({
  selectedId, data, team, places, tab, setTab, rentMode, setRentMode, hiddenAmenities, toggleAmenity,
  uni, setUni, hoverPlace, setHoverPlace, onPlaceClick, onStopClick, onSelect,
  onCampusClick = () => {}, onCampusHover = () => {},
}) {
  const profile = data.profiles[selectedId];
  const index = ACTIVE_DISTRICTS.indexOf(selectedId);
  const step = (dir) => onSelect(ACTIVE_DISTRICTS[(index + dir + ACTIVE_DISTRICTS.length) % ACTIVE_DISTRICTS.length]);

  return (
    <aside className="profile-card">
      <div className="profile-banner" style={{ background: bannerColor(profile.hue) }}>
        <div className="profile-banner-top">
          <span className="profile-kicker">DISTRICT PROFILE · {profile.side.toUpperCase()}</span>
          <span className="district-pill">{selectedId}</span>
        </div>
        <h2>{team?.name || profile.name}</h2>
        <p>{team?.description || profile.areas.map((a) => a[0]).join(' · ')}</p>
        <p className="eircode-line">Eircode routing key <b>{profile.eircode}</b></p>
        {data.safety?.[selectedId] && (
          <button type="button" className="banner-safety" onClick={() => setTab('safety')} title="See the Safety tab">
            <b style={{ background: heatColor(data.safety[selectedId].score), color: textOnHeat(data.safety[selectedId].score) }}>{data.safety[selectedId].score.toFixed(0)}</b>
            {safetyLabel(data.safety[selectedId].score)}
          </button>
        )}
        <span className="banner-decoration">{selectedId.replace('D', '')}</span>
      </div>

      <div className="profile-body">
        <div className="district-navigation">
          <button type="button" onClick={() => step(-1)}><span>←</span> {ACTIVE_DISTRICTS[(index - 1 + ACTIVE_DISTRICTS.length) % ACTIVE_DISTRICTS.length]}</button>
          <span>{String(index + 1).padStart(2, '0')} <i /> {ACTIVE_DISTRICTS.length} districts</span>
          <button type="button" onClick={() => step(1)}>{ACTIVE_DISTRICTS[(index + 1) % ACTIVE_DISTRICTS.length]} <span>→</span></button>
        </div>

        <div className="profile-tabs" role="tablist">
          {TABS.map(([k, l]) => (
            <button type="button" role="tab" key={k} aria-selected={tab === k} onClick={() => setTab(k)}
              style={tab === k ? { color: strongColor(profile.hue), borderColor: strongColor(profile.hue) } : undefined}>{l}</button>
          ))}
        </div>

        {tab === 'places' && <PlacesSection code={selectedId} places={places} hoverPlace={hoverPlace} onHoverPlace={setHoverPlace} onPlaceClick={onPlaceClick} />}
        {tab === 'rent' && <RentSection code={selectedId} data={data} rentMode={rentMode} setRentMode={setRentMode} />}
        {tab === 'amen' && <AmenitiesSection code={selectedId} data={data} hiddenAmenities={hiddenAmenities} toggleAmenity={toggleAmenity} />}
        {tab === 'safety' && <SafetySection code={selectedId} data={data} />}
        {tab === 'commute' && <CommuteSection code={selectedId} data={data} uni={uni} setUni={setUni} onStopClick={onStopClick} />}
        {tab === 'area' && <AreaSection code={selectedId} data={data} />}
        {tab === 'unis' && <UniversitiesSection code={selectedId} onCampusClick={onCampusClick} onCampusHover={onCampusHover} />}
      </div>
    </aside>
  );
}
