/*
 * The screenshots in docs/, taken from a running dev server rather than drawn.
 *
 * Kept as a script for the reason the sibling tables in this repository keep one:
 * a README illustrated by hand drifts from the thing it documents, and nobody
 * notices until somebody who has not seen the game reads it. Re-run it after
 * anything that changes the picture.
 *
 * Wants a dev server:  npm run dev -- --port 5190 --strictPort --host 127.0.0.1
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const URL = process.env.URL ?? 'http://127.0.0.1:5190/'
const OUT = 'docs'

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })

const shot = async (name, target) => {
  await (target ? page.locator(target) : page).screenshot({ path: `${OUT}/${name}.jpg`, quality: 82, type: 'jpeg' })
  console.log(`  ${OUT}/${name}.jpg`)
}

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('.pitch')

console.log('\ntaking the pictures')

/* The table before a round: the odds on the goal, the keeper standing. */
await page.locator('.stakes .chip').nth(2).click()
await shot('table', '.table')

await page.locator('.go').click()
await page.waitForSelector('.during')
await shot('goal', '.pitch')

/*
 * The tell, which is the mechanic worth a picture. Hunted for rather than staged -
 * it fires about one kick in five, so the loop opens rounds until one turns up and
 * then photographs the real thing.
 */
let found = false
for (let i = 0; i < 60 && !found; i++) {
  const view = page.locator('.tell')
  if ((await view.count()) > 0) {
    await shot('tell', '.table')
    found = true
    break
  }
  /* Take a kick to move on. Down the middle, so rounds tend to continue. */
  if ((await page.locator('.during').count()) === 0) {
    await page.locator('.go').click()
    await page.waitForSelector('.during')
    continue
  }
  await page.locator('.zone').nth(4).click()
  await page.waitForSelector('.verdict.goal, .verdict.saved, .verdict.missed')
  await page.waitForTimeout(820)
}
if (!found) console.log('  (no tell turned up in 60 tries, which is suspicious - check TELL_RATE)')

/* The verifier, with a seed revealed and a round recomputed on the device. */
if ((await page.locator('.during').count()) > 0) {
  const cash = page.locator('.cash')
  if (await cash.isEnabled()) {
    await cash.click()
    await page.waitForSelector('.outcome')
  } else {
    await page.locator('.zone').nth(4).click()
    await page.waitForSelector('.verdict.goal, .verdict.saved, .verdict.missed')
    await page.waitForTimeout(900)
    if (await page.locator('.cash').isEnabled()) {
      await page.locator('.cash').click()
      await page.waitForSelector('.outcome')
    }
  }
}

await page.locator('.disclose').click()
await page.locator('.seedform button.primary').click()
await page.waitForSelector('.revealed')
await page.waitForTimeout(300)
await shot('verify', '.verify')

await browser.close()
console.log('')
