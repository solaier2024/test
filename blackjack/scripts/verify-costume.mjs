#!/usr/bin/env node
/*
 * Asserts that every dealer plate is wearing the same clothes.
 *
 * This is the guard for a bug that shipped: the generator re-invents the exact
 * cut of the neckline on every plate, and because the clips are optical flow
 * between two plates, a few pixels of difference becomes a neckline visibly
 * sliding up her chest. lock-costume.mjs fixes it by compositing; this is what
 * stops it coming back, and build-clips.mjs runs it before it will encode
 * anything.
 *
 *   node scripts/verify-costume.mjs
 */
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MASTER, PLATES, REGIONS, boxDiff, core, plateFile, readRgb } from './lock-costume.mjs'

const ART = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'art')

/*
 * A locked region round-trips through JPEG, so it lands near 1.2 rather than 0.
 * Three is comfortably above that and far below the 9-to-38 the unlocked plates
 * were scoring, so it separates "compressed" from "different clothes".
 */
const LIMIT = 3

const master = readRgb(join(ART, `${MASTER}.jpg`))
const fail = []

console.log(`costume, against ${MASTER}.jpg (limit ${LIMIT})\n`)
for (const [name, region] of Object.entries(PLATES)) {
  const d = boxDiff(master, readRgb(plateFile(name)), core(REGIONS[region]))
  const ok = d <= LIMIT
  console.log(`  ${name.padEnd(20)} ${region.padEnd(7)} ${d.toFixed(2).padStart(6)}  ${ok ? 'locked' : 'DRIFTING'}`)
  if (!ok) fail.push(`${name} is wearing something else (${d.toFixed(2)} > ${LIMIT})`)
}

console.log('')
if (fail.length) {
  console.log(`FAILED (${fail.length}):`)
  for (const f of fail) console.log(`  - ${f}`)
  console.log('\nrun: node scripts/lock-costume.mjs && FORCE=1 node scripts/build-clips.mjs')
  process.exit(1)
}
console.log('OK: every plate is wearing the same costume as the master')
