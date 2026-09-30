import { useEffect, useState, type ReactNode } from 'react'
import { plateUrl } from '../art'
import { Clip, type ClipRequest } from './Clip'

/*
 * The picture: a still plate, the video layer on top of it when there is one,
 * and the reels punched through the machine's window.
 *
 * Every plate is the same locked-off camera with the same machine in the same
 * place, so the only thing that changes between them is the room behind the
 * bar. Swapping plates is therefore the crowd moving, and nothing else - which
 * is why the crowd can react at any moment without a clip existing for it.
 */

export type Room = 'back' | 'in' | 'roar' | 'sigh'

const PLATE: Record<Room, string> = {
  back: 'machine_rest',
  in: 'machine_lean',
  roar: 'machine_roar',
  sigh: 'machine_sigh',
}

interface SceneProps {
  room: Room
  clip: ClipRequest | null
  small: boolean
  /** 0 to 1. Drives the warmth and the push, both of which are live. */
  attention: number
  children: ReactNode
  /*
   * Goes inside the frame rather than beside it, because it is aimed at
   * something painted into the plate and the frame is the only box the plate's
   * fractions mean anything in. Same reason the reels live in here.
   */
  lever?: ReactNode
  onClipEnded?: (name: string) => void
}

export function Scene({ room, clip, small, attention, children, lever, onClipEnded }: SceneProps) {
  const [shown, setShown] = useState<Room>(room)
  const [fading, setFading] = useState<Room | null>(null)

  /*
   * Asymmetric cross-fade. A symmetric one puts both plates near half opacity
   * at the midpoint and the black behind them comes through, which reads as the
   * room briefly emptying. The outgoing plate holds and leaves slowly; the
   * incoming one arrives fast, because a room reacting is a fast thing.
   */
  useEffect(() => {
    if (room === shown) return
    setFading(shown)
    setShown(room)
    const t = window.setTimeout(() => setFading(null), 900)
    return () => window.clearTimeout(t)
  }, [room, shown])

  return (
    <div className="scene" style={{ ['--attention' as string]: String(attention) }}>
      <div className="frame">
        {fading && <img className="plate leaving" src={plateUrl(PLATE[fading])} alt="" aria-hidden="true" />}
        <img className="plate arriving" src={plateUrl(PLATE[shown])} alt="" aria-hidden="true" />
        <Clip request={clip} small={small} onEnded={onClipEnded} />
        {/* The window in the casting, and everything that shows through it. */}
        <div className="window">{children}</div>
        {lever}
      </div>
    </div>
  )
}
