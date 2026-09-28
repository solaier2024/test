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
/*
 * The costume box in plate pixels. At a 1280x720 viewport the plate maps about
 * one-to-one into the scene, so the same box can be screenshotted off the live
 * page - give or take the shared camera drift, which is a handful of pixels.
 */
const COSTUME = { x: 336, y: 252, width: 528, height: 218 }
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
  // And her costume on its own, which is the thing that was drifting.
  const dress = join(DIR, `costume-${name}.png`)
  await page.screenshot({ path: dress, clip: COSTUME })
  costume[name] = dress
  return path
}

const shots = {}
const costume = {}
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
/*
 * Two things have to be held still to compare the costume across screens. The
 * grain canvas repaints over everything, and the shared camera drift scales the
 * table's plate by up to 1.6% - which against a 528px box of lace is about eight
 * pixels of offset and enough on its own to score 15. The opening's video has no
 * such transform, so the drift is switched off here to compare like with like.
 */
await page.addStyleTag({
  content: '.atmosphere { display: none !important; } .breath { animation: none !important; transform: none !important; }',
})
await page.waitForTimeout(1500)
shots.table = join(DIR, 'table.png')
await page.screenshot({ path: shots.table, clip: { x: 400, y: 20, width: 500, height: 480 } })
costume.table = join(DIR, 'costume-table.png')
await page.screenshot({ path: costume.table, clip: COSTUME })

await browser.close()

/*
 * How far apart the two live costume samples may be. Not zero: one is a VP9 frame
 * and the other a JPEG plate, and that codec difference alone measures about 1.7
 * over a box full of lace. Five separates it from a costume that has actually
 * changed, which scored nine to thirty-eight before it was locked.
 */
const COSTUME_LIMIT = 5

/** Mean absolute luma difference against the same crop of a reference plate. */
function score(shot, ref) {
  let against = ref
  // A full plate has to be cropped to the sample's geometry first; two samples of
  // the same size are compared as they are.
  if (/\.jpg$/.test(ref)) {
    against = join(DIR, `ref-${ref.split('/').pop()}.png`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', ref, '-vf',
      'scale=1280:720,crop=500:480:400:20', against])
  }
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', shot, '-i', against, '-lavfi',
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

/*
 * And the question the bug report was actually about: is she wearing the same
 * clothes at the table as she is in the opening? This compares the two live
 * samples to each other, so it needs no reference file and cannot be satisfied by
 * both of them being wrong in the same way as some plate on disk.
 */
/*
 * Sampled on the third shot, not the title card. The title is centred in the
 * viewport, which puts "DEALER'S CHOICE" directly across the costume box - and
 * that alone scored 8.2 while the costume underneath it was correct to 1.7.
 */
if (costume.intro_look && costume.table) {
  const d = score(costume.table, costume.intro_look)
  console.log('')
  console.log(`costume, opening vs table: ${d.toFixed(2)} (limit ${COSTUME_LIMIT})`)
  if (d > COSTUME_LIMIT) {
    fail.push(`the costume differs between the opening and the table (${d.toFixed(2)})`)
  }
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: the woman in the opening and the woman at the table are both the current one')
