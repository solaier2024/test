import { useEffect, useRef, useState } from 'react'
import type { Mood } from '../game/ai'

export type SceneState = Mood | 'aiming'

const FRAMES: Record<SceneState, string> = {
  neutral: 'art/cowboy_neutral.png',
  confident: 'art/cowboy_smirk.png',
  rattled: 'art/cowboy_afraid.png',
  aiming: 'art/cowboy_aiming.png',
}

const RECOIL: Keyframe[] = [
  { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
  { transform: 'translate(-26px, 15px) rotate(-1.5deg) scale(1.035)', offset: 0.05 },
  { transform: 'translate(23px, -18px) rotate(1.3deg) scale(1.03)', offset: 0.13 },
  { transform: 'translate(-18px, 10px) rotate(-0.9deg) scale(1.024)', offset: 0.23 },
  { transform: 'translate(13px, -9px) rotate(0.7deg) scale(1.018)', offset: 0.35 },
  { transform: 'translate(-9px, 5px) rotate(-0.4deg) scale(1.012)', offset: 0.48 },
  { transform: 'translate(6px, -3px) rotate(0.25deg) scale(1.007)', offset: 0.62 },
  { transform: 'translate(-3px, 2px) rotate(-0.12deg) scale(1.003)', offset: 0.78 },
  { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
]

interface SceneProps {
  state: SceneState
  /** Increments once per live round; drives the muzzle flash and the recoil. */
  flash: number
  flashSource: 'player' | 'dealer' | null
  hurt: boolean
  /** Pushes the camera in during high-tension moments. */
  zoom: number
  showRevolver: boolean
}

/**
 * The cinematic plate. Every character state is a full pre-rendered frame with
 * matching lighting, so states cross-fade instead of needing cut-out alpha.
 */
export function Scene({ state, flash, flashSource, hurt, zoom, showRevolver }: SceneProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [parallax, setParallax] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setParallax({
        x: (e.clientX - r.left) / r.width - 0.5,
        y: (e.clientY - r.top) / r.height - 0.5,
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Recoil is played imperatively so repeat shots always restart the motion.
  useEffect(() => {
    if (flash === 0) return
    rootRef.current?.animate(RECOIL, {
      duration: 900,
      easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)',
    })
  }, [flash])

  const plateTransform = `translate3d(${(-parallax.x * 22).toFixed(2)}px, ${(
    -parallax.y * 11
  ).toFixed(2)}px, 0) scale(${1.06 + zoom * 0.06})`

  return (
    <div ref={rootRef} className={`scene${hurt ? ' scene--hurt' : ''}`}>
      <div className="scene__plates" style={{ transform: plateTransform }}>
        <img className="scene__plate" src="art/saloon_backplate.png" alt="" />
        {(Object.keys(FRAMES) as SceneState[]).map((key) => (
          <img
            key={key}
            className={`scene__plate scene__plate--char${state === key ? ' is-active' : ''}`}
            src={FRAMES[key]}
            alt=""
          />
        ))}
      </div>

      {showRevolver && (
        <img
          className="scene__revolver"
          src="art/revolver_table.png"
          alt=""
          style={{
            transform: `translate3d(${(-parallax.x * 46).toFixed(2)}px, ${(
              -parallax.y * 18
            ).toFixed(2)}px, 0)`,
          }}
        />
      )}

      <div className="scene__lamp" />
      <div className="scene__vignette" />
      {flash > 0 && (
        <div key={flash} className={`scene__flash scene__flash--${flashSource ?? 'dealer'}`} />
      )}
      {hurt && <div className="scene__blood" />}
    </div>
  )
}
