// Google Lighthouse scores for every page: performance, accessibility, best practices and SEO, on mobile and desktop.
//
//   npm run test:lighthouse
//
// Needs the website served at BASE_URL (default http://localhost:4173, as `npx vite preview --port 4173` serves the
// production build) and the backend for pages that use it. Writes lighthouse-report/<page>-<mode>.html, one report per
// page, and lighthouse-report/summary.md + summary.json with every score. The run fails if a page's average
// accessibility or best-practices score drops below MIN_SCORE (default 80), so CI notices a regression.
import fs from 'node:fs'
import path from 'node:path'
import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4173').replace(/\/$/, '')
const OUT = path.resolve(process.env.LIGHTHOUSE_OUT || 'lighthouse-report')
const MIN_SCORE = Number(process.env.MIN_SCORE || 80)
const PAGES = [
  ['home', '/'], ['districts', '/districts'], ['questionnaire', '/questionnaire'], ['things-to-know', '/things-to-know'],
  ['universities', '/campuses'], ['attractions', '/attractions'], ['how-it-works', '/how-it-works'], ['login', '/login'],
]
const MODES = ['mobile', 'desktop']
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']

async function reachable(url) {
  try { return (await fetch(url)).ok } catch { return false }
}

if (!(await reachable(BASE_URL))) {
  console.error(`The website isn't running at ${BASE_URL}. Start it first, e.g.:\n  npm run build && npx vite preview --port 4173`)
  process.exit(1)
}
fs.mkdirSync(OUT, { recursive: true })
const chrome = await chromeLauncher.launch({ chromePath: process.env.CHROME_PATH, chromeFlags: ['--headless=new', '--no-sandbox'] })
const rows = []
try {
  for (const [name, route] of PAGES) {
    for (const mode of MODES) {
      const config = mode === 'desktop'
        ? { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttlingMethod: 'simulate' } }
        : { extends: 'lighthouse:default', settings: { formFactor: 'mobile', throttlingMethod: 'simulate' } }
      const result = await lighthouse(`${BASE_URL}${route}`, { port: chrome.port, output: 'html', logLevel: 'error', onlyCategories: CATEGORIES }, config)
      fs.writeFileSync(path.join(OUT, `${name}-${mode}.html`), result.report)
      const scores = Object.fromEntries(CATEGORIES.map((c) => [c, Math.round((result.lhr.categories[c]?.score ?? 0) * 100)]))
      rows.push({ page: name, path: route, mode, ...scores })
      console.log(`${name.padEnd(15)} ${mode.padEnd(8)} ${CATEGORIES.map((c) => `${c} ${String(scores[c]).padStart(3)}`).join('  ')}`)
    }
  }
} finally {
  await chrome.kill()
}

const avg = (key) => Math.round(rows.reduce((n, r) => n + r[key], 0) / rows.length)
const table = [
  '| Page | Mode | Performance | Accessibility | Best practices | SEO |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.page} (${r.path}) | ${r.mode} | ${r.performance} | ${r.accessibility} | ${r['best-practices']} | ${r.seo} |`),
  `| **Average** | | **${avg('performance')}** | **${avg('accessibility')}** | **${avg('best-practices')}** | **${avg('seo')}** |`,
].join('\n')
fs.writeFileSync(path.join(OUT, 'summary.md'), `# Lighthouse scores\n\nRun on ${new Date().toISOString().slice(0, 10)} against ${BASE_URL}. Scores are out of 100; one HTML report per page and mode is in this folder.\n\n${table}\n`)
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(rows, null, 2))
console.log(`\nSummary: ${path.join(OUT, 'summary.md')}`)

const low = PAGES.filter(([name]) => ['accessibility', 'best-practices'].some((c) => {
  const pageRows = rows.filter((r) => r.page === name)
  return pageRows.reduce((n, r) => n + r[c], 0) / pageRows.length < MIN_SCORE
}))
if (low.length) {
  console.error(`Below ${MIN_SCORE} for accessibility or best practices: ${low.map(([n]) => n).join(', ')}`)
  process.exit(1)
}
