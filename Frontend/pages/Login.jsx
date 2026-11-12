
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { requireAuth } from '../firebase'
import { getAuthErrorMessage } from '../authErrors'
import { recordLogin } from '../account'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [showSignupPrompt, setShowSignupPrompt] = useState(false)
  const [loading, setLoading] = useState(false)

  const navigate = useNavigate()

  async function handleLogin(event) {
    event.preventDefault()
    setError('')
    setShowSignupPrompt(false)
    setLoading(true)

    try {
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

          <p className="eyebrow">WELCOME BACK</p>

          <h1>
            Your Dublin story
            <em> continues here.</em>
          </h1>

          <p>
            Log in to continue exploring neighbourhoods
            that feel like home.
          </p>
        </div>

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
              <span className="login-note">Keep it private</span>
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
