/**
 * The opening only plays once, which has a side effect for scripts. Seeding the
 * flag before navigation means capture runs start on the title page instead of
 * spending twelve seconds on a cinematic they are not testing.
 *
 * record-demo.mjs deliberately does not call this, so the demo includes it.
 */
export async function skipIntro(page, url) {
  await page.addInitScript(() => {
    localStorage.setItem('dc.intro.seen', '1')
  })
  if (!url) return
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // A proxy may hold the build behind a one-time notice. Step through it, the
  // way a first-time visitor has to.
  const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
  if (await notice.count()) {
    await notice.first().click()
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
  }
}
