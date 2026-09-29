import type { Face as FaceName } from '../game/types'

/*
 * The symbols, drawn rather than photographed.
 *
 * They are the one thing on this table that has to stay legible at any size:
 * the whole game is the player counting how often a bell shows up on the third
 * band, and a bell they have to squint at is a game they cannot play. Paths
 * scale, a sprite sheet does not, and this way the near-miss glow can be a
 * property of the symbol rather than a second copy of the artwork.
 *
 * The drawing follows the band in the opening shot: flat hand-inked shapes in
 * two colours on cream paper, the way a fairground sign was made in 1899.
 */

const RED = '#a8232b'
const BLACK = '#1d1a16'

const PATHS: Record<FaceName, { d: string; ink: string }> = {
  bell: {
    ink: RED,
    d:
      'M50 12c-3.4 0-6 2.4-6 5.4 0 1.3.5 2.5 1.3 3.4C34.6 24 27 33.8 27 45.6v13.8L20 71h60l-7-11.6V45.6C73 33.8 65.4 24 54.7 20.8c.8-.9 1.3-2.1 1.3-3.4 0-3-2.6-5.4-6-5.4z' +
      'M39 76c0 6.1 4.9 11 11 11s11-4.9 11-11z',
  },
  shoe: {
    ink: BLACK,
    d:
      'M50 10c-17.1 0-31 14.6-31 32.6V72c0 5 4 9 9 9h8c5 0 9-4 9-9V45.5c0-3.3 2.2-5.8 5-5.8s5 2.5 5 5.8V72c0 5 4 9 9 9h8c5 0 9-4 9-9V42.6C81 24.6 67.1 10 50 10z' +
      'M25 25.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM75 25.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z' +
      'M20 41a3.6 3.6 0 1 0 0-7.2A3.6 3.6 0 0 0 20 41zM80 41a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z' +
      'M21 57a3.6 3.6 0 1 0 0-7.2A3.6 3.6 0 0 0 21 57zM79 57a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z',
  },
  star: {
    ink: RED,
    d: 'M50 8l11.1 26.7 28.9 2.4-22 19 6.6 28.2L50 69.2 25.4 84.3 32 56.1l-22-19 28.9-2.4z',
  },
  spade: {
    ink: BLACK,
    d:
      'M50 10C50 10 18 34.6 18 52.8 18 63 25.6 70 34.8 70c5.2 0 9.8-2.3 12.8-5.9-1 9.8-4.6 18-9.6 22.9h24c-5-4.9-8.6-13.1-9.6-22.9 3 3.6 7.6 5.9 12.8 5.9C74.4 70 82 63 82 52.8 82 34.6 50 10 50 10z',
  },
  diamond: {
    ink: RED,
    d: 'M50 8L78 50 50 92 22 50z',
  },
  heart: {
    ink: RED,
    d:
      'M50 88C50 88 12 62.4 12 37.6 12 24.6 21.8 15 33.6 15c7.2 0 13.4 3.6 16.4 9.2C53 18.6 59.2 15 66.4 15 78.2 15 88 24.6 88 37.6 88 62.4 50 88 50 88z',
  },
}

interface FaceProps {
  name: FaceName
  /** Set on the third band when the symbol is one row off the pay line. */
  teasing?: boolean
}

export function FaceMark({ name, teasing }: FaceProps) {
  const { d, ink } = PATHS[name]
  return (
    <svg
      className={`face face-${name}${teasing ? ' teasing' : ''}`}
      viewBox="0 0 100 100"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill={ink} />
    </svg>
  )
}
