#!/usr/bin/env node
/*
 * Is the woman in the opening the same woman as the one at the table, and is she
 * the current version of her?
 *
 * This is the check VIDEO.md argues for. A video-based product has a failure mode
 * the other scripts cannot see: every asset loads, every clip plays, the layout is
 * clean - and the character drifts, or half the build is still showing the old
 * costume. Costume changes and re-generated plates are exactly when that happens.
 *
 * It grabs her out of the live opening and off the live table, and scores both
 * against a reference plate. Pass a second reference to assert which one is
 * closer, which is how "the new costume actually shipped" gets proved rather than
 * eyeballed.
 *
 *   node scripts/verify-identity.mjs <url> <reference.jpg> [older-reference.jpg]
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
const reference = process.argv[3]
const older = process.argv[4]
if (!url || !reference) {
  console.error('usage: node scripts/verify-identity.mjs <url> <reference.jpg> [older-reference.jpg]')
  process.exit(2)
}
for (const p of [reference, older].filter(Boolean)) {
  if (!existsSync(p)) {
    console.error(`no such reference: ${p}`)
    process.exit(2)
  }
}

const DIR = '/tmp/dc-identity'
mkdirSync(DIR, { recursive: true })
const fail = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
if (await notice.count()) {
  await notice.first().click()
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 })
}

/*
 * Her two appearances in the opening are the third shot and the last one. Seeking
 * the element rather than waiting through it keeps this quick and, more to the
 * point, makes the sample land on a known shot instead of wherever playback
 * happened to be.
 */
async function grabIntro(at, name) {
  const ok = await page.evaluate(async (t) => {
    const v = document.querySelector('.intro-video')
    if (!v) return false
    v.pause()
    v.currentTime = t
    await new Promise((r) => {
      const done = () => {
        v.removeEventListener('seeked', done)
        r()
      }
      v.addEventListener('seeked', done)
      setTimeout(r, 2500)
    })
    return true
  }, at)
  if (!ok) return null
  const path = join(DIR, `${name}.png`)
  // Only her half of the frame: the room behind her is identical in both
  // versions, so including it would wash the comparison out.
  await page.screenshot({ path, clip: { x: 400, y: 20, width: 500, height: 480 } })
  return path
}

const shots = {}
if (await page.locator('.intro-video').count()) {
  shots.intro_look = await grabIntro(5.4, 'intro_look')
  shots.intro_title = await grabIntro(11.4, 'intro_title')
  await page.locator('.chrome.skip').click()
} else {
  console.log('note:          the opening had already been seen, replaying it')
  await page.waitForSelector('.title-page')
  await page.getByRole('button', { name: /WATCH THE OPENING|VER LA APERTURA/ }).click()
  await page.waitForSelector('.intro-video')
  shots.intro_look = await grabIntro(5.4, 'intro_look')
  shots.intro_title = await grabIntro(11.4, 'intro_title')
  await page.locator('.chrome.skip').click()
}

await page.waitForSelector('.title-page', { timeout: 30000 })
await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page')
// The grain canvas sits over everything and would be counted as difference.
await page.addStyleTag({ content: '.atmosphere { display: none !important; }' })
await page.waitForTimeout(1500)
shots.table = join(DIR, 'table.png')
await page.screenshot({ path: shots.table, clip: { x: 400, y: 20, width: 500, height: 480 } })

await browser.close()

/** Mean absolute luma difference against the same crop of a reference plate. */
function score(shot, ref) {
  const crop = join(DIR, `ref-${ref.split('/').pop()}.png`)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', ref, '-vf',
    'scale=1280:720,crop=500:480:400:20', crop])
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', shot, '-i', crop, '-lavfi',
    '[0][1]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const m = /YAVG=([0-9.]+)/.exec(out)
  return m ? Number(m[1]) : NaN
}

console.log('')
for (const [name, shot] of Object.entries(shots)) {
  if (!shot) {
    fail.push(`could not sample ${name}`)
    continue
  }
  const now = score(shot, reference)
  const then = older ? score(shot, older) : null
  const line = older
    ? `${name.padEnd(12)} vs current ${now.toFixed(2).padStart(6)}   vs previous ${then.toFixed(2).padStart(6)}`
    : `${name.padEnd(12)} vs current ${now.toFixed(2).padStart(6)}`
  console.log(line)

  // Absolute closeness is not the assertion - lighting and pose differ shot to
  // shot. What has to hold is that she is nearer the current plate than the old
  // one, which is only false if some of the build is still on the old assets.
  if (older && !(now < then * 0.85)) {
    fail.push(`${name} is not clearly closer to the current plate (${now.toFixed(2)} vs ${then.toFixed(2)})`)
  }
  if (now > 40) fail.push(`${name} is a long way from the reference (${now.toFixed(2)})`)
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: the woman in the opening and the woman at the table are both the current one')
