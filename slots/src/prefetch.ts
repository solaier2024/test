import { clipKind, clipUrl, plateUrl } from './art'

/** Only one encoding is ever fetched: the one this browser actually supports. */
const CLIPS = ['idle', 'pull', 'release']
const PLATES = ['machine_rest', 'machine_lean', 'machine_roar', 'machine_sigh']

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
  /*
   * The crowd plates are prefetched rather than lazily loaded because they are
   * a reaction: a plate that arrives a beat after the reel stops is a room that
   * reacts late, which reads worse than a room that does not react at all.
   */
  for (const name of PLATES) {
    const img = new Image()
    img.src = plateUrl(name)
  }
}
