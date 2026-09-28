import { clipKind, clipUrl, plateUrl } from './art'

/** Only one encoding is ever fetched: the one this browser actually supports. */
const CLIPS = ['idle', 'deal', 'warm', 'sharp', 'cool', 'shuffle', 'caught']
const PLATES = ['dealer_cool', 'dealer_cool_blink', 'dealer_warm', 'dealer_sharp']

let done = false

export function prefetchClips(small: boolean): void {
  if (done || typeof document === 'undefined') return
  done = true
  const kind = clipKind()
  for (const name of CLIPS) {
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'video'
    link.href = clipUrl(name, kind, small)
    document.head.appendChild(link)
  }
  for (const name of PLATES) {
    const img = new Image()
    img.src = plateUrl(name)
  }
}
