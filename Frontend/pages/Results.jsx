import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Results.css'
import { districts } from '../District Profile/districtData.js'
import { TRAVEL_MODES } from './CommuteFields'
import { FlowChoices, FlowIcon, FlowSidebar } from './FlowLayout'
import RouteMap from './RouteMap'
import { setChatContext } from '../chatContext'

// '' = same address as the website (Azure serves both); unset = the Render API.
const MODE_ICONS = { public_transport: 'bus', walk: 'walk', cycle: 'bike' }

const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'
const ANSWERS_KEY = 'questionnaireAnswers'

function answersToLink(answers) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(answers))))
}

function answersFromLink(text) {
  try {
    const answers = JSON.parse(decodeURIComponent(escape(atob(text))))
    return answers?.university && answers?.budget ? answers : null
  } catch {
    return null
  }
}


function loadAnswers(state, search) {
  const answers = state ?? answersFromLink(new URLSearchParams(search).get('a') ?? '')
  try {
    if (answers) {
      sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(answers))
      return answers
    }
    return JSON.parse(sessionStorage.getItem(ANSWERS_KEY))
  } catch {
    return answers ?? null
  }
}

function euro(value) {
  return `€${Math.round(value).toLocaleString('en-IE')}`
}

// One safety score per postal district, straight from safety_indicators.csv (via the API).
// Relative crime scores: 0-100 against the recorded-crime rate of Irish towns and cities (50 = that rate), in four bands.
// Plain-language bands so anyone (e.g. a new international student) can read them. "Average" = Irish towns and cities.
const SAFETY_TIERS = [[57, 'Much safer than average'], [50, 'A little safer than average'], [40, 'A little less safe than average'], [0, 'Much less safe than average']]
const TIER_TONE = { 'Much safer than average': 'good', 'A little safer than average': 'good', 'A little less safe than average': 'mid', 'Much less safe than average': 'low' }

// Bands from the unrounded score (the card shows one decimal, so the number and its band always agree).
function safetyTier(score) {
  return SAFETY_TIERS.find(([cut]) => score >= cut)[1]
}

function safetyLevel(raw) {
  const tier = safetyTier(raw)
  return [TIER_TONE[tier], tier]
}

// Plain verdict for one area: at or above the Irish town/city rate (50) counts as safe.
function safeOrUnsafe(score) {
  return score >= 50 ? ['good', 'Safe'] : ['low', 'Unsafe']
}

function SafetyScore({ label, score }) {
  if (score == null) return null
  const [tone, words] = safetyLevel(score)
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {score.toFixed(1)}<span className="result-muted">/100</span>
        <span className={`safety-tag ${tone}`}>{words}</span>
        <span className="safety-meter" role="img" aria-label={`${label}: ${score.toFixed(1)} out of 100`}>
          <span className={tone} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
        </span>
      </dd>
    </div>
  )
}

function SafetyScores({ area, safety }) {
  if (!safety) return null
  const parts = (safety.station_areas ?? []).filter((p) => p.score != null)

  return (
    <section className="result-safety" aria-label={`Safety in ${area}`}>
      <h3>Safety</h3>
      <dl className="result-stats safety-stats">
        <SafetyScore label={`Safety score for ${area}`} score={safety.index} />
      </dl>
      {parts.length > 0 && (
        <>
          <h4>Areas in {area}</h4>
          <ul className="safety-areas">
            {parts.map((part) => {
              const [tone, verdict] = safeOrUnsafe(part.score)
              return (
                <li key={part.station}>
                  <span>{part.station}</span>
                  <span>{part.score.toFixed(1)}<span className="result-muted">/100</span></span>
                  <span className={`safety-tag ${tone}`}>{verdict}</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <p className="home-credits">
        Crime data: Central Statistics Office (CSO), Garda recorded crime, CC BY 4.0. Population and boundaries: CSO
        Census and Tailte Éireann, CC BY 4.0.
      </p>
    </section>
  )
}

const RESIDENCES_SHOWN = 4
const STUDENT_ROOM_NAMES = { shared: 'Shared room', private: 'Private room', studio: 'Studio' }

// Student residences in the district (OpenStreetMap) and rental searches for it (Daft.ie, Rent.ie).
// A residence's published price: monthly range, the weekly price it's quoted in, and whether it fits the budget
function ResidencePrice({ price, budget, missing }) {
  if (!price) return <span className="res-price res-price-none">{missing || 'Contact the residence for prices'}</span>
  const month = price.monthly_to && price.monthly_to !== price.monthly_from
    ? `${euro(price.monthly_from)}–${euro(price.monthly_to)}` : `from ${euro(price.monthly_from)}`
  const week = price.weekly_from
    ? (price.weekly_to && price.weekly_to !== price.weekly_from ? `${euro(price.weekly_from)}–${euro(price.weekly_to)}` : `from ${euro(price.weekly_from)}`)
    : null
  const fits = budget && price.monthly_from <= budget
  return (
    <span className="res-price">
      <b>{month}<small> a month</small></b>
      {week && <span className="result-muted">{week} a week</span>}
      {budget && <span className={`res-fit ${fits ? 'is-in' : 'is-out'}`}>{fits ? 'Within your budget' : `From ${euro(price.monthly_from - budget)} over budget`}</span>}
    </span>
  )
}

function PlacesToLive({ area, places, budget, student, room }) {
  const [showAll, setShowAll] = useState(false)
  if (!places) return null
  const { search_links: links = [] } = places
  // with a chosen student room type, show that room's price and list residences that have it first, cheapest first
  const priceOf = (r) => (room ? r.rooms?.[room] : r.price)
  const residences = [...(places.residences || [])].sort((a, b) => {
    const pa = priceOf(a), pb = priceOf(b)
    if (student) {
      return (pa ? 0 : 1) - (pb ? 0 : 1) || (b.in_matched_part ? 1 : 0) - (a.in_matched_part ? 1 : 0)
        || (a.walk_minutes ?? 999) - (b.walk_minutes ?? 999)
    }
    return (pa ? 0 : 1) - (pb ? 0 : 1) || (pa?.monthly_from ?? 0) - (pb?.monthly_from ?? 0)
  })
  const perPage = student ? 6 : RESIDENCES_SHOWN
  const shown = showAll ? residences : residences.slice(0, perPage)
  const priced = residences.filter((r) => r.price)
  const roomName = { shared: 'shared rooms', private: 'private rooms', studio: 'studios' }[room]

  return (
    <section className="result-homes" aria-label={`Places to live in ${area}`}>
      <h3>Places to live in {area}</h3>
      {student ? (<>      <h4>Student residences {residences.length > 0 && <span>{residences.length} in {area}</span>}</h4>
        {residences.length === 0 ? (
          <p className="result-muted">
            No purpose-built student residences in {area} on OpenStreetMap. Most students here rent a room in a
            shared house or apartment - try the searches above.
          </p>
        ) : (
          <>
            <ul className="home-list">
              {shown.map((r) => {
                return (
                  <li key={r.name} className="home-card">
                    <span className="home-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z" fill="currentColor" /></svg>
                    </span>
                    <span className="home-body">
                      <strong>{r.name}</strong>
                      <span className="result-muted">
                        {[r.operator || 'Student residence', r.address].filter(Boolean).join(' · ')}
                      </span>
                      {(r.walk_minutes != null || r.in_matched_part) && (
                      <span className="res-tags">
                        {r.walk_minutes != null && <span className="res-walk">🚶 ≈ {r.walk_minutes} min walk to campus</span>}
                        {r.in_matched_part && <span className="res-here">In this neighbourhood</span>}
                      </span>
                    )}
                    {room && r.rooms?.[room]?.note ? <span className="res-rooms">{r.rooms[room].note}</span>
                      : r.price?.room_types && <span className="res-rooms">{r.price.room_types}</span>}
                      {r.price?.notes && <span className="res-notes">{r.price.notes}</span>}
                    {r.price?.source && (
                      <a className={`res-source ${r.price.source_type === 'listing' ? 'is-listing' : ''}`} href={r.price.source} target="_blank" rel="noopener noreferrer">
                        {r.price.source_type === 'listing' ? 'Indicative price from listing sites, check before booking' : 'Price from the operator’s website'} ↗
                      </a>
                    )}
                    </span>
                    <ResidencePrice price={priceOf(r)} budget={budget} missing={room && r.price ? `No ${roomName} listed` : null} />
                    {r.website ? (
                      <a className="home-link" href={r.website} target="_blank" rel="noopener noreferrer">Website ↗</a>
                    ) : (
                      <span className="home-link muted">No website listed</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {residences.length > perPage && (
              <button type="button" className="home-more" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${residences.length} residences`}
              </button>
            )}
            <p className="home-note">
              {priced.length > 0
                ? `Prices are each residence's published starting prices (2026/27), checked ${new Date(priced[0].price.checked).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' })}. Weekly prices are shown as monthly (× 52 ÷ 12). Availability changes fast, so check rooms and who can apply on each website.`
                : 'Check rooms, prices and who can apply on each website.'}
            </p>
          </>
        )}
  
        {links.length > 0 && <h4 className="home-or">Or rent a room in a shared home</h4>}
      <p className="result-muted">Live listings open on Daft.ie and Rent.ie, filtered to {/^[AK]\d{2}$/.test(area) && links[0]?.label ? links[0].label.replace(/^.* in (.*) up to .*$/, '$1') : area}, your room type and budget.</p>
        <div className="home-search">
          {links.map((l) => (
            <a key={l.site} className="home-search-link" href={l.url} target="_blank" rel="noopener noreferrer">
              <strong>{l.site}</strong>
              <span>{l.label}</span>
              <span aria-hidden="true" className="home-search-arrow">↗</span>
            </a>
          ))}
        </div>
  
  
      </>) : (<>      <p className="result-muted">Live listings open on Daft.ie and Rent.ie, filtered to {/^[AK]\d{2}$/.test(area) && links[0]?.label ? links[0].label.replace(/^.* in (.*) up to .*$/, '$1') : area}, your room type and budget.</p>
      <div className="home-search">
        {links.map((l) => (
          <a key={l.site} className="home-search-link" href={l.url} target="_blank" rel="noopener noreferrer">
            <strong>{l.site}</strong>
            <span>{l.label}</span>
            <span aria-hidden="true" className="home-search-arrow">↗</span>
          </a>
        ))}
      </div>

      <h4>Student residences {residences.length > 0 && <span>{residences.length} in {area}</span>}</h4>
      {residences.length === 0 ? (
        <p className="result-muted">
          No purpose-built student residences in {area} on OpenStreetMap. Most students here rent a room in a
          shared house or apartment - try the searches above.
        </p>
      ) : (
        <>
          <ul className="home-list">
            {shown.map((r) => {
              return (
                <li key={r.name} className="home-card">
                  <span className="home-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z" fill="currentColor" /></svg>
                  </span>
                  <span className="home-body">
                    <strong>{r.name}</strong>
                    <span className="result-muted">
                      {[r.operator || 'Student residence', r.address].filter(Boolean).join(' · ')}
                    </span>
                    {r.price?.room_types && <span className="res-rooms">{r.price.room_types}</span>}
                    {r.price?.notes && <span className="res-notes">{r.price.notes}</span>}
                  </span>
                  <ResidencePrice price={r.price} budget={budget} />
                  {r.website ? (
                    <a className="home-link" href={r.website} target="_blank" rel="noopener noreferrer">Website ↗</a>
                  ) : (
                    <span className="home-link muted">No website listed</span>
                  )}
                </li>
              )
            })}
          </ul>
          {residences.length > perPage && (
            <button type="button" className="home-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${residences.length} residences`}
            </button>
          )}
          <p className="home-note">
            {priced.length > 0
              ? `Prices are each residence's published starting prices (2026/27), checked ${new Date(priced[0].price.checked).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' })}. Weekly prices are shown as monthly (× 52 ÷ 12). Availability changes fast, so check rooms and who can apply on each website.`
              : 'Check rooms, prices and who can apply on each website.'}
          </p>
        </>
      )}
      </>)}
      <p className="home-credits">
        Residences: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap
        contributors</a> (ODbL), the official websites of the operators and universities, and Amber Student, checked October 2026.
        Find Your Dublin is not affiliated with Daft.ie, Rent.ie or any residence listed.
      </p>
    </section>
  )
}

// compared: 1 = better than most areas, 0 = about average, -1 = worse (icon + words, never colour alone)
const TONES = { 1: 'better', 0: 'average', [-1]: 'worse' }
const FACTOR_ICONS = {
  Rent: 'euro', Safety: 'shield', Commute: 'clock',
  'Shopping & Groceries': 'basket', Supermarkets: 'basket', 'Grocery Shops': 'basket', 'Shopping Malls': 'basket',
  Restaurants: 'fork', Healthcare: 'heart', Hospitals: 'heart', Pharmacies: 'heart',
  'Recreation & Wellness': 'tree', Gyms: 'tree', Parks: 'tree',
}
// what "better" and "worse" mean for each kind of factor, in plain words
function comparedWords(factor, compared) {
  if (compared === 0 || compared == null) return 'About average'
  const better = compared > 0
  if (factor === 'Rent') return better ? 'Cheaper than most areas' : 'Pricier than most areas'
  if (factor === 'Commute') return better ? 'Quicker commute than most areas' : 'Longer commute than most areas'
  if (factor === 'Safety') return better ? 'Safer than most areas' : 'Less safe than most areas'
  return better ? 'More nearby than most areas' : 'Fewer nearby than most areas'
}

function joinWords(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

// How much the student cares: five dots (importance is 0-10)
function ImportanceDots({ value, label }) {
  const filled = Math.round((value ?? 0) / 2)
  return (
    <span className="why-importance" title={label} aria-label={`${label} to you`}>
      <span className="why-dots" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < filled ? 'on' : ''} />)}
      </span>
      {label}
    </span>
  )
}

// Why the place ranked here: a card per factor the student rated, most important first
function WhyThisPlace({ result, place }) {
  const items = result.breakdown
  const title = `Why ${place} is #${result.rank}`
  if (!items?.length) {
    return (
      <>
        <h3>{title}</h3>
        <p>{result.why}</p>
      </>
    )
  }
  const { ahead_of: ahead, behind } = result.compared_with ?? {}
  const strong = items.filter((item) => item.compared > 0).map((item) => item.factor)
  const weak = items.filter((item) => item.compared < 0).map((item) => item.factor)

  return (
    <section className="result-why" aria-label={title}>
      <h3>{title}</h3>
      {(strong.length > 0 || weak.length > 0) && (
        <div className="why-summary">
          {strong.length > 0 && (
            <p><span className="why-summary-label better">▲ Strong on</span>{strong.map((f) => <span key={f} className="why-chip better">{f}</span>)}</p>
          )}
          {weak.length > 0 && (
            <p><span className="why-summary-label worse">▼ Weaker on</span>{weak.map((f) => <span key={f} className="why-chip worse">{f}</span>)}</p>
          )}
        </div>
      )}
      <p className="result-muted why-intro">
        Everything you rated, most important to you first, compared with the other areas we looked at.
      </p>
      <ul className="why-grid">
        {items.map((item) => {
          const tone = TONES[item.compared] ?? 'average'
          const score = Math.max(0, Math.min(100, item.score ?? 0))
          return (
            <li key={item.factor} className={`why-card ${tone}`}>
              <div className="why-card-head">
                <span className="why-icon"><FlowIcon name={FACTOR_ICONS[item.factor] ?? 'pin'} /></span>
                <strong>{item.factor}</strong>
                <ImportanceDots value={item.importance} label={item.importance_label} />
              </div>
              <p className="why-card-value">{item.value}</p>
              <p className={`why-card-compare ${tone}`}>
                <span aria-hidden="true">{tone === 'better' ? '▲' : tone === 'worse' ? '▼' : '●'}</span>
                {comparedWords(item.factor, item.compared)}
              </p>
              <div className="why-meter">
                <span className="why-meter-label">Covers your need <b>{score}%</b></span>
                <span className="why-meter-bar" role="img" aria-label={`Covers ${score}% of your need for ${item.factor}`}>
                  <span style={{ width: `${Math.max(3, score)}%` }} />
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {(behind?.reasons?.length > 0 || ahead?.reasons?.length > 0) && (
        <ul className="why-compare">
          {behind?.reasons?.length > 0 && (
            <li>
              <span className="why-rank">#{behind.rank}</span>
              <span><strong>{behind.name}, {behind.area}</strong> ranked higher with {joinWords(behind.reasons)}</span>
            </li>
          )}
          {ahead?.reasons?.length > 0 && (
            <li>
              <span className="why-rank">#{ahead.rank}</span>
              <span>Ahead of <strong>{ahead.name}, {ahead.area}</strong> for {joinWords(ahead.reasons)}</span>
            </li>
          )}
        </ul>
      )}
      {result.commute_penalty_pct != null && (
        <p className="result-muted">The long commute lowers the match score by {result.commute_penalty_pct}%.</p>
      )}
      {result.budget_penalty_pct != null && (
        <p className="result-muted">Being over your budget lowers the match score by {result.budget_penalty_pct}%.</p>
      )}
    </section>
  )
}

// "about 2 in 5 people" - the closest simple fraction, an easier way to picture a percentage
function oneIn(pct) {
  if (pct < 1) return 'very few'
  let best = null
  for (const d of [2, 3, 4, 5, 6, 10, 20]) {
    const n = Math.round((pct / 100) * d)
    if (n < 1 || n >= d) continue
    const err = Math.abs(n / d - pct / 100)
    if (!best || err < best.err - 1e-9) best = { n, d, err }
  }
  if (!best) return pct >= 50 ? 'almost all' : 'very few'
  return best.n === 1 && best.d === 2 ? 'about half' : `about ${best.n} in ${best.d}`
}

// small person / home icons for the picture rows (each one is 5%)
const PICTO = {
  person: 'M12 4.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2ZM7.4 20c.2-4.4 2-6.9 4.6-6.9s4.4 2.5 4.6 6.9Z',
  home: 'M4 11.2 12 4.5l8 6.7V20h-5.6v-5h-4.8v5H4Z',
}

// One census figure for the area: the share, "1 in N", a picture row, the Dublin comparison and what it means
function ShareTile({ label, icon, value, dublin, meaning, note, of = 'people', picto = 'person' }) {
  const filled = Math.round(value / 5)
  const tone = versus(value, dublin) ?? 'same'
  return (
    <div className="about-tile">
      <span className="about-label"><FlowIcon name={icon} />{label}</span>
      <div className="about-figure">
        <strong>{Math.round(value)}%</strong>
        <span>{oneIn(value)} {of}</span>
      </div>
      <span className="about-picto" role="img" aria-label={`${Math.round(value)}% of ${of}`}>
        {Array.from({ length: 20 }, (_, i) => (
          <svg key={i} viewBox="5 3.5 14 17" className={i < filled ? 'on' : ''} aria-hidden="true"><path d={PICTO[picto]} /></svg>
        ))}
      </span>
      {dublin != null && (
        <span className={`about-compare ${tone}`}>
          {tone === 'same' ? '● About the same as' : tone === 'up' ? '▲ Above' : '▼ Below'} the Dublin average of {Math.round(dublin)}%
        </span>
      )}
      {meaning && <p className="about-meaning">{meaning}</p>}
      {note}
    </div>
  )
}

// above / below the Dublin average: one rule for both the pill and the sentence (2 points either way)
const versus = (v, d) => (d == null ? null : v - d >= 2 ? 'up' : v - d <= -2 ? 'down' : 'same')

// what each figure means for a student, in plain words
const meaningStudents = (v, d) => ({ up: 'More students than most of Dublin, so plenty of people studying nearby.',
  down: 'Fewer students than most areas, with a more local feel.', same: 'A typical number of students for Dublin.' })[versus(v, d)] ?? null
const meaningYoung = (v, d) => ({ up: 'A young, lively crowd in their twenties.',
  down: 'An older, more settled population.', same: 'A typical age mix for Dublin.' })[versus(v, d)] ?? null
const meaningInternational = (v) => (v >= 25 ? 'A very international area, easy to find people from all over.'
  : v >= 15 ? 'A good international mix alongside Irish neighbours.' : 'A mostly Irish community.')
const meaningApartments = (v) => (v >= 50 ? 'Mostly apartments, so flats are easier to find.'
  : v >= 25 ? 'A mix of apartments and houses.' : 'Mostly houses: rooms in shared houses are the usual option.')

function AboutArea({ result }) {
  const stats = result.profile_stats
  const hasStats = stats && (stats.population != null || stats.non_irish_pct != null || stats.apartments_pct != null)
  if (!hasStats) {
    return result.profile ? (
      <>
        <h3>About this area</h3>
        <p>{result.profile}</p>
      </>
    ) : <p className="result-muted">No area profile for {result.area} yet.</p>
  }
  const groups = stats.largest_groups ?? []

  return (
    <section className="result-about" aria-label="About this area">
      <h3>About this area</h3>
      {stats.population != null && (
        <p className="result-muted about-intro">
          Who lives here, from the Census figures for the wider <strong>{stats.lea}</strong> area
          ({stats.population.toLocaleString('en-IE')} people). Each icon is 5%.
        </p>
      )}
      <div className="about-tiles">
        {stats.students_pct != null && (
          <ShareTile label="Students" icon="cap" value={stats.students_pct} dublin={stats.dublin_students_pct}
            meaning={meaningStudents(stats.students_pct, stats.dublin_students_pct)} />
        )}
        {stats.young_pct != null && (
          <ShareTile label="Aged 20–29" icon="person" value={stats.young_pct} dublin={stats.dublin_young_pct}
            meaning={meaningYoung(stats.young_pct, stats.dublin_young_pct)} />
        )}
        {stats.non_irish_pct != null && (
          <ShareTile label="Not Irish" icon="pin" value={stats.non_irish_pct} meaning={meaningInternational(stats.non_irish_pct)}
            note={groups.length > 0 && (
              <span className="about-groups">
                <small>Largest groups</small>
                {groups.map((g) => <span key={g.name} className="about-group">{g.name} <b>{g.pct}%</b></span>)}
              </span>
            )}
          />
        )}
        {stats.apartments_pct != null && (
          <ShareTile label="Homes that are apartments" icon="home" value={stats.apartments_pct} of="homes" picto="home"
            meaning={meaningApartments(stats.apartments_pct)} />
        )}
      </div>
    </section>
  )
}

function RentNote({ result, student }) {
  if (student) {
    const n = result.rent_listings ?? 0
    const where = result.neighbourhood?.name || result.area
    return <span className="rent-note">Cheapest starting price at {n} student residence{n === 1 ? '' : 's'} around {where}</span>
  }
  const ownRent = result.rent_is_for === 'neighbourhood' && result.neighbourhood
  // County Dublin areas: the rent is a Daft.ie report average (rooms) or an RTB average (homes)
  if (result.rent_source) return <span className="rent-note">For all of {result.area} · {result.rent_source}</span>
  // A place with enough room listings of its own shows their average; otherwise its district's
  return (
    <span className="rent-note">
      {ownRent
        ? `From ${result.rent_listings} listings in ${result.neighbourhood.name}`
        : `For all of ${result.area}${result.rent_listings != null
          ? ` · from ${result.rent_listings} listings`
          : ' · registered rents (RTB)'}`}
    </span>
  )
}

function BudgetTag({ result }) {
  const withinBudget = result.budget_status === 'Within budget'
  return (
    <span className={withinBudget ? 'budget-tag within' : 'budget-tag above'}>
      {withinBudget
        ? `${euro(-result.budget_difference)} under budget`
        : `${euro(result.budget_difference)} over budget`}
    </span>
  )
}

function commuteText(result, modeWords) {
  if (result.commute_minutes == null) return 'Commute not available'
  return `${result.commute_minutes} min ${result.walk_faster ? 'on foot' : modeWords}`
}

// The selected match's commute by the way of travelling the student picks, with the route on a map.
// The matches themselves stay as searched (to change them, go back to "About you").
function GettingThere({ result, university, universityLocation, mode, onMode }) {
  const commute = result.commute_by_mode?.[mode]
  const place = result.neighbourhood
  const [, label, words] = TRAVEL_MODES.find(([value]) => value === mode)

  return (
    <div className="flow-panel-group">
      <h2>Getting there</h2>
      <FlowChoices
        label="Travel mode"
        options={TRAVEL_MODES.map(([value, optionLabel]) => [value, optionLabel, MODE_ICONS[value]])}
        value={mode}
        onChange={onMode}
      />
      {place && universityLocation ? (
        <RouteMap
          fromLat={place.lat}
          fromLon={place.lon}
          fromName={place.name}
          toLat={universityLocation.lat}
          toLon={universityLocation.lon}
          toName={university}
          mode={commute?.walk_faster ? 'walk' : mode}
          defaultMinutes={commute?.minutes ?? null}
          defaultKm={commute?.km ?? null}
          defaultWords={commute?.walk_faster ? 'on foot - quicker than public transport from here' : words}
        />
      ) : (
        <p className="route-summary">{commute ? `${commute.minutes} min ${words}` : `No ${label.toLowerCase()} time for this place yet.`}</p>
      )}
    </div>
  )
}

// One of the top matches, as a card the student clicks to see its details
function MatchCard({ result, modeWords, selected, onSelect }) {
  return (
    <button
      type="button"
      className={selected ? 'flow-match selected' : 'flow-match'}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="flow-match-top">
        <span className="result-rank">#{result.rank}</span>
        <span className="flow-match-score">{result.match_score.toFixed(1)}%<small>match</small></span>
      </span>
      <strong className="flow-match-name">
        {result.area}
        {result.neighbourhood && <span> · {result.neighbourhood.name}</span>}
      </strong>
      <span className="flow-match-line">
        <FlowIcon name="euro" /> {euro(result.rent)}/month <BudgetTag result={result} />
      </span>
      <span className="flow-match-line">
        <FlowIcon name="clock" /> {commuteText(result, modeWords)}
      </span>
    </button>
  )
}

const DETAIL_TABS = ['Why it fits', 'About the area', 'Safety', 'Places to live', 'Compare', 'Letting agents']

function MatchDetail({ result, results, budget, tab, onTab, student, room }) {
  const navigate = useNavigate()
  const isCounty = /^[AK]\d{2}$/.test(result.area) // County Dublin areas have profiles on the same page
  const hasProfile = isCounty || districts.some((d) => d.id === result.area)
  const place = result.neighbourhood ? `${result.neighbourhood.name}, ${result.area}` : result.area

  return (
    <article className="flow-detail result-card">
      <header className="flow-detail-head">
        <div>
          <h2>{place}</h2>
          <p className="result-muted">
            {euro(result.rent)}/month · <RentNote result={result} student={student} />
          </p>
        </div>
        {hasProfile && (
          <button
            type="button"
            className="result-profile-link"
            onClick={() => navigate('/districts', { state: { district: result.area } })}
          >
            {result.area} {isCounty ? 'area' : 'district'} profile <span>→</span>
          </button>
        )}
      </header>

      <div className="flow-tabs" role="tablist" aria-label="Details">
        {DETAIL_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? 'flow-tab selected' : 'flow-tab'}
            onClick={() => onTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="flow-tab-body" role="tabpanel" aria-label={tab}>
        {tab === 'Why it fits' && <WhyThisPlace result={result} place={place} />}
        {tab === 'About the area' && <AboutArea result={result} />}
        {tab === 'Safety' && (
          result.safety
            ? <SafetyScores area={result.area} safety={result.safety} />
            : <p className="result-muted">No safety data for {result.area} yet.</p>
        )}
        {tab === 'Places to live' && <PlacesToLive area={result.area} places={result.places_to_live} budget={budget} student={student} room={room} />}
        {tab === 'Compare' && <CompareAreas results={results} budget={budget} />}
        {tab === 'Letting agents' && <LettingAgents />}
      </div>
    </article>
  )
}

function LettingAgents() {
  const [agents, setAgents] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/agencies`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setAgents)
      .catch(() => setFailed(true))
  }, [])

  return (
    <div className="agencies">
      <div className="agencies-panel">
        <p className="agencies-intro">
          A selection of licensed letting agents operating in Dublin. This is not a complete
          list, and agents are shown in alphabetical order. Being listed here does not mean we
          recommend them.
        </p>
        {failed && <p>We couldn't load the letting agents. Please try again later.</p>}
        {!agents && !failed && <p>Loading…</p>}
        {agents && agents.length > 0 && (
          <div className="agent-grid">
            {[...agents].sort((a, b) => a.Name.localeCompare(b.Name)).map((a) => (
              <article className="agent-card" key={a.Name}>
                <div className="agent-top">
                  <span className="agent-initial" aria-hidden="true">{a.Name.charAt(0)}</span>
                  <div>
                    <h3 className="agent-name">{a.Name}</h3>
                    {a.Areas && <span className="agent-area">{a.Areas}</span>}
                  </div>
                </div>
                {a.Address && <p className="agent-address">📍 {a.Address}</p>}
                <div className="agent-bottom">
                  {a.PSRA_Licence && <span className="agent-psra">✓ PSRA {a.PSRA_Licence}</span>}
                  {a.Website && (
                    <a className="agent-link" href={a.Website} target="_blank" rel="noreferrer">
                      Visit website ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {agents && agents.length > 0 && (
          <p className="agencies-note">
            Find Your Dublin is a student project and is not affiliated with, endorsed by or paid
            by any of these agents. Details were correct when checked in October 2026, so please
            confirm them directly with the agent. Never pay a deposit before viewing a property
            and checking the agent's PSRA licence.
          </p>
        )}
      </div>
    </div>
  )
}

const COMPARE_ROWS = [
  { label: 'Match score', get: (r) => r.match_score, show: (v) => `${v.toFixed(1)}%`, better: 'high' },
  { label: 'Monthly rent', get: (r) => r.rent, show: (v) => euro(v), better: 'low' },
  { label: 'Commute', get: (r) => r.commute_minutes, show: (v) => `${v} min`, better: 'low' },
  { label: 'Walk to campus', get: (r) => r.walking?.average_minutes, show: (v) => `${v} min`, better: 'low' },
  { label: 'Relative crime score', get: (r) => r.safety?.index, show: (v) => `${v.toFixed(1)} / 100`, better: 'high' },
]

function CompareAreas({ results, budget }) {
  if (!results || results.length < 2) return <p className="result-muted">Only one area matched, so there is nothing to compare.</p>

  // only show rows where at least two areas have a value
  const rows = COMPARE_ROWS.filter((row) => results.filter((r) => row.get(r) != null).length >= 2)

  return (
    <div className="compare-wrap">
      <section className="compare" aria-label="Compare your top areas">
        <h2 className="compare-title">Your top {results.length} side by side</h2>
        <p className="compare-subtitle">The best area for each row is highlighted.</p>

        <div className="compare-table" style={{ '--areas': results.length }}>
          <div className="compare-corner" />
          {results.map((r) => (
            <div className="compare-head" key={r.rank}>
              <span className="compare-rank">#{r.rank}</span>
              <strong>{r.area}</strong>
              {r.neighbourhood && <span className="compare-sub">{r.neighbourhood.name}</span>}
            </div>
          ))}

          {rows.map((row) => {
            const values = results.map((r) => row.get(r))
            const known = values.filter((v) => v != null)
            const best = row.better === 'low' ? Math.min(...known) : Math.max(...known)
            const max = Math.max(...known)
            return [
              <div className="compare-label" key={row.label}>{row.label}</div>,
              ...results.map((r, i) => {
                const v = values[i]
                const isBest = v != null && v === best
                return (
                  <div className={isBest ? 'compare-cell best' : 'compare-cell'} key={row.label + r.rank}>
                    {v == null ? (
                      <span className="compare-na">Not available</span>
                    ) : (
                      <>
                        <span className="compare-value">
                          {row.show(v)}
                          {isBest && <span className="compare-badge">Best</span>}
                        </span>
                        <span className="compare-bar">
                          <span style={{ width: `${max ? Math.max((v / max) * 100, 4) : 0}%` }} />
                        </span>
                        {row.label === 'Monthly rent' && budget && (
                          <span className={v <= budget ? 'compare-note ok' : 'compare-note over'}>
                            {v <= budget ? 'Within budget' : `${euro(v - budget)} over`}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )
              }),
            ]
          })}
        </div>
      </section>
    </div>
  )
}

const SHARE_ICONS = {
  bookmark: ['M6 3h12v18l-6-4-6 4z'],
  share: ['M12 3v12', 'M7 8l5-5 5 5', 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  mail: ['M3 6h18v12H3z', 'M3 7l9 6 9-6'],
  print: ['M7 9V3h10v6', 'M7 17H4v-7h16v7h-3', 'M7 14h10v7H7z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
}

function ShareIcon({ name }) {
  return (
    <svg className="share-icon" viewBox="0 0 24 24" aria-hidden="true">
      {SHARE_ICONS[name].map((d) => <path d={d} key={d} />)}
    </svg>
  )
}

function shareApps(url, text) {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(text)
  return [
    ['WhatsApp', 'fa-whatsapp', '#25d366', `https://wa.me/?text=${t}%20${u}`],
    ['Facebook', 'fa-facebook-f', '#1877f2', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['X', 'fa-x-twitter', '#000000', `https://x.com/intent/tweet?text=${t}&url=${u}`],
    ['LinkedIn', 'fa-linkedin-in', '#0a66c2', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ['Telegram', 'fa-telegram', '#229ed9', `https://t.me/share/url?url=${u}&text=${t}`],
    ['Reddit', 'fa-reddit-alien', '#ff4500', `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ['Pinterest', 'fa-pinterest-p', '#e60023', `https://pinterest.com/pin/create/button/?url=${u}&description=${t}`],
  ]
}

function ShareResults() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const menuRef = useRef(null)

  const url = window.location.href
  const text = 'My Dublin neighbourhood matches from Find Your Dublin'
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
  const isPhone = window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    if (!open) return
    const onClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function save() {
    setOpen(false)
    setMessage(isPhone
      ? 'Open your browser menu and tap "Add bookmark" to save these results.'
      : `Press ${isMac ? '⌘' : 'Ctrl'} + D to bookmark this page and come back to these results.`)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setMessage('Link copied. Paste it anywhere to share your results.')
    } catch {
      setMessage('Could not copy the link. Copy it from the address bar instead.')
    }
    setOpen(false)
  }

  function print() {
    setOpen(false)
    setTimeout(() => window.print(), 100) 
  }

  async function moreOptions() {
    setOpen(false)
    try {
      await navigator.share({ title: text, url })
    } catch {
    }
  }

  return (
    <div className="share-results">
      <div className="share-buttons">
        <button type="button" className="share-button" onClick={save}>
          <ShareIcon name="bookmark" /> Save
        </button>

        <div className="share-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="share-button"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen(!open)}
          >
            <ShareIcon name="share" /> Share
          </button>

          {open && (
            <div className="share-menu" role="menu">
              <button type="button" role="menuitem" className="share-wide" onClick={copyLink}>
                <ShareIcon name="copy" /> Copy link
              </button>

              {shareApps(url, text).map(([name, logo, colour, link]) => (
                <a
                  key={name}
                  role="menuitem"
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <span className="share-badge" style={{ background: colour }} aria-hidden="true"><i className={`fa-brands ${logo}`} /></span>
                  {name}
                </a>
              ))}

              <a
                role="menuitem"
                href={`mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`Here are my results: ${url}`)}`}
                onClick={() => setOpen(false)}
              >
                <ShareIcon name="mail" /> Email
              </a>
              <button type="button" role="menuitem" onClick={print}>
                <ShareIcon name="print" /> Print
              </button>
              {navigator.share && (
                <button type="button" role="menuitem" className="share-wide" onClick={moreOptions}>
                  <ShareIcon name="more" /> More options
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="result-muted" role="status">
        {message || 'Save this page or send the link. It opens these same results.'}
      </p>
    </div>
  )
}
function Results() {
  const location = useLocation()
  const navigate = useNavigate()
  const [answers] = useState(() => loadAnswers(location.state, location.search))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState(0) 
  const [tab, setTab] = useState(() => (String(answers?.accommodation).startsWith('student') ? 'Places to live' : DETAIL_TABS[0]))
  
  useEffect(() => {
    if (answers) navigate(`/results?a=${encodeURIComponent(answersToLink(answers))}`, { replace: true })
  }, [answers, navigate])

  const travelMode = answers?.travelMode ?? 'public_transport'
  const maxCommute = answers?.maxCommute ?? null
  const modeWords = TRAVEL_MODES.find(([value]) => value === travelMode)[2]

  const [routeMode, setRouteMode] = useState(travelMode) // "Getting there": only changes the map, not the matches

  useEffect(() => {
    if (!answers) return
    const controller = new AbortController()
    setError(null)
    setLoading(true)

    // Wait until the slider stops moving before searching.
    const timer = setTimeout(() => fetch(`${API_URL}/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        university: answers.university,
        budget: answers.budget,
        accommodation: answers.accommodation,
        importance: answers.importance,
        ratings: answers.importance ? undefined : answers.ratings, // answers saved before the sliders
        language: answers.language ?? 'en',
        travel_mode: travelMode,
        max_commute: maxCommute,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof body.detail === 'string' ? body.detail : 'Something went wrong.')
        }
        setData(body)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setData(null)
          setError(err.message === 'Failed to fetch'
            ? "We couldn't reach the recommendation service. Please try again."
            : /Unknown accommodation/i.test(err.message)
              ? 'Student accommodation matching isn’t available on the server yet. Please choose another room type for now, or try again later.'
              : err.message)
        }
      })
      .finally(() => setLoading(false)), 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [answers, attempt])

  // Share the student's matches with the AI assistant so it can answer about them
  useEffect(() => {
    const list = data?.recommendations ?? []
    if (!answers || !list.length) { setChatContext(null); return undefined }
    const word = { 1: 'better than most areas', 0: 'about average', [-1]: 'worse than most areas' }
    const lines = list.slice(0, 8).map((r) => {
      const name = r.neighbourhood ? `${r.neighbourhood.name} (${r.area})` : r.area
      const facts = (r.breakdown ?? []).map((b) => `${b.factor}: ${b.value} (${word[b.compared] ?? 'about average'})`).join('; ')
      return `#${r.rank} ${name}: ${r.match_score.toFixed(1)}% match, ${euro(r.rent)}/month${r.commute_minutes != null ? `, ${r.commute_minutes} min commute` : ''}. ${facts}`
    })
    const open = list[Math.min(selected, list.length - 1)]
    setChatContext([
      `Student's search: ${answers.accommodationLabel ?? 'room'}, budget ${euro(answers.budget)}/month, studying at ${answers.university}, travelling ${(answers.travelMode ?? 'public_transport').replace('_', ' ')}.`,
      `Their top matches (out of ${data.areas_compared ?? list.length} areas compared):`,
      ...lines,
      open ? `They currently have #${open.rank} ${open.neighbourhood?.name ?? open.area} open.` : '',
    ].filter(Boolean).join('\n'))
    return () => setChatContext(null)
  }, [data, selected, answers])

  if (!answers) {
    return (
      <section className="flow-page flow-page-results" data-site-tour="results">
        <FlowSidebar step={3} onStep={(n) => navigate('/questionnaire', { state: { step: n } })} />
        <div className="flow-empty">
          <h1>No answers yet.</h1>
          <p className="result-muted">Answer a few questions and we'll match you with Dublin neighbourhoods.</p>
          <Link className="flow-next" to="/questionnaire">Find my match <span>→</span></Link>
        </div>
      </section>
    )
  }

  const results = data?.recommendations ?? []
  const shown = results[Math.min(selected, results.length - 1)]

  return (
    <section className="flow-page flow-page-results" data-site-tour="results">
      <FlowSidebar
        step={3}
        // back to the questionnaire with these answers filled in
        onStep={(n) => navigate('/questionnaire', { state: { answers, step: n } })}
      />

      {/* The search: change anything here and the matches update straight away */}
      <aside className="flow-panel">
        <p className="flow-eyebrow">YOUR MATCHES</p>
        <div className="flow-progress-info">
          <span>YOUR RESULTS</span>
          <span>STEP 3 OF 3</span>
        </div>
        <div className="flow-progress" aria-hidden="true"><span style={{ width: '100%' }} /></div>
        <h1>Your top Dublin <em>neighbourhoods.</em></h1>
        <p className="flow-summary">
          {answers.accommodationLabel}{answers.studentRoom && answers.studentRoom !== 'any' ? ` · ${STUDENT_ROOM_NAMES[answers.studentRoom]}` : ''} · {euro(answers.budget)}/month · {answers.university}
          {data && <> · compared {data.areas_compared} areas</>}
        </p>
        
        {data && <ShareResults />}

        {shown && (
          <GettingThere
            result={shown}
            university={data.university}
            universityLocation={data.university_location}
            mode={routeMode}
            onMode={setRouteMode}
          />
        )}
      </aside>

      <div className={loading ? 'flow-results results-updating' : 'flow-results'}>
        {!data && !error && (
          <div className="results-status" role="status">
            <span className="results-spinner" aria-hidden="true" />
            <p>
              Finding your matches… If this is the first search in a while, it can take
              up to a minute while our server wakes up.
            </p>
          </div>
        )}

        {error && (
          <div className="results-status results-error" role="alert">
            <p>{error}</p>
            <div className="results-error-actions">
              <button type="button" className="flow-next" onClick={() => setAttempt(attempt + 1)}>
                Try again <span>↻</span>
              </button>
              <button type="button" className="flow-back-link" onClick={() => navigate('/questionnaire', { state: { answers, step: 1 } })}>
                Change my answers
              </button>
            </div>
          </div>
        )}

        {data && shown && (
          <>
            {data.warning && <p className="results-warning">{data.warning}</p>}
            <div className="flow-matches">
              {results.map((result, index) => (
                <MatchCard
                  key={`${result.area}-${result.neighbourhood?.name ?? result.rank}`}
                  result={result}
                  modeWords={modeWords}
                  selected={result === shown}
                  onSelect={() => setSelected(index)}
                />
              ))}
            </div>
            <MatchDetail
              result={shown}
              results={results}
              budget={data.budget}
              tab={tab}
              onTab={setTab}
              student={String(answers.accommodation).startsWith('student')}
              room={answers.studentRoom && answers.studentRoom !== 'any' ? answers.studentRoom : null}
            />
          </>
        )}
      </div>
    </section>
  )
}

export default Results
