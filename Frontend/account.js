// The logged-in student's saved searches (backend: Backend/accounts.py, kept in the PostgreSQL database).
// Every request carries the student's Firebase ID token, so the backend only ever returns their own searches.
import { idToken } from './firebase'

const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'

async function call(method, path, body, freshToken = false) {
  const token = await idToken(freshToken)
  if (!token) return null // nobody logged in: nothing to save or load
  const response = await fetch(`${API_URL}/account${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.')
    error.status = response.status
    throw error
  }
  return data
}

// Records the login and returns { name, email, history }
export const recordLogin = (name) => call('POST', '/login', { name: name || null })
export const loadHistory = () => call('GET', '/history')
export const saveSearch = (answers, topAreas) => call('POST', '/history', { answers, top_areas: topAreas })
export const deleteSearch = (id) => call('DELETE', `/history/${id}`)
export const clearHistory = () => call('DELETE', '/history')

// The logged-in student's conversations with the assistant (their 10 most recent), so they can pick any of them up
// again, on any device
export const listChats = () => call('GET', '/chats')
export const openChat = (id) => call('GET', `/chats/${id}`)
export const createChat = (messages) => call('POST', '/chats', { messages })
export const updateChat = (id, messages) => call('PUT', `/chats/${id}`, { messages })
export const deleteChat = (id) => call('DELETE', `/chats/${id}`)

// Deletes the student's name, email, searches and chats from the database. Call it straight after
// confirmPassword (firebase.js): the backend only accepts a login from the last few minutes.
export const deleteMyAccount = () => call('DELETE', '', undefined, true)
