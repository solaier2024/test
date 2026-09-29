/*
 * The walkthrough, once, for both recorders.
 *
 * record-demo.mjs captures the page and record-sound.mjs captures a screen
 * with the audio on it. They are two different capture rigs demonstrating one
 * thing, and the moment the choreography lives in both of them one of the two
 * recordings starts being of an older game.
 *
 * Every wait here is set against the timetable in App.tsx rather than picked
 * to look right: lever 0.3s, bands at rest 1.25 / 2.0 / 2.85, a tease holds
 * the third band to 4.15, the room answers 0.26 after the last band and holds
 * its reaction 2.1. So a tease finishes at 6.8s and an ordinary pull at 5.5s.
 * Eight seconds covers both and leaves the idle loop showing in between, which
 * is what stops it looking like a highlight reel.
 */

export const SEED = 51

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Takes hold of the ball on the arm and hauls it down, in steps, the way a
 * hand does.
 *
 * The recording uses the drag and not the button underneath for the same
 * reason the drag was built: the brief asked for a hand working a lever, and
 * a demonstration that presses PULL is a demonstration of a remote control.
 * The pointer is left visible in the screen capture so the haul can be seen
 * happening.
 */
export async function haulLever(page) {
  const knob = await page.locator('button.lever-knob').boundingBox()
  const frame = await page.locator('.frame').boundingBox()
  const x = knob.x + knob.width / 2
  const y0 = knob.y + knob.height / 2

  await page.mouse.move(x, y0)
  await sleep(320)
  await page.mouse.down()
  /* Slow enough to see, and slow enough to hear: the ratchet puts a tooth
   * every nine degrees of arc and the whole point is that they tick past. */
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(x, y0 + (frame.height * 0.45 * i) / 16)
    await sleep(28)
  }
  await page.mouse.up()
}

/**
 * @param page      a page already showing the game at its first frame
 * @param withSound whether to turn the sound on, which the screen recorder
 *                  needs and the silent page recorder has no use for
 */
export async function walkthrough(page, { withSound = false } = {}) {
  // ---------- the opening ----------
  // Eleven seconds, and it runs its middle in Spanish to put both caption
  // tracks on tape. Nothing here skips it; it hands over on its own.
  await page.waitForSelector('.intro-video', { timeout: 30000 })

  if (withSound) {
    /* Three-state control - locked, on, muted - so press it until the glyph
     * says it is on rather than pressing it once and hoping. Getting this
     * wrong records a silent film of a game about noise. */
    for (let i = 0; i < 3; i++) {
      const label = (await page.locator('button.sound').textContent()) ?? ''
      if (label.includes('🔊')) break
      await page.locator('button.sound').click()
      await sleep(420)
    }
  }

  await sleep(3400)
  await page.locator('button.lang').click()
  await sleep(3600)
  await page.locator('button.lang').click()
  await page.waitForSelector('.machines button', { timeout: 40000 })

  // ---------- the picker ----------
  // Long enough to read all three blurbs, because the choice they describe -
  // which machine to spend the night suspecting - is the whole game.
  await sleep(4200)
  await page.locator('.machines button').nth(2).click()
  await page.waitForSelector('.reels', { timeout: 30000 })

  // A beat on the table at rest: the lamp gutters, the room shifts, nothing
  // else happens. It is the shot that makes the reactions mean something.
  await sleep(2600)

  // ---------- pull one: a near miss, and the room loses its breath --------
  await haulLever(page)
  await sleep(7600)

  // ---------- pull two: it pays, and the room comes off the floor ---------
  await haulLever(page)
  await sleep(7600)

  // ---------- the bet ----------
  // Between pulls, where it belongs. Three coins a pull pays triple and buys
  // exactly as much of the count as one does, which is the decision.
  await page.locator('.stake-coin', { hasText: '3' }).click()
  await sleep(1600)

  // ---------- pull three: nothing, and the room groans ----------
  await haulLever(page)
  await sleep(7600)

  await haulLever(page)
  await sleep(7600)

  // ---------- and the accusation ----------
  // Four pulls is nowhere near enough evidence and the room says so. That is
  // the honest ending to demonstrate: calling early is a bet you lose.
  await sleep(1200)
  await page.keyboard.press('c')
  await sleep(6000)
}
