#!/usr/bin/env node
/*
 * Renders the score to WAV files so it can actually be listened to.
 *
 * The music is synthesised in the browser at runtime, which means there is
 * nothing to open in an editor and nothing to diff. This loads the page from a
 * running server and taps the real audio graph - the same modules the game uses,
 * not a second copy written for testing - then writes what came out to disk.
 *
 *   node scripts/render-score.mjs [outdir] [url]
 *
 * Note that her spoken lines are NOT in these files. Speech synthesis is a
 * platform service outside WebAudio, so it cannot be captured this way; only the
 * coo underneath it is here, because that part is synthesised like everything
 * else. verify-audio.mjs is what proves the words fire.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { skipIntro } from './lib/skip-intro.mjs'

const OUT = process.argv[2] ?? '/tmp/dc-score'
const url = process.argv[3] ?? 'http://127.0.0.1:5180/'
mkdirSync(OUT, { recursive: true })

/** Interleaved float samples to a 16-bit PCM WAV. */
function wav(channels, rate) {
  const n = channels[0].length
  const ch = channels.length
  const buf = Buffer.alloc(44 + n * ch * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * ch * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * ch * 2, 28)
  buf.writeUInt16LE(ch * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  // The data chunk's own length. Leaving this at zero writes a file every tool
  // reads as valid and empty, which is a very quiet kind of wrong.
  buf.writeUInt32LE(n * ch * 2, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]))
      buf.writeInt16LE(Math.round(v * 32767), o)
      o += 2
    }
  }
  return buf
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await skipIntro(page, url)
await page.waitForSelector('.title-page', { timeout: 20000 })

/*
 * A recorder spliced onto the real graph. A MediaStreamDestination taps the live
 * AudioContext, so this captures the arrangement as the game is actually playing
 * it - including whatever the mood parameters happen to be doing.
 */
await page.evaluate(() => {
  const g = window
  g.__cap = {
    start(seconds) {
      return new Promise((resolve) => {
        const mod = g.__audio
        const ctx = mod.ctx()
        const dest = ctx.createMediaStreamDestination()
        mod.tap(dest)
        const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' })
        const chunks = []
        rec.ondataavailable = (e) => chunks.push(e.data)
        rec.onstop = async () => {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const ab = await blob.arrayBuffer()
          const decoded = await new (g.OfflineAudioContext ?? g.webkitOfflineAudioContext)(
            2,
            1,
            ctx.sampleRate,
          ).decodeAudioData(ab)
          resolve({
            rate: decoded.sampleRate,
            left: [...decoded.getChannelData(0)],
            right: [...decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0)],
          })
        }
        rec.start()
        setTimeout(() => rec.stop(), seconds * 1000)
      })
    },
  }
})

const hasTap = await page.evaluate(() => Boolean(window.__audio && window.__audio.tap))
if (!hasTap) {
  console.error('the page does not expose an audio tap; build with the debug hook in engine.ts')
  await browser.close()
  process.exit(2)
}

async function capture(name, seconds, setup) {
  if (setup) await setup()
  const got = await page.evaluate((s) => window.__cap.start(s), seconds)
  const file = join(OUT, `${name}.wav`)
  writeFileSync(file, wav([Float32Array.from(got.left), Float32Array.from(got.right)], got.rate))
  // Spreading a few hundred thousand samples into Math.max blows the stack.
  let peak = 0
  let sum = 0
  for (const v of got.left) {
    const a = Math.abs(v)
    if (a > peak) peak = a
    sum += v * v
  }
  const rms = Math.sqrt(sum / got.left.length)
  console.log(
    `${name.padEnd(14)} ${seconds}s  peak ${(20 * Math.log10(peak || 1e-9)).toFixed(1)} dBFS  rms ${(20 * Math.log10(rms || 1e-9)).toFixed(1)} dBFS  -> ${file}`,
  )
  return { peak, rms }
}

await page.evaluate(() => window.__audio.unlock())
await page.waitForTimeout(500)

await capture('title', 6)

await page.getByRole('button', { name: /FIND A TABLE|BUSCAR MESA/ }).click()
await page.waitForSelector('.tables-page')
await page.locator('.table-card').nth(1).getByRole('button').click()
await page.waitForSelector('.table-page')
await page.waitForTimeout(600)

// Cold shoe, her being professional: the minor.
await capture('table_cold', 10, async () => {
  await page.evaluate(() => window.__audio.mood({ edge: 0.1, heat: 0, warmth: 0.2 }))
  await page.waitForTimeout(400)
})

// Count running your way and she has warmed up: the major, full arrangement.
await capture('table_hot', 10, async () => {
  await page.evaluate(() => window.__audio.mood({ edge: 1, heat: 0.2, warmth: 0.95 }))
  await page.waitForTimeout(400)
})

// The turnaround she plays over a shuffle.
await capture('shuffle_seam', 9, async () => {
  await page.evaluate(() => {
    window.__audio.mood({ edge: 0.8, heat: 0, warmth: 0.5 })
    window.__audio.seam()
  })
})

// And the opening, from the top.
await capture('opening', 13, async () => {
  await page.evaluate(() => window.__audio.intro(0))
})

await browser.close()
console.log(`\n-> ${OUT}`)
