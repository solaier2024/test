#!/usr/bin/env node
/*
 * Records the page itself rather than the screen.
 *
 * This exists because desktop screen capture is the wrong instrument for this
 * game and will lie about it. A sparsely sampled screen recording compresses a
 * long session, so a 120ms blink becomes zero frames and a 6.9 second breathing
 * loop reads as a photograph - the same trap the sibling project documented
 * after four separate reviews reported effects that frame-by-frame measurement
 * showed were there all along.
 *
 * Playwright records the viewport at a real frame rate, so what comes out is
 * what the page actually did.
 *
 *   node scripts/record-demo.mjs [url] [outdir]
 *
 * Unlike the other capture scripts this one deliberately does NOT seed the
 * intro-seen flag: the opening is part of what is being demonstrated.
 */
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[3] ?? '/tmp/dc-demo'
mkdirSync(OUT, { recursive: true })

const size = { width: 1280, height: 720 }
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: OUT, size },
  // Autoplay has to be allowed or the opening never starts and there is nothing
  // to record. The unlock path itself is covered by verify-deploy instead.
})
const page = await context.newPage()
const beat = (ms) => page.waitForTimeout(ms)

console.log(`recording ${url}`)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
if (await notice.count()) {
  await notice.first().click()
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
}

// The opening, all the way through. Nothing is clicked while it runs, because
// clicking anywhere skips it.
if (await page.locator('.intro-video').count()) {
  console.log('  opening: letting it run')
  await page.waitForSelector('.title-page', { timeout: 30000 })
} else {
  // Already seen in this profile, so replay it from the title page on purpose.
  console.log('  opening: replaying from the title page')
  await page.waitForSelector('.title-page')
  await beat(900)
  await page.getByRole('button', { name: /WATCH THE OPENING|VER LA APERTURA/ }).click()
  await page.waitForSelector('.title-page', { timeout: 30000 })
}

await beat(1600)
await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await beat(2200)

// Six decks, so the shoe lasts and the hands keep coming.
await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page')

// Sit still first: the idle loop breathes and blinks, and that only reads if
// nothing else is moving.
console.log('  idle: holding on her')
await beat(5000)

async function playHand({ lean = false } = {}) {
  await page.locator('.chip').nth(1).click()
  await beat(500)
  await page.locator('[data-act="deal"]').click()

  if (lean) {
    // Hold it down, the way a player would.
    const btn = page.locator('[data-act="lean"]')
    await btn.dispatchEvent('pointerdown')
    await beat(2600)
    await btn.dispatchEvent('pointerup')
    await beat(400)
  } else {
    await beat(1500)
  }

  for (let i = 0; i < 10; i++) {
    if (await page.locator('.banner').count()) break
    const hit = page.locator('[data-act="hit"]')
    const stand = page.locator('[data-act="stand"]')
    if (!(await hit.count())) break
    const mine = Number(await page.locator('.hand.player .hand-label b').first().innerText())
    if (Number.isFinite(mine) && mine < 17) await hit.click()
    else await stand.click()
    await beat(1100)
  }
  await beat(2000)
  const head = (await page.locator('.banner strong').count())
    ? await page.locator('.banner strong').innerText()
    : '(no banner)'
  console.log(`  hand: ${head}`)
  const next = page.locator('[data-act="next"]')
  if (await next.count()) await next.click()
  await beat(900)
}

await playHand()
await playHand({ lean: true })
await playHand()
await playHand()

await beat(1200)
await context.close()
await browser.close()

const file = readdirSync(OUT).filter((f) => f.endsWith('.webm')).sort().pop()
const named = join(OUT, 'demo.webm')
renameSync(join(OUT, file), named)
console.log(`\n-> ${named}`)
