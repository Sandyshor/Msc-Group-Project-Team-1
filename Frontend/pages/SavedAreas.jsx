// Saved areas: the areas a logged-in student saved from their results ("Save area"), kept in the database
// (Backend/accounts.py). They can pick up to 3, even from different searches, and compare them side by side.
// Each card shows the figures from the moment it was saved, and can open that search again for fresh results.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { watchUser } from '../firebase'
import { listSavedAreas, removeSavedArea } from '../account'
import './MySearches.css'
import './SavedAreas.css'

const MAX_COMPARED = 3
const MODE_WORDS = { public_transport: 'by public transport', walk: 'on foot', cycle: 'by bike' }

const euro = (n) => `€${Math.round(Number(n)).toLocaleString('en-IE')}`
const when = (iso) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' }).format(new Date(iso))
const placeName = (a) => (a.neighbourhood ? `${a.neighbourhood}, ${a.area}` : a.area)
const commuteWords = (a) => (a.commute_minutes == null ? null
  : `${a.commute_minutes} min ${a.walk_faster ? 'on foot' : MODE_WORDS[a.travel_mode] || ''}`.trim())

// The rows of the comparison: how to read each figure and which way is better
const ROWS = [
  { label: 'Monthly rent', get: (a) => a.rent, show: (a) => euro(a.rent), better: 'low', note: (a) => a.accommodation },
  { label: 'Commute', get: (a) => a.commute_minutes, show: commuteWords, better: 'low', note: (a) => `to ${a.university}` },
  { label: 'Safety score', get: (a) => a.safety, show: (a) => `${a.safety.toFixed(1)}/100`, better: 'high', note: () => '50 = Irish average' },
  { label: 'Match score', get: (a) => a.match_score, show: (a) => `${a.match_score.toFixed(1)}%`, better: 'high', note: () => 'for that search' },
]

function Compare({ areas }) {
  const differs = (key) => new Set(areas.map((a) => a[key])).size > 1
  const notes = [
    differs('university') && 'These areas were saved for different universities, so their commutes are to different campuses.',
    differs('accommodation') && 'They were saved for different room types, so their rents are for different kinds of rooms.',
  ].filter(Boolean)

  return (
    <section className="sa-compare" aria-label="Your saved areas side by side">
      <h2>Side by side</h2>
      {notes.map((n) => <p className="sa-compare-note" key={n}>{n}</p>)}
      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th scope="col"><span className="sa-visually-hidden">Figure</span></th>
              {areas.map((a) => <th scope="col" key={a.id}>{placeName(a)}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const known = areas.map(row.get).filter((v) => v != null)
              const best = known.length > 1 ? (row.better === 'low' ? Math.min(...known) : Math.max(...known)) : null
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {areas.map((a) => {
                    const v = row.get(a)
                    return (
                      <td key={a.id} className={v != null && v === best ? 'is-best' : undefined}>
                        {v == null ? <span className="sa-na">Not available</span> : (
                          <>
                            <span className="sa-value">{row.show(a)}{v === best && <span className="sa-best"> ★ Best</span>}</span>
                            <span className="sa-note">{row.note(a)}</span>
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="sa-small">Figures are as they were when you saved each area. Open a search again to see today’s.</p>
    </section>
  )
}

export default function SavedAreas() {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined) // undefined: still checking who is logged in
  const [state, setState] = useState({ status: 'loading', areas: [] })
  const [picked, setPicked] = useState([])
  useEffect(() => watchUser(setUser), [])

  useEffect(() => {
    if (user === undefined) return undefined
    if (!user) { setState({ status: 'signed-out', areas: [] }); return undefined }
    let live = true
    listSavedAreas()
      .then((data) => {
        if (!live) return
        const areas = data?.areas ?? []
        setState({ status: 'ready', areas })
        setPicked(areas.slice(0, Math.min(2, areas.length)).map((a) => a.id)) // the two newest, ready to compare
      })
      .catch((e) => live && setState({ status: e.status === 503 ? 'unavailable' : 'error', areas: [], error: e.message }))
    return () => { live = false }
  }, [user])

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_COMPARED ? [...p, id] : p))
  const remove = async (id) => {
    setState((s) => ({ ...s, areas: s.areas.filter((a) => a.id !== id) }))
    setPicked((p) => p.filter((x) => x !== id))
    try { await removeSavedArea(id) } catch { /* it reappears on the next visit; nothing lost */ }
  }
  const compared = state.areas.filter((a) => picked.includes(a.id))

  return (
    <section className="my-searches saved-areas">
      <header className="ms-intro">
        <p className="ms-eyebrow">YOUR ACCOUNT</p>
        <h1>Saved areas<em>.</em></h1>
        <p>Areas you saved from your results. Tick up to {MAX_COMPARED} to compare them side by side, even from different searches.</p>
      </header>

      {(state.status === 'loading' || user === undefined) && <p className="ms-note">Loading your saved areas…</p>}
      {state.status === 'signed-out' && (
        <div className="ms-empty">
          <p>Log in to see the areas you’ve saved.</p>
          <Link className="ms-cta" to="/login">Log in</Link>
        </div>
      )}
      {state.status === 'unavailable' && <p className="ms-note">Saved areas aren’t available right now. Please try again later.</p>}
      {state.status === 'error' && <p className="ms-note">{state.error}</p>}

      {state.status === 'ready' && (state.areas.length ? (
        <>
          {compared.length >= 2 ? <Compare areas={compared} /> : (
            <p className="sa-hint" role="status">Tick at least 2 areas below to compare them side by side.</p>
          )}
          <ul className="ms-list sa-list">
            {state.areas.map((a) => {
              const isPicked = picked.includes(a.id)
              const full = !isPicked && picked.length >= MAX_COMPARED
              return (
                <li className={`ms-card${isPicked ? ' sa-picked' : ''}`} key={a.id}>
                  <div className="ms-card-head">
                    <label className="sa-pick">
                      <input type="checkbox" checked={isPicked} disabled={full} onChange={() => toggle(a.id)} />
                      {full ? `Compare (max ${MAX_COMPARED})` : 'Compare'}
                    </label>
                    <button type="button" className="ms-remove" onClick={() => remove(a.id)} aria-label={`Remove ${placeName(a)} from your saved areas`}>Remove</button>
                  </div>
                  <h3>{placeName(a)}</h3>
                  <p className="ms-facts">
                    {a.rent != null && <span>{euro(a.rent)} a month</span>}
                    {commuteWords(a) && <span>{commuteWords(a)}</span>}
                    {a.safety != null && <span>Safety {a.safety.toFixed(0)}/100</span>}
                  </p>
                  <p className="ms-areas">{a.accommodation} · {a.university} · saved {when(a.saved_at)}</p>
                  {a.answers && Object.keys(a.answers).length > 0 && (
                    <button type="button" className="ms-open" onClick={() => navigate('/results', { state: a.answers })}>
                      Open this search again <span aria-hidden="true">→</span>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="ms-empty">
          <p>No saved areas yet. On your results, open a match and choose <b>♡ Save area</b> to keep it here.</p>
          <Link className="ms-cta" to="/questionnaire">Find my match <span aria-hidden="true">→</span></Link>
        </div>
      ))}
    </section>
  )
}
