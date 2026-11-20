// Things to know: the arrival checklist, its official links, and ticks that are remembered
import { test, expect } from '@playwright/test'
import { watchErrors } from './helpers.js'

test('the checklist has 4 stages and 13 steps, each with an official link', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/things-to-know')
  for (const stage of ['Before you fly', 'Your first week', 'Your first month', 'Living in Dublin']) {
    await expect(page.getByRole('heading', { name: stage, exact: true })).toBeVisible()
  }
  await expect(page.locator('main h3')).toHaveCount(13)
  const links = await page.locator('main a[href^="http"]').evaluateAll((as) => as.map((a) => a.href))
  expect(links.length).toBeGreaterThanOrEqual(13)
  for (const href of links) expect(href, 'official links use https').toMatch(/^https:\/\//)
  errors.check()
})

test('a ticked step is still ticked after a reload', async ({ page }) => {
  await page.goto('/things-to-know')
  // each step has a tick button (pressed = done)
  const tick = page.locator('main .ttk-check').first()
  await expect(tick).toHaveAttribute('aria-pressed', 'false')
  await tick.click()
  await expect(tick).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.locator('main .ttk-check').first()).toHaveAttribute('aria-pressed', 'true')
})
