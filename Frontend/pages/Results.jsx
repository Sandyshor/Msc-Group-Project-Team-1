import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Results.css'
import { districts } from '../District Profile/districtData.js'
import { TRAVEL_MODES } from './CommuteFields'
import { FlowChoices, FlowIcon, FlowSidebar } from './FlowLayout'
import RouteMap from './RouteMap'

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

// Student residences in the district (OpenStreetMap) and rental searches for it (Daft.ie, Rent.ie).
function PlacesToLive({ area, places }) {
  const [showAll, setShowAll] = useState(false)
  if (!places) return null
  const { residences = [], search_links: links = [] } = places
  const shown = showAll ? residences : residences.slice(0, RESIDENCES_SHOWN)

  return (
    <section className="result-homes" aria-label={`Places to live in ${area}`}>
      <h3>Places to live in {area}</h3>
      <p className="result-muted">Live listings open on Daft.ie and Rent.ie, filtered to {area}, your room type and budget.</p>
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
                  </span>
                  {r.website ? (
                    <a className="home-link" href={r.website} target="_blank" rel="noopener noreferrer">Website ↗</a>
                  ) : (
                    <span className="home-link muted">No website listed</span>
                  )}
                </li>
              )
            })}
          </ul>
          {residences.length > RESIDENCES_SHOWN && (
            <button type="button" className="home-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${residences.length} residences`}
            </button>
          )}
          <p className="home-note">Check rooms, prices and who can apply on each website.</p>
        </>
      )}
      <p className="home-credits">
        Residences: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap
        contributors</a> (ODbL), the official websites of the operators and universities, and Amber Student, checked October 2026.
        Find Your Dublin is not affiliated with Daft.ie, Rent.ie or any residence listed.
      </p>
    </section>
  )
}

// compared: 1 = better than most areas, 0 = about average, -1 = worse (icon + words, never colour alone)
const COMPARED = {
  1: ['better', '▲ Better than most'],
  0: ['average', '● About average'],
  [-1]: ['worse', '▼ Worse than most'],
}

function joinWords(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

// Why the place ranked here: one bar per factor the student rated, most important first
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

  return (
    <section className="result-why" aria-label={title}>
      <h3>{title}</h3>
      <p className="result-muted">
        Each thing you rated, most important first. The bar shows how well this place meets your need (full = all
        you need); the tag compares it with the other areas.
      </p>
      <ul className="why-list">
        {items.map((item) => {
          const [tone, words] = COMPARED[item.compared] ?? COMPARED[0]
          return (
            <li key={item.factor} className="why-row">
              <div className="why-factor">
                <strong>{item.factor}</strong>
                <span className="result-muted">{item.importance_label}</span>
              </div>
              <span className="why-bar" role="img" aria-label={`${item.factor}: ${item.score} out of 100`}>
                <span style={{ width: `${Math.max(3, item.score)}%` }} />
              </span>
              <div className="why-value">
                <span>{item.value}</span>
                <span className={`why-tag ${tone}`}>{words}</span>
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

// A share of the population, with the Dublin average marked on the same bar when there is one
function ShareTile({ label, value, dublin, note }) {
  const diff = dublin == null ? null : value - dublin
  return (
    <div className="about-tile">
      <span className="about-label">{label}</span>
      <strong>{Math.round(value)}%</strong>
      <span
        className="share-bar"
        role="img"
        aria-label={`${label}: ${Math.round(value)}%${dublin != null ? `, Dublin average ${Math.round(dublin)}%` : ''}`}
      >
        <span style={{ width: `${Math.min(100, value)}%` }} />
        {dublin != null && <i style={{ left: `${Math.min(100, dublin)}%` }} />}
      </span>
      {dublin != null && (
        <span className="result-muted">
          {Math.abs(diff) < 1 ? 'About the same as' : diff > 0 ? 'Higher than' : 'Lower than'} the Dublin
          average ({Math.round(dublin)}%)
        </span>
      )}
      {note && <span className="result-muted">{note}</span>}
    </div>
  )
}

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
        <p className="result-muted">
          Census figures for the wider {stats.lea} area, home to {stats.population.toLocaleString('en-IE')} people
          · the line on each bar is the Dublin average
        </p>
      )}
      <div className="about-tiles">
        {stats.students_pct != null && (
          <ShareTile label="Students" value={stats.students_pct} dublin={stats.dublin_students_pct} />
        )}
        {stats.young_pct != null && (
          <ShareTile label="Aged 20–29" value={stats.young_pct} dublin={stats.dublin_young_pct} />
        )}
        {stats.non_irish_pct != null && (
          <ShareTile
            label="Not Irish"
            value={stats.non_irish_pct}
            note={groups.length > 0 && `Biggest groups: ${groups.map((g) => `${g.name} ${g.pct}%`).join(' · ')}`}
          />
        )}
        {stats.apartments_pct != null && <ShareTile label="Homes that are apartments" value={stats.apartments_pct} />}
      </div>
    </section>
  )
}

function RentNote({ result }) {
  const ownRent = result.rent_is_for === 'neighbourhood' && result.neighbourhood
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
      <p className="route-summary" aria-live="polite">
        {commute ? (
          <>
            <strong>{commute.minutes} min</strong>
            <span>
              {commute.walk_faster ? 'on foot - quicker than public transport from here' : words}
              {commute.km != null && ` · ${commute.km} km`}
            </span>
          </>
        ) : (
          <span>No {label.toLowerCase()} time for this place yet.</span>
        )}
      </p>
      {place && universityLocation && (
        <RouteMap
          fromLat={place.lat}
          fromLon={place.lon}
          fromName={place.name}
          toLat={universityLocation.lat}
          toLon={universityLocation.lon}
          toName={university}
          mode={commute?.walk_faster ? 'walk' : mode}
        />
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

function MatchDetail({ result, results, budget, tab, onTab }) {
  const navigate = useNavigate()
  const hasProfile = districts.some((d) => d.id === result.area)
  const place = result.neighbourhood ? `${result.neighbourhood.name}, ${result.area}` : result.area

  return (
    <article className="flow-detail result-card">
      <header className="flow-detail-head">
        <div>
          <h2>{place}</h2>
          <p className="result-muted">
            {euro(result.rent)}/month · <RentNote result={result} />
          </p>
        </div>
        {hasProfile && (
          <button
            type="button"
            className="result-profile-link"
            onClick={() => navigate('/districts', { state: { district: result.area } })}
          >
            {result.area} district profile <span>→</span>
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
        {tab === 'Places to live' && <PlacesToLive area={result.area} places={result.places_to_live} />}
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
  const [tab, setTab] = useState(DETAIL_TABS[0]) 
  
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
            : err.message)
        }
      })
      .finally(() => setLoading(false)), 300)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [answers, attempt])

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
          {answers.accommodationLabel} · {euro(answers.budget)}/month · {answers.university}
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
            <button type="button" className="flow-next" onClick={() => setAttempt(attempt + 1)}>
              Try again <span>↻</span>
            </button>
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
            />
          </>
        )}
      </div>
    </section>
  )
}

export default Results
