import { useEffect, useState } from 'react'

/** Subscribes to a media query and re-renders when it flips. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const sync = () => setOn(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return on
}

/**
 * Phone and small-tablet territory. Drives the portrait layout and the
 * smaller clip encodes, so it is deliberately a width test rather than a
 * touch test: a narrow desktop window has the same layout problem.
 */
export const useCompact = () => useMedia('(max-width: 860px)')

/** True where the primary input cannot hover, so hover can carry no meaning. */
export const useTouch = () => useMedia('(pointer: coarse)')

export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')
