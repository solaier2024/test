/*
 * Nothing under public/ gets its URL rewritten by the bundler, so every runtime
 * asset path goes through BASE_URL. Rehosting the build is then a one-line
 * change in vite.config.ts rather than a hunt through the source.
 */
const base = () => import.meta.env.BASE_URL

export const plateUrl = (name: string) => `${base()}art/${name}.jpg`

export const clipUrl = (name: string, kind: 'webm' | 'mp4', small: boolean) =>
  `${base()}clips/${name}${small ? '.sm' : ''}.${kind}`

export const clipPoster = (name: string) => `${base()}clips/${name}.jpg`

/** Only one of the two encodings is ever fetched. */
export function clipKind(): 'webm' | 'mp4' {
  if (typeof document === 'undefined') return 'mp4'
  const probe = document.createElement('video')
  return probe.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'
}
