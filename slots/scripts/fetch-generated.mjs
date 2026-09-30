#!/usr/bin/env node
/*
 * Pulls the generated footage named in clipsrc/generated.json down to
 * clipsrc/generated/*.mp4 and normalises it to working size.
 *
 *   node scripts/fetch-generated.mjs
 *   node scripts/fetch-generated.mjs roar sigh
 *
 * Why the footage is committed rather than fetched at build time: the manifest
 * records the model, the mode, the exact prompt, the two conditioning plates
 * and the historyId, which is enough to regenerate a clip but NOT enough to
 * reproduce one - these models are not deterministic and the seed is not ours
 * to pin. The mp4 in clipsrc/generated/ is therefore a source asset in the same
 * sense clipsrc/*.jpg is, and the manifest beside it is its provenance.
 *
 * It is stored at 1280x720 CRF 16 rather than at the 1920x1080 the model
 * returns, because 1280x720 is the working size the whole pipeline runs at and
 * everything above it is discarded by the first scale filter anyway. Paying to
 * version control detail that build-clips.mjs throws away on the way in would
 * be storing the receipt instead of the goods.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'clipsrc', 'generated')
const W = 1280
const H = 720

const manifest = JSON.parse(readFileSync(join(ROOT, 'clipsrc', 'generated.json'), 'utf8'))
const only = process.argv.slice(2)
const force = process.env.FORCE === '1'

mkdirSync(OUT, { recursive: true })

for (const [name, spec] of Object.entries(manifest.clips)) {
  if (only.length && !only.includes(name)) continue
  const out = join(OUT, `${name}.mp4`)
  if (!force && existsSync(out)) {
    console.log(`${name.padEnd(10)} have it  ${(statSync(out).size / 1024).toFixed(0)} KB`)
    continue
  }
  if (!spec.url) {
    console.log(`${name.padEnd(10)} NO URL YET - generation not recorded in the manifest`)
    continue
  }

  const tmp = join(OUT, `.${name}.download`)
  execFileSync('curl', ['-sS', '--fail', '--retry', '3', '-o', tmp, spec.url])
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', tmp,
    '-vf', `scale=${W}:${H}:flags=lanczos`,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    // VIDEO.md is explicit that clips are silent and sound is synthesised at
    // runtime, so the audio track is dropped here rather than muted later.
    '-an', out,
  ])
  execFileSync('rm', ['-f', tmp])

  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames', '-of', 'csv=p=0', out]).toString().trim()
  console.log(`${name.padEnd(10)} ${probe}  ${(statSync(out).size / 1024).toFixed(0)} KB`)
}
