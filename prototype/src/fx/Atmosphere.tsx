import { useEffect, useRef } from 'react'

interface Mote {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  r: number
  a: number
  phase: number
}

interface Smoke {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
  max: number
}

/**
 * Canvas layer that sells the room as a live space: dust drifting through the
 * lamp light, slow smoke off the table, and an animated grain plate on top.
 */
export function Atmosphere({ smokeBursts }: { smokeBursts: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const burstRef = useRef(smokeBursts)
  burstRef.current = smokeBursts

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    const motes: Mote[] = []
    const smoke: Smoke[] = []
    let lastBurst = burstRef.current

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const seedMotes = () => {
      motes.length = 0
      const count = Math.floor((w * h) / 9000)
      for (let i = 0; i < count; i++) {
        const z = Math.random()
        motes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z,
          vx: (Math.random() - 0.5) * (0.12 + z * 0.3),
          vy: -(0.03 + Math.random() * 0.12) * (0.4 + z),
          r: 0.4 + z * 1.9,
          a: 0.06 + Math.random() * 0.3 * z,
          phase: Math.random() * Math.PI * 2,
        })
      }
    }
    seedMotes()

    const addSmoke = () => {
      for (let i = 0; i < 26; i++) {
        smoke.push({
          x: w * (0.42 + Math.random() * 0.16),
          y: h * (0.62 + Math.random() * 0.1),
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.25 + Math.random() * 0.7),
          r: 14 + Math.random() * 46,
          life: 0,
          max: 160 + Math.random() * 190,
        })
      }
    }

    let raf = 0
    let t = 0

    const frame = () => {
      t += 1
      if (burstRef.current !== lastBurst) {
        lastBurst = burstRef.current
        addSmoke()
      }
      ctx.clearRect(0, 0, w, h)

      // Dust drifting upward through the warm key light.
      ctx.globalCompositeOperation = 'lighter'
      for (const m of motes) {
        m.x += m.vx
        m.y += m.vy
        m.phase += 0.01
        m.x += Math.sin(m.phase) * 0.12
        if (m.y < -10) {
          m.y = h + 10
          m.x = Math.random() * w
        }
        if (m.x < -10) m.x = w + 10
        if (m.x > w + 10) m.x = -10
        // Brighter where the lamp light falls, on the right of frame.
        const lamp = 1 - Math.min(1, Math.hypot(m.x - w * 0.72, m.y - h * 0.3) / (w * 0.6))
        const alpha = m.a * (0.25 + lamp * 1.35) * (0.7 + Math.sin(m.phase * 1.7) * 0.3)
        if (alpha <= 0.002) continue
        ctx.fillStyle = `rgba(255, 216, 150, ${alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Powder smoke after a shot.
      ctx.globalCompositeOperation = 'source-over'
      for (let i = smoke.length - 1; i >= 0; i--) {
        const s = smoke[i]
        s.life += 1
        if (s.life > s.max) {
          smoke.splice(i, 1)
          continue
        }
        const k = s.life / s.max
        s.x += s.vx
        s.y += s.vy
        s.vy *= 0.995
        const rad = s.r * (1 + k * 2.4)
        const alpha = Math.sin(k * Math.PI) * 0.16
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad)
        grad.addColorStop(0, `rgba(206, 188, 158, ${alpha.toFixed(3)})`)
        grad.addColorStop(1, 'rgba(206, 188, 158, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(s.x, s.y, rad, 0, Math.PI * 2)
        ctx.fill()
      }

      // Film grain, redrawn on a coarse grid so it stays cheap.
      if (t % 2 === 0) {
        const step = 3
        ctx.globalCompositeOperation = 'overlay'
        for (let y = 0; y < h; y += step) {
          for (let x = 0; x < w; x += step) {
            const n = Math.random()
            if (n > 0.86) {
              ctx.fillStyle = `rgba(255,255,255,${((n - 0.86) * 0.22).toFixed(3)})`
              ctx.fillRect(x, y, step, step)
            } else if (n < 0.05) {
              ctx.fillStyle = `rgba(0,0,0,${((0.05 - n) * 0.5).toFixed(3)})`
              ctx.fillRect(x, y, step, step)
            }
          }
        }
        ctx.globalCompositeOperation = 'source-over'
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="atmosphere" />
}
