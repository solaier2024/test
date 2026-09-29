import { useEffect, useRef, useState } from 'react'
import { clipKind, clipPoster, clipUrl } from '../art'

/*
 * The video layer: one element per clip, and the idle loop never stops.
 *
 * WHAT THIS REPLACES, because the bug it caused is worth keeping a note of. There
 * used to be a single <video> whose `src` was reassigned every time the dealer
 * changed state. Every reassignment tears the media pipeline down and builds it
 * again, so each of hit, stand, deal, shuffle, lean and settle cost a fresh
 * network fetch, a fresh demux and a fresh decode - and until the first frame of
 * that arrived the element showed its poster, which is a different pose. That is
 * the flash, and there were several of them per hand.
 *
 * So instead: every clip gets its own element and keeps it. Switching state is now
 * a change of opacity between two things that are already decoded. Three
 * consequences worth spelling out:
 *
 *   - The idle loop is a BED. It plays continuously from the moment the table
 *     opens and is never paused, so coming back to rest after any action is a
 *     crossfade onto a picture that is already running rather than a cold start,
 *     and her breathing does not restart from zero every hand.
 *   - Nothing is revealed until a frame of it has actually been painted. Showing
 *     an element the moment play() is called is what put posters on screen.
 *   - `stalled` no longer hides anything. It used to, and on a slow connection
 *     that made the dealer vanish mid-movement; a video that is waiting for data
 *     holds its last frame, which is a far better picture than none.
 *
 * A clip is still a picture, never a rule: nothing in the game waits on one, and
 * if a file will not load at all its element is marked broken and the bed carries
 * the scene.
 */

/** The bed. Starts and ends on the resting plate, so anything can cut to it. */
const BED = 'idle'

/*
 * Every clip the table can ask for. They are mounted in two waves: the bed and
 * the deal are the only two a player meets in their first ten seconds, and if all
 * six start fetching at once they starve each other on a slow connection.
 */
const FIRST = [BED, 'deal']
const REST = ['warm', 'sharp', 'shuffle', 'caught']

/** Crossfade. Both ends of every clip are the resting pose, so this is short. */
const FADE_MS = 150

export interface ClipRequest {
  name: string
  /** Bumped to replay the same clip without renaming it. */
  token: number
  loop?: boolean
  rate?: number
}

interface ClipProps {
  request: ClipRequest | null
  small: boolean
  onEnded?: (name: string) => void
}

export function Clip({ request, small, onEnded }: ClipProps) {
  const kind = useRef(clipKind())
  /*
   * Frozen at mount. Resizing across the narrow breakpoint mid-hand would
   * otherwise re-point all six elements at a different file and reload the lot,
   * which is the exact stall this component exists to remove.
   */
  const size = useRef(small)
  const els = useRef(new Map<string, HTMLVideoElement>())
  const broken = useRef(new Set<string>())

  /** Nothing is fetched until the table actually asks for a clip. */
  const [armed, setArmed] = useState(false)
  const [wave, setWave] = useState(1)
  const [showing, setShowing] = useState<string | null>(null)

  useEffect(() => {
    if (request) setArmed(true)
  }, [request])

  // Let the bed have the connection to itself until it can play through.
  useEffect(() => {
    if (!armed) return
    const bed = els.current.get(BED)
    if (!bed) return
    const go = () => setWave(2)
    if (bed.readyState >= 3) {
      go()
      return
    }
    bed.addEventListener('canplaythrough', go, { once: true })
    const t = window.setTimeout(go, 4000)
    return () => {
      bed.removeEventListener('canplaythrough', go)
      window.clearTimeout(t)
    }
  }, [armed])

  // Keep the bed running. Autoplay can be refused even on a muted element, and a
  // paused bed is a photograph - which is precisely what reviewers kept reporting.
  useEffect(() => {
    if (!armed) return
    const bed = els.current.get(BED)
    if (!bed) return
    const kick = () => {
      const p = bed.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    kick()
    const retry = window.setInterval(() => {
      if (bed.paused) kick()
    }, 1200)
    return () => window.clearInterval(retry)
  }, [armed])

  useEffect(() => {
    if (!request) {
      setShowing(null)
      return
    }
    const name = broken.current.has(request.name) ? BED : request.name
    const el = els.current.get(name)
    if (!el) return
    el.playbackRate = request.rate ?? 1

    if (name === BED) {
      setShowing(BED)
      return
    }

    let alive = true
    try {
      el.currentTime = 0
    } catch {
      // Not seekable yet, in which case it has not played and starts at zero.
    }
    const reveal = () => {
      if (alive) setShowing(name)
    }
    // The real gate: the next frame this element actually presents. Everything
    // else - play() resolving, readyState, canplay - can be true while the
    // compositor is still holding the poster.
    if ('requestVideoFrameCallback' in el) {
      el.requestVideoFrameCallback(reveal)
    }
    const fallback = window.setTimeout(reveal, FADE_MS)
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        if (alive) setShowing(BED)
      })
    }

    return () => {
      alive = false
      window.clearTimeout(fallback)
    }
  }, [request])

  // Whatever is off screen stops decoding. Six live decoders for one visible
  // picture is work the main thread can feel.
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const [name, el] of els.current) {
        if (name === BED || name === showing) continue
        if (!el.paused) el.pause()
      }
    }, FADE_MS + 60)
    return () => window.clearTimeout(t)
  }, [showing])

  if (!armed) return null

  const mounted = wave === 1 ? FIRST : [...FIRST, ...REST]

  return (
    <>
      {mounted.map((name) => (
        <video
          key={name}
          ref={(el) => {
            if (el) els.current.set(name, el)
            else els.current.delete(name)
          }}
          className={`clip${name === BED ? ' bed' : ''}${showing === name ? ' on' : ''}`}
          src={clipUrl(name, kind.current, size.current)}
          poster={clipPoster(name)}
          loop={name === BED}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={() => {
            broken.current.add(name)
            setShowing((s) => (s === name ? BED : s))
          }}
          onEnded={() => {
            if (name === BED) return
            setShowing(BED)
            onEnded?.(name)
          }}
        />
      ))}
    </>
  )
}
