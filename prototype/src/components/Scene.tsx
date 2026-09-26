import { useEffect, useRef, useState } from 'react'
import { OPPONENTS, type Mood, type OpponentId } from '../game/ai'
import type { VenueId } from '../game/types'

export type SceneState = Mood | 'aiming' | 'hit'

/** Filename stem of each opponent's pre-rendered plate set. */
const PREFIX: Record<OpponentId, string> = {
  calloway: 'cowboy',
  viuda: 'viuda',
}

const ROOM: Record<VenueId, { back: string; prop: string }> = {
  saloon: { back: 'art/saloon_backplate.png', prop: 'art/table_with_revolver.png' },
  cantina: { back: 'art/cantina_backplate.png', prop: 'art/cantina_with_revolver.png' },
}

const SUFFIX: Record<SceneState, string> = {
  neutral: 'neutral',
  confident: 'smirk',
  rattled: 'afraid',
  aiming: 'aiming',
  hit: 'hit',
}

const ORDER: SceneState[] = ['neutral', 'confident', 'rattled', 'aiming', 'hit']

/**
 * States that have an eyes-closed twin. A blink needs the rest of the frame to
 * be unchanged, so only the two settled expressions get one; someone rattled or
 * sighting down a barrel holding a stare is in character anyway.
 */
const BLINKABLE: SceneState[] = ['neutral', 'confident']

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
  opponent: OpponentId
  state: SceneState
  /** Increments once per live round; drives the muzzle flash and the recoil. */
  flash: number
  flashSource: 'player' | 'dealer' | null
  hurt: boolean
  /** Pushes the camera in during high-tension moments. */
  zoom: number
  showRevolver: boolean
  /** Cuts rather than dissolves, for the frame the shot lands on. */
  snap: boolean
}

/**
 * The cinematic plate. Every character state is a full pre-rendered frame with
 * matching lighting, so states cross-fade instead of needing cut-out alpha.
 */
export function Scene({
  opponent,
  state,
  flash,
  flashSource,
  hurt,
  zoom,
  showRevolver,
  snap,
}: SceneProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [parallax, setParallax] = useState({ x: 0, y: 0 })
  /** The expression currently caught mid-blink, if any. */
  const [blinkFor, setBlinkFor] = useState<SceneState | null>(null)

  const venue = OPPONENTS[opponent].venue
  const prefix = PREFIX[opponent]
  const room = ROOM[venue]
  const frame = (s: SceneState, closed = false) =>
    `art/${prefix}_${SUFFIX[s]}${closed ? '_blink' : ''}.png`

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

  /*
   * Blinks fire on an irregular schedule so the frame never feels like a still.
   * Restarting the loop whenever the expression changes also guarantees no
   * blink plate is left showing across a cross-dissolve into another state.
   */
  const canBlink = BLINKABLE.includes(state)
  useEffect(() => {
    if (!canBlink) return

    let closeAt = 0
    let openAt = 0
    const schedule = () => {
      closeAt = window.setTimeout(
        () => {
          setBlinkFor(state)
          openAt = window.setTimeout(() => {
            setBlinkFor(null)
            schedule()
          }, 120)
        },
        2200 + Math.random() * 4200,
      )
    }
    schedule()

    return () => {
      window.clearTimeout(closeAt)
      window.clearTimeout(openAt)
      setBlinkFor(null)
    }
  }, [canBlink, state, opponent])

  const blinking = blinkFor === state

  const plateTransform = `translate3d(${(-parallax.x * 22).toFixed(2)}px, ${(
    -parallax.y * 11
  ).toFixed(2)}px, 0) scale(${1.06 + zoom * 0.06})`

  return (
    <div
      ref={rootRef}
      className={`scene${hurt ? ' scene--hurt' : ''}${snap ? ' scene--snap' : ''}`}
    >
      <div className="scene__plates" style={{ transform: plateTransform }}>
        <img className="scene__plate" src={room.back} alt="" />
        {ORDER.map((key) => (
          <img
            key={`${opponent}-${key}`}
            className={`scene__plate scene__plate--char${state === key ? ' is-active' : ''}`}
            src={frame(key)}
            alt=""
          />
        ))}
        {/*
         * The eyes-closed twin of the current expression, identical to it in
         * every other respect, so snapping it on for a fifth of a second reads
         * as a blink rather than as a change of frame.
         */}
        {canBlink && (
          <img
            key={`${opponent}-${state}-blink`}
            className={`scene__plate scene__plate--blink${blinking ? ' is-active' : ''}`}
            src={frame(state, true)}
            alt=""
          />
        )}
        {/*
         * The revolver is rendered into a copy of the same plate rather than
         * composited as a cut-out prop, so its contact shadow and rim light
         * match the room. Masking to the corner it occupies lets it sit on top
         * of any character state without disturbing the rest of the frame.
         */}
        {showRevolver && (
          <img
            className={`scene__plate scene__plate--prop scene__plate--prop-${venue}`}
            src={room.prop}
            alt=""
          />
        )}
      </div>

      <div className={`scene__lamp scene__lamp--${venue}`} />
      <div className="scene__vignette" />
      {flash > 0 && (
        <div key={flash} className={`scene__flash scene__flash--${flashSource ?? 'dealer'}`} />
      )}
      {hurt && <div className="scene__blood" />}
    </div>
  )
}
