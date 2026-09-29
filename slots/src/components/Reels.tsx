import { useEffect, useRef } from 'react'
import { STOPS, type Face } from '../game/types'
import { FaceMark } from './Face'
import { reelTick } from '../audio/sfx'

/*
 * The three bands.
 *
 * These are DOM, driven by the engine's own clock, and that is a decision
 * rather than an implementation detail. The tempting version of this table is
 * a video of a spinning reel: one locked-off camera, three reels turning, it is
 * exactly the shot a generative model is good at. It cannot work here.
 *
 *   - three bands of twenty stops is 8000 rests, so there is no clip per result
 *   - the whole game is the player counting how often a bell lands beside the
 *     line. If that were painted into footage they would be counting an edit
 *     rather than counting the machine, and the table would have no game in it
 *   - how long the third band hangs is decided at run time, by whether the
 *     first two matched. You cannot bake a duration you have not chosen yet
 *
 * So: video carries the hand and the lever, which are qualitative. The reels
 * are quantitative and they live here.
 */

/*
 * Rows rendered per band: the twenty stops, plus the three the window shows at
 * once so the band is still covered when it has wrapped round. Both the
 * stylesheet and the transform below are derived from this one number - see
 * the note on .strip in App.css for what happens when they disagree.
 */
const CELLS = STOPS + 3

/** Stops per second at full tilt. */
const SPEED = 26
/** How long a band takes to come down from full speed to rest. */
const BRAKE = 0.62
/** How far it travels while braking. Fixed, so every stop feels the same. */
const BRAKE_STOPS = 9

export interface ReelPlan {
  /** Engine clock, in seconds, when the band was let go. */
  from: number
  /** Where it was standing when it was let go, in stops. */
  fromPos: number
  /** Engine clock when the brake bites. */
  brakeAt: number
  /** Engine clock when it is standing still. */
  restAt: number
  /** Where it ends up, in stops, unwrapped so it is always ahead of fromPos. */
  target: number
  /** Derived: stops per second during the free run. */
  speed: number
}

/**
 * Works backwards from when the band is supposed to be standing still, because
 * that is the timing the room reacts to and it must not drift. The free-run
 * speed is whatever makes the arithmetic land on the right stop at the right
 * moment, which is within a few percent of SPEED either way.
 */
export function planReel(fromPos: number, now: number, restAt: number, stop: number): ReelPlan {
  const brakeAt = restAt - BRAKE
  const free = Math.max(0.1, brakeAt - now)
  const wanted = fromPos + SPEED * free + BRAKE_STOPS
  // The first landing at or past `wanted` that actually shows `stop`.
  const target = wanted + ((((stop - wanted) % STOPS) + STOPS) % STOPS)
  return {
    from: now,
    fromPos,
    brakeAt,
    restAt,
    target,
    speed: (target - BRAKE_STOPS - fromPos) / free,
  }
}

/** Overshoot and settle back, the way a sprung reel actually stops. */
const BACK = 0.28
function easeOutBack(u: number): number {
  const p = u - 1
  return 1 + (BACK + 1) * p ** 3 + BACK * p ** 2
}

/** Where a band is at time t. A pure function of the clock, so it cannot desync. */
export function positionAt(plan: ReelPlan | null, restPos: number, t: number): number {
  if (!plan) return restPos
  if (t <= plan.from) return plan.fromPos
  if (t >= plan.restAt) return plan.target
  if (t < plan.brakeAt) return plan.fromPos + plan.speed * (t - plan.from)
  const u = (t - plan.brakeAt) / BRAKE
  return plan.target - BRAKE_STOPS + BRAKE_STOPS * easeOutBack(u)
}

interface ReelsProps {
  bands: [Face[], Face[], Face[]]
  /** One per band, or null for a band standing still. */
  plans: [ReelPlan | null, ReelPlan | null, ReelPlan | null]
  /** Where each band is standing when it has no plan. */
  rest: [number, number, number]
  /** Engine clock in seconds. The component never reads a wall clock of its own. */
  clock: () => number
  /** The symbol the first two are holding, once they agree. Lights the misses. */
  wanted: Face | null
  muted: boolean
  reduced: boolean
}

export function Reels({ bands, plans, rest, clock, wanted, muted, reduced }: ReelsProps) {
  const strips = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)]
  const live = useRef({ plans, rest, wanted, muted, reduced })
  live.current = { plans, rest, wanted, muted, reduced }

  useEffect(() => {
    let raf = 0
    const lastStop = [-1, -1, -1]

    const frame = () => {
      const t = clock()
      const now = live.current
      for (let i = 0; i < 3; i++) {
        const el = strips[i].current
        if (!el) continue
        const pos = positionAt(now.plans[i], now.rest[i], t)
        const wrapped = ((pos % STOPS) + STOPS) % STOPS
        el.style.transform = `translate3d(0, ${-wrapped * (100 / CELLS)}%, 0)`

        // One click per stop going past the window, straight off the position.
        const whole = Math.floor(wrapped)
        if (whole !== lastStop[i]) {
          const moving = now.plans[i] && t < now.plans[i]!.restAt
          if (moving && lastStop[i] >= 0 && !now.muted && !now.reduced) {
            reelTick(now.plans[i]!.speed)
          }
          lastStop[i] = whole
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock])

  return (
    <div className="reels" style={{ ['--cells' as string]: String(CELLS) }} aria-hidden="true">
      {bands.map((band, i) => (
        <div className="reel" key={i}>
          <div className="strip" ref={strips[i]}>
            {/*
             * The strip starts one stop BEFORE the band does, and that offset
             * is what puts a stop above the pay line at every position rather
             * than only most of them.
             *
             * The window is three stops tall and the middle one pays, so the
             * band standing at stop w has to show w-1, w, w+1. Rendering the
             * band in order and sliding it up by w-1 gets w and w+1 right and
             * leaves bare paper above the line when w is 0 - which does not
             * look like an off-by-one, it looks like the symbols failed to
             * load. Starting at stop 19 and sliding up by w means row one is
             * always the stop before, wrapping included.
             */
            Array.from({ length: CELLS }, (_, k) => {
              const face = band[(k + STOPS - 1) % STOPS]
              const off = wanted !== null && i === 2 && face === wanted
              return (
                <div className="cell" key={k}>
                  <FaceMark name={face} teasing={off} />
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div className="payline" />
      <div className="glass" />
    </div>
  )
}
