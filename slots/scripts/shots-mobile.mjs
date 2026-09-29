#!/usr/bin/env node
/*
 * Walks the table at a phone viewport, photographing every step and checking
 * at each one that the layout still holds.
 *
 *   npm run shots:mobile
 *   node scripts/shots-mobile.mjs <baseUrl> <outDir>
 *
 * Portrait is easy to break without noticing, because every one of these
 * screens is fine at desktop width. This table has one failure mode the
 * sibling projects did not: the machine is a picture with a HOLE in it and
 * the reels are DOM showing through, so a layout that merely reflows is not
 * enough - the bands have to stay inside the glass at every width, and at
 * phone width the glass is about 60 pixels across.
 */
import { mkdirSync } from 'node:fs'
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[3] ?? '/tmp/slots-mobile'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ ...devices['iPhone 14'], reducedMotion: 'no-preference' })
const page = await context.newPage()

const problems = []
page.on('pageerror', (e) => problems.push(String(e)))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))

/**
 * A control the thumb cannot reach is not a control. Checked on every screen
 * rather than once at the end, because each one lays out differently.
 */
async function audit(step) {
  const found = await page.evaluate(() => {
    const h = window.innerHeight
    const w = window.innerWidth
    const bad = []
    for (const el of document.querySelectorAll('button')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const tag = `${el.tagName.toLowerCase()}.${el.className || '-'}`
      if (r.bottom > h + 1 || r.top < -1 || r.right > w + 1 || r.left < -1) {
        bad.push(`${tag} outside the viewport (${Math.round(r.top)}..${Math.round(r.bottom)})`)
      } else if (r.height < 44) {
        bad.push(`${tag} only ${Math.round(r.height)}px tall`)
      }
    }
    if (document.documentElement.scrollWidth > w) bad.push('the page scrolls sideways')

    /*
     * The bands against the hole. This is the check this table exists for:
     * the window is positioned in fractions of the plate, so anything that
     * changes how the plate is fitted - object-fit, a letterbox, a rounding
     * error at an odd width - moves the hole out from under the reels while
     * leaving every button exactly where it should be.
     */
    const win = document.querySelector('.window')?.getBoundingClientRect()
    const reels = document.querySelector('.reels')?.getBoundingClientRect()
    if (win && reels) {
      const out = [
        ['left', win.left - reels.left],
        ['right', reels.right - win.right],
        ['top', win.top - reels.top],
        ['bottom', reels.bottom - win.bottom],
      ].filter(([, over]) => over > 1)
      for (const [side, over] of out) bad.push(`the bands hang ${over.toFixed(1)}px past the ${side} of the glass`)
      /*
       * 90px across for three bands is about 28 per symbol. Below that a bell
       * and a horseshoe stop being distinguishable at arm's length, and this
       * table is unplayable without that distinction rather than merely
       * cramped - so the glass has a minimum and it is checked, not hoped for.
       */
      if (win.width < 90) bad.push(`the glass is only ${win.width.toFixed(0)}px wide - a bell is not countable`)
    }

    /*
     * Do any two panels sit on top of each other.
     *
     * This is the check that was missing, and its absence is why an earlier
     * portrait layout passed while the pay card lay across both controls, the
     * count sat under a button and the disclaimer ran through the middle of
     * CALL THE HOUSE. Everything was inside the viewport and everything was
     * tall enough to tap, which is all the audit had been asking.
     *
     * Overlap is allowed on the picture - the crowd line is SUPPOSED to sit
     * over it - so the picture is not in the list. Everything in the list is
     * a panel that owns its own space.
     */
    const panels = [
      '.hud', '.chrome-row', '.tally', '.paycard', '.controls', '.disclaimer.floating', '.said',
      // The picker is a screen too, and leaving it out of this list is how
      // its title came to be printed underneath the language button.
      '.pick h1', '.tagline', '.pick h2', '.machines', '.pick-note',
      '.intro-title', '.intro-line', '.skip',
    ]
      .map((sel) => ({ sel, r: document.querySelector(sel)?.getBoundingClientRect() }))
      .filter((p) => p.r && p.r.width > 0 && p.r.height > 0)
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i].r
        const b = panels[j].r
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (x > 1 && y > 1) {
          bad.push(`${panels[i].sel} and ${panels[j].sel} overlap by ${Math.round(x)}x${Math.round(y)}px`)
        }
      }
    }
    return bad
  })
  found.forEach((f) => problems.push(`${step}: ${f}`))
}

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, quality: 88, type: 'jpeg' })
  await audit(name)
  console.log(name)
}

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })

const interstitial = page.getByRole('button', { name: 'Open the page' })
if (await interstitial.count()) {
  await interstitial.tap()
  await page.waitForLoadState('networkidle')
  problems.length = 0
}

await page.waitForTimeout(1600)
await shot('01-intro')

await page.locator('button.skip').tap()
await page.waitForTimeout(900)
await shot('02-pick')

await page.locator('.machines button').nth(2).tap()
await page.waitForSelector('.reels', { timeout: 30000 })
await page.waitForTimeout(1400)
await shot('03-table')

// The offsets are the ones from shots.mjs, for the same reasons.
await page.locator('button.lever').tap()
await page.waitForTimeout(1800)
await shot('04-spinning')
await page.waitForTimeout(2200)
await shot('05-reaction')
await page.waitForTimeout(1400)
await shot('06-settled')

// The accusation panel is the one screen with a block of prose on it, which
// is the screen most likely to slide under the pinned controls.
await page.locator('button.callout').tap()
await page.waitForTimeout(2600)
await shot('07-called')

await browser.close()

if (problems.length) console.error('\n' + problems.join('\n'))
console.log(problems.length ? '\nFAILED' : '\nOK: portrait holds, every control is reachable, the bands stay in the glass')
process.exit(problems.length ? 1 : 0)
