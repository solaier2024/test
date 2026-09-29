#!/usr/bin/env node
/*
 * Listening-shaped assertions about what actually reaches the output.
 *
 * "It should sound hotter" is not testable, but the things that make it sound
 * hotter are: how many rhythmic events land per second, how bright the mix is,
 * how loud it runs, whether the harmony moves when her mood does, and whether
 * she actually speaks. All of those are numbers, so all of them are asserted
 * here rather than left to somebody's ear.
 *
 * The level and spectrum come off the WAVs that render-score.mjs captures from
 * the live graph. Her spoken lines are checked separately, in the page, by
 * counting calls into the platform speech synthesiser - which is the only way,
 * because speech is outside WebAudio and cannot be recorded with the music.
 *
 *   node scripts/verify-audio.mjs [url]
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { skipIntro } from './lib/skip-intro.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'
const SCORE = '/tmp/dc-audio'
mkdirSync(SCORE, { recursive: true })

const fail = []

/* --------------------------------------------------- the band, off the wire */

console.log('rendering the live graph to wav')
execFileSync('node', [join(import.meta.dirname, 'render-score.mjs'), SCORE, url], { stdio: 'pipe' })

/** Decodes a 16-bit PCM wav without pulling in a dependency for it. */
function readWav(path) {
  const b = readFileSync(path)
  const channels = b.readUInt16LE(22)
  const rate = b.readUInt32LE(24)
  let o = 12
  let size = 0
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4)
    const len = b.readUInt32LE(o + 4)
    if (id === 'data') {
      size = len
      o += 8
      break
    }
    o += 8 + len
  }
  if (!size) throw new Error(`${path}: no data chunk`)
  const frames = Math.floor(size / 2 / channels)
  const x = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += b.readInt16LE(o + (i * channels + c) * 2) / 32768
    x[i] = sum / channels
  }
  return { x, rate }
}

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
      }
    }
  }
}

function spectrum(frame) {
  const n = frame.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  fft(re, im)
  const half = n / 2
  const mag = new Float64Array(half)
  for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k])
  return mag
}

/** Spectral-flux onsets per second: how much is happening. */
function onsetRate({ x, rate }) {
  const win = 1024
  const hop = 256
  let prev = null
  const flux = []
  for (let i = 0; i + win < x.length; i += hop) {
    const mag = spectrum(x.subarray(i, i + win))
    if (prev) {
      let f = 0
      for (let k = 0; k < mag.length; k++) f += Math.max(0, mag[k] - prev[k])
      flux.push(f)
    }
    prev = mag
  }
  const mean = flux.reduce((a, v) => a + v, 0) / flux.length
  const sd = Math.sqrt(flux.reduce((a, v) => a + (v - mean) ** 2, 0) / flux.length)
  const th = mean + sd * 0.9
  let hits = 0
  let last = -9
  flux.forEach((f, i) => {
    const t = (i * hop) / rate
    if (f > th && t - last > 0.055) {
      hits++
      last = t
    }
  })
  return hits / (x.length / rate)
}

/** Spectral centroid: how bright the mix sits. */
function centroid({ x, rate }) {
  const win = 4096
  let tot = 0
  let sum = 0
  for (let i = 0; i + win < x.length; i += win) {
    const mag = spectrum(x.subarray(i, i + win))
    for (let k = 1; k < mag.length; k++) {
      tot += mag[k] * ((k * rate) / win)
      sum += mag[k]
    }
  }
  return sum ? tot / sum : 0
}

function levels({ x }) {
  let peak = 0
  let sq = 0
  for (const v of x) {
    const a = Math.abs(v)
    if (a > peak) peak = a
    sq += v * v
  }
  return { peak: 20 * Math.log10(peak || 1e-9), rms: 20 * Math.log10(Math.sqrt(sq / x.length) || 1e-9) }
}

/*
 * A cantina band, not a bed of atmosphere. These floors are what the arrangement
 * has to clear to be one: six rhythmic events a second at the table, a mix
 * bright enough that the accordion and the palmas are in front of the room
 * rather than behind it, and a level you can hear under a conversation.
 */
const WANT = {
  title: { onsets: 3.0, centroid: 1100, rms: -38 },
  table_cold: { onsets: 5.0, centroid: 1600, rms: -34 },
  table_hot: { onsets: 5.0, centroid: 1700, rms: -32 },
  shuffle_seam: { onsets: 4.5, centroid: 1600, rms: -32 },
  opening: { onsets: 4.5, centroid: 1600, rms: -32 },
}

const got = {}
console.log('')
for (const [name, want] of Object.entries(WANT)) {
  const file = join(SCORE, `${name}.wav`)
  if (!existsSync(file)) {
    fail.push(`${name}.wav was not rendered`)
    continue
  }
  const w = readWav(file)
  const o = onsetRate(w)
  const c = centroid(w)
  const { peak, rms } = levels(w)
  got[name] = { o, c, rms, peak }
  console.log(
    `${name.padEnd(14)} onsets/s ${o.toFixed(1).padStart(5)} (>=${want.onsets})   centroid ${c.toFixed(0).padStart(5)} Hz (>=${want.centroid})   rms ${rms.toFixed(1).padStart(6)} dBFS (>=${want.rms})   peak ${peak.toFixed(1)} dBFS`,
  )
  if (o < want.onsets) fail.push(`${name}: only ${o.toFixed(1)} onsets/s, wanted ${want.onsets}`)
  if (c < want.centroid) fail.push(`${name}: centroid ${c.toFixed(0)} Hz is duller than ${want.centroid} Hz`)
  if (rms < want.rms) fail.push(`${name}: ${rms.toFixed(1)} dBFS is quieter than ${want.rms} dBFS`)
  if (peak > -1) fail.push(`${name}: peak ${peak.toFixed(1)} dBFS is clipping`)
}

// A full arrangement has to be audibly bigger than a thin one, or the mood knobs
// are not doing anything.
if (got.table_hot && got.table_cold && !(got.table_hot.rms > got.table_cold.rms + 1)) {
  fail.push(
    `a hot shoe is not louder than a cold one (${got.table_hot.rms.toFixed(1)} vs ${got.table_cold.rms.toFixed(1)} dBFS)`,
  )
}

/* ------------------------------------------------------------- her voice */

console.log('\nchecking that she speaks')
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

/*
 * A headless browser normally has no speech voices installed, so `speak()` makes
 * no sound there. What can be proved is that the game asks for the right words at
 * the right moments, which is what this records.
 */
await page.addInitScript(() => {
  const said = []
  window.__said = said
  const real = window.speechSynthesis?.speak?.bind(window.speechSynthesis)
  if (window.speechSynthesis) {
    window.speechSynthesis.speak = (u) => {
      said.push({ at: performance.now(), text: u.text, pitch: u.pitch, rate: u.rate, volume: u.volume, lang: u.lang })
      try {
        real?.(u)
      } catch {
        /* no voices installed */
      }
    }
  }
})
await skipIntro(page, url)
await page.waitForSelector('.title-page', { timeout: 20000 })
await page.evaluate(() => window.__audio.unlock())
await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page')
await page.waitForTimeout(1600)

const dealtAt = await page.evaluate(() => performance.now())
await page.locator('[data-act="deal"]').click()
await page.waitForTimeout(2600)
for (let i = 0; i < 8; i++) {
  if (await page.locator('.banner').count()) break
  const stand = page.locator('[data-act="stand"]')
  if (await stand.count()) await stand.click()
  await page.waitForTimeout(900)
}
await page.waitForTimeout(1800)

const said = await page.evaluate(() => window.__said ?? [])
const voices = await page.evaluate(() => window.__audio.voices())
await browser.close()

console.log(`voices installed: ${voices ? 'yes' : 'no (headless; the coo still plays)'}`)
for (const s of said) {
  const when = `${((s.at - dealtAt) / 1000).toFixed(1)}s`.padStart(6)
  console.log(`  ${when}  "${s.text}"  pitch ${s.pitch}  rate ${s.rate}  volume ${s.volume}  ${s.lang}`)
}

const NUMBERS = /zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci|veinte/i

/*
 * The deal line is asserted by WHEN it was said, not by its wording. This used to
 * be a copy of the phrase list: 'Let\u2019s see, then.' was added to the table in
 * src/audio/voice.ts without being added here, and 'm\u00edrame' stayed behind from
 * the removed call-out lines, so the gate failed on one deal in four at random and
 * the failure said nothing was spoken when the transcript printed right above it
 * showed that she had spoken. A window around the click cannot drift when someone
 * rewrites the copy, and it is the thing actually worth holding: she talks to you
 * as the cards land. The card beats run to 700ms, so 2.5s is generous but still
 * excludes anything said later in the hand.
 */
const SPEAKS_WITHIN = 2500
if (said.length < 3) fail.push(`she only spoke ${said.length} time(s) in a whole hand`)
if (!said.some((s) => s.at >= dealtAt && s.at <= dealtAt + SPEAKS_WITHIN)) {
  fail.push(`nothing was said in the ${SPEAKS_WITHIN}ms after the cards came out`)
}
if (!said.some((s) => NUMBERS.test(s.text))) fail.push('no total was ever called')
// High and unhurried is the whole character of the voice; flat defaults are not it.
for (const s of said) {
  if (s.pitch < 1.4) fail.push(`"${s.text}" was spoken at pitch ${s.pitch}, which is not her`)
  if (s.rate > 1) fail.push(`"${s.text}" was spoken at rate ${s.rate}, too brisk`)
  // Under the band, deliberately.
  if (s.volume > 0.85) fail.push(`"${s.text}" at volume ${s.volume} would sit on top of the music`)
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`OK: the band plays hot at ${got.table_hot.o.toFixed(1)} onsets/s and ${got.table_hot.c.toFixed(0)} Hz,`)
console.log(`    and she calls the cards and the totals. Wavs in ${SCORE}`)
