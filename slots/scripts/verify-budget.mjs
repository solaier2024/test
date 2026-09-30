#!/usr/bin/env node
/*
 * The delivery budget from VIDEO.md section 7, as a check rather than a hope.
 *
 *   node scripts/verify-budget.mjs
 *
 * That section makes the point that moving to a video base is a real cost, and
 * that the cost lands on delivery harder than anywhere else: a generated-video
 * product drifts toward hundreds of megabytes, and the thing this series is
 * proudest of is that the preview site opens and plays for a first-time
 * visitor with a cold cache. Its instruction was to fix a hard budget and
 * enforce it the same way the pipeline already enforces that a clip plays to
 * the end - "超了就判失败,不靠自觉": over budget is a failure, not a note.
 *
 * So the numbers below are from that document, narrowed to one table:
 *
 *   FIRST SCREEN <= 2 MB. What a new visitor must download before the table is
 *     playable at all. Phone-tier encodes only, because a phone is the device
 *     this matters on.
 *   SINGLE CLIP <= 400 KB on the phone tier. This one has teeth: it is what
 *     stops "just one more reaction shot" from quietly becoming a 40 MB table.
 *   WHOLE TABLE <= 40 MB across every encode and size.
 */
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(HERE, '..', 'public')

const KB = 1024
const MB = 1024 * KB
const FIRST_SCREEN = 2 * MB
const ONE_CLIP = 400 * KB
const WHOLE_TABLE = 40 * MB

const size = (p) => statSync(p).size
const list = (dir) => readdirSync(dir).map((f) => ({ name: f, path: join(dir, f), size: size(join(dir, f)) }))

const clips = list(join(PUBLIC, 'clips'))
const art = list(join(PUBLIC, 'art'))

let bad = 0
const fail = (msg) => {
  bad++
  console.error(`  OVER BUDGET  ${msg}`)
}

/* ------------------------------------------------------- one clip at a time */

console.log('phone tier, per clip (budget 400 KB)')
for (const c of clips.filter((f) => f.name.endsWith('.sm.webm') || f.name.endsWith('.sm.mp4'))) {
  const over = c.size > ONE_CLIP
  console.log(`  ${c.name.padEnd(22)} ${(c.size / KB).toFixed(0).padStart(6)} KB${over ? '   OVER' : ''}`)
  if (over) fail(`${c.name} is ${(c.size / KB).toFixed(0)} KB`)
}

/* ------------------------------------------------------------- first screen
 *
 * What actually has to arrive before the player can pull the lever: the
 * opening, the plate the table rests on, and the two clips a first pull will
 * reach for. Reaction footage is deliberately NOT counted - prefetch.ts asks
 * for it after the table is up, and a player who pulls the lever inside the
 * first second gets the plate cross-fade, which is the fallback working as
 * designed rather than a degraded experience.
 */
const firstScreen = ['intro.sm.webm', 'pull.sm.webm', 'release.sm.webm', 'idle.sm.webm']
const plate = art.find((f) => f.name === 'machine_rest.jpg')
let first = plate ? plate.size : 0
console.log('\nfirst screen (budget 2 MB)')
if (plate) console.log(`  ${'art/machine_rest.jpg'.padEnd(22)} ${(plate.size / KB).toFixed(0).padStart(6)} KB`)
for (const name of firstScreen) {
  const f = clips.find((c) => c.name === name)
  if (!f) {
    fail(`${name} is missing`)
    continue
  }
  first += f.size
  console.log(`  ${name.padEnd(22)} ${(f.size / KB).toFixed(0).padStart(6)} KB`)
}
console.log(`  ${'TOTAL'.padEnd(22)} ${(first / KB).toFixed(0).padStart(6)} KB`)
if (first > FIRST_SCREEN) fail(`first screen is ${(first / MB).toFixed(2)} MB`)

/* ----------------------------------------------------------- the whole table */

const total = [...clips, ...art].reduce((s, f) => s + f.size, 0)
console.log(`\nwhole table, every encode and size (budget 40 MB)\n  ${(total / MB).toFixed(1)} MB`)
if (total > WHOLE_TABLE) fail(`the table is ${(total / MB).toFixed(1)} MB`)

if (bad) {
  console.error(`\n${bad} budget failure(s)`)
  process.exit(1)
}
console.log('\nOK: within the delivery budget')
