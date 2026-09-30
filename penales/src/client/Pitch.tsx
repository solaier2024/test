/*
 * The lot. A grey box, and specific about which parts stay grey.
 *
 * WHERE THIS IS
 *
 * A vacant lot at the edge of a border cattle town, dusk, 1884 - the same night as
 * the rest of EL GARITO. Not a stadium and not a modern pitch: two timber posts
 * lashed with rope, a hand-strung net, barbed wire and a corral rail behind, mesas
 * on the horizon. A llano, a sandlot, a bit of flat dirt somebody paced out.
 *
 * WHAT THE ART DIRECTION BOUGHT
 *
 * The camera is behind the ball, so the taker does not exist. No body, no run up,
 * no kicking animation, no character rig - the single most expensive thing in a
 * football game is deleted by choosing where to stand.
 *
 * The keeper's face is under a hat brim and behind a bandana, so there is no face.
 * Faces are where generated footage drifts and where a character rig earns its
 * money; a brim and a kerchief are flat shapes that are identical in every frame by
 * construction. It is the same trick a luchador's mask would do, in the register
 * this series is actually set in - and a man who has pulled his kerchief up over
 * his nose reads as exactly the sort of man who would be keeping goal for money on
 * a lot outside town.
 *
 * The camera never moves, so the background is a still image. One still per venue,
 * and stills are the thing image generation is actually good at.
 *
 * Six dives, one short clip each, reused across all ten kicks of a round and every
 * round after it.
 *
 * WHAT IS REAL HERE AND WHAT IS PLACEHOLDER
 *
 * Real: the layout, the perspective, the zone geometry, the timing, the reading
 * order, the touch targets, the reduced-motion path. Those have to be right before
 * a dollar of art budget is spent, because they are what the art gets made to fit.
 *
 * Placeholder: every pixel. The sky is a gradient, the mesas are a polygon, the
 * keeper is two dozen SVG shapes. Each is a slot with a named replacement, and the
 * replacement does not change this file's structure - a still becomes a
 * background-image, the keeper becomes a <video> whose poster is the frame the clip
 * starts on, so a failed load leaves him standing where he was rather than leaving
 * a hole.
 *
 * TWO DETAILS THAT ARE NOT DECORATION
 *
 * Barbed wire, not chain link. Barbed wire is patented in 1874 and is the reason
 * the open range was closing in exactly these years; chain link is a twentieth
 * century product and would be the fence equivalent of putting a slot machine in
 * 1884.
 *
 * A brown laced ball, not a black-and-white one. The black-and-white truncated
 * icosahedron is the 1970 Telstar. An 1884 ball is tanned leather panels with a
 * laced slit where the bladder went in, and it is a better-looking object anyway.
 *
 * THE ANIMATION IS NEVER AUTHORITATIVE
 *
 * The ball flies because the engine said it went in, never the reverse. If the
 * answer is slow the flight holds and the UI says so; if a frame is dropped the
 * result is unaffected. Same rule the other tables in this repository arrived at:
 * the clip is the picture, not the rule.
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
   * Cheaper than it sounds, and it fixes something the screenshots caught: the ball
   * transitions to the zone it was struck at, and when the shot cleared it
   * transitioned BACK, so a ball that had just been saved floated gently out of the
   * goal and settled on the mark. Nobody places a ball like that. Remounting puts a
   * new one down with no transition to run, which is what actually happens between
   * kicks.
   */
  ballKey: number
  onKick(zone: Zone): void
}

/*
 * Bunting, sun-bleached.
 *
 * A border town on a feast day strings these up, and the colours are the same
 * family papel picado would use - which is the point, since this lot is on the
 * Mexican side of a line nobody on it took seriously. Faded hard, though: saturated
 * flags belong to a modern stadium and would be the only new-looking thing in the
 * picture.
 */
const BUNTING = ['#b4573f', '#c99a4a', '#7e8763', '#9a6b7c', '#c2b06a', '#6d7d86']

const Bunting = () => (
  <div className="bunting" aria-hidden="true">
    {Array.from({ length: 26 }, (_, i) => (
      <span
        key={i}
        className="flag"
        style={{ background: BUNTING[i % BUNTING.length], animationDelay: `${(i % 7) * 0.45}s` }}
      />
    ))}
  </div>
)

/**
 * El Portero. Hat, duster, kerchief, work gloves - and no face, which is the whole
 * reason he looks like this.
 */
const Keeper = ({ dive, lean }: { dive: Dive | null; lean: Dive | null }) => {
  const at = dive === null ? null : DIVE_TO[dive]
  /* The tell: he shifts his weight before the kick. About a fifth of the dive,
   * which is enough to read at a glance and not enough to look like he has gone. */
  const hint = lean === null ? null : DIVE_TO[lean]

  const transform = at
    ? `translate(${at.x}%, ${at.y}%) rotate(${at.tilt}deg)`
    : hint
      ? `translate(${hint.x * 0.22}%, ${hint.y * 0.1}%) rotate(${hint.tilt * 0.12}deg)`
      : 'translate(0, 0)'

  return (
    <div className={`keeper${at ? ' diving' : ''}${hint && !at ? ' leaning' : ''}`} style={{ transform }}>
      <svg viewBox="0 0 160 200" width="100%" height="100%" aria-hidden="true">
        {/* Arms out and slightly down - a keeper's ready stance. Straight up reads as
            surrender, which is the wrong thing for the opponent to look like. Wide,
            because a keeper's silhouette is mostly reach. */}
        <path d="M62 76 L16 94 L11 112 L66 100 Z" fill="#3a2f22" />
        <path d="M98 76 L144 94 L149 112 L94 100 Z" fill="#3a2f22" />
        {/* Work gloves. Tan leather, the warmest thing on him, so the eye tracks where
            he can get to - which means they have to be big enough to see at the size
            he is actually drawn. The first pass made them mittens. */}
        <path d="M2 98 q-6 12 4 19 q13 8 22 -3 l-4 -19 z" fill="#c19457" />
        <path d="M158 98 q6 12 -4 19 q-13 8 -22 -3 l4 -19 z" fill="#c19457" />
        <path d="M5 104 l17 -3 M8 112 l16 -3" stroke="#78582f" strokeWidth="2" />
        <path d="M155 104 l-17 -3 M152 112 l-16 -3" stroke="#78582f" strokeWidth="2" />

        {/* The duster, flaring to the hem. It is the silhouette, so it does the work
            a rig would otherwise have to. */}
        <path d="M60 74 H100 L112 152 H48 Z" fill="#2b241a" />
        {/* The vent, and one fold, which is all it takes to stop it reading as a bag. */}
        <path d="M80 100 V152" stroke="#1d180f" strokeWidth="2" opacity="0.7" />
        <path d="M66 82 L62 150" stroke="#1d180f" strokeWidth="1.5" opacity="0.5" />
        {/* Shoulders, so the head does not float. */}
        <path d="M60 74 Q80 66 100 74 Z" fill="#3a2f22" />
        {/* Legs and boots under the hem. */}
        <path d="M64 150 H78 L74 190 H60 Z" fill="#241d15" />
        <path d="M82 150 H96 L100 190 H86 Z" fill="#241d15" />
        <path d="M56 188 H78 L78 197 H54 Z" fill="#1a1510" />
        <path d="M82 188 H104 L106 197 H82 Z" fill="#1a1510" />

        {/*
          The face, which is the absence of one.
          Brim shadow above, kerchief below, and nothing in between but two catchlights
          - so there is no likeness to keep consistent from one frame to the next, and
          nothing for a generated dive clip to drift on. The mask a luchador would wear
          does the same job; this is that job done in 1884.
        */}
        <ellipse cx="80" cy="44" rx="17" ry="19" fill="#2b241a" />
        {/* The kerchief, pulled up over the nose, knotted at the side. */}
        <path d="M63 44 q17 10 34 0 q-2 20 -17 22 q-15 -2 -17 -22 z" fill="#a8452f" />
        <path d="M63 46 q6 4 5 10" stroke="#8a3423" strokeWidth="2" fill="none" />
        <path d="M96 44 l8 -3 l-1 7 z" fill="#8a3423" />
        {/* Two catchlights under the brim. The only thing suggesting a man in there,
            and they are deliberately not eyes. */}
        <circle cx="73" cy="38" r="1.7" fill="#d9c9a4" opacity="0.75" />
        <circle cx="87" cy="38" r="1.7" fill="#d9c9a4" opacity="0.75" />

        {/* The hat. Crown, dented, then the brim over everything - drawn last so its
            shadow falls across the eyes rather than behind them. */}
        <path d="M64 30 q-1 -18 16 -18 q17 0 16 18 z" fill="#463726" />
        <path d="M64 24 q16 5 32 0 l0 6 q-16 5 -32 0 z" fill="#2f2517" />
        <ellipse cx="80" cy="31" rx="34" ry="8" fill="#3d3022" />
        <ellipse cx="80" cy="30" rx="34" ry="8" fill="#513f2b" />
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
      <div className="horizon" aria-hidden="true">
        <svg viewBox="0 0 400 70" preserveAspectRatio="none" width="100%" height="100%">
          {/* Mesas, flat-topped, because that is what says "west" in one shape. */}
          <path d="M0 70 L0 40 L28 40 L34 26 L74 26 L80 40 L128 40 L128 70 Z" fill="#4a3b2b" />
          <path d="M250 70 L250 34 L262 34 L268 20 L318 20 L322 34 L340 34 L340 70 Z" fill="#433627" />
          <path d="M0 70 L0 52 L60 46 L140 52 L210 44 L290 50 L360 44 L400 50 L400 70 Z" fill="#332a1f" />
          {/* A water tower and a windmill, the two things on every one of these
              horizons, and the cheapest way to say this is a town and not a desert. */}
          <path d="M168 52 L168 34 L186 34 L186 52 Z" fill="#2a221a" />
          <path d="M165 34 L189 34 L177 26 Z" fill="#2a221a" />
          <path d="M172 52 L170 70 M182 52 L184 70" stroke="#2a221a" strokeWidth="2" />
          {/* A windpump, drawn as a mast and four vanes rather than as a wheel. This
              band is stretched vertically by preserveAspectRatio="none", so a circle
              here came out an oval big enough to read as a lasso hanging in mid-air.
              Straight strokes distort into straight strokes. */}
          <path d="M214 52 L214 28 M209 24 L219 24 M214 19 L214 30 M210 20 L218 28 M218 20 L210 28" stroke="#2a221a" strokeWidth="1.6" />
        </svg>
      </div>
      {/* Barbed wire on leaning posts. Drawn as backgrounds rather than elements,
          because two hundred DOM nodes of fence is a phone performance bug and a
          gradient is free. */}
      <div className="wire" aria-hidden="true" />
      <div className="dirt" aria-hidden="true" />

      <div className="mouth">
        {/* Rope, hand-strung, so the spacing is deliberately not square. Two nets are
            laid over each other at slightly different periods to break the grid -
            a ruled mesh reads as machine-made, and machine-made nets arrive in 1891. */}
        <div className="net" aria-hidden="true" />
        {/* Two timber posts and a timber crossbar, lashed at the corners. */}
        <div className="post left" aria-hidden="true" />
        <div className="post right" aria-hidden="true" />
        <div className="bar" aria-hidden="true" />

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
                {/* The zone's name lives in the aria-label and nowhere on screen: a
                    third line does not fit in the gap between the crossbar and the
                    keeper's head, and a player aiming at a corner does not need to be
                    told it is a corner. */}
                <span className="mult">{row?.multiplier.toFixed(2)}x</span>
                <span className="prob">{((row?.p ?? 0) * 100).toFixed(0)}%</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The ball. Sits on the mark between kicks and flies to the chosen zone, which
          is the only thing on screen the player's choice moves. */}
      <div
        key={ballKey}
        className={`ball${shot ? ` flying to-${shot.zone}` : ''}${shot?.result === 'missed' ? ' wide' : ''}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="20" r="19" fill="#9c6b3c" />
          {/* Tanned panels. Six of them, seamed, the way they were cut and sewn. */}
          <path d="M20 1 A19 19 0 0 1 20 39 A26 26 0 0 0 20 1 Z" fill="#8a5c31" />
          <path d="M6 8 A19 19 0 0 0 6 32 A30 30 0 0 1 6 8 Z" fill="#8a5c31" opacity="0.7" />
          <path d="M34 8 A19 19 0 0 1 34 32 A30 30 0 0 0 34 8 Z" fill="#8a5c31" opacity="0.7" />
          <path d="M20 1 A19 19 0 0 1 20 39" fill="none" stroke="#6d4622" strokeWidth="0.8" />
          <path d="M9 4 A22 22 0 0 0 9 36" fill="none" stroke="#6d4622" strokeWidth="0.8" />
          <path d="M31 4 A22 22 0 0 1 31 36" fill="none" stroke="#6d4622" strokeWidth="0.8" />
          {/* The laced slit where the bladder went in. This is the detail that dates
              the object, so it is the one detail drawn at full contrast. */}
          <path d="M11 20 H29" stroke="#553719" strokeWidth="3.4" strokeLinecap="round" />
          <path
            d="M13 17.6 L16 22.4 M16 17.6 L19 22.4 M19 17.6 L22 22.4 M22 17.6 L25 22.4 M25 17.6 L27.6 22"
            stroke="#e3cfa4"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          {/* One highlight, top left, where the sun is setting in .sky. */}
          <ellipse cx="13" cy="10" rx="7" ry="5" fill="#e8c893" opacity="0.28" />
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
