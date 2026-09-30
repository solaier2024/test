import { useCallback, useRef, useState } from 'react'
import { leverNotch, leverReturn } from '../audio/sfx'
import { LEVER, gripAtTop, leverAt } from '../machine'

/*
 * The lever on the machine, as something you take hold of.
 *
 * The brief asked for a hand that works the lever. A PULL button at the bottom
 * of the screen is a way to make the machine spin, and it is not that: it puts
 * the player outside the picture operating a remote control. So the knob in
 * the plate is a live target, you drag it down, and the arm you are dragging
 * is the one in the photograph.
 *
 * What the DOM does and what the film does is the same split as everywhere
 * else in this project. The film has the only honest picture of an arm coming
 * down, so the film plays the movement the moment you commit. The DOM has the
 * only honest picture of how far YOUR hand has gone, which is a live quantity
 * no clip can know, so the DOM carries the grip: a ring under your finger
 * tracking the arc, and a ratchet tooth every few degrees. Trying to animate
 * the painted arm from the two plates was the other option and it reads as a
 * double exposure rather than as motion - the arm is in two very different
 * places and a cross-fade shows you both of them at once.
 *
 * The bottom button stays. This one wants a pointer and a picture big enough
 * to aim at, and neither is true of a keyboard, a screen reader, or a phone
 * held upright, so the lever is the good way to pull it and never the only
 * way. A tap on the knob also works, because insisting on a drag would make a
 * tap look broken.
 */

/** How far down the throw counts as having pulled it. */
const THROW = 0.38
/** Degrees of arc between ratchet teeth. */
const TOOTH = 9

interface LeverProps {
  onPull: () => void
  disabled: boolean
  /** Read by anything that cannot see the picture. */
  label: string
  /**
   * Breathe until it has been used once.
   *
   * Nothing is drawn over the knob at rest, which is right and which makes it
   * invisible as a control - and on a touch screen there is no hover to find
   * it with. So it asks once, quietly, and then never again.
   */
  unused: boolean
}

export function Lever({ onPull, disabled, label, unused }: LeverProps) {
  const [grip, setGrip] = useState(0)
  const drag = useRef<{ y0: number; top: number; height: number; moved: number; tooth: number; fired: boolean } | null>(null)

  const at = leverAt(grip)

  const release = useCallback((target: HTMLElement, pointerId: number) => {
    drag.current = null
    setGrip(0)
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  }, [])

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    const frame = e.currentTarget.parentElement
    if (!frame) return
    /* The frame is measured live, not from the plate's dimensions: it is
     * responsive AND under a scale transform that follows how hard the room is
     * looking at you, so its height on screen is not something to assume. */
    const box = frame.getBoundingClientRect()
    drag.current = { y0: e.clientY, top: box.top, height: box.height, moved: 0, tooth: 0, fired: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.fired) return
    d.moved = Math.max(d.moved, Math.abs(e.clientY - d.y0))
    /* Where the hand IS, not how far it has come. See gripAtTop. */
    const next = gripAtTop(((e.clientY - d.top) / d.height) * 100)
    setGrip(next)

    const tooth = Math.floor((next * (LEVER.down.deg - LEVER.rest.deg)) / TOOTH)
    if (tooth !== d.tooth) {
      d.tooth = tooth
      leverNotch(next)
    }

    /* Fires at the clutch rather than on release, because that is where a real
     * one goes: past this point the arm is no longer yours and letting go
     * changes nothing. */
    if (next >= THROW) {
      d.fired = true
      release(e.currentTarget, e.pointerId)
      onPull()
    }
  }

  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    release(e.currentTarget, e.pointerId)
    if (d.fired) return
    // A tap, not a drag. Treat it as flicking the arm.
    if (d.moved < 6) onPull()
    else leverReturn()
  }

  return (
    <button
      type="button"
      className={`lever-knob${grip > 0 ? ' held' : ''}${unused && !disabled ? ' unused' : ''}`}
      style={{ left: `${at.left}%`, top: `${at.top}%`, ['--grip' as string]: String(grip) }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      /* Pointer events already handled the mouse and the touch. This is left
       * for the click a keyboard synthesises, which carries no pointer and so
       * reports detail 0. */
      onClick={(e) => e.detail === 0 && !disabled && onPull()}
      disabled={disabled}
      aria-label={label}
    >
      <span className="lever-ring" aria-hidden="true" />
    </button>
  )
}
