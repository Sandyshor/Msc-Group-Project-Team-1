import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Results.css'
import { districts } from '../District Profile/districtData.js'
import CommuteFields, { TRAVEL_MODES } from './CommuteFields'

const SafetyHeatMap = lazy(() => import('./SafetyHeatMap'))

// '' = same address as the website (Azure serves both); unset = the Render API.
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

function WalkingDistance({ area, walking, university }) {
  if (!walking) {
    return <p className="result-muted">No walking data from {area} to {university}.</p>
  }

  return (
    <div className="result-walking">
      <p>
        <strong>Walking:</strong> average {walking.average_km.toFixed(2)} km
        (about {walking.average_minutes} min) from {area} to {university}
      </p>
      <details>
        <summary>Show walking distance to each place in {area}</summary>
        <ul>
          {walking.places.map((place) => (
            <li key={place.landmark}>
              {place.landmark} ({place.direction}):{' '}
              {place.km != null
                ? `${place.km.toFixed(2)} km, about ${place.minutes} min walk`
                : 'not available'}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
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

// The district's safety heat map (GET /safety-map/{area}). maplibre is loaded only when a card scrolls into view.
function SafetyMap({ area, score, residences }) {
  const box = useRef(null)
  const [visible, setVisible] = useState(false)
  const [data, setData] = useState(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!box.current || !('IntersectionObserver' in window)) { setVisible(true); return undefined }
    const seen = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: '300px' })
    seen.observe(box.current)
    return () => seen.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    fetch(`${API_URL}/safety-map/${encodeURIComponent(area)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [visible, area])

  if (missing) return null
  return (
    <div ref={box} className="heat-map-slot">
      {data && (
        <Suspense fallback={null}>
          <SafetyHeatMap area={area} data={data} score={score} residences={residences} />
        </Suspense>
      )}
    </div>
  )
}

function SafetyScores({ area, safety, residences }) {
  if (!safety) return null

  return (
    <section className="result-safety" aria-label={`Safety in ${area}`}>
      <h3>Safety</h3>
      <p className="result-muted">50 = Dublin average · higher is safer</p>
      <dl className="result-stats safety-stats">
        <SafetyScore label="Street safety score" score={safety.index} />
      </dl>
      <SafetyMap area={area} score={safety.index} residences={residences} />
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
        Census and Tailte Éireann, CC BY 4.0. Map data: ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.
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
          <p className="home-note">
            Switch the safety map above to <strong>Student homes</strong> to see where they are. Check rooms, prices
            and who can apply on each website.
          </p>
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

// The recommended place (a neighbourhood or commute point in the district) and the district's other options
function NeighbourhoodDetails({ area, neighbourhood }) {
  if (!neighbourhood) return null
  const others = neighbourhood.others ?? []

  return (
    <p className="result-muted">
      Recommended place: <strong>{neighbourhood.name}, {area}</strong>
      {neighbourhood.safety_score != null && ` (safety ${Math.round(neighbourhood.safety_score)}/100)`}
      {neighbourhood.commute_estimated_from &&
        ` (commute estimated from nearby ${neighbourhood.commute_estimated_from})`}
      {others.length > 0 &&
        ` · Other options in ${area}: ${others.map((o) => `${o.name} (${o.commute_minutes} min)`).join(', ')}`}
    </p>
  )
}

function ResultCard({ result, university, modeWords, maxCommute }) {
  const navigate = useNavigate()
  const hasProfile = districts.some((d) => d.id === result.area)
  const withinBudget = result.budget_status === 'Within budget'

  return (
    <article className="result-card">
      <header className="result-header">
        <div>
          <span className="result-rank">#{result.rank}</span>
          <h2>
            {result.area}
            {result.neighbourhood
              ? <span className="result-lea"> · {result.neighbourhood.name}</span>
              : result.lea && <span className="result-lea"> · {result.lea}</span>}
          </h2>
        </div>
        <div className="result-score">
          <strong>{result.match_score.toFixed(1)}%</strong>
          <span>match</span>
        </div>
      </header>

      <dl className="result-stats">
        <div>
          <dt>Average rent</dt>
          <dd>
            {euro(result.rent)}/month
            <span className={withinBudget ? 'budget-tag within' : 'budget-tag above'}>
              {withinBudget
                ? `${euro(-result.budget_difference)} under budget`
                : `${euro(result.budget_difference)} over budget`}
            </span>
          </dd>
        </div>
        <div>
          <dt>Commute</dt>
          <dd>
            {result.commute_minutes != null ? `${result.commute_minutes} min ${modeWords}` : 'Not available'}
            {result.distance && <span className="result-muted"> · {result.distance}</span>}
          </dd>
        </div>
      </dl>

      <NeighbourhoodDetails area={result.area} neighbourhood={result.neighbourhood} />

      <CommuteDetails area={result.area} commute={result.commute} maxCommute={maxCommute} />

      <WalkingDistance area={result.area} walking={result.walking} university={university} />

      <SafetyScores area={result.area} safety={result.safety} residences={result.places_to_live?.residences} />

      <PlacesToLive area={result.area} places={result.places_to_live} />

      <h3>Why {result.neighbourhood ? `${result.neighbourhood.name}, ${result.area}` : result.area} is #{result.rank}</h3>
      <p>{result.why}</p>

      {result.profile && (
        <>
          <h3>About this area</h3>
          <p>{result.profile}</p>
        </>
      )}

      {hasProfile && (
        <button
          type="button"
          className="result-profile-link"
          onClick={() => navigate('/districts', { state: { district: result.area } })}
        >
          View {result.area} district profile <span>→</span>
        </button>
      )}
    </article>
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

  const travelMode = answers?.travelMode ?? 'public_transport'
  const maxCommute = answers?.maxCommute ?? null
  const modeWords = TRAVEL_MODES.find(([value]) => value === travelMode)[2]

  // Changing the commute on this page searches again straight away.
  function updateCommute(commute) {
    const updated = loadAnswers({ ...answers, ...commute })
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
        ratings: answers.ratings,
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
      <section className="questionnaire-page">
        <div className="questionnaire-container">
          <h1>No answers yet.</h1>
          <p className="questionnaire-description">
            Answer a few questions and we'll match you with Dublin neighbourhoods.
          </p>
          <Link className="questionnaire-next" to="/questionnaire">
            Find my match <span>→</span>
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="questionnaire-page">
      <div className="questionnaire-container results-container">
        <Link className="back-link" to="/questionnaire">
          ← Change my answers
        </Link>

        <p className="eyebrow">YOUR MATCHES</p>

        <div className="progress-info">
          <span>YOUR RESULTS</span>
          <span>STEP 3 OF 3</span>
        </div>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: '100%' }} />
        </div>

        <h1>
          Your top Dublin
          <em> neighbourhoods.</em>
        </h1>

        <p className="questionnaire-description">
          {answers.accommodationLabel} · budget {euro(answers.budget)}/month · studying at{' '}
          {answers.university}
          {data && <> · compared {data.areas_compared} areas</>}
        </p>

        <div className="commute-controls">
          <CommuteFields travelMode={travelMode} maxCommute={maxCommute} onChange={updateCommute} />
        </div>

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
            <button type="button" className="questionnaire-next" onClick={() => setAttempt(attempt + 1)}>
              Try again <span>↻</span>
            </button>
          </div>
        )}

        {data && (
          <>
            {data.warning && <p className="results-warning">{data.warning}</p>}
            <div className={loading ? 'results-list results-updating' : 'results-list'}>
              {data.recommendations.map((result) => (
                <ResultCard
                  key={`${result.area}-${result.neighbourhood?.name ?? result.rank}`}
                  result={result}
                  university={data.university}
                  modeWords={modeWords}
                  maxCommute={maxCommute}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default Results
