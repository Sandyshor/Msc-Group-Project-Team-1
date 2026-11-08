// What the student is looking at, shared with the AI assistant (e.g. their matches on the results page).
// Pages call setChatContext(text) and clear it on unmount; the chat widget reads it with useChatContext().
import { useSyncExternalStore } from 'react'

let current = null
const listeners = new Set()

export function setChatContext(text) {
  current = text || null
  listeners.forEach((fn) => fn())
}

export function useChatContext() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    () => current,
  )
}
