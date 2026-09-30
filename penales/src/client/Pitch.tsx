/*
 * The picture. A grey box, and specific about which parts stay grey.
 *
 * The art direction the brief settled on is the reason this file is as small as
 * it is, so it is worth restating what it bought:
 *
 *   The camera is behind the ball, so the taker does not exist. No body, no run
 *   up, no kicking animation, no character rig - the single most expensive thing
 *   in a football game is deleted by choosing where to stand.
 *
 *   The keeper wears a lucha mask, so he has no face. Faces are where generated
 *   footage drifts and where a character rig earns its money; a mask is a flat
 *   graphic that is identical in every frame by construction, and it is also the
 *   strongest cultural signal available.
 *
 *   The camera never moves, so the background is a still image. One still per
 *   venue, and stills are the thing image generation is actually good at.
 *
 *   Six dives, one short clip each, reused across all ten kicks of a round and
 *   every round after it.
 *
 * WHAT IS REAL HERE AND WHAT IS PLACEHOLDER
 *
 * Real, and not placeholder: the layout, the perspective, the zone geometry, the
 * timing, the reading order, the touch targets, the reduced-motion path. Those are
 * the things that have to be right before a peso of art budget is spent, because
 * they are what the art has to be produced to fit.
 *
 * Placeholder: every pixel. The sky is a gradient, the stands are a polygon, the
 * keeper is nine SVG shapes. Each of them is a slot with a named replacement in
 * PENALES.md section 4, and the replacement does not change this file's structure -
 * a still becomes a background-image, the keeper becomes a <video> with a poster,
 * and the poster is the frame the clip starts on so a failed load leaves him
 * standing where he was rather than leaving a hole.
 *
 * THE ANIMATION IS NEVER AUTHORITATIVE
 *
 * The ball flies because the server said it went in, never the reverse. If the
 * response is slow the flight holds and the UI says so; if a frame is dropped the
 * result is unaffected. This is the same rule the other tables in this repository
 * ended up with - the clip is the picture, not the rule - and on a real money game
 * it stops being a nicety.
 */

import type { Dive, KickResult, Zone } from '../game/table.ts'
import { ZONES } from '../game/table.ts'
import type { Strings } from '../i18n/strings.ts'
import { DIVE_TO, GEOMETRY, ZONE_LABEL } from './zones.ts'

export interface Shot {
  zone: Zone
  /** 'flight' while the answer is still outstanding. */
  phase: 'flight' | 'resolved'
  result?: KickResult
  dive?: Dive
}

export interface BoardRow {
  zone: Zone
  p: number
  multiplier: number
}

interface Props {
  t: Strings
  board: readonly BoardRow[]
  /** His dive, when he has tipped his hand and the player may act on it. */
  shown: Dive | null
  shot: Shot | null
  /** False between rounds and while a kick is in the air. */
  live: boolean
  /**
   * Bumped once a kick has been seen through, which remounts the ball.
   *
   * Cheaper than it sounds and it fixes something the screenshots caught: the ball
   * transitions to the zone it was struck at, and when the shot cleared it
   * transitioned BACK, so a ball that had just been saved floated gently out of the
   * goal and settled on the spot. Nobody places a ball like that. Remounting puts a
   * new ball on the spot with no transition to run, which is what actually happens
   * between kicks.
   */
  ballKey: number
  onKick(zone: Zone): void
}

/*
 * Papel picado. Cut from the goal net in the brief, and moved to bunting above it
 * here for one reason: a net has to read as a net or the goal stops being a goal,
 * and the shape language of papel picado fights that at the only size it matters.
 * Strung across the top it does the same cultural work without arguing with the
 * thing the player is aiming at. The colours are the traditional set.
 */
const PAPEL = ['#e8455f', '#f2a63b', '#4bb3a8', '#8e6fc4', '#e8d24a', '#4b8fd4']

const Bunting = () => (
  <div className="bunting" aria-hidden="true">
    {Array.from({ length: 28 }, (_, i) => (
      <span key={i} className="flag" style={{ background: PAPEL[i % PAPEL.length], animationDelay: `${(i % 7) * 0.4}s` }} />
    ))}
  </div>
)

/**
 * The keeper. Masked, so there is no face to keep consistent, and drawn as flat
 * shapes rather than shaded - which is what a silhouette against a lit sky would
 * actually look like, and also what a low-polygon model would give.
 */
const Keeper = ({ dive, lean }: { dive: Dive | null; lean: Dive | null }) => {
  const at = dive === null ? null : DIVE_TO[dive]
  /* The tell: he shifts his weight before the kick. A quarter of the dive, which is
   * enough to read at a glance and not enough to look like he has already gone. */
  const hint = lean === null ? null : DIVE_TO[lean]

  const transform = at
    ? `translate(${at.x}%, ${at.y}%) rotate(${at.tilt}deg)`
    : hint
      ? `translate(${hint.x * 0.22}%, ${hint.y * 0.1}%) rotate(${hint.tilt * 0.12}deg)`
      : 'translate(0, 0)'

  return (
    <div className={`keeper${at ? ' diving' : ''}${hint && !at ? ' leaning' : ''}`} style={{ transform }}>
      <svg viewBox="0 0 160 200" width="100%" height="100%" aria-hidden="true">
        {/* Arms out and slightly down - a keeper's ready stance. Straight up reads
            as surrender, which is the wrong thing for the opponent to look like.
            Wide, because a keeper's silhouette is mostly reach. */}
        <path d="M62 74 L14 92 L10 108 L66 94 Z" fill="#1d2230" />
        <path d="M98 74 L146 92 L150 108 L94 94 Z" fill="#1d2230" />
        {/* Gloves. Saturated, so the eye tracks where he can get to. */}
        <circle cx="13" cy="103" r="14" fill="#e8455f" />
        <circle cx="147" cy="103" r="14" fill="#e8455f" />
        <path d="M6 99 A14 14 0 0 1 20 99" fill="none" stroke="#f4f1ea" strokeWidth="2.5" opacity="0.55" />
        <path d="M140 99 A14 14 0 0 1 154 99" fill="none" stroke="#f4f1ea" strokeWidth="2.5" opacity="0.55" />
        {/* Torso, narrowing to the waist, with the shoulders filled in so the head
            does not float. */}
        <path d="M62 70 H98 L101 130 H59 Z" fill="#161b26" />
        <path d="M62 70 Q80 60 98 70 Z" fill="#1d2230" />
        {/* Legs, apart, because a keeper stands wide. */}
        <path d="M61 128 H77 L71 197 H55 Z" fill="#1d2230" />
        <path d="M83 128 H99 L105 197 H89 Z" fill="#1d2230" />

        {/*
          The mask, doing three jobs at once. It is the reason there is no face to
          keep consistent across frames; it is the strongest cultural signal
          available for a Mexican product; and the empty eye holes read as a calaca,
          which puts the lucha and the Día de Muertos sides of the same visual
          family into one graphic.
          It is also the only lit thing on him, and that is deliberate. Drawn dark,
          like the rest of the silhouette, it vanished against the net and all that
          survived was the gold trim - so the character disappeared. He is a
          silhouette with a mask for a face, and the mask has to carry him.
        */}
        <ellipse cx="80" cy="40" rx="23" ry="26" fill="#1c5a63" />
        <ellipse cx="80" cy="40" rx="23" ry="26" fill="none" stroke="#0b2b30" strokeWidth="2" />
        {/* The crown, laced over the brow. */}
        <path d="M57 35 Q80 12 103 35 Q80 25 57 35 Z" fill="#e8d24a" />
        <path d="M80 14 L80 65" stroke="#e8455f" strokeWidth="6" />
        {/* Flames down the cheeks. */}
        <path d="M60 32 Q71 42 60 52" stroke="#e8d24a" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M100 32 Q89 42 100 52" stroke="#e8d24a" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* Eye holes. Empty on purpose - nothing to draw, nothing to drift - and
            rimmed, because black on a dark mask is not a hole, it is nothing. */}
        <ellipse cx="69" cy="40" rx="6.5" ry="7.5" fill="#05070a" stroke="#e8d24a" strokeWidth="1.5" />
        <ellipse cx="91" cy="40" rx="6.5" ry="7.5" fill="#05070a" stroke="#e8d24a" strokeWidth="1.5" />
        {/* Laces, the detail that makes it a mask rather than a hood. */}
        <path d="M65 25 L95 25 M67 21 L93 21" stroke="#0b2b30" strokeWidth="1.5" opacity="0.6" />
      </svg>
    </div>
  )
}

export function Pitch({ t, board, shown, shot, live, ballKey, onKick }: Props) {
  const rows = new Map(board.map((r) => [r.zone, r]))

  return (
    <div className="pitch">
      <div className="sky" aria-hidden="true" />
      <Bunting />
      <div className="stands" aria-hidden="true">
        <svg viewBox="0 0 400 60" preserveAspectRatio="none" width="100%" height="100%">
          {/* Crude terraces and the poles holding the fence up. A llano pitch. */}
          <path d="M0 60 L0 34 L40 28 L80 32 L130 24 L190 30 L250 22 L310 30 L360 26 L400 32 L400 60 Z" fill="#1b1a17" />
          {Array.from({ length: 21 }, (_, i) => (
            <rect key={i} x={i * 20} y={18} width="2" height="42" fill="#232219" />
          ))}
        </svg>
      </div>
      {/* Chain link, drawn once as a repeating gradient rather than as elements,
          because two hundred DOM nodes of fence is a scroll performance bug on a
          phone and a background is free. */}
      <div className="fence" aria-hidden="true" />
      <div className="dirt" aria-hidden="true" />

      <div className="mouth">
        <div className="net" aria-hidden="true" />
        <div className="frame" aria-hidden="true" />

        <Keeper dive={shot?.phase === 'resolved' ? (shot.dive ?? null) : null} lean={shot === null ? shown : null} />

        <div className="zones" role="group" aria-label={t.odds}>
          {ZONES.map((zone) => {
            const row = rows.get(zone)
            const g = GEOMETRY[zone]
            const chosen = shot?.zone === zone
            return (
              <button
                key={zone}
                type="button"
                className={`zone${chosen ? ' chosen' : ''}${shown === zone ? ' covered' : ''}`}
                style={{ gridColumn: g.column, gridRow: g.row }}
                disabled={!live}
                onClick={() => onKick(zone)}
                aria-label={`${t[ZONE_LABEL[zone]]}, ${t.pays} ${row?.multiplier.toFixed(2)}x, ${t.chance} ${((row?.p ?? 0) * 100).toFixed(0)}%`}
              >
                {/* The zone's name lives in the aria-label above and nowhere on
                    screen: a third line here does not fit in the gap between the
                    crossbar and the keeper's head, and a player aiming at a corner
                    does not need to be told it is a corner. */}
                <span className="mult">{row?.multiplier.toFixed(2)}x</span>
                <span className="prob">{((row?.p ?? 0) * 100).toFixed(0)}%</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The ball. Sits on the spot between kicks and flies to the chosen zone,
          which is the only thing on screen that the player's choice moves. */}
      <div
        key={ballKey}
        className={`ball${shot ? ` flying to-${shot.zone}` : ''}${shot?.result === 'missed' ? ' wide' : ''}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <defs>
            {/* The rim pentagons run off the edge of the ball, so they are clipped
                by it rather than drawn to fit - which is what makes it read as a
                sphere with a pattern wrapped round it instead of a flat badge. */}
            <clipPath id="ballclip">
              <circle cx="20" cy="20" r="19" />
            </clipPath>
          </defs>
          <circle cx="20" cy="20" r="19" fill="#f6f4ee" />
          <g clipPath="url(#ballclip)" fill="#1b1f28">
            <path d="M20 13 L26.66 17.84 L24.11 25.66 L15.89 25.66 L13.34 17.84 Z" />
            <path d="M20 29.5 L25.23 33.3 L23.23 39.45 L16.77 39.45 L14.77 33.3 Z" />
            <path d="M34.27 19.14 L39.5 22.94 L37.5 29.09 L31.04 29.09 L29.04 22.94 Z" />
            <path d="M5.73 19.14 L10.96 22.94 L8.96 29.09 L2.5 29.09 L0.5 22.94 Z" />
            <path d="M11.18 2.36 L16.41 6.16 L14.41 12.31 L7.95 12.31 L5.95 6.16 Z" />
            <path d="M28.82 2.36 L34.05 6.16 L32.05 12.31 L25.59 12.31 L23.59 6.16 Z" />
          </g>
          {/* One highlight, top left, matching where the sunset sits in .sky. */}
          <ellipse cx="13" cy="11" rx="7" ry="5" fill="#ffffff" opacity="0.3" />
        </svg>
      </div>

      {shot?.phase === 'resolved' && shot.result !== undefined && (
        <div className={`verdict ${shot.result}`} role="status">
          {shot.result === 'goal' ? t.goal : shot.result === 'saved' ? t.saved : t.missed}
        </div>
      )}
      {shot?.phase === 'flight' && (
        <div className="verdict waiting" role="status">
          {t.waiting}
        </div>
      )}
    </div>
  )
}
