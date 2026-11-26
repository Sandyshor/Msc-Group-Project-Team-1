// "Hi, name": the logged-in student's recent searches, saved in the database (Backend/accounts.py).
// Each one can be opened again (same answers, fresh results) or removed. The student can also delete their
// whole account here (/my-searches#delete-account opens that straight away).
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { confirmPassword, deleteLogin, watchUser } from '../firebase'
import { clearHistory, deleteMyAccount, deleteSearch, loadHistory } from '../account'
import { getAuthErrorMessage } from '../authErrors'
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

// Asks for the password, then deletes the saved data (backend) and the login (Firebase), in that order: if the
// second step fails, trying again repeats both, and nothing is left half done.
function DeleteAccount({ startOpen, onDeleted }) {
  const [open, setOpen] = useState(startOpen)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (startOpen) { setOpen(true); box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  }, [startOpen])

  const cancel = () => { setOpen(false); setPassword(''); setError('') }
  const submit = async (event) => {
    event.preventDefault()
    setWorking(true)
    setError('')
    try {
      await confirmPassword(password)
    } catch (e) {
      const wrong = ['auth/invalid-credential', 'auth/wrong-password'].includes(e?.code)
      setError(wrong ? 'That password isn’t right. Please try again.' : getAuthErrorMessage(e, 'Check your password'))
      setWorking(false)
      return
    }
    try {
      await deleteMyAccount()
      await deleteLogin()
    } catch (e) {
      console.error('Delete account error:', e?.code || e?.message || e)
      setError(e?.status === 503
        ? 'We can’t delete accounts right now. Please try again later.'
        : 'Your account couldn’t be deleted. Please try again.')
      setWorking(false)
      return
    }
    onDeleted()
  }

  return (
    <section id="delete-account" className="ms-delete" ref={box} aria-labelledby="ms-delete-title">
      <h2 id="ms-delete-title">Delete my account</h2>
      <p>This permanently deletes your account, your saved searches, your saved areas and your chats with the assistant. It can’t be undone.</p>
      {!open ? (
        <button type="button" className="ms-delete-start" onClick={() => setOpen(true)}>Delete my account</button>
      ) : (
        <form className="ms-delete-form" onSubmit={submit}>
          <label htmlFor="ms-delete-password">Type your password to confirm</label>
          <input id="ms-delete-password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} disabled={working} autoFocus />
          {error && <p className="ms-delete-error" role="alert">{error}</p>}
          <div className="ms-delete-actions">
            <button type="submit" className="ms-delete-confirm" disabled={!password || working}>
              {working ? 'Deleting…' : 'Delete my account permanently'}
            </button>
            <button type="button" className="ms-delete-cancel" onClick={cancel} disabled={working}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}

export default function MySearches() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState(undefined) // undefined: still checking who is logged in
  const [state, setState] = useState({ status: 'loading', history: [] })
  const [deleted, setDeleted] = useState(false)
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

  if (deleted) {
    return (
      <section className="my-searches">
        <div className="ms-empty" role="status">
          <p><b>Your account has been deleted.</b> Your saved searches and chats are gone, and you’ve been logged out.</p>
          <Link className="ms-cta" to="/">Back to the home page</Link>
        </div>
      </section>
    )
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

      {user && <DeleteAccount startOpen={location.hash === '#delete-account'} onDeleted={() => setDeleted(true)} />}
    </section>
  )
}
