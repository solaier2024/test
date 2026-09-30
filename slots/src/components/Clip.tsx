import { useEffect, useRef, useState } from 'react'
import { clipKind, clipPoster, clipUrl } from '../art'

/*
 * The video layer. It sits *on top of* the still plate rather than replacing it,
 * and the first and last frame of every clip is itself a plate - so the still
 * underneath has already been switched to the clip's end frame before it plays,
 * and pulling the clip away at the end cannot drop a frame.
 *
 * If it will not load, will not decode, or the network stalls, it hides itself
 * and what shows through is exactly the frame it should have finished on. A clip
 * is a picture, never a rule: nothing waits on one to keep playing.
 */

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
  const ref = useRef<HTMLVideoElement>(null)
  const [hidden, setHidden] = useState(false)
  const kind = useRef(clipKind())

  useEffect(() => {
    const el = ref.current
    if (!el || !request) return
    setHidden(false)
    el.playbackRate = request.rate ?? 1
    el.currentTime = 0
    const play = el.play()
    if (play && typeof play.catch === 'function') play.catch(() => setHidden(true))
  }, [request])

  if (!request) return null

  return (
    <video
      ref={ref}
      className={`clip${hidden ? ' gone' : ''}`}
      src={clipUrl(request.name, kind.current, small)}
      poster={clipPoster(request.name)}
      loop={request.loop}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      onError={() => setHidden(true)}
      onStalled={() => setHidden(true)}
      onEnded={() => onEnded?.(request.name)}
    />
  )
}
