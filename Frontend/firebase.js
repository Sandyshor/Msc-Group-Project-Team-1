
import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// The settings come from GitHub secrets at build time (.github/workflows/main_crib-crew-api-1.yml).
// Without them getAuth() would throw and the whole site would go blank, so Firebase only starts when they're
// there; otherwise everything else works and log in says it isn't set up.
export const authConfigured = Boolean(firebaseConfig.apiKey)

export const auth = authConfigured ? getAuth(initializeApp(firebaseConfig)) : null

export function requireAuth() {
  if (!auth) {
    throw { code: 'auth/not-configured' }
  }
  return auth
}

// A plain copy of the user: Firebase reuses one object, so React wouldn't notice a new name
const snapshot = (u) => (u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null)

// Login and Signup set this just before signing in, so the site can greet the student by name ("back" or "new")
export const WELCOME_KEY = 'fmd-welcome'
export function expectWelcome(kind) {
  try { if (kind) sessionStorage.setItem(WELCOME_KEY, kind); else sessionStorage.removeItem(WELCOME_KEY) } catch { /* private mode */ }
}

// The name to greet a student by: the first word of the name they gave at sign up ("Vignesh"), or failing that
// the start of their email address ("vignesh.v@…" -> "Vignesh")
export function firstNameOf(user) {
  if (!user) return ''
  const fromName = (user.displayName || '').trim().split(/\s+/)[0]
  const raw = fromName || (user.email || '').split('@')[0].split(/[._\-+\d]/).find(Boolean) || ''
  const name = raw.slice(0, 14)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Calls back with the signed-in user (or null) now and whenever it changes; returns a function to stop.
export function watchUser(callback) {
  if (!auth) {
    callback(null)
    return () => {}
  }
  const stop = onAuthStateChanged(auth, (u) => callback(snapshot(u)))
  const onProfile = () => callback(snapshot(auth.currentUser))
  window.addEventListener('fmd-profile-changed', onProfile)
  return () => {
    stop()
    window.removeEventListener('fmd-profile-changed', onProfile)
  }
}

// Call after updateProfile (the name typed at sign up): Firebase doesn't announce profile changes
export function profileChanged() {
  window.dispatchEvent(new Event('fmd-profile-changed'))
}

// The logged-in student's ID token for the backend (it proves who they are), or null if nobody is logged in
export async function idToken() {
  if (!auth) return null
  await auth.authStateReady()
  return auth.currentUser ? auth.currentUser.getIdToken() : null
}

export function logOut() {
  return auth ? signOut(auth) : Promise.resolve()
}
