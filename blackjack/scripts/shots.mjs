#!/usr/bin/env node
/*
 * Screenshots of every screen and a few mid-hand states, in both languages and
 * at both layouts. Used for eyeballing composition, which is the one thing the
 * automated audit in playthrough.mjs cannot do.
 *
 *   node scripts/shots.mjs [outdir] [url]
 */
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { skipIntro } from './lib/skip-intro.mjs'

const OUT = process.argv[2] ?? '/tmp/dc-shots'
const url = process.argv[3] ?? 'http://127.0.0.1:5180/'
mkdirSync(OUT, { recursive: true })

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.jpg`), quality: 88, type: 'jpeg' })

async function toTable(page, tableIndex = 1) {
  await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
  await page.waitForSelector('.tables-page')
  await page.locator('.table-card').nth(tableIndex).getByRole('button').click()
  await page.waitForSelector('.table-page')
}

for (const [label, device] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['wide', { viewport: { width: 1920, height: 1080 } }],
  ['portrait', devices['iPhone 14']],
]) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ ...device })
  await skipIntro(page, url)

  await page.waitForSelector('.title-page')
  await page.waitForTimeout(700)
  await shot(page, `${label}-1-title`)

  await toTable(page)
  await page.waitForTimeout(500)
  await shot(page, `${label}-2-seated`)

  // Deal, then catch it mid-hand with cards on the felt.
  await page.locator('[data-act="deal"]').click()
  await page.waitForTimeout(1300)
  await shot(page, `${label}-3-hand`)

  // Hit twice to get a wider hand on the felt and check the row still fits.
  for (let i = 0; i < 2; i++) {
    const a = page.locator('[data-act="hit"]')
    if ((await a.count()) && !(await a.isDisabled())) {
      await a.click()
      await page.waitForTimeout(520)
    }
  }
  await shot(page, `${label}-4-wide-hand`)

  // Leaning in: the readouts dim, the frame closes, the hint changes.
  const lean = page.locator('[data-act="lean"]')
  if (await lean.count()) {
    await lean.dispatchEvent('pointerdown')
    await page.waitForTimeout(700)
    await shot(page, `${label}-5-leaning`)
    await lean.dispatchEvent('pointerup')
  }

  // Play it out to a settled banner.
  for (let i = 0; i < 8; i++) {
    if (await page.locator('.banner').count()) break
    const stand = page.locator('[data-act="stand"]')
    if ((await stand.count()) && !(await stand.isDisabled())) await stand.click()
    await page.waitForTimeout(700)
  }
  await shot(page, `${label}-6-settled`)

  // And the picker in Spanish.
  await page.locator('.chrome.leave').click()
  await page.waitForSelector('.tables-page')
  await page.locator('.chrome.lang').click()
  await page.waitForTimeout(400)
  await shot(page, `${label}-7-tables-es`)

  await browser.close()
  console.log(`${label}: 7 shots`)
}
console.log(`-> ${OUT}`)
