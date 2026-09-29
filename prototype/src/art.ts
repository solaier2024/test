/**
 * The character plates, room plates and action clips live in the public
 * directory, so Vite does not rewrite their URLs at build time and they have
 * to be resolved against the base path the app is served from. The preview
 * runs on a GitHub Pages project site, which is a sub-path, not the root.
 */
export const plateUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`

/**
 * Clips ship at two widths. The phone cut is a quarter of the bytes, which
 * matters most on the connection least able to afford them, and nobody can
 * see 720p worth of detail on a 390pt screen anyway.
 */
export const clipUrl = (name: string, kind: 'webm' | 'mp4', small: boolean) =>
  `${import.meta.env.BASE_URL}clips/${name}${small ? '.sm' : ''}.${kind}`

/** The frame a clip rests on, used as its poster and as its fallback still. */
export const clipPoster = (name: string) => `${import.meta.env.BASE_URL}clips/${name}.jpg`

let preferred: 'webm' | 'mp4' | null = null

/**
 * Which encoding this browser will actually pick. The <video> element is given
 * both and chooses for itself, but prefetching has to commit to one or it
 * downloads every clip twice.
 */
export function clipKind(): 'webm' | 'mp4' {
  if (preferred) return preferred
  const probe = document.createElement('video')
  preferred = probe.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'
  return preferred
}
