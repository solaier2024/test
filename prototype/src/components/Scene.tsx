import { useEffect, useRef, useState } from 'react'
import type { Mood } from '../game/ai'

export type SceneState = Mood | 'aiming'

const FRAMES: Record<SceneState, string> = {
  neutral: 'art/cowboy_neutral.png',
  confident: 'art/cowboy_smirk.png',
  rattled: 'art/cowboy_afraid.png',
  aiming: 'art/cowboy_aiming.png',
}

interface SceneProps {
  state: SceneState
  /** Drives the muzzle flash and shake when a live round goes off. */
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
  const [flashOn, setFlashOn] = useState(false)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const nx = (e.clientX - r.left) / r.width - 0.5
      const ny = (e.clientY - r.top) / r.height - 0.5
      setParallax({ x: nx, y: ny })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    if (flash === 0) return
    setFlashOn(true)
    setShake(true)
    const a = window.setTimeout(() => setFlashOn(false), 140)
    const b = window.setTimeout(() => setShake(false), 620)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [flash])

  const layer = (depth: number) => ({
    transform: `translate3d(${(-parallax.x * depth).toFixed(2)}px, ${(
      -parallax.y * depth * 0.5
    ).toFixed(2)}px, 0) scale(${1.06 + zoom * 0.06})`,
  })

  return (
    <div
      ref={rootRef}
      className={`scene${shake ? ' scene--shake' : ''}${hurt ? ' scene--hurt' : ''}`}
    >
      <div className="scene__plates" style={layer(22)}>
        <img className="scene__plate" src="art/saloon_backplate.png" alt="" />
        {(Object.keys(FRAMES) as SceneState[]).map((key) => (
          <img
            key={key}
            className={`scene__plate scene__plate--char${
              state === key ? ' is-active' : ''
            }`}
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
      {flashOn && (
        <div
          className={`scene__flash scene__flash--${flashSource ?? 'dealer'}`}
        />
      )}
      {hurt && <div className="scene__blood" />}
    </div>
  )
}
