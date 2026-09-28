/**
 * Plays every table in a real browser and checks the rules the engine tests
 * cannot see: what the HUD says while it says it, and which buttons are
 * reachable at the moment the cylinder stops offering a choice.
 *
 * A sampler runs inside the page on every frame, so states that exist for a
 * few hundred milliseconds - the forced last shot in particular - are caught
 * rather than missed between polls.
 *
 * Usage: node scripts/audit-modes.mjs [baseUrl] [outDir] [onlyTheseModes]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { skipIntro } from './lib/skip-intro.mjs'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/'
const OUT = process.argv[3] ?? '/tmp/audit'
mkdirSync(OUT, { recursive: true })

/** Labels that must never be offered while the next chamber cannot miss. */
const LOSING = ['AT YOURSELF', 'PASS THE IRON', 'CALL']

/**
 * Every table plays until it has both dealt `least` hands, for the spread of
 * odds, and reached a chamber that cannot miss, which is the state the audit
 * exists for. Where the load is the player's, the audit takes the heaviest
 * one: it is the shortest road to a full cylinder and so to the certainty.
 */
const TABLES = [
  { mode: 'STRAIGHT SIX', who: 'Amos Calloway', least: 6, most: 30 },
  { mode: 'QUICK DRAW', who: 'Amos Calloway', least: 8, most: 30 },
  { mode: 'WIDOWMAKER', who: 'Amos Calloway', least: 6, most: 30 },
  { mode: 'EL PASE', who: 'La Viuda', least: 6, most: 30 },
]

const install = () => {
  const seen = new Map()
  const sample = () => {
    const hud = document.querySelector('.hud')
    if (hud) {
      const odds = document.querySelector('.readout__oddsValue')?.textContent?.trim() ?? '-'
      const buttons = [...document.querySelectorAll('.actions .btn')]
        .filter((b) => b.offsetParent !== null && !b.disabled)
        .map((b) => b.firstChild?.textContent?.trim() ?? b.textContent.trim())
        .sort()
      const caption = document.querySelector('.caption')?.textContent?.trim() ?? ''
      const key = `${odds}|${buttons.join(',')}`
      if (!seen.has(key)) seen.set(key, { odds, buttons, caption })
      if (caption) window.__captions.add(caption)
      const title = document.querySelector('.loadpanel__title')?.textContent?.trim()
      if (title) {
        const choices = document.querySelectorAll('.chamberbtn').length
        window.__load.add(`${choices} choices | ${title}`)
      }
    }
    requestAnimationFrame(sample)
  }
  window.__seen = seen
  window.__captions = new Set()
  window.__load = new Set()
  requestAnimationFrame(sample)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await skipIntro(page)

const problems = []
const report = []

// A full pass is slow, because it is playing real hands at the table's own
// pace. Naming a table re-checks just that one after a change.
const only = process.argv[4]?.split(',').map((s) => s.trim().toUpperCase())

for (const table of TABLES.filter((t) => !only || only.includes(t.mode))) {
  await page.goto(BASE)
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: 'TAKE A SEAT' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: table.mode }).first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: table.who }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'SIT DOWN' }).click()
  await page.waitForTimeout(1200)
  await page.evaluate(install)

  /** Clicks the first of these that is on screen, or reports none. */
  const tap = async (...labels) => {
    for (const label of labels) {
      const btn = page.getByRole('button', { name: label, exact: false }).first()
      if (await btn.isVisible().catch(() => false)) {
        await btn.click()
        return label
      }
    }
    return null
  }

  const slug = table.mode.toLowerCase().replace(/ /g, '-')
  const reachedCertainty = () =>
    page.evaluate(() => [...window.__seen.keys()].some((k) => k.startsWith('100%')))

  let hands = 0
  let idle = 0
  let caught = false
  while (idle < 60) {
    /*
     * The forced shot holds its caption for most of a second and offers no
     * buttons at all, so the only place to photograph it is here, before the
     * loop decides there is nothing to click and goes back to waiting.
     */
    if (!caught) {
      // Read the DOM rather than using a locator: a locator would wait for a
      // caption to appear, and most of the time there is not one to wait for.
      const line = await page.evaluate(() => document.querySelector('.caption')?.textContent ?? '')
      if (/nothing left to decide/i.test(line)) {
        await page.screenshot({ path: `${OUT}/${slug}-forced.png` })
        caught = true
      }
    }

    if (hands >= table.least && (await reachedCertainty())) break
    if (hands >= table.most) break

    const heaviest = page.locator('.chamberbtn').last()
    if (await heaviest.isVisible().catch(() => false)) await heaviest.click()

    // Preferring the self shot walks the cylinder down to its last chamber,
    // which is the state this whole audit exists to reach.
    const took = await tap(
      'LOAD AND SPIN',
      'AT YOURSELF',
      'ACROSS THE TABLE',
      'END IT',
      'CALL ',
      'NEXT HAND',
      'DEAL AGAIN',
    )
    if (took === 'LOAD AND SPIN') hands++
    if (took === null) {
      idle++
      await page.waitForTimeout(250)
      continue
    }
    idle = 0
    await page.waitForTimeout(320)
  }

  const { states, captions, loadPanels } = await page.evaluate(() => ({
    states: [...window.__seen.values()],
    captions: [...window.__captions],
    loadPanels: [...window.__load],
  }))

  const certain = states.filter((s) => s.odds === '100%')
  for (const s of certain) {
    const offered = s.buttons.filter((b) => LOSING.some((l) => b.startsWith(l)))
    if (offered.length) {
      problems.push(`${table.mode}: offered ${offered.join(', ')} at 100%`)
    }
  }
  // Which chambers a hand reaches is luck, so a pass that never got to a full
  // cylinder checked nothing and has to say so rather than read as a pass.
  if (!certain.length) {
    problems.push(`${table.mode}: no hand reached a certain chamber - deal more hands`)
  }
  const forcedShots = captions.filter((c) => /nothing left to decide/i.test(c)).length
  for (const panel of loadPanels) {
    if (/^0 choices \| How many live rounds go in\?/.test(panel)) {
      problems.push(`${table.mode}: load panel asks the question with no answers`)
    }
  }

  report.push({
    mode: table.mode,
    hands,
    states,
    sawCertainChamber: certain.length > 0,
    buttonsAtCertainty: [...new Set(certain.flatMap((s) => s.buttons))],
    forcedLastShot: forcedShots > 0,
    loadPanels,
  })
  await page.screenshot({ path: `${OUT}/${slug}.png` })
}

await browser.close()

for (const r of report) {
  console.log(
    `\n${r.mode}  ${r.hands} hands dealt, ${r.states.length} distinct states\n` +
      `  reached a certain chamber: ${r.sawCertainChamber ? 'yes' : 'NO - audit proved nothing'}\n` +
      `  fired the last shot itself: ${r.forcedLastShot ? 'yes' : 'no'}\n` +
      `  offered at 100%: ${r.buttonsAtCertainty.length ? r.buttonsAtCertainty.join(', ') : 'nothing'}`,
  )
  for (const panel of r.loadPanels) console.log(`  load panel: ${panel}`)
  // Printing every state is the evidence that the sampler saw the buttons at
  // all, which is the only thing that makes the empty 100% row mean anything.
  for (const s of r.states.sort((a, b) => a.odds.localeCompare(b.odds))) {
    console.log(`    ${s.odds.padStart(4)}  ${s.buttons.join(' / ') || '(no controls)'}`)
  }
}

if (problems.length) {
  console.error('\nFAIL\n' + problems.map((p) => `  ${p}`).join('\n'))
  process.exit(1)
}
console.log('\nNo table offered a losing move against a chamber that cannot miss.')
