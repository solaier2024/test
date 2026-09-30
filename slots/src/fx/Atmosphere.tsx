import { useEffect, useRef } from 'react'

/*
 * Grain, drifting smoke and the lamp's unsteadiness, all in code.
 *
 * This layer is deliberately the outermost one - above the felt, above the cards
 * and above the UI. The usual mistake with a video base is to grade and grain
 * only the footage, which leaves the interface looking cleaner than the picture
 * and gives the whole thing away. Everything gets the same noise.
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

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = reduced ? 0 : Math.round((w * h) / 26000)
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -0.03 - Math.random() * 0.1,
        r: 0.4 + Math.random() * 1.5,
        a: 0.05 + Math.random() * 0.16,
      }))
    }
    resize()
    window.addEventListener('resize', resize)

    // A fixed grain tile, scrolled each frame: far cheaper than per-pixel noise.
    const tile = document.createElement('canvas')
    tile.width = 128
    tile.height = 128
    const tctx = tile.getContext('2d')!
    const img = tctx.createImageData(128, 128)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 135
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 16
    }
    tctx.putImageData(img, 0, 0)

    let t = 0
    const frame = () => {
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

        ctx.globalAlpha = 0.5
        for (let y = -128; y < h + 128; y += 128) {
          for (let x = -128; x < w + 128; x += 128) {
            ctx.drawImage(tile, x + ((t * 7) % 128), y + ((t * 11) % 128))
          }
        }
        ctx.globalAlpha = 1
      }

      // Vignette: tightens as the room watches you and as you lean in.
      const close = Math.min(0.95, 0.42 + hh * 0.3 + ll * 0.28)
      const g = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * (0.72 - ll * 0.22), w / 2, h * 0.5, Math.max(w, h) * 0.78)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(4, 6, 8, ${close})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      if (hh > 0.3) {
        ctx.fillStyle = `rgba(30, 70, 96, ${(hh - 0.3) * 0.16})`
        ctx.fillRect(0, 0, w, h)
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [reduced])

  return <canvas ref={ref} className="atmosphere" aria-hidden="true" />
}
