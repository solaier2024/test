#!/usr/bin/env node
/*
 * Can you still open the URL and play?
 *
 * VIDEO.md section 7 asked for this check and said why. The one genuinely
 * impressive claim this project makes is that a stranger opens a link and is
 * playing seconds later, and a video base is the thing most likely to take that
 * away quietly - the assets grow, everyone testing has a fast connection, and
 * nobody notices until it is someone else's phone. It also said not to trust
 * discipline about it: 超了就判失败,不靠自觉.
 *
 * WHY BYTES ALONE ARE THE WRONG QUESTION. The first version of this script counted
 * transferred bytes on localhost and reported 7.6 MB before the first frame. That
 * number was true and almost useless, because on a loopback interface the browser
 * finishes downloading a 6 MB file long before it has decided to start playing it:
 * what was really being measured was how eagerly Chromium prefetches, not what a
 * player waits for. A budget built on it would have been satisfied by making the
 * browser lazier rather than the site lighter.
 *
 * So this measures the thing itself, under a throttle, twice:
 *
 *   THE THIN PATH is the promise. A connection the browser itself calls slow gets
 *     the small tier (see thinConnection() in src/platform.ts), and that path has
 *     to come in under the 2 MB the document asked for and start fast.
 *   THE FULL PATH is the experience everyone else gets, and the assertion there is
 *     not about bytes but about whether the opening can actually stream: a film
 *     that stutters through half its length is worse than a softer one that runs.
 *
 * WHAT IT CAUGHT. Both halves of the state this replaced:
 *
 *   - The opening was encoded for quality only, at 3.78 Mbps. Throttled to 3 Mbps
 *     it played 7.4 of its 12.9 seconds in 13 seconds of wall clock and stalled
 *     seven times; at 1.6 Mbps it managed 3.5 seconds. The very first thing a
 *     visitor sees was the one asset that could not stream.
 *   - Every dealer clip was downloaded twice, because a <link rel="prefetch">
 *     entry fetched without a Range header does not satisfy the `Range: bytes=0-`
 *     that a <video> element asks with. About a megabyte, paid for and discarded.
 *
 *   node scripts/verify-weight.mjs [url]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:5180/'

const MB = 1024 * 1024

/*
 * Throttle profiles, matching the ones Chrome DevTools ships so the numbers mean
 * something to anyone who has used them. Slow 4G is the one to care about: it is
 * an ordinary phone on an ordinary street.
 */
const SLOW_4G = { bps: 3_000_000, rtt: 150 }
const THREE_G = { bps: 1_600_000, rtt: 300 }

/** The opening's real length, from the file. Everything below is relative to it. */
const FILM_S = 12.87

const RUNS = [
  {
    name: 'thin path, 3G',
    net: THREE_G,
    /*
     * A browser that reports a slow connection, which is what a real phone on a
     * real 3G cell reports. CDP throttling does not change navigator.connection,
     * so the API has to be stubbed to exercise the branch that depends on it.
     */
    connection: { effectiveType: '3g', saveData: false },
    /** 首屏 ≤ 2 MB, from VIDEO.md section 7. This is the path it applies to. */
    openingMb: 2.0,
    firstFrameMs: 6000,
    playedFraction: 0.8,
  },
  {
    name: 'full path, slow 4G',
    net: SLOW_4G,
    connection: { effectiveType: '4g', saveData: false },
    /*
     * Looser, and a regression guard rather than a promise: this path is chosen
     * because the connection can carry it. What matters here is the film running.
     */
    openingMb: 3.5,
    firstFrameMs: 4000,
    playedFraction: 0.85,
  },
]

async function run(spec) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

  await page.addInitScript((c) => {
    Object.defineProperty(navigator, 'connection', { value: c, configurable: true })
  }, spec.connection)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: spec.net.rtt,
    downloadThroughput: spec.net.bps / 8,
    uploadThroughput: spec.net.bps / 8,
  })

  const media = new Set()
  page.on('request', (r) => {
    if (r.resourceType() === 'media') media.add(r.url().split('/').pop())
  })

  /*
   * Bytes counted from the protocol rather than from performance.getEntries().
   * A resource timing entry reports encodedBodySize 0 until the response is
   * complete, and a <video> that is still streaming never is - so the obvious way
   * to do this reports a tenth of a megabyte for a site pulling three. Every chunk
   * the renderer receives raises this instead, which is what the network paid.
   */
  let wire = 0
  cdp.on('Network.dataReceived', (e) => {
    wire += e.encodedDataLength > 0 ? e.encodedDataLength : e.dataLength
  })
  const bytes = () => wire

  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  // githack shows a notice page to a brand new visitor before the site itself.
  const notice = page.locator('button.url-action-button, button:has-text("Open the page")')
  if (await notice.count()) {
    await notice.first().click()
    await page.waitForLoadState('domcontentloaded')
  }

  await page.waitForSelector('.intro-video', { timeout: 120000 })
  let stalls = 0
  await page.exposeFunction('__stall', () => {
    stalls++
  })
  await page.evaluate(() => {
    document.querySelector('.intro-video')?.addEventListener('waiting', () => window.__stall())
  })

  /*
   * currentTime moving is the only honest signal that a frame is on screen.
   * readyState, canplay and a resolved play() can all be true while the
   * compositor is still holding the poster.
   */
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.intro-video')
      return v && v.currentTime > 0.1
    },
    { timeout: 120000 },
  )
  const firstFrameMs = Date.now() - t0
  const startedMb = bytes() / MB

  /*
   * How far it gets in its own running time plus a second of slack. Sampled as it
   * goes, because the element is torn down the moment the film ends and reading
   * currentTime afterwards gives zero.
   */
  let played = 0
  const until = Date.now() + (FILM_S + 1) * 1000
  while (Date.now() < until) {
    const t = await page.evaluate(() => document.querySelector('.intro-video')?.currentTime ?? -1)
    if (t < 0) {
      played = FILM_S
      break
    }
    played = Math.max(played, t)
    await page.waitForTimeout(400)
  }

  const openingMb = bytes() / MB
  await browser.close()
  return { firstFrameMs, startedMb, openingMb, played, stalls, media: [...media] }
}

const fail = []
console.log(`a cold visit to ${url}, throttled\n`)

for (const spec of RUNS) {
  const r = await run(spec)
  const frac = r.played / FILM_S
  const small = r.media.some((f) => f.includes('.sm.'))

  console.log(`  ${spec.name}`)
  console.log(
    `    first frame        ${String(r.firstFrameMs).padStart(6)} ms   (limit ${spec.firstFrameMs})`,
  )
  console.log(`    bytes to start     ${r.startedMb.toFixed(2).padStart(6)} MB`)
  console.log(
    `    bytes for the film ${r.openingMb.toFixed(2).padStart(6)} MB   (budget ${spec.openingMb.toFixed(1)})`,
  )
  console.log(
    `    film played        ${r.played.toFixed(1).padStart(6)} s of ${FILM_S}s ` +
      `(${(frac * 100).toFixed(0)}%, needs ${(spec.playedFraction * 100).toFixed(0)}%)   stalls ${r.stalls}`,
  )
  console.log(`    tier served        ${small ? 'small' : 'full'}   ${r.media.join(' ')}\n`)

  if (r.firstFrameMs > spec.firstFrameMs) {
    fail.push(`${spec.name}: ${r.firstFrameMs}ms to the first frame, limit ${spec.firstFrameMs}`)
  }
  if (r.openingMb > spec.openingMb) {
    fail.push(`${spec.name}: ${r.openingMb.toFixed(2)} MB to get started, budget ${spec.openingMb}`)
  }
  if (frac < spec.playedFraction) {
    fail.push(
      `${spec.name}: the opening only reached ${(frac * 100).toFixed(0)}% of its length in its own running time`,
    )
  }
  // The point of the thin path is that it is thinner. If it serves the full files
  // the branch has broken and the budget above passed for the wrong reason.
  if (spec.name.startsWith('thin') && !small) {
    fail.push(`${spec.name}: served the full-size files to a connection that reports 3g`)
  }
}

if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('OK: it opens and plays on a slow phone, and the thin path stays inside 2 MB')
