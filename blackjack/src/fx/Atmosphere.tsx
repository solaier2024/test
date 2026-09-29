import { useEffect, useRef } from 'react'

/*
 * Grain, drifting smoke and the lamp's unsteadiness, all in code.
 *
 * This layer is deliberately the outermost one - above the felt, above the cards
 * and above the UI. The usual mistake with a video base is to grade and grain
 * only the footage, which leaves the interface looking cleaner than the picture
 * and gives the whole thing away. Everything gets the same noise.
 *
 * WHAT WAS WRONG WITH IT. This was the single largest main-thread cost in the
 * build, and it was being paid sixty times a second on top of video decode:
 *
 *   - The canvas was sized at device pixel ratio 2, so on a 1920x1080 window the
 *     backing store was 3840x2160 - eight megapixels.
 *   - Every frame built a fresh radial gradient and filled all eight megapixels
 *     with it, although the gradient only changes when the heat or the lean does.
 *   - Every frame drew the grain tile in a nested loop: about 160 drawImage calls
 *     at 1920x1080, one per 128px cell.
 *
 * All three are now paid once and reused: the vignette is baked to an offscreen
 * canvas and only rebuilt when it would actually look different, the grain is
 * pre-tiled into one image that is drawn with a single offset call, and the whole
 * layer runs at 30fps at device resolution. Film grain does not need 120 megapixels
 * a second to read as film grain.
 */

interface Mote {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  a: number
}

interface AtmosphereProps {
  reduced: boolean
  /** 0 to 1. The room paying attention to you cools and closes the frame. */
  heat: number
  /** 0 to 1, how far the player is leaning over her hands. */
  lean: number
}

/** Grain and vignette at one device pixel per CSS pixel. Neither needs more. */
const DPR = 1
/** The atmosphere's own frame budget. The video runs at 30; this need not beat it. */
const FRAME_MS = 1000 / 30

export function Atmosphere({ reduced, heat, lean }: AtmosphereProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ heat, lean })
  live.current = { heat, lean }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let raf = 0
    let motes: Mote[] = []
    let w = 0
    let h = 0

    // One pre-tiled sheet of grain, big enough to be scrolled by up to a tile in
    // either direction and still cover the frame.
    const TILE = 128
    const sheet = document.createElement('canvas')
    const sctx = sheet.getContext('2d')!

    // The vignette, baked. `bakedFor` is the quantised state it was baked at.
    const vignette = document.createElement('canvas')
    const vctx = vignette.getContext('2d')!
    let bakedFor = ''

    const buildSheet = () => {
      const tile = document.createElement('canvas')
      tile.width = TILE
      tile.height = TILE
      const tctx = tile.getContext('2d')!
      const img = tctx.createImageData(TILE, TILE)
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.random() * 135
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 16
      }
      tctx.putImageData(img, 0, 0)

      sheet.width = Math.max(1, w + TILE * 2)
      sheet.height = Math.max(1, h + TILE * 2)
      for (let y = 0; y < sheet.height; y += TILE) {
        for (let x = 0; x < sheet.width; x += TILE) sctx.drawImage(tile, x, y)
      }
    }

    const bake = (hh: number, ll: number) => {
      // Quantised, so a gauge creeping up by a tenth of a percent every 250ms does
      // not rebuild an eight-megapixel gradient.
      const key = `${Math.round(hh * 40)}:${Math.round(ll * 40)}:${w}x${h}`
      if (key === bakedFor) return
      bakedFor = key
      vignette.width = Math.max(1, w)
      vignette.height = Math.max(1, h)
      const close = Math.min(0.95, 0.42 + hh * 0.3 + ll * 0.28)
      const g = vctx.createRadialGradient(
        w / 2, h * 0.46, Math.min(w, h) * (0.72 - ll * 0.22),
        w / 2, h * 0.5, Math.max(w, h) * 0.78,
      )
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(4, 6, 8, ${close})`)
      vctx.clearRect(0, 0, w, h)
      vctx.fillStyle = g
      vctx.fillRect(0, 0, w, h)
      if (hh > 0.3) {
        vctx.fillStyle = `rgba(30, 70, 96, ${(hh - 0.3) * 0.16})`
        vctx.fillRect(0, 0, w, h)
      }
    }

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(w * DPR))
      canvas.height = Math.max(1, Math.floor(h * DPR))
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      const count = reduced ? 0 : Math.round((w * h) / 26000)
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.03 - Math.random() * 0.1,
        r: 0.4 + Math.random() * 1.5,
        a: 0.05 + Math.random() * 0.16,
      }))
      buildSheet()
      bakedFor = ''
    }
    resize()
    window.addEventListener('resize', resize)

    let t = 0
    let last = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < FRAME_MS - 1) return
      last = now
      t += 1

      ctx.clearRect(0, 0, w, h)
      const { heat: hh, lean: ll } = live.current

      if (!reduced) {
        for (const m of motes) {
          m.x += m.vx
          m.y += m.vy
          if (m.y < -4) {
            m.y = h + 4
            m.x = Math.random() * w
          }
          if (m.x < -4) m.x = w + 4
          if (m.x > w + 4) m.x = -4
          ctx.beginPath()
          ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255, 233, 196, ${m.a})`
          ctx.fill()
        }

        // One call. The sheet is oversized, so scrolling it never exposes an edge.
        ctx.globalAlpha = 0.5
        ctx.drawImage(sheet, -TILE + ((t * 7) % TILE), -TILE + ((t * 11) % TILE))
        ctx.globalAlpha = 1
      }

      bake(hh, ll)
      ctx.drawImage(vignette, 0, 0, w, h)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [reduced])

  return <canvas ref={ref} className="atmosphere" aria-hidden="true" />
}
