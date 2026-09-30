#!/usr/bin/env node
/*
 * The reel window is a hole in the casting, and the DOM bands are laid over it
 * using the fractions in src/machine.ts. That arrangement has one failure mode
 * and it is silent: if the machine sits ten pixels high on one plate, the bands
 * slide out from under the brass on that plate only - and because which plate
 * is showing depends on what the crowd is doing, it would happen on a groan and
 * not on a cheer, which is the worst kind of bug to reproduce on purpose.
 *
 * Two checks, in the order they can actually be relied on:
 *
 *   1. every registered plate still lines up with the reference casting. This
 *      is a cross-correlation over the iron, NOT a re-detection of the window
 *      on each plate. Detecting it six times looked more thorough and was in
 *      fact less reliable: the bottom bevel is a soft gradient and the reading
 *      moved by nine pixels when a denoise filter was added upstream, which was
 *      the measurement changing and not the picture.
 *   2. the window is found once, on the reference, and has to match the numbers
 *      the stylesheet is using. Nothing else in the project checks this, and
 *      what it catches is bands sitting slightly off the glass on every plate
 *      at once, which looks like a rendering bug and is an art bug.
 *
 *   node scripts/verify-window.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { H, W, bestShift, cost, luma } from './lib/register.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'clipsrc', 'aligned')

const REFERENCE = 'machine_rest'
const PLATES = ['machine_rest', 'machine_breath', 'machine_pull', 'machine_lean', 'machine_roar', 'machine_sigh']

/** Whole pixels of residual drift allowed after registration. */
const DRIFT = 1
/** The bevel is soft, so the stylesheet gets a little room against the glass. */
const DECLARED = 8

/* ------------------------------------------------- finding the glass, once */

const DARK = 12
const FRACTION = 0.5
/**
 * There is a warm reflection streak across the middle of the pane, about eleven
 * rows of it and brighter than the brass. Runs are merged across a gap this
 * size so the streak does not saw the window in half - and the band of shadow
 * under the payout plate stays twenty-odd rows away, so it is not swallowed.
 */
const GAP = 14
const CORE = { x0: 470, x1: 650, y0: 250, y1: 340 }
const SEARCH = { x0: 380, x1: 760, y0: 180, y1: 430 }

function longestRun(flags, from) {
  const runs = []
  let start = -1
  for (let i = 0; i <= flags.length; i++) {
    if (flags[i] && start < 0) start = i
    if (!flags[i] && start >= 0) {
      runs.push([start, i - 1])
      start = -1
    }
  }
  const merged = []
  for (const r of runs) {
    const last = merged.at(-1)
    if (last && r[0] - last[1] <= GAP) last[1] = r[1]
    else merged.push([...r])
  }
  const best = merged.sort((a, b) => b[1] - b[0] - (a[1] - a[0])).at(0)
  if (!best) throw new Error('found no window')
  return [best[0] + from, best[1] + from]
}

function glassOf(px) {
  const dark = (x, y) => px[y * W + x] < DARK
  const rows = []
  for (let y = SEARCH.y0; y <= SEARCH.y1; y++) {
    let n = 0
    for (let x = CORE.x0; x <= CORE.x1; x++) if (dark(x, y)) n++
    rows.push(n / (CORE.x1 - CORE.x0 + 1) >= FRACTION)
  }
  const [top, bottom] = longestRun(rows, SEARCH.y0)

  const cols = []
  for (let x = SEARCH.x0; x <= SEARCH.x1; x++) {
    let n = 0
    for (let y = CORE.y0; y <= CORE.y1; y++) if (dark(x, y)) n++
    cols.push(n / (CORE.y1 - CORE.y0 + 1) >= 0.9)
  }
  const [left, right] = longestRun(cols, SEARCH.x0)
  return { left, top, right, bottom }
}

/* --------------------------------------------------------------- the checks */

const path = (name) => {
  const p = join(SRC, `${name}.png`)
  if (!existsSync(p)) throw new Error(`missing ${p} - run: node scripts/align-plates.mjs`)
  return p
}

const ref = luma(path(REFERENCE))
let bad = 0

console.log('plate                 dx   dy   residual')
for (const name of PLATES) {
  if (name === REFERENCE) {
    console.log(`${name.padEnd(18)} ${'0'.padStart(4)} ${'0'.padStart(4)} ${'0.00'.padStart(10)}   reference`)
    continue
  }
  const cand = luma(path(name))
  const { dx, dy } = bestShift(ref, cand, 6)
  const ok = Math.abs(dx) <= DRIFT && Math.abs(dy) <= DRIFT
  if (!ok) bad++
  console.log(
    `${name.padEnd(18)} ${String(dx).padStart(4)} ${String(dy).padStart(4)} ` +
      `${cost(ref, cand, dx, dy).toFixed(2).padStart(10)}${ok ? '' : '   DRIFTED'}`,
  )
}

const glass = glassOf(ref)
const geom = readFileSync(join(ROOT, 'src', 'machine.ts'), 'utf8')
const read = (key) => {
  const m = geom.match(new RegExp(`${key}:\\s*([0-9.]+)`))
  if (!m) throw new Error(`src/machine.ts has no ${key}`)
  return Number(m[1])
}
const declared = {
  left: Math.round(read('left') * W),
  top: Math.round(read('top') * H),
  right: Math.round((read('left') + read('width')) * W),
  bottom: Math.round((read('top') + read('height')) * H),
}

console.log(`\nthe glass on ${REFERENCE}, against src/machine.ts:`)
for (const side of ['left', 'top', 'right', 'bottom']) {
  const off = Math.abs(declared[side] - glass[side])
  const ok = off <= DECLARED
  if (!ok) bad++
  console.log(
    `  ${side.padEnd(7)} declared ${String(declared[side]).padStart(4)}  measured ${String(glass[side]).padStart(4)}` +
      `  off by ${String(off).padStart(3)}px${ok ? '' : '   WRONG'}`,
  )
}

if (bad) {
  console.error(`\n${bad} problem(s): the bands would not sit in the glass`)
  process.exit(1)
}
console.log(`\nOK: all ${PLATES.length} plates hold the same casting, and the stylesheet agrees with the glass`)
