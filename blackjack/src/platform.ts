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

export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

export const useTouch = () => useMedia('(hover: none)')
