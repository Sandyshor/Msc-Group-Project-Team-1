import { useEffect, useRef, useState } from 'react'

// '' = same address as the website (Azure serves both); unset = the Render API.
const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'

// code, name in its own language, name in English
const LANGUAGES = [
  ['en', 'English', 'English'],
  ['es', 'Español', 'Spanish'],
  ['pt', 'Português', 'Portuguese'],
  ['hi', 'हिन्दी', 'Hindi'],
  ['zh-Hans', '中文', 'Chinese'],
  ['ar', 'العربية', 'Arabic'],
]

const originals = new WeakMap() // text node -> English text
const shown = new WeakMap()     // text node -> text we last put there
const cache = {}                // language -> { English text: translation }

function textNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      if (/^[\d\s.,:%€+\-–/()]+$/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT
      if (parent.closest('script, style, [translate="no"]')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  return nodes
}

async function translatePage(lang) {
  const nodes = textNodes()
  // React may have put new English text in a node since we last translated it
  for (const node of nodes) {
    if (node.nodeValue !== shown.get(node)) originals.set(node, node.nodeValue)
  }
  if (lang !== 'en') {
    const done = (cache[lang] ??= {})
    const missing = [...new Set(nodes.map((n) => originals.get(n)))].filter((t) => !(t in done))
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100)
      const res = await fetch(`${API_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: batch, language: lang }),
      })
      if (!res.ok) return
      const { translations } = await res.json()
      batch.forEach((text, j) => { done[text] = translations[j] })
    }
  }
  for (const node of nodes) {
    const english = originals.get(node)
    const text = lang === 'en' ? english : cache[lang][english] ?? english
    if (node.nodeValue !== text) node.nodeValue = text
    shown.set(node, text)
  }
}

function LanguageSwitcher() {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('language') || 'en' } catch { return 'en' }
  })

  useEffect(() => {
    try { localStorage.setItem('language', lang) } catch { /* ignore */ }
    document.documentElement.lang = lang
    translatePage(lang)

    // pages change and results load later, so translate new text when it appears
    let timer
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => translatePage(lang), 300)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [lang])

  // A pill button with a menu of languages (keyboard: arrows, Enter, Esc)
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const box = useRef(null)
  const current = LANGUAGES.find(([code]) => code === lang) || LANGUAGES[0]

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEffect(() => {
    if (open) box.current?.querySelectorAll('[role="option"]')[focus]?.focus()
  }, [open, focus])

  const choose = (code) => { setLang(code); setOpen(false); box.current?.querySelector('button')?.focus() }
  const openMenu = () => { setFocus(Math.max(0, LANGUAGES.findIndex(([code]) => code === lang))); setOpen(true) }
  const onKey = (event) => {
    if (event.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) openMenu(); else setFocus((f) => (f + 1) % LANGUAGES.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (!open) openMenu(); else setFocus((f) => (f - 1 + LANGUAGES.length) % LANGUAGES.length) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className={`lang-switch${open ? ' is-open' : ''}`} translate="no" ref={box} onKeyDown={onKey}>
      <button type="button" className="lang-switch-button" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Language: ${current[2]}`} onClick={() => (open ? setOpen(false) : openMenu())}>
        <svg className="lang-globe" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
        <span>{current[1]}</span>
        <svg className="lang-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox" aria-label="Choose a language">
          {LANGUAGES.map(([code, own, english], i) => (
            <li key={code} role="option" aria-selected={code === lang} tabIndex={i === focus ? 0 : -1} lang={code}
              className={code === lang ? 'is-current' : ''}
              onClick={() => choose(code)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(code) } }}>
              <span className="lang-own">{own}</span>
              <span className="lang-english">{english}</span>
              {code === lang && <svg className="lang-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default LanguageSwitcher
