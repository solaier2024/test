/**
 * Captures the screens that cannot be reached without playing: the title card,
 * the table picker in both languages, and a sealed cylinder mid-hand.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = process.argv[2] ?? '/tmp/shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://127.0.0.1:5173/')
await page.waitForTimeout(2500)

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(name)
}

await shot('01-title-en')

await page.getByRole('button', { name: 'Español (MX)' }).click()
await page.waitForTimeout(700)
await shot('02-title-es')

await page.getByRole('button', { name: 'English' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'TAKE A SEAT' }).click()
await page.waitForTimeout(900)
await shot('03-menu-classic')

for (const [mode, file] of [
  ['QUICK DRAW', '04-menu-quickdraw'],
  ['WIDOWMAKER', '05-menu-widowmaker'],
  ['EL PASE', '06-menu-elpase'],
]) {
  await page.getByRole('button', { name: mode }).click()
  await page.waitForTimeout(450)
  await shot(file)
}

await page.getByRole('button', { name: 'La Viuda' }).click()
await page.waitForTimeout(900)
await shot('07-menu-viuda-cantina')

await page.getByRole('button', { name: 'Español (MX)' }).click()
await page.waitForTimeout(600)
await shot('08-menu-es')

await page.getByRole('button', { name: 'English' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'SIT DOWN' }).click()
await page.waitForTimeout(1200)
await shot('09-table-load-cantina')

await page.getByRole('button', { name: 'LOAD AND SPIN' }).click()
await page.waitForTimeout(4000)
await shot('10-table-betting-cantina')

await browser.close()
