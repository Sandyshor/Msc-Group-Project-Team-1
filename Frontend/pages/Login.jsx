
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { requireAuth, expectWelcome } from '../firebase'
import { getAuthErrorMessage } from '../authErrors'
import { recordLogin } from '../account'

// Forgot password: Firebase emails a link to choose a new password. The page says the same thing whether or not
// the email has an account, so it can't be used to find out who has signed up.
async function sendResetLink(email) {
  const auth = requireAuth()
  try {
    // After choosing a new password, the student is offered a link back to this login page
    await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/login` })
  } catch (error) {
    if (['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri'].includes(error?.code)) {
      await sendPasswordResetEmail(auth, email) // this address isn't allowed in Firebase: send the link without it
    } else if (error?.code !== 'auth/user-not-found') {
      throw error
    }
  }
}

function ForgotPassword({ initialEmail, onBack }) {
  const [email, setEmail] = useState(initialEmail)
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend(event) {
    event.preventDefault()
    setError('')
    setSending(true)
    try {
      await sendResetLink(email.trim())
      setSentTo(email.trim())
    } catch (error) {
      setError(getAuthErrorMessage(error, 'send the reset link'))
    } finally {
      setSending(false)
    }
  }

  if (sentTo) {
    return (
      <div className="reset-sent" role="status">
        <p>
          If there's an account for <b>{sentTo}</b>, we've sent it a link to choose a new password.
          Check your inbox, and your spam folder if it isn't there in a few minutes.
        </p>
        <button type="button" className="login-submit" onClick={() => onBack(sentTo)}>
          Back to log in <span>→</span>
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSend} className="login-form">
      <p className="reset-intro">
        Enter the email address you signed up with and we'll send you a link to choose a new password.
      </p>

      <div className="login-field">
        <label htmlFor="reset-email">Email address</label>
        <input
          id="reset-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
      </div>

      {error && <p className="signup-error" role="alert">{error}</p>}

      <button type="submit" className="login-submit" disabled={sending}>
        {sending ? 'Sending...' : 'Send reset link'}
        {!sending && <span>→</span>}
      </button>

      <button type="button" className="reset-back" onClick={() => onBack(email.trim())}>
        ← Back to log in
      </button>
    </form>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [showSignupPrompt, setShowSignupPrompt] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false) // showing "Forgot password"

  const navigate = useNavigate()

  async function handleLogin(event) {
    event.preventDefault()
    setError('')
    setShowSignupPrompt(false)
    setLoading(true)

    try {
      expectWelcome('back') // the site says "Welcome back, <name>!" once they're in
      await signInWithEmailAndPassword(requireAuth(), email.trim(), password)
      // Back again: show their recent searches if they have any
      let history = []
      try {
        history = (await recordLogin())?.history ?? []
      } catch {
        // saved searches unavailable right now: they're still logged in
      }
      navigate(history.length ? '/my-searches' : '/')
    } catch (error) {
      expectWelcome(null)
      setShowSignupPrompt([
        'auth/invalid-credential',
        'auth/wrong-password',
        'auth/user-not-found',
      ].includes(error?.code))
      setError(getAuthErrorMessage(error, 'log in'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <Link className="login-back" to="/">
          ← Back to home
        </Link>

        <div className="login-heading">
          <div className="login-mark">⌂</div>

          <p className="eyebrow">{resetting ? 'FORGOT YOUR PASSWORD?' : 'WELCOME BACK'}</p>

          {resetting ? (
            <h1>
              Let's get you
              <em> back in.</em>
            </h1>
          ) : (
            <h1>
              Your Dublin story
              <em> continues here.</em>
            </h1>
          )}

          <p>
            {resetting
              ? 'It only takes a minute.'
              : 'Log in to continue exploring neighbourhoods that feel like home.'}
          </p>
        </div>

        {resetting ? (
          <ForgotPassword
            initialEmail={email.trim()}
            onBack={(typed) => {
              if (typed) setEmail(typed)
              setPassword('')
              setError('')
              setShowSignupPrompt(false)
              setResetting(false)
            }}
          />
        ) : (
        <form onSubmit={handleLogin} className="login-form">
          <div className="login-field">
            <label htmlFor="email">Email address</label>

            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="login-field">
            <div className="password-label">
              <label htmlFor="password">Password</label>
              <button type="button" className="forgot-link" onClick={() => setResetting(true)}>
                Forgot password?
              </button>
            </div>

            <div className="password-input-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="show-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && (
            <p className="signup-error" role="alert">
              {error}
              {showSignupPrompt && (
                <>
                  {' '}Are you new to Find My Dublin? Then{' '}
                  <Link to="/signup">create an account</Link>.
                </>
              )}
            </p>
          )}

          <button
            type="submit"
            className="login-submit"
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Log in'}
            {!loading && <span>→</span>}
          </button>
        </form>
        )}

        <div className="login-divider">
          <span>YOUR NEXT CHAPTER</span>
        </div>

        <p className="login-bottom">
          New to Find My Dublin?
          <br />
          <Link to="/signup">Sign up →</Link>
        </p>
      </div>
    </section>
  )
}

export default Login
