import { useEffect, useState } from 'react'

// '' = same address as the website (Azure serves both); unset = the Render API.
const API_URL = import.meta.env.VITE_API_URL ?? 'https://crib-crew-recommender-api.onrender.com'

const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['hi', 'हिन्दी'],
  ['zh-Hans', '中文'],
  ['ar', 'العربية'],
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

  return (
    <select
      className="language-switcher"
      translate="no"
      aria-label="Language"
      value={lang}
      onChange={(event) => setLang(event.target.value)}
    >
      {LANGUAGES.map(([code, label]) => (
        <option key={code} value={code}>{label}</option>
      ))}
    </select>
  )
}

export default LanguageSwitcher
