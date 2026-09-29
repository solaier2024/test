import { useEffect, useRef, useState } from 'react'
import { clipPoster, clipUrl } from '../art'

interface ClipProps {
  /** Base name of the clip, without size suffix or extension. */
  name: string
  /** Changing this replays the clip even when the name has not changed. */
  token?: number
  loop?: boolean
  /** Scales playback to the table's pacing, so fast tables cut faster. */
  rate?: number
  small: boolean
  className?: string
  /** Fires when the clip finishes, and also if it never manages to start. */
  onEnd?: () => void
}

/**
 * One action clip, drawn over the still plates.
 *
 * Every clip begins and ends on a frame that also exists as a plate, so the
 * layer underneath always matches the first and last frame and the video can
 * appear and disappear without a visible seam. That also makes failure cheap:
 * if the clip never loads, the plate already showing is the right picture, so
 * the component reports itself finished and gets out of the way.
 */
export function Clip({ name, token = 0, loop, rate = 1, small, className, onEnd }: ClipProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const done = useRef(false)

  // onEnd changes identity every render; a ref keeps it out of the effect deps
  // so a parent re-render cannot restart the clip mid-play.
  const endRef = useRef(onEnd)
  useEffect(() => {
    endRef.current = onEnd
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    done.current = false
    setFailed(false)

    const finish = () => {
      if (done.current) return
      done.current = true
      endRef.current?.()
    }

    el.playbackRate = rate
    el.currentTime = 0
    const started = el.play()
    if (started) {
      started.catch(() => {
        // Autoplay refused, or the file is missing. Either way the plates
        // underneath are already showing the right frame.
        setFailed(true)
        finish()
      })
    }

    if (loop) return
    el.addEventListener('ended', finish)
    return () => el.removeEventListener('ended', finish)
  }, [name, token, loop, rate, small])

  return (
    <video
      // A fresh element per clip; swapping <source> on a live one is where
      // browsers disagree most about what currentTime and play() should do.
      key={`${name}-${small}`}
      ref={ref}
      className={`clip${failed ? ' clip--failed' : ''}${className ? ' ' + className : ''}`}
      poster={clipPoster(name)}
      muted
      playsInline
      loop={loop}
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      onError={() => {
        setFailed(true)
        if (!done.current) {
          done.current = true
          endRef.current?.()
        }
      }}
    >
      <source src={clipUrl(name, 'webm', small)} type="video/webm" />
      <source src={clipUrl(name, 'mp4', small)} type="video/mp4" />
    </video>
  )
}
