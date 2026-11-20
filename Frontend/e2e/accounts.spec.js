// Log in and sign up: the forms work and, where log in isn't configured (tests and local copies), say so clearly
import { test, expect } from '@playwright/test'

test('the log in form checks the details and explains when log in is unavailable', async ({ page }) => {
  await page.goto('/login')
  const form = page.locator('form')
  await form.locator('input[type="email"]').fill('student@example.com')
  await form.locator('input[type="password"]').fill('a-wrong-password')
  await form.locator('input[type="password"]').press('Enter')
  // Without Firebase settings (as in these tests) the site explains instead of failing silently
  await expect(page.getByText(/not set up|incorrect|wrong|try again/i).first()).toBeVisible()
})

test('the sign up form has every field and links back to log in', async ({ page }) => {
  await page.goto('/signup')
  const form = page.locator('form')
  await expect(form.locator('input[type="email"]')).toBeVisible()
  await expect(form.locator('input[type="password"]').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /log in/i }).first()).toBeVisible()
})
