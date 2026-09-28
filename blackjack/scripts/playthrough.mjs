#!/usr/bin/env node
/*
 * Walks a real browser through a long session and checks the things a
 * screenshot cannot: that the loop never wedges, that the chip ledger adds up
 * across dozens of hands, that no console error ever fires, and that every
 * control stays inside the viewport at a usable size.
 *
 *   node scripts/playthrough.mjs [url] [hands]
 *
 * Checking only the final state is useless - that is exactly how a control that
 * falls off the bottom of a phone halfway through a hand stays green.
 */
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { skipIntro } from './lib/skip-intro.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'
const hands = Number(process.argv[3] ?? 40)
const OUT = '/tmp/dc-shots'
mkdirSync(OUT, { recursive: true })

const fail = []
const note = (m) => console.log(`  ${m}`)

async function chips(page) {
  const txt = await page.locator('.money b').first().innerText()
  return Number(txt.replace(/[^0-9-]/g, ''))
}

async function clickIfVisible(page, selector) {
  const el = page.locator(selector).first()
  if ((await el.count()) === 0) return false
  if (!(await el.isVisible())) return false
  if (await el.isDisabled()) return false
  await el.click({ timeout: 4000 })
  return true
}

/**
 * Every control has to be reachable and hittable. Each one is scrolled to and
 * then measured on its own: a carousel pushes its siblings off screen on purpose,
 * so measuring them all after scrolling to the last one reports nonsense.
 */
async function auditLayout(page, label) {
  const bad = []
  const buttons = page.locator('button')
  const n = await buttons.count()
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i)
    if (!(await b.isVisible().catch(() => false))) continue
    await b.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {})
    const r = await b.boundingBox().catch(() => null)
    if (!r) continue
    const text = ((await b.innerText().catch(() => '')) || '').trim().slice(0, 24)
    const vp = page.viewportSize()
    if (r.y + r.height > vp.height + 1 || r.y < -1 || r.x + r.width > vp.width + 1 || r.x < -1) {
      bad.push(`offscreen after scrolling: "${text}" at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    if (r.height < 40) bad.push(`small: "${text}" is ${Math.round(r.height)}px tall`)
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) {
    bad.push('horizontal scroll on the document')
  }
  for (const b of bad) fail.push(`[${label}] ${b}`)
  return bad.length === 0
}

async function run(name, device, handCount, tableIndex = 1, wantShuffle = false) {
  console.log(`\n=== ${name} ===`)
  const browser = await chromium.launch()
  const page = await browser.newPage({ ...device })
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await skipIntro(page, url)
  await page.waitForSelector('.title-page', { timeout: 15000 })
  await auditLayout(page, `${name} title`)
  await page.screenshot({ path: join(OUT, `${name}-title.jpg`), quality: 80, type: 'jpeg' })

  await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
  await page.waitForSelector('.tables-page')
  await auditLayout(page, `${name} tables`)
  await page.screenshot({ path: join(OUT, `${name}-tables.jpg`), quality: 80, type: 'jpeg' })

  const tableCount = await page.locator('.table-card').count()
  if (tableCount !== 3) fail.push(`[${name}] expected 3 tables, found ${tableCount}`)

  await page.locator('.table-card').nth(tableIndex).getByRole('button').click()
  await page.waitForSelector('.table-page', { timeout: 10000 })
  await auditLayout(page, `${name} table`)

  let played = 0
  let calls = 0
  let caught = 0
  let ledgerChecks = 0
  let shuffles = 0

  for (let i = 0; i < handCount; i++) {
    // Phase: betting. The stack has to be read *before* the stake leaves it,
    // otherwise this measures the payout and calls a correct ledger wrong.
    const before = await chips(page)
    const dealt = await clickIfVisible(page, '[data-act="deal"]')
    if (!dealt) {
      // Might be mid-shuffle or over; give it a moment and look again.
      await page.waitForTimeout(1400)
      if (await page.locator('.over').count()) {
        note(`session ended after ${played} hands (${await page.locator('.over h2').innerText()})`)
        break
      }
      if (!(await clickIfVisible(page, '[data-act="deal"]'))) {
        fail.push(`[${name}] nothing to press on hand ${i + 1}`)
        break
      }
    }

    await page.waitForTimeout(1000)

    // Occasionally lean on her and call, to exercise both outcomes.
    if (i % 5 === 2) {
      await clickIfVisible(page, '[data-act="lean"]')
      await page.waitForTimeout(220)
    }
    if (i % 7 === 3) {
      if (await clickIfVisible(page, '[data-act="call"]')) calls++
      await page.waitForTimeout(700)
    }

    // Phase: player. Hit while low, then stand.
    for (let guard = 0; guard < 12; guard++) {
      if (!(await page.locator('[data-act="hit"]').count())) break
      const mine = await page.locator('.hand.player .hand-label b').first().innerText()
      const score = Number(mine)
      if (Number.isFinite(score) && score < 17) {
        if (!(await clickIfVisible(page, '[data-act="hit"]'))) break
      } else {
        await clickIfVisible(page, '[data-act="stand"]')
        break
      }
      await page.waitForTimeout(420)
    }

    await page.waitForSelector('.banner, .over', { timeout: 12000 })
    if (await page.locator('.over').count()) {
      note(`session ended after ${played} hands`)
      break
    }

    const head = await page.locator('.banner strong').innerText()
    if (/CAUGHT HER|LA CACHASTE/.test(head)) caught++

    const after = await chips(page)
    const bannerNet = (await page.locator('.banner span').count())
      ? Number((await page.locator('.banner span').innerText()).replace(/[^0-9-]/g, ''))
      : 0
    // She sometimes buys a rule and pays the table for it; that fee is income on
    // top of the hand, and the chip on the felt says how much it was.
    const fee = (await page.locator('.house-call b').count())
      ? Number(await page.locator('.house-call b').first().getAttribute('data-fee'))
      : 0
    if (after - before !== bannerNet + fee) {
      fail.push(`[${name}] hand ${i + 1}: stack moved ${after - before} but the table said ${bannerNet} (+${fee} rule fee)`)
    } else {
      ledgerChecks++
    }

    if (i % 9 === 4) await auditLayout(page, `${name} hand ${i + 1}`)
    if (i === 3) await page.screenshot({ path: join(OUT, `${name}-hand.jpg`), quality: 80, type: 'jpeg' })

    await clickIfVisible(page, '[data-act="next"]')
    await page.waitForTimeout(260)
    if (await page.locator('.note-line', { hasText: /shuffl|baraj/i }).count()) shuffles++
    played++
  }

  note(`hands played: ${played}`)
  note(`ledger checks passed: ${ledgerChecks}`)
  note(`calls made: ${calls}, of which right: ${caught}`)
  note(`shuffles seen: ${shuffles}`)
  note(`console errors: ${errors.length}`)
  for (const e of errors.slice(0, 5)) fail.push(`[${name}] console: ${e}`)
  if (played < Math.min(12, handCount)) fail.push(`[${name}] only got through ${played} hands`)
  // The shuffle is the seam the score turns its phrase over on, so at least one
  // table has to actually reach the cut card inside a normal session.
  if (wantShuffle && shuffles === 0) fail.push(`[${name}] never reached the cut card in ${played} hands`)

  await page.screenshot({ path: join(OUT, `${name}-late.jpg`), quality: 80, type: 'jpeg' })
  await browser.close()
}

// The middle table sells rules, so it exercises the most machinery.
await run('desktop', { viewport: { width: 1440, height: 900 } }, hands, 1)
await run('iphone', devices['iPhone 14'], Math.min(14, hands), 1)
// One deck reaches the cut card inside a dozen hands, which is the only way to
// see the shuffle - and the shuffle is what the score hangs its form on.
await run('single-deck', { viewport: { width: 1440, height: 900 } }, 16, 0, true)

console.log('')
if (fail.length) {
  console.log(`FAILED with ${fail.length} problem(s):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`OK: loop holds, ledger balances, layout clean, no console errors. Shots in ${OUT}`)
