import { useEffect, useState } from 'react'

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handle = () => setOn(mq.matches)
    mq.addEventListener('change', handle)
    handle()
    return () => mq.removeEventListener('change', handle)
  }, [query])
  return on
}

/** Narrow enough to want the portrait layout and the smaller clip sources. */
export const useNarrow = () => useMedia('(max-width: 860px)')

/*
 * Is this connection too thin to be served the full-size video?
 *
 * VIDEO.md section 7 asked for a low-bitrate fast path on the grounds that "打开
 * 网址就能玩" is the best thing about this project and a video base is what takes
 * it away. This is the switch for it, and it is a switch rather than a guess
 * because the browser already knows: the Network Information API reports the
 * effective connection class and whether the user has asked for less data.
 *
 * Read once, at startup, and never re-read. Clip.tsx freezes its source choice at
 * mount for the same reason it freezes the size: re-pointing six video elements
 * at different files mid-hand reloads all of them, which is the exact stall that
 * component exists to prevent. A connection that improves mid-session is not worth
 * a stall, and one that degrades is already being handled by streaming.
 *
 * Absent on Safari and Firefox, where the answer is false and they get the full
 * tier - which is the right default, because their fallback is H.264 and the
 * opening's H.264 is the smaller of the two encodings anyway.
 */
export function thinConnection(): boolean {
  if (typeof navigator === 'undefined') return false
  const c = (
    navigator as unknown as {
      connection?: { effectiveType?: string; saveData?: boolean }
    }
  ).connection
  if (!c) return false
  if (c.saveData) return true
  return c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g'
}

export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

export const useTouch = () => useMedia('(hover: none)')
