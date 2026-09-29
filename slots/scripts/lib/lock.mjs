/*
 * Holds a generated frame still enough to cut a hole in it.
 *
 * Everywhere else in this series a video clip is just a picture, so a few
 * pixels of wander between frames is atmosphere. On this table it is a bug,
 * because the reel window is not painted on the machine - it is a HOLE, and
 * the three DOM bands in src/components/Reels.tsx are rendered underneath the
 * footage and show through it at the fractions in src/machine.ts. If the
 * casting wanders, the brass rim wanders off the bands and they leak.
 *
 * A generative video model will not hold a locked-off camera for free. It is
 * asked to (see the prompts in clipsrc/generated/manifest.json) and it mostly
 * obliges, but "mostly" is measured in pixels and the tolerance here is about
 * one. So every generated frame goes through two passes:
 *
 *   1. REGISTER. Cross-correlate the frame's casting against the approved
 *      reference plate and shift it back. Translation only, same as
 *      align-plates.mjs does for the stills, and for the same reason: a
 *      rotation or scale search that is not needed is one that will eventually
 *      find something that is not there.
 *
 *   2. PIN THE RIM. Registration fixes where the casting is, not what it looks
 *      like; the model still repaints the brass a little differently each
 *      frame, and a rim that breathes reads as the glass being alive. So the
 *      rectangle containing the glass and its rim is composited back from the
 *      reference plate, feathered so there is no seam. It is a small rectangle
 *      and it is the only part of this picture that is not allowed to be
 *      interpreted.
 *
 * Pass 2 is cheap to dismiss as a hack and it is the opposite: it is the seam
 * between the two halves of VIDEO.md's split made literal. Inside the rect the
 * picture is quantitative and belongs to the engine. Outside it the picture is
 * qualitative and belongs to the model.
 */
import { execFileSync } from 'node:child_process'
import { H, ROI, W } from './register.mjs'

/** Raw RGB24 at working size, whatever the input was. */
export function readRGB(path) {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 30 },
  )
  if (raw.length !== W * H * 3) throw new Error(`${path}: got ${raw.length} bytes, wanted ${W * H * 3}`)
  return raw
}

/**
 * Write a whole sequence of frames as PNGs in one ffmpeg pass.
 *
 * One process per frame is the obvious way to write this and it is about
 * fifteen times slower: at a hundred frames a clip and six clips, process
 * startup alone was most of the build. The frames go to a concatenated raw
 * file instead, which ffmpeg demuxes in a single call - and to a file rather
 * than a pipe because a clip of raw 1280x720 RGB is a third of a gigabyte and
 * there is no reason for it to be resident.
 */
export function writeSequence(rawPath, dir) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${W}x${H}`, '-i', rawPath, '-pix_fmt', 'rgb24', `${dir}/%05d.png`])
}

export const toLuma = (rgb) => {
  const out = new Uint8Array(W * H)
  for (let i = 0, p = 0; i < out.length; i++, p += 3) {
    out[i] = (rgb[p] * 77 + rgb[p + 1] * 150 + rgb[p + 2] * 29) >> 8
  }
  return out
}

/*
 * Shifting leaves a strip with nothing in it along one or two edges. It is
 * filled by repeating the edge pixel rather than with black, because these
 * shifts are single digits and the repeated strip lands under the vignette,
 * whereas a black strip is a hard line that VP9 will happily spend bits on.
 */
export function shiftRGB(rgb, dx, dy) {
  if (!dx && !dy) return rgb
  const out = Buffer.allocUnsafe(W * H * 3)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(H - 1, Math.max(0, y - dy))
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - dx))
      out.writeUIntBE(rgb.readUIntBE((sy * W + sx) * 3, 3), (y * W + x) * 3, 3)
    }
  }
  return out
}

/** Mean absolute luma difference over the casting, candidate shifted by (dx, dy). */
function cost(ref, cand, dx, dy) {
  let sum = 0
  let n = 0
  for (let y = ROI.y0; y <= ROI.y1; y += 2) {
    const ry = y * W
    const cy = (y - dy) * W
    for (let x = ROI.x0; x <= ROI.x1; x += 2) {
      sum += Math.abs(ref[ry + x] - cand[cy + x - dx])
      n++
    }
  }
  return sum / n
}

/**
 * Coarse-to-fine so a wider search stays cheap: generated frames can wander
 * further than the stills ever did, and an exhaustive +/-16 per frame over a
 * hundred frames is not worth paying for when two passes find the same answer.
 */
export function bestShiftRGB(refLuma, candLuma, range = 16) {
  let best = { dx: 0, dy: 0, cost: Infinity }
  for (const [step, span, cx, cy] of [[2, range, 0, 0], [1, 2, null, null]]) {
    const ox = cx ?? best.dx
    const oy = cy ?? best.dy
    for (let dy = oy - span; dy <= oy + span; dy += step) {
      for (let dx = ox - span; dx <= ox + span; dx += step) {
        const c = cost(refLuma, candLuma, dx, dy)
        if (c < best.cost) best = { dx, dy, cost: c }
      }
    }
  }
  return best
}

/*
 * The glass plus enough of the casting around it to carry the rim. Wider than
 * the window in src/machine.ts on every side, because it is the RIM that has
 * to stay put - pinning only the glass would leave the brass free to move
 * against a frozen pane, which is the same bug one step further out.
 */
export const RIM = { x0: 415, y0: 196, x1: 703, y1: 402 }
/** Feather width. Wide enough to hide the join in the surrounding iron. */
const FEATHER = 22

/**
 * Composite the reference plate's window and rim back over a frame, feathered
 * to nothing over FEATHER pixels so no edge of the patch is visible.
 */
export function pinRim(frame, plate) {
  const out = Buffer.from(frame)
  for (let y = RIM.y0; y <= RIM.y1; y++) {
    const edgeY = Math.min(y - RIM.y0, RIM.y1 - y)
    for (let x = RIM.x0; x <= RIM.x1; x++) {
      const edge = Math.min(edgeY, x - RIM.x0, RIM.x1 - x)
      if (edge >= FEATHER) {
        const i = (y * W + x) * 3
        out[i] = plate[i]
        out[i + 1] = plate[i + 1]
        out[i + 2] = plate[i + 2]
        continue
      }
      // Raised cosine, so the blend has no visible start or end.
      const a = 0.5 - 0.5 * Math.cos((Math.PI * edge) / FEATHER)
      const i = (y * W + x) * 3
      out[i] = frame[i] + (plate[i] - frame[i]) * a
      out[i + 1] = frame[i + 1] + (plate[i + 1] - frame[i + 1]) * a
      out[i + 2] = frame[i + 2] + (plate[i + 2] - frame[i + 2]) * a
    }
  }
  return out
}
