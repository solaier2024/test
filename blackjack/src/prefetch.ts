import { plateUrl } from './art'

/*
 * Warm the cache for the fallback layer, and deliberately NOT for the clips.
 *
 * This used to add a <link rel="prefetch" as="video"> for all six dealer clips,
 * which downloaded every one of them TWICE. A media element streams: it asks for
 * the file with `Range: bytes=0-`, and a prefetch entry fetched without a Range
 * header does not satisfy that request, so the browser fetched the lot again the
 * moment <video> was mounted. Measured on the production build, every clip
 * appeared on the wire twice - idle 276 KB twice, natural 162 KB twice - about a
 * megabyte paid for and thrown away on the first visit.
 *
 * The clips did not need the help anyway. Clip.tsx mounts its elements in two
 * waves and lets the idle bed have the connection to itself until it can play
 * through, which is a better fetch order than a pile of prefetch hints with no
 * priority between them.
 *
 * The plates are a different case and do belong here: they are <img>, they are
 * fetched whole without a Range header, and a second <img> with the same src
 * genuinely does hit the same cache entry. They are also the fallback layer, so
 * having them early is what lets the table draw something the instant it opens.
 */
const PLATES = ['dealer_cool', 'dealer_cool_blink', 'dealer_warm', 'dealer_sharp']

let done = false

export function prefetchClips(): void {
  if (done || typeof document === 'undefined') return
  done = true
  for (const name of PLATES) {
    const img = new Image()
    img.src = plateUrl(name)
  }
}
