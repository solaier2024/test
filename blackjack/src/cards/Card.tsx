import { memo } from 'react'
import type { Card, Rank, Suit } from '../game/types'
import type { Strings } from '../i18n/strings'

/*
 * The deck is drawn, not photographed. Fifty-two card faces as images would be
 * fifty-two more things to keep consistent with the plate underneath, and they
 * would have to be re-rendered for every size; as vectors they are sharp at any
 * scale, tint with the room's light for free, and the artwork is original, which
 * matters because vintage deck designs are not all in the public domain.
 */

const RED = '#a8232b'
const BLACK = '#181410'
const FACE = '#efe6d2'

const PIPS: Record<Suit, string> = {
  // Spade, heart, diamond and club drawn in a 100x100 box, centred on 50,50.
  S: 'M50 14c-9 16-26 24-26 40 0 10 8 17 17 17 4 0 8-2 9-4-1 8-4 14-9 19h18c-5-5-8-11-9-19 1 2 5 4 9 4 9 0 17-7 17-17 0-16-17-24-26-40z',
  H: 'M50 86C29 70 20 58 20 45c0-11 8-19 18-19 6 0 10 3 12 7 2-4 6-7 12-7 10 0 18 8 18 19 0 13-9 25-30 41z',
  D: 'M50 12 78 50 50 88 22 50z',
  C: 'M50 14c-8 0-15 7-15 15 0 4 2 8 4 10-2-1-5-2-8-2-8 0-15 7-15 15s7 15 15 15c6 0 11-3 13-8-1 9-4 15-9 20h28c-5-5-8-11-9-20 2 5 7 8 13 8 8 0 15-7 15-15s-7-15-15-15c-3 0-6 1-8 2 2-2 4-6 4-10 0-8-7-15-15-15z',
}

const GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

const isRed = (s: Suit) => s === 'H' || s === 'D'

/** Pip positions per rank, as fractions of the face, mirrored top to bottom. */
const LAYOUT: Partial<Record<Rank, [number, number][]>> = {
  '2': [[0.5, 0.18], [0.5, 0.82]],
  '3': [[0.5, 0.18], [0.5, 0.5], [0.5, 0.82]],
  '4': [[0.3, 0.18], [0.7, 0.18], [0.3, 0.82], [0.7, 0.82]],
  '5': [[0.3, 0.18], [0.7, 0.18], [0.5, 0.5], [0.3, 0.82], [0.7, 0.82]],
  '6': [[0.3, 0.18], [0.7, 0.18], [0.3, 0.5], [0.7, 0.5], [0.3, 0.82], [0.7, 0.82]],
  '7': [[0.3, 0.18], [0.7, 0.18], [0.5, 0.34], [0.3, 0.5], [0.7, 0.5], [0.3, 0.82], [0.7, 0.82]],
  '8': [[0.3, 0.18], [0.7, 0.18], [0.5, 0.34], [0.3, 0.5], [0.7, 0.5], [0.5, 0.66], [0.3, 0.82], [0.7, 0.82]],
  '9': [[0.3, 0.16], [0.7, 0.16], [0.3, 0.38], [0.7, 0.38], [0.5, 0.5], [0.3, 0.62], [0.7, 0.62], [0.3, 0.84], [0.7, 0.84]],
  '10': [[0.3, 0.16], [0.7, 0.16], [0.5, 0.27], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.5, 0.73], [0.3, 0.84], [0.7, 0.84]],
}

const COURT: Partial<Record<Rank, string>> = { J: 'J', Q: 'Q', K: 'K', A: 'A' }

interface FaceProps {
  card: Card
  /** Only for the spoken label - the printed face is a rank and a pip. */
  t: Strings
  /** Face down shows the back. */
  down?: boolean
  /** Marks the card as the one that just landed, for the drop animation. */
  fresh?: boolean
  className?: string
}

export const PlayingCard = memo(function PlayingCard({ card, t, down, fresh, className }: FaceProps) {
  const ink = isRed(card.suit) ? RED : BLACK
  const label = down
    ? t.faceDown
    : t.cardName(t.rankName[card.rank as 'A' | 'J' | 'Q' | 'K'] ?? card.rank, t.suitName[card.suit])

  return (
    <div
      className={`card${down ? ' down' : ''}${fresh ? ' fresh' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 240 336" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id="cardsheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="1" stopColor="#000" stopOpacity="0.16" />
          </linearGradient>
          <pattern id="cardback" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="24" height="24" fill="#6d1a20" />
            <path d="M12 2 22 12 12 22 2 12z" fill="none" stroke="#a8323c" strokeWidth="1.4" />
            <circle cx="12" cy="12" r="2" fill="#c8a24a" opacity="0.7" />
          </pattern>
        </defs>

        <rect x="2" y="2" width="236" height="332" rx="16" fill={down ? '#5d151b' : FACE} stroke="#241c14" strokeWidth="2.5" />

        {down ? (
          <>
            <rect x="14" y="14" width="212" height="308" rx="10" fill="url(#cardback)" />
            <rect x="14" y="14" width="212" height="308" rx="10" fill="none" stroke="#c8a24a" strokeWidth="2" opacity="0.65" />
            <circle cx="120" cy="168" r="42" fill="none" stroke="#c8a24a" strokeWidth="2.5" opacity="0.8" />
            <text x="120" y="182" textAnchor="middle" fontSize="44" fill="#c8a24a" opacity="0.9" fontFamily="Rye, Georgia, serif">C</text>
          </>
        ) : (
          <>
            {/* Index and a small pip in both opposite corners, as a real card has. */}
            {[0, 1].map((flip) => (
              <g key={flip} transform={flip ? 'rotate(180 120 168)' : undefined}>
                <text
                  x={card.rank === '10' ? 34 : 30}
                  y="66"
                  textAnchor="middle"
                  fontSize="62"
                  fontWeight="700"
                  fill={ink}
                  fontFamily="Georgia, 'Times New Roman', serif"
                >
                  {card.rank}
                </text>
                <g transform="translate(14 72) scale(0.3)">
                  <path d={PIPS[card.suit]} fill={ink} />
                </g>
              </g>
            ))}

            {COURT[card.rank] ? (
              <g>
                <rect x="62" y="96" width="116" height="150" rx="8" fill="none" stroke={ink} strokeWidth="2" opacity="0.45" />
                <text x="120" y="206" textAnchor="middle" fontSize="120" fill={ink} fontFamily="Rye, Georgia, serif" opacity="0.94">
                  {COURT[card.rank]}
                </text>
                <text x="120" y="240" textAnchor="middle" fontSize="34" fill={ink}>
                  {GLYPH[card.suit]}
                </text>
              </g>
            ) : (
              (LAYOUT[card.rank] ?? []).map(([x, y], i) => (
                <g key={i} transform={`translate(${62 + x * 116} ${96 + y * 150}) scale(0.34) translate(-50 -50)`}>
                  <path d={PIPS[card.suit]} fill={ink} />
                </g>
              ))
            )}
          </>
        )}

        <rect x="2" y="2" width="236" height="332" rx="16" fill="url(#cardsheen)" />
      </svg>
    </div>
  )
})
