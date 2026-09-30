/**
 * Navigates to a build and gets past anything standing in front of it.
 *
 * A proxy may hold the build behind a one-time notice, which a first-time
 * visitor has to step through too, so this is not test-only behaviour - it is
 * the first thing the page does on the published URL.
 */
export async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
  if (await notice.count()) {
    await notice.first().click()
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
  }
}

/**
 * The opening only plays once, which has a side effect for scripts. Seeding the
 * flag before navigation means capture runs start on the title page instead of
 * spending twelve seconds on a cinematic they are not testing.
 *
 * record-demo.mjs deliberately does not call this, so the demo includes it.
 * Neither does the opening's own section of verify-audio.mjs, which is
 * measuring what the film sounds like.
 */
export async function skipIntro(page, url) {
  await page.addInitScript(() => {
    localStorage.setItem('dc.intro.seen', '1')
  })
  if (!url) return
  await open(page, url)
}
