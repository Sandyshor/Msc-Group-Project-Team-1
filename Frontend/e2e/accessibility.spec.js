// Accessibility: an automatic axe-core scan of every main page (WCAG 2.1 A and AA rules).
// Serious and critical problems fail the test; the full list of findings is attached to the HTML report.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { closeTour } from './helpers.js'

const PAGES = ['/', '/districts', '/campuses', '/attractions', '/how-it-works', '/questionnaire', '/things-to-know', '/login', '/signup', '/contact', '/privacy']

test.describe('accessibility', () => {
  for (const path of PAGES) {
    test(`${path} has no serious accessibility problems`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chrome', 'scanned once, in desktop Chrome')
      // no fade-in animations (the site honours reduced motion), so text isn't measured half-faded
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(path, { waitUntil: 'networkidle' })
      if (path === '/') await closeTour(page)
      await page.waitForTimeout(1000)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .exclude('.leaflet-container') // third-party map tiles and controls
        .analyze()
      await testInfo.attach('axe-results.json', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' })
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      const summary = serious.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}\n    e.g. ${v.nodes[0]?.target.join(' ')}`).join('\n')
      expect(serious, summary).toEqual([])
    })
  }
})
