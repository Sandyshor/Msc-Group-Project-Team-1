import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Results.css'
import { districts } from '../District Profile/districtData.js'
import CommuteFields, { TRAVEL_MODES } from './CommuteFields'

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
            {result.lea && <span className="result-lea"> · {result.lea}</span>}
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

      <CommuteDetails area={result.area} commute={result.commute} maxCommute={maxCommute} />

      <WalkingDistance area={result.area} walking={result.walking} university={university} />

      <h3>Why {result.area} is #{result.rank}</h3>
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
                  key={result.area}
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
