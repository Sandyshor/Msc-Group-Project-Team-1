
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

// Calls back with the signed-in user (or null) now and whenever it changes; returns a function to stop.
export function watchUser(callback) {
  if (!auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}

export function logOut() {
  return auth ? signOut(auth) : Promise.resolve()
}
