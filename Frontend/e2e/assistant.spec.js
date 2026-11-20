// The AI assistant ("Ask me"). Its replies are supplied by the test, so no API key or cost is needed.
import { test, expect } from '@playwright/test'
import { mockAssistant, openChat, openDistrict, resultsUrl, watchErrors } from './helpers.js'

test('the chat opens with a welcome and suggested questions, and answers', async ({ page }) => {
  const errors = watchErrors(page)
  const sent = await mockAssistant(page)
  await page.goto('/things-to-know')
  await openChat(page)
  const panel = page.locator('.chatw-panel')
  await expect(panel.locator('.chatw-hello h3')).toHaveText(/^Hi/)
  await expect(panel.locator('.chatw-starters button')).toHaveCount(4)
  await panel.locator('.chatw-starters button').filter({ hasText: 'Leap card' }).click()
  await expect(panel.locator('.chatw-msg.is-user')).toHaveText('How do I get a student Leap card?')
  await expect(panel.locator('.chatw-msg.is-bot').last()).toContainText('50% off')
  await expect(panel.locator('.chatw-msg.is-bot strong').last()).toHaveText('50% off') // **bold** is formatted
  expect(sent[0].messages.at(-1).content).toBe('How do I get a student Leap card?')
  expect(sent[0].context).toContain('/things-to-know')
  errors.check()
})

test('typing a question and pressing Enter sends it; New chat starts again', async ({ page }) => {
  await mockAssistant(page, 'Rathmines is a popular student area.')
  await page.goto('/how-it-works')
  await openChat(page)
  const box = page.locator('.chatw-form textarea')
  await box.fill('Is Rathmines good for students?')
  await box.press('Enter')
  await expect(page.locator('.chatw-msg.is-bot').last()).toHaveText('Rathmines is a popular student area.')
  await page.getByRole('button', { name: 'New chat' }).click()
  await expect(page.locator('.chatw-msg.is-user')).toHaveCount(0)
  await expect(page.locator('.chatw-starters button')).toHaveCount(4)
})

test('if the assistant is unavailable, the student sees why and keeps their question', async ({ page }) => {
  await mockAssistant(page, '', { status: 503 })
  await page.goto('/campuses')
  await openChat(page)
  const box = page.locator('.chatw-form textarea')
  await box.fill('How do I find a GP?')
  await box.press('Enter')
  await expect(page.locator('.chatw-error')).toContainText('busy')
  await expect(box).toHaveValue('How do I find a GP?')
})

test('on a district profile the suggestions are about that district and it knows which one is open', async ({ page }) => {
  const sent = await mockAssistant(page, 'D6 has a safety score of 58/100.')
  await page.goto('/districts')
  await openDistrict(page, 'D6')
  await openChat(page)
  await expect(page.locator('.chatw-starters button').first()).toContainText('How safe is D6?')
  await page.locator('.chatw-starters button').first().click()
  await expect(page.locator('.chatw-msg.is-bot').last()).toContainText('58/100')
  expect(sent[0].context).toContain('district profile for D6 Rathmines & Ranelagh')
})

test('on the results page it knows the student’s matches', async ({ page }) => {
  const sent = await mockAssistant(page, 'Your cheapest match is shown first.')
  await page.goto(resultsUrl())
  await expect(page.locator('main button').filter({ hasText: /^#1/ })).toBeVisible({ timeout: 30_000 })
  await openChat(page)
  await expect(page.locator('.chatw-starters button').first()).toContainText('Which of my matches is cheapest?')
  await page.locator('.chatw-starters button').first().click()
  await expect(page.locator('.chatw-msg.is-bot').last()).toContainText('cheapest')
  expect(sent[0].context).toMatch(/Their top matches[\s\S]*#1 /)
})

test('voice input fills the box for the student to check before sending', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'speech recognition is a Chrome and Edge feature')
  // a stand-in microphone that "hears" a sentence
  await page.addInitScript(() => {
    class FakeRecognition {
      start() { setTimeout(() => { this.onresult?.({ results: [[{ transcript: 'How do I get a PPS number' }]] }); this.onend?.() }, 200) }
      stop() { this.onend?.() }
      abort() {}
    }
    window.SpeechRecognition = FakeRecognition
    window.webkitSpeechRecognition = FakeRecognition
  })
  const sent = await mockAssistant(page)
  await page.goto('/things-to-know')
  await openChat(page)
  await page.locator('.chatw-mic').click()
  await expect(page.locator('.chatw-form textarea')).toHaveValue('How do I get a PPS number')
  expect(sent).toHaveLength(0) // nothing is sent until the student presses send
})
