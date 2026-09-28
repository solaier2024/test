#!/usr/bin/env node
/*
 * Checks that nothing lands outside the frame at a spread of window sizes.
 *
 * This exists because of a specific failure: the control bar reserved a fixed
 * height, its contents grew past it, and at 1280x720 the key hints and the leave
 * link were sliced in half by the bottom edge - invisible at 1440x900, which is
 * the only size anything was being looked at.
 *
 *   node scripts/verify-edges.mjs [url]
 */
import { chromium } from 'playwright'
import { skipIntro } from './lib/skip-intro.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'
const SIZES = [
  { width: 1024, height: 640 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
]
const WATCH = '.keys, .disclaimer, .chrome, .money, .act, .chip, .hand-label, .stake, .tally, .shoe-label, .banner, .hint'

const fail = []
for (const viewport of SIZES) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport })
  await skipIntro(page, url)
  await page.waitForSelector('.title-page', { timeout: 20000 })
  await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
  await page.waitForSelector('.tables-page')
  await page.locator('.table-card').nth(1).getByRole('button').click()
  await page.waitForSelector('.table-page')

  const states = []
  // Betting, mid-hand and settled all lay the bar out differently.
  states.push(await check(page, 'betting'))
  await page.locator('[data-act="deal"]').click()
  await page.waitForTimeout(1400)
  states.push(await check(page, 'in hand'))
  for (let i = 0; i < 8 && !(await page.locator('.banner').count()); i++) {
    const stand = page.locator('[data-act="stand"]')
    if (await stand.count()) await stand.click()
    await page.waitForTimeout(700)
  }
  states.push(await check(page, 'settled'))

  const problems = states.flat()
  console.log(`${viewport.width}x${viewport.height}: ${problems.length ? problems.join(' | ') : 'clear'}`)
  for (const p of problems) fail.push(`${viewport.width}x${viewport.height} ${p}`)
  await browser.close()
}

async function check(page, label) {
  return page.evaluate(
    ({ sel, label }) => {
      const out = []
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (getComputedStyle(el).visibility === 'hidden') continue
        const text = (el.textContent || '').trim().slice(0, 18)
        if (r.bottom > innerHeight + 0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.left < -0.5) {
          out.push(`[${label}] ${el.className.split(' ')[0]} "${text}" clipped`)
        }
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`[${label}] horizontal scroll`)

      // Nothing that carries a number may sit on top of anything else that does.
      // The result banner landing across the hand total is the specific bug this
      // catches, and it only showed up at some window sizes.
      const boxes = [...document.querySelectorAll('.banner, .hand-label, .stake, .money, .note-line, .hint, .card, .act, .chip')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          // A child sits inside its parent by definition; that is nesting, not a
          // collision.
          if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue
          // Cards in a hand are fanned and overlap by design.
          if (boxes[i].el.classList.contains('card') && boxes[j].el.classList.contains('card')) continue
          const a = boxes[i].r
          const b = boxes[j].r
          const overlap =
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
          if (overlap > 12) {
            const na = boxes[i].el.className.split(' ')[0]
            const nb = boxes[j].el.className.split(' ')[0]
            out.push(`[${label}] ${na} overlaps ${nb} by ${Math.round(overlap)}px2`)
          }
        }
      }
      return out
    },
    { sel: WATCH, label },
  )
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`OK: nothing clipped at ${SIZES.length} window sizes, in all three phases`)
