import { useEffect, useRef, useState } from 'react'
import type { Mood } from '../game/ai'

export type SceneState = Mood | 'aiming'

const FRAMES: Record<SceneState, string> = {
  neutral: 'art/cowboy_neutral.png',
  confident: 'art/cowboy_smirk.png',
  rattled: 'art/cowboy_afraid.png',
  aiming: 'art/cowboy_aiming.png',
}

/** A hard kick that settles over about a second, like a camera being struck. */
const RECOIL: Keyframe[] = [
  { transform: 'translate(0, 0) rotate(0deg) scale(1)', filter: 'brightness(1)' },
  {
    transform: 'translate(-46px, 26px) rotate(-2.6deg) scale(1.07)',
    filter: 'brightness(1.5)',
    offset: 0.04,
  },
  {
    transform: 'translate(40px, -31px) rotate(2.2deg) scale(1.06)',
    filter: 'brightness(1.18)',
    offset: 0.11,
  },
  { transform: 'translate(-31px, 18px) rotate(-1.5deg) scale(1.046)', offset: 0.2 },
  { transform: 'translate(23px, -15px) rotate(1.1deg) scale(1.034)', offset: 0.31 },
  { transform: 'translate(-16px, 9px) rotate(-0.7deg) scale(1.023)', offset: 0.44 },
  { transform: 'translate(10px, -6px) rotate(0.4deg) scale(1.014)', offset: 0.58 },
  { transform: 'translate(-6px, 3px) rotate(-0.2deg) scale(1.007)', offset: 0.73 },
  { transform: 'translate(2px, -1px) rotate(0.07deg) scale(1.002)', offset: 0.87 },
  { transform: 'translate(0, 0) rotate(0deg) scale(1)', filter: 'brightness(1)' },
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
      duration: 1100,
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
        {/*
         * The revolver is rendered into a copy of the same plate rather than
         * composited as a cut-out prop, so its contact shadow and rim light
         * match the room. Masking to the corner it occupies lets it sit on top
         * of any character state without disturbing the rest of the frame.
         */}
        {showRevolver && (
          <img className="scene__plate scene__plate--prop" src="art/table_with_revolver.png" alt="" />
        )}
      </div>

      <div className="scene__lamp" />
      <div className="scene__vignette" />
      {flash > 0 && (
        <div key={flash} className={`scene__flash scene__flash--${flashSource ?? 'dealer'}`} />
      )}
      {hurt && <div className="scene__blood" />}
    </div>
  )
}
