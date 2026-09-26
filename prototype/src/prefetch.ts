import { useEffect } from 'react'
import { clipKind, clipUrl } from './art'

/**
 * Warms the clips a table is about to need.
 *
 * Prefetch rather than preload, so a phone on a slow connection still gets
 * the page interactive first. By the time a hand is dealt the clips are
 * usually there, and if they are not the plates cover for them.
 */
export function usePrefetchClips(names: string[], small: boolean) {
  const key = names.join(',')
  useEffect(() => {
    if (!key) return
    const kind = clipKind()
    const links = key.split(',').map((name) => {
      const el = document.createElement('link')
      el.rel = 'prefetch'
      el.as = 'video'
      el.href = clipUrl(name, kind, small)
      document.head.appendChild(el)
      return el
    })
    return () => links.forEach((el) => el.remove())
  }, [key, small])
}
