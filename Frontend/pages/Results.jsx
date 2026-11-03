import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Results.css'
import { districts } from '../District Profile/districtData.js'
import { NO_LIMIT, TRAVEL_MODES } from './CommuteFields'
import { FlowChoices, FlowIcon, FlowSidebar } from './FlowLayout'
import PrioritySlider from './PrioritySlider'

// '' = same address as the website (Azure serves both); unset = the Render API.
const MODE_ICONS = { public_transport: 'bus', walk: 'walk', cycle: 'bike' }

const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'
const ANSWERS_KEY = 'questionnaireAnswers'

// Keep the answers for this tab so refreshing /results still works.
function loadAnswers(state) {
  try {
    if (state) {
      sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(state))
      return state
    }
    return JSON.parse(sessionStorage.getItem(ANSWERS_KEY))
  } catch {
    return state ?? null
  }
}

function euro(value) {
  return `€${Math.round(value).toLocaleString('en-IE')}`
}

// One safety score per postal district, straight from safety_indicators.csv (via the API).
// The wording comes from the district's rank among the 22 districts; no colours for areas.
// Street safety scores: 50 = the Dublin average; twice the average crime rate = 25, half = 75.
function safetyLevel(raw) {
  const score = Math.round(raw)   // label the number people see (39.8 shows as 40)
  if (score >= 60) return ['good', 'Safer than Dublin average']
  if (score >= 40) return ['mid', 'Around Dublin average']
  return ['low', 'Below Dublin average']
}

function SafetyScore({ label, score }) {
  if (score == null) return null
  const [tone, words] = safetyLevel(score)
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {Math.round(score)}<span className="result-muted">/100</span>
        <span className={`safety-tag ${tone}`}>{words}</span>
        <span className="safety-meter" role="img" aria-label={`${label}: ${Math.round(score)} out of 100`}>
          <span className={tone} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
        </span>
      </dd>
    </div>
  )
}

function SafetyScores({ area, safety }) {
  if (!safety) return null

  return (
    <section className="result-safety" aria-label={`Safety in ${area}`}>
      <h3>Safety</h3>
      <p className="result-muted">50 = Dublin average · higher is safer</p>
      <dl className="result-stats safety-stats">
        <SafetyScore label="Street safety score" score={safety.index} />
      </dl>
      <details>
        <summary>What&apos;s behind this score</summary>
        <h4>Used in the score</h4>
        <ul>
          {safety.robbery_per_100k != null && (
            <li>
              Robberies: {safety.robbery_per_100k.toLocaleString('en-IE')} per 100,000 people a year
              {safety.dublin_robbery_per_100k != null && ` (Dublin average ${safety.dublin_robbery_per_100k.toLocaleString('en-IE')})`}
            </li>
          )}
          {safety.public_order_per_100k != null && (
            <li>
              Public order offences: {safety.public_order_per_100k.toLocaleString('en-IE')} per 100,000 people a year
              {safety.dublin_public_order_per_100k != null && ` (Dublin average ${safety.dublin_public_order_per_100k.toLocaleString('en-IE')})`}
            </li>
          )}
          {safety.garda_nearest_km != null && (
            <li>Nearest Garda station: {safety.garda_nearest_km.toFixed(1)} km on average</li>
          )}
        </ul>
        {(safety.lit_streets_pct != null || safety.night_transit_pct != null) && (
          <>
            <h4>Other safety factors</h4>
            <ul>
              {safety.lit_streets_pct != null && <li>Street lighting (where mapped): {safety.lit_streets_pct}% of streets lit</li>}
              {safety.night_transit_pct != null && (
                <li>Night bus, Luas or train within a 5-minute walk: {safety.night_transit_pct}% of streets</li>
              )}
            </ul>
          </>
        )}
      </details>
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

function CommuteDetails({ area, commute, maxCommute }) {
  if (!commute) return null

  return (
    <p className="result-muted">
      Quickest from {commute.fastest_from} ({commute.fastest_minutes} min)
      {commute.parts_within_limit != null &&
        ` · ${commute.parts_within_limit} of ${commute.parts} parts of ${area} are within ${maxCommute} min`}
    </p>
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

function MatchDetail({ result, results, budget, modeWords, maxCommute, tab, onTab }) {
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
          <p className="result-muted">
            {commuteText(result, modeWords)}
            {result.distance && ` · ${result.distance}`}
            {result.walk_faster && ' (walking is quicker than public transport from here)'}
          </p>
          <CommuteDetails area={result.area} commute={result.commute} maxCommute={maxCommute} />
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
  { label: 'Safety score', get: (r) => r.safety?.index, show: (v) => `${Math.round(v)} / 100`, better: 'high' },
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

function Results() {
  const location = useLocation()
  const navigate = useNavigate()
  const [answers, setAnswers] = useState(() => loadAnswers(location.state))
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState(0) // which match the detail panel shows
  const [tab, setTab] = useState(DETAIL_TABS[0]) // kept when switching matches, to compare them

  const travelMode = answers?.travelMode ?? 'public_transport'
  const maxCommute = answers?.maxCommute ?? null
  const modeWords = TRAVEL_MODES.find(([value]) => value === travelMode)[2]

  // Changing the commute or a priority on this page searches again straight away.
  function updateAnswers(changes) {
    const updated = loadAnswers({ ...answers, ...changes })
    setAnswers(updated)
    navigate('/results', { replace: true, state: updated }) // so a refresh keeps the new choice
  }

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
      <section className="flow-page flow-page-results">
        <FlowSidebar step={3} onStep={() => navigate('/questionnaire')} canGoTo={(n) => n === 1} />
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
    <section className="flow-page flow-page-results">
      <FlowSidebar
        step={3}
        canGoTo={(n) => n < 3}
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

        <div className="flow-panel-group">
          <h2>Getting there</h2>
          <FlowChoices
            label="Travel mode"
            options={TRAVEL_MODES.map(([value, label]) => [value, label, MODE_ICONS[value]])}
            value={travelMode}
            onChange={(mode) => updateAnswers({ travelMode: mode })}
          />
          <div className="flow-value">
            <label htmlFor="max-commute">Longest commute</label>
            <strong>{maxCommute ? `${maxCommute} min` : 'No limit'}</strong>
          </div>
          <input
            id="max-commute"
            type="range"
            min="10"
            max={NO_LIMIT}
            step="5"
            value={maxCommute ?? NO_LIMIT}
            onChange={(event) => {
              const value = Number(event.target.value)
              updateAnswers({ maxCommute: value === NO_LIMIT ? null : value })
            }}
          />
        </div>

        {answers.importance && (
          <div className="flow-panel-group">
            <h2>Your priorities</h2>
            {Object.entries(answers.importance).map(([name, value]) => (
              <PrioritySlider
                key={name}
                name={name}
                value={value}
                showName
                onChange={(changed) => updateAnswers({ importance: { ...answers.importance, [name]: changed } })}
              />
            ))}
          </div>
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
              modeWords={modeWords}
              maxCommute={maxCommute}
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
