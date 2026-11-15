// "Hi, name": the logged-in student's recent searches, saved in the database (Backend/accounts.py).
// Each one can be opened again (same answers, fresh results) or removed.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { watchUser } from '../firebase'
import { clearHistory, deleteSearch, loadHistory } from '../account'
import './MySearches.css'

const MODES = { public_transport: 'Public transport', walk: 'Walking', cycle: 'Cycling' }

const when = (iso) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const euro = (n) => `€${Math.round(Number(n)).toLocaleString('en-IE')}`

function SearchCard({ search, onOpen, onRemove }) {
  const a = search.answers || {}
  const room = a.accommodationLabel || String(a.accommodation || '').replace(/_/g, ' ')
  return (
    <li className="ms-card">
      <div className="ms-card-head">
        <time dateTime={search.created_at}>{when(search.created_at)}</time>
        <button type="button" className="ms-remove" onClick={onRemove} aria-label={`Remove the search from ${when(search.created_at)}`}>Remove</button>
      </div>
      <h3>{a.university || 'Your search'}</h3>
      <p className="ms-facts">
        {a.budget != null && <span>{euro(a.budget)} a month</span>}
        {room && <span>{room}</span>}
        {a.travelMode && <span>{MODES[a.travelMode] || a.travelMode}{a.maxCommute ? `, up to ${a.maxCommute} min` : ''}</span>}
      </p>
      {search.top_areas?.length > 0 && (
        <p className="ms-areas"><b>Top matches:</b> {search.top_areas.map((area) => <span key={area}>{area}</span>)}</p>
      )}
      <button type="button" className="ms-open" onClick={onOpen}>See these results again <span aria-hidden="true">→</span></button>
    </li>
  )
}

export default function MySearches() {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined) // undefined: still checking who is logged in
  const [state, setState] = useState({ status: 'loading', history: [] })
  useEffect(() => watchUser(setUser), [])

  useEffect(() => {
    if (user === undefined) return undefined
    if (!user) { setState({ status: 'signed-out', history: [] }); return undefined }
    let live = true
    loadHistory()
      .then((data) => live && setState({ status: 'ready', history: data?.history ?? [] }))
      .catch((e) => live && setState({ status: e.status === 503 ? 'unavailable' : 'error', history: [], error: e.message }))
    return () => { live = false }
  }, [user])

  const firstName = user ? (user.displayName || user.email || '').split(/[\s@]/)[0] : ''

  const remove = async (id) => {
    setState((s) => ({ ...s, history: s.history.filter((x) => x.id !== id) }))
    try { await deleteSearch(id) } catch { /* it reappears on the next visit; nothing lost */ }
  }
  const clearAll = async () => {
    if (!window.confirm('Remove all your saved searches?')) return
    setState((s) => ({ ...s, history: [] }))
    try { await clearHistory() } catch { /* as above */ }
  }

  return (
    <section className="my-searches">
      <header className="ms-intro">
        <p className="ms-eyebrow">YOUR ACCOUNT</p>
        <h1>{firstName ? <>Hi, {firstName}<em>.</em></> : 'Your searches'}</h1>
        <p>Your recent searches, newest first. Open one to see fresh results for the same answers.</p>
      </header>

      {(state.status === 'loading' || user === undefined) && <p className="ms-note">Loading your searches…</p>}

      {state.status === 'signed-out' && (
        <div className="ms-empty">
          <p>Log in to see the searches you've made.</p>
          <Link className="ms-cta" to="/login">Log in</Link>
        </div>
      )}

      {state.status === 'unavailable' && <p className="ms-note">Saved searches aren't available right now. Please try again later.</p>}
      {state.status === 'error' && <p className="ms-note">{state.error}</p>}

      {state.status === 'ready' && (state.history.length ? (
        <>
          <ul className="ms-list">
            {state.history.map((search) => (
              <SearchCard key={search.id} search={search}
                onOpen={() => navigate('/results', { state: search.answers })}
                onRemove={() => remove(search.id)} />
            ))}
          </ul>
          <button type="button" className="ms-clear" onClick={clearAll}>Remove all my searches</button>
        </>
      ) : (
        <div className="ms-empty">
          <p>No searches yet. Your searches are saved here each time you look for a match while logged in.</p>
          <Link className="ms-cta" to="/questionnaire">Find my match <span aria-hidden="true">→</span></Link>
        </div>
      ))}
    </section>
  )
}
