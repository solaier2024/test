import { useEffect, useRef, useState } from 'react'
import { plateUrl } from '../art'
import { Clip, type ClipRequest } from './Clip'
import type { Mood } from '../game/ai'

export type SceneState = Mood | 'shuffling'

/** Which plate backs each state. The clips start and end on these. */
const PLATE: Record<SceneState, string> = {
  cool: 'dealer_cool',
  warm: 'dealer_warm',
  sharp: 'dealer_sharp',
  shuffling: 'dealer_shuffle',
}

/** States with an eyes-closed twin. */
const BLINKS: SceneState[] = ['cool', 'warm']

interface SceneProps {
  state: SceneState
  clip: ClipRequest | null
  small: boolean
  reduced: boolean
  onClipEnded?: (name: string) => void
}

export function Scene({ state, clip, small, reduced, onClipEnded }: SceneProps) {
  const [blink, setBlink] = useState(false)
  const [shown, setShown] = useState<SceneState>(state)
  const [fading, setFading] = useState<SceneState | null>(null)

  /*
   * Asymmetric cross-fade. A symmetric one puts both plates near half opacity at
   * the midpoint, and the black behind them shows through - which reads as the
   * dealer briefly vanishing from her own chair. The outgoing plate holds full
   * opacity for a beat and leaves slowly; the incoming one arrives faster.
   */
  useEffect(() => {
    if (state === shown) return
    setFading(shown)
    setShown(state)
    const t = window.setTimeout(() => setFading(null), 1100)
    return () => window.clearTimeout(t)
  }, [state, shown])

  // Randomly spaced blinks of about 130ms, which is a real one.
  useEffect(() => {
    if (reduced || clip || !BLINKS.includes(shown)) return
    let alive = true
    let timer = 0
    const loop = () => {
      timer = window.setTimeout(() => {
        if (!alive) return
        setBlink(true)
        window.setTimeout(() => {
          setBlink(false)
          loop()
        }, 120 + Math.random() * 25)
      }, 2400 + Math.random() * 4200)
    }
    loop()
    return () => {
      alive = false
      window.clearTimeout(timer)
      setBlink(false)
    }
  }, [shown, clip, reduced])

  return (
    <div className="scene">
      {/* Locked off. Nothing here is ever transformed - see .camera in App.css. */}
      <div className="camera">
        {fading && (
          <img className="plate leaving" src={plateUrl(PLATE[fading])} alt="" aria-hidden="true" />
        )}
        <img className="plate arriving" src={plateUrl(PLATE[shown])} alt="" aria-hidden="true" />
        {blink && (
          <img className="plate blink" src={plateUrl(`${PLATE[shown]}_blink`)} alt="" aria-hidden="true" />
        )}
        <Clip request={clip} small={small} onEnded={onClipEnded} />
      </div>
    </div>
  )
}

/**
 * How much of the shoe is left, as a thing on the table rather than a number.
 * A real counter watches the block of cards go down; so does this one, and the
 * warmth of the edge glow is the only advantage readout there is.
 */
export function Shoe({ left, size, edge, label }: { left: number; size: number; edge: number; label: string }) {
  const frac = Math.max(0, Math.min(1, left / Math.max(1, size)))
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="shoe" ref={ref}>
      <span className="shoe-label">{label}</span>
      <div className="shoe-body">
        <div className="shoe-stack" style={{ height: `${frac * 100}%` }} />
        <div className="shoe-glow" style={{ opacity: 0.12 + edge * 0.72 }} />
      </div>
    </div>
  )
}
