/**
 * Captures the screens that cannot be reached without playing: the title card,
 * the table picker, and each variant mid-hand so the differences between them
 * are visible rather than just described.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { skipIntro } from './lib/skip-intro.mjs'

const OUT = process.argv[2] ?? '/tmp/shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await skipIntro(page)
await page.goto('http://localhost:5173/')
await page.waitForTimeout(2500)

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(name)
}
const click = async (name, settle = 700) => {
  await page.getByRole('button', { name }).first().click()
  await page.waitForTimeout(settle)
}

await shot('01_title_en')
await click('Español (MX)', 900)
await shot('02_title_es')
await click('English', 600)

await click('TAKE A SEAT', 900)
await shot('03_menu_straight_six')

for (const [mode, file] of [
  ['QUICK DRAW', '04_menu_quick_draw'],
  ['WIDOWMAKER', '05_menu_widowmaker'],
  ['EL PASE', '06_menu_el_pase'],
]) {
  await click(mode, 500)
  await shot(file)
}

await click('La Viuda', 1100)
await shot('07_menu_cantina')
await click('Español (MX)', 800)
await shot('08_menu_es')
await click('English', 500)

/** Sits at a table, deals a hand and holds on the first decision. */
async function playTo(mode, opponent, chamberIndex, name) {
  await click(mode, 500)
  await click(opponent, 900)
  await click('SIT DOWN', 1400)
  const chambers = page.locator('.chamberbtn')
  if (chamberIndex !== null && (await chambers.count())) {
    await chambers.nth(chamberIndex).click()
    await page.waitForTimeout(500)
  }
  await click('LOAD AND SPIN', 4200)
  // Wait for the table to hand control back before freezing the frame.
  for (let i = 0; i < 60; i++) {
    const ready = await page
      .getByRole('button', { name: 'AT YOURSELF' })
      .first()
      .isVisible()
      .catch(() => false)
    if (ready) break
    await page.waitForTimeout(400)
  }
  await shot(name)
}

await playTo('EL PASE', 'La Viuda', null, '09_table_el_pase_cantina')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await click('TAKE A SEAT', 800)
await playTo('QUICK DRAW', 'Amos Calloway', null, '10_table_quick_draw_saloon')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await click('TAKE A SEAT', 800)
await playTo('WIDOWMAKER', 'La Viuda', 2, '11_table_widowmaker_cantina')

await browser.close()
