// "Crib Crew Assistant": the AI assistant in the bottom-right corner of every page.
// Replies stream from the backend's POST /chat (Claude); the conversation lives in this tab only.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useChatContext } from './chatContext'
import './ChatWidget.css'

// '' = same address as the website (Azure serves both); unset = the Render API.
const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'
const STORE_KEY = 'fmd-chat'
const MAX_CHARS = 2000
const LANGUAGE_NAMES = { es: 'Spanish', pt: 'Portuguese', hi: 'Hindi', 'zh-Hans': 'Chinese', ar: 'Arabic' } // the site's languages (LanguageSwitcher)

const WELCOME = "Hi! I'm the Crib Crew Assistant. Ask me about neighbourhoods, renting, getting around or settling in Dublin."
const STARTERS = [
  'Which areas suit a tight budget?',
  'How do I avoid rental scams?',
  'How do I get a student Leap card?',
  'What do I need before I rent?',
]
const RESULTS_STARTERS = [
  'Which of my matches is cheapest?',
  'Compare my top 3 matches',
  'Which match is best for nightlife?',
]

function loadChat() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || [] } catch { return [] }
}

// Light formatting for replies, built as React elements (never raw HTML): **bold**, "- " bullets and web addresses
const INLINE = /(\*\*[^*]+\*\*|(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:ie|com|org|eu|net)(?:\/[^\s),]*)?)/gi
function inline(text) {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (i % 2 === 1) {
      const href = part.startsWith('http') ? part : `https://${part}`
      return <a key={i} href={href} target="_blank" rel="noopener noreferrer">{part.replace(/^https?:\/\//, '')}</a>
    }
    return part
  })
}
function Formatted({ text }) {
  const blocks = []
  text.split('\n').forEach((line) => {
    const bullet = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/)
    if (bullet) {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'list') last.items.push(bullet[1])
      else blocks.push({ type: 'list', items: [bullet[1]] })
    } else if (line.trim()) blocks.push({ type: 'p', text: line })
  })
  return blocks.map((b, i) => (b.type === 'list'
    ? <ul key={i}>{b.items.map((item, k) => <li key={k}>{inline(item)}</li>)}</ul>
    : <p key={i}>{inline(b.text)}</p>))
}

const Icon = ({ d, size = 20 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {[].concat(d).map((p) => <path key={p} d={p} />)}
  </svg>
)
const ICONS = {
  chat: ['M20 11.5a7.5 7.5 0 0 1-11.1 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5Z', 'M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01'],
  close: 'M6 6l12 12M18 6 6 18',
  send: ['M5 12h13', 'm12 5 7 7-7 7'],
  stop: 'M8 8h8v8H8z',
  reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4.5h4.5'],
  expand: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
  shrink: ['M20 10h-6V4', 'M14 10l7-7', 'M4 14h6v6', 'M10 14l-7 7'],
  spark: ['M12 3v4M12 17v4M3 12h4M17 12h4', 'm6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18'],
}

// The colour behind a point: the first element up the tree with a background colour (or a gradient's first colour)
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function isDarkBehind(el) {
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node)
    const bg = style.backgroundColor.match(/[\d.]+/g)?.map(Number)
    if (bg && (bg[3] ?? 1) > 0.5) return luminance(bg.slice(0, 3)) < 0.18
    const grad = style.backgroundImage.match(/rgba?\(([^)]+)\)/)
    if (grad) {
      const c = grad[1].split(',').map((v) => parseFloat(v))
      if ((c[3] ?? 1) > 0.5) return luminance(c.slice(0, 3)) < 0.18
    }
    if (node.tagName === 'IMG' || style.backgroundImage.includes('url(')) return true // photos: treat as busy/dark
  }
  return false
}

// Would the button cover something on the page - a control, text, an image, or a card/panel? Large page
// backgrounds (the home hero photo, full-width sections) don't count. Checks a grid of points.
const CONTROLS = 'a[href], button, input, select, textarea, label, [role="button"], [role="slider"], [role="tab"], .leaflet-control'
const MEDIA = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'PICTURE', 'IFRAME'])
function textAtPoint(el, x, y) {
  for (const node of el.childNodes) {
    if (node.nodeType !== 3 || !node.textContent.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4) return true
    }
  }
  return false
}
function isBoxed(style) {
  const bg = style.backgroundColor.match(/[\d.]+/g)?.map(Number)
  const hasBg = (bg && (bg[3] ?? 1) > 0.05) || style.backgroundImage !== 'none'
  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none')
  return hasBg || hasBorder || style.boxShadow !== 'none'
}
function coversContent(r) {
  const big = window.innerWidth * window.innerHeight * 0.45 // anything this large is page background, not content
  for (const fx of [0.1, 0.5, 0.9]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy
      const top = document.elementsFromPoint(x, y).find((el) => !el.closest('.chatw'))
      if (!top) continue
      if (top.closest(CONTROLS)) return true
      for (let el = top, depth = 0; el && el !== document.body && depth < 6; el = el.parentElement, depth++) {
        const box = el.getBoundingClientRect()
        if (box.width * box.height >= big) break
        if (MEDIA.has(el.tagName.toUpperCase()) || textAtPoint(el, x, y) || isBoxed(getComputedStyle(el))) return true
      }
    }
  }
  return false
}

export default function ChatWidget() {
  const { pathname } = useLocation()
  const context = useChatContext()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(loadChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const fabRef = useRef(null)
  const [onDark, setOnDark] = useState(false)
  const [tucked, setTucked] = useState(false) // slides into the screen edge when it would cover page content
  const [closing, setClosing] = useState(false) // panel plays its exit before unmounting
  const [burst, setBurst] = useState(0) // each click restarts the button's burst animation
  const closeTimer = useRef(null)
  const [big, setBig] = useState(() => { try { return sessionStorage.getItem('fmd-chat-big') === '1' } catch { return false } })
  useEffect(() => { try { sessionStorage.setItem('fmd-chat-big', big ? '1' : '0') } catch { /* private mode */ } }, [big])

  // Is the page behind the button dark (e.g. the green home hero)? Then the button switches to a light colour.
  useEffect(() => {
    let frame = 0
    const check = () => {
      frame = 0
      const fab = fabRef.current
      const box = fab?.parentElement // the widget's own box isn't moved by the tuck, so the check stays stable
      if (!fab || !box) return
      const r = box.getBoundingClientRect()
      const tuck = coversContent(r)
      // colour: judge the background where the button actually shows (just the peeking tab when tucked)
      const x = tuck ? window.innerWidth - 22 : r.left + r.width / 2, y = r.top + r.height / 2
      const below = document.elementsFromPoint(x, y).find((el) => !el.closest('.chatw'))
      setOnDark(isDarkBehind(below))
      setTucked(tuck)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check) }
    const late = setTimeout(schedule, 600) // after images and layout settle
    const poll = setInterval(schedule, 1200) // content can appear without a scroll (results loading, panels opening)
    schedule()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(late)
      clearInterval(poll)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [pathname])

  useEffect(() => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(messages)) } catch { /* private mode */ } }, [messages])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [messages, open, busy])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') closePanel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send(text) {
    const question = text.trim().slice(0, MAX_CHARS)
    if (!question || busy) return
    setError('')
    setInput('')
    const history = [...messages, { role: 'user', content: question }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)

    let lang = 'en'
    try { lang = localStorage.getItem('language') || 'en' } catch { /* ignore */ }
    const pageContext = [
      `The student is on the page ${pathname}.`,
      lang !== 'en' && LANGUAGE_NAMES[lang] ? `The website is shown in ${LANGUAGE_NAMES[lang]}; reply in ${LANGUAGE_NAMES[lang]} unless they write in another language.` : '',
      context || '',
    ].filter(Boolean).join('\n')

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, context: pageContext }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body.detail === 'string' ? body.detail : "The assistant isn't available right now.")
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let reply = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        reply += decoder.decode(value, { stream: true })
        setMessages([...history, { role: 'assistant', content: reply }])
      }
      if (!reply.trim()) throw new Error('No reply came back. Please try again.')
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages((m) => (m.at(-1)?.content ? m : m.slice(0, -1)))
      } else {
        setMessages(history.slice(0, -1)) // take the question back out so it can be resent
        setInput(question)
        setError(err.message === 'Failed to fetch' ? "Couldn't reach the assistant. Check your connection and try again." : err.message)
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function closePanel() {
    if (!open || closing) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setOpen(false); return }
    setClosing(true)
    closeTimer.current = setTimeout(() => { setOpen(false); setClosing(false) }, 260)
  }
  function toggle() {
    setBurst((n) => n + 1)
    if (open) closePanel()
    else { clearTimeout(closeTimer.current); setClosing(false); setOpen(true) }
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    const onOpen = () => { clearTimeout(closeTimer.current); setClosing(false); setOpen(true) }
    window.addEventListener('chatw-open', onOpen)
    return () => window.removeEventListener('chatw-open', onOpen)
  }, [])

  function reset() {
    abortRef.current?.abort()
    setMessages([])
    setError('')
    inputRef.current?.focus()
  }

  const starters = context && pathname.startsWith('/results') ? RESULTS_STARTERS : STARTERS
  const waiting = busy && !messages.at(-1)?.content

  return (
    <div className={`chatw${open && !closing ? ' is-open' : ''}${tucked && !open ? ' is-tucked' : ''}${onDark ? ' on-dark' : ''}${big ? ' is-big' : ''}`}>
      {open && (
        <section className={`chatw-panel${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Crib Crew Assistant, AI assistant">
          <header className="chatw-head">
            <span className="chatw-avatar" aria-hidden="true"><Icon d={ICONS.spark} size={18} /></span>
            <div className="chatw-title">
              <strong>Crib Crew Assistant</strong>
              <span><i aria-hidden="true" />AI assistant · can make mistakes</span>
            </div>
            {messages.length > 0 && (
              <button type="button" className="chatw-icon-btn" onClick={reset} aria-label="Start a new chat" title="New chat">
                <Icon d={ICONS.reset} size={17} />
              </button>
            )}
            <button type="button" className="chatw-icon-btn chatw-size-btn" onClick={() => setBig((v) => !v)}
              aria-pressed={big} aria-label={big ? 'Make the chat smaller' : 'Enlarge the chat'} title={big ? 'Smaller' : 'Enlarge'}>
              <Icon d={big ? ICONS.shrink : ICONS.expand} size={17} />
            </button>
            <button type="button" className="chatw-icon-btn" onClick={closePanel} aria-label="Close the assistant">
              <Icon d={ICONS.close} size={18} />
            </button>
          </header>

          <div className="chatw-body" ref={listRef} aria-live="polite" translate="no">
            <div className="chatw-msg is-bot"><p>{WELCOME}</p></div>
            {messages.length === 0 && (
              <div className="chatw-starters">
                {starters.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {messages.map((m, i) => (
              (m.content || !busy || i < messages.length - 1) && (
                <div key={i} className={`chatw-msg ${m.role === 'user' ? 'is-user' : 'is-bot'}`}>
                  {m.role === 'user' ? <p>{m.content}</p> : <Formatted text={m.content} />}
                </div>
              )
            ))}
            {waiting && <div className="chatw-msg is-bot chatw-typing" aria-label="The assistant is typing"><span /><span /><span /></div>}
            {error && <p className="chatw-error" role="alert">{error}</p>}
          </div>

          <form className="chatw-form" onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_CHARS}
              placeholder="Ask about areas, rent, transport…"
              aria-label="Your question"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) } }}
            />
            {busy ? (
              <button type="button" className="chatw-send is-stop" onClick={() => abortRef.current?.abort()} aria-label="Stop the reply">
                <Icon d={ICONS.stop} size={16} />
              </button>
            ) : (
              <button type="submit" className="chatw-send" disabled={!input.trim()} aria-label="Send">
                <Icon d={ICONS.send} size={18} />
              </button>
            )}
          </form>
          <p className="chatw-foot">Answers are general guidance. Check rents and rules with official sources.</p>
        </section>
      )}

      <button
        ref={fabRef}
        type="button"
        className={`chatw-fab${burst ? (burst % 2 ? ' pop-a' : ' pop-b') : ''}`}
        onClick={toggle}
        aria-expanded={open && !closing}
        aria-label={open ? 'Close the assistant' : 'Open the Crib Crew Assistant'}
      >
        <span className={`chatw-fab-icon${open && !closing ? ' is-x' : ''}`} aria-hidden="true">
          {/* speech bubble whose three dots "type" now and then */}
          <svg className="i-chat" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path className="bubble" d="M20 11.5a7.5 7.5 0 0 1-11.1 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5Z" />
            <circle className="dot d1" cx="8.6" cy="11.5" r="1.05" fill="currentColor" stroke="none" />
            <circle className="dot d2" cx="12" cy="11.5" r="1.05" fill="currentColor" stroke="none" />
            <circle className="dot d3" cx="15.4" cy="11.5" r="1.05" fill="currentColor" stroke="none" />
          </svg>
          <svg className="i-close" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d={ICONS.close} /></svg>
        </span>
        {!(open && !closing) && <span className="chatw-fab-label">Ask me</span>}
        {burst > 0 && (
          <span key={burst} className="chatw-burst" aria-hidden="true">
            <i className="ring" />
            {Array.from({ length: 10 }, (_, k) => <b key={k} style={{ '--a': `${k * 36 + (burst % 2) * 18}deg`, '--d': `${k % 3 * 6}px` }} />)}
          </span>
        )}
      </button>
    </div>
  )
}
