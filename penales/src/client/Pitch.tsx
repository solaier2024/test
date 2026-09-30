/*
 * The lot. A grey box, and specific about which parts stay grey.
 *
 * WHERE THIS IS
 *
 * A dirt pitch behind a cantina somewhere on the border, tonight. Not a period
 * piece: chain link, a floodlight on a leaning pole, two pickups parked nose-in with
 * their headlights left on so the game can go past sundown. Buttes on the horizon,
 * a windpump, dust. Western as a look and a place, not as a date - so the ball is a
 * ball and the goal is galvanised pipe, and nothing here has to be argued with a
 * calendar.
 *
 * The keeper is the west: straw hat, bandana over the face, goalkeeper jersey,
 * modern gloves. A ranch hand keeping goal for money.
 *
 * WHAT THE ART DIRECTION BUYS
 *
 * The camera is behind the ball, so the taker does not exist. No body, no run up, no
 * kicking animation, no character rig - the single most expensive thing in a football
 * game is deleted by choosing where to stand.
 *
 * The keeper's face is under a hat brim and behind a bandana, so there is no face.
 * Faces are where generated footage drifts and where a character rig earns its money;
 * a brim and a kerchief are flat shapes, identical in every frame by construction. It
 * is the property a luchador's mask would buy, in the register this series is set in -
 * and a man who has pulled his bandana up is exactly the sort of man who would be
 * keeping goal for money on a lot behind a bar.
 *
 * The camera never moves, so the background is a still image. One still per venue,
 * and stills are the thing image generation is actually good at.
 *
 * Six dives, one short clip each, reused across every kick of every round.
 *
 * THE HEADLIGHTS ARE NOT DECORATION
 *
 * They are the lighting motif, and they are why this scene can be dramatic without a
 * stadium. Two beams raking across the dirt from the left give the pitch a direction
 * of light, a reason for the keeper to be a silhouette, and a reason for the ball to
 * have a hot edge on one side. A flat floodlit pitch would need real art to look like
 * anything; a pitch lit by a truck looks like something at grey-box fidelity.
 *
 * WHAT IS REAL HERE AND WHAT IS PLACEHOLDER
 *
 * Real: the layout, the perspective, the zone geometry, the timing, the reading
 * order, the touch targets, the reduced-motion path. Those have to be right before a
 * dollar of art budget is spent, because they are what the art gets made to fit.
 *
 * Placeholder: every pixel. Each is a slot with a named replacement, and the
 * replacement does not change this file's structure - a still becomes a
 * background-image, the keeper becomes a <video> whose poster is the frame the clip
 * starts on, so a failed load leaves him standing where he was rather than a hole.
 *
 * THE ANIMATION IS NEVER AUTHORITATIVE
 *
 * The ball flies because the engine said it went in, never the reverse. If the answer
 * is slow the flight holds and the UI says so; if a frame is dropped the result is
 * unaffected. Same rule the other tables arrived at: the clip is the picture, not the
 * rule.
 *
 * One exception that is not an exception: when he comes off his line early, the
 * animation shows it - he leaves before the ball does. That is a picture of something
 * the engine already decided, and the player's read of it is what section 4 of
 * PENALES.md is about. It is still not the rule. The rule is in the seed.
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
  /** He left before the ball did. Visible, and the player may call it. */
  stole?: boolean
  /** The bribe took, so he went the wrong way on purpose. */
  bought?: boolean
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
  /** Money is down on this kick with the keeper bought. Changes how he moves. */
  buying: boolean
  /**
   * Bumped once a kick has been seen through, which remounts the ball.
   *
   * Cheaper than it sounds, and it fixes something the screenshots caught: the ball
   * transitions to the zone it was struck at, and when the shot cleared it
   * transitioned BACK, so a ball that had just been saved floated gently out of the
   * goal and settled on the mark. Nobody places a ball like that. Remounting puts a
   * new one down with no transition to run, which is what happens between kicks.
   */
  ballKey: number
  onKick(zone: Zone): void
}

/*
 * Bunting over the cantina yard, sun-bleached. The colours are the family papel
 * picado uses, faded hard - saturated flags belong to a stadium and would be the only
 * new-looking thing in the picture.
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
 * El Portero. Hat, bandana, jersey, gloves - and no face, which is the whole reason
 * he looks like this.
 */
const Keeper = ({ dive, lean, bought }: { dive: Dive | null; lean: Dive | null; bought: boolean }) => {
  const at = dive === null ? null : DIVE_TO[dive]
  /* The tell: he shifts his weight before the kick. About a fifth of the dive, which
   * is enough to read at a glance and not enough to look like he has gone. */
  const hint = lean === null ? null : DIVE_TO[lean]

  const transform = at
    ? `translate(${at.x}%, ${at.y}%) rotate(${at.tilt}deg)`
    : hint
      ? `translate(${hint.x * 0.22}%, ${hint.y * 0.1}%) rotate(${hint.tilt * 0.12}deg)`
      : 'translate(0, 0)'

  return (
    <div
      className={`keeper${at ? ' diving' : ''}${hint && !at ? ' leaning' : ''}${bought ? ' bought' : ''}`}
      style={{ transform }}
    >
      <svg viewBox="0 0 160 200" width="100%" height="100%" aria-hidden="true">
        {/* Arms out and slightly down - a keeper's ready stance. Straight up reads as
            surrender, which is the wrong thing for the opponent to look like. Wide,
            because a keeper's silhouette is mostly reach. */}
        <path d="M62 76 L16 94 L11 112 L66 100 Z" fill="#2f3a44" />
        <path d="M98 76 L144 94 L149 112 L94 100 Z" fill="#2f3a44" />
        {/* Gloves. Big enough to see at the size he is actually drawn - the first pass
            made them mittens - and the warmest thing on him, so the eye tracks where
            he can get to. */}
        <path d="M2 98 q-6 12 4 19 q13 8 22 -3 l-4 -19 z" fill="#c9622f" />
        <path d="M158 98 q6 12 -4 19 q-13 8 -22 -3 l4 -19 z" fill="#c9622f" />
        <path d="M5 104 l17 -3 M8 112 l16 -3" stroke="#7d3616" strokeWidth="2" />
        <path d="M155 104 l-17 -3 M152 112 l-16 -3" stroke="#7d3616" strokeWidth="2" />

        {/* Jersey and shorts. Long sleeves, a collar, and a number nobody can read at
            this size but which stops the torso being a rectangle. */}
        <path d="M60 74 H100 L104 128 H56 Z" fill="#26313a" />
        <path d="M60 74 Q80 66 100 74 Z" fill="#2f3a44" />
        <path d="M74 70 L80 80 L86 70" fill="#3c4a56" />
        <path d="M72 92 h16 v4 h-16 z M78 96 h4 v14 h-4 z" fill="#3c4a56" opacity="0.55" />
        <path d="M58 126 H102 L100 152 H60 Z" fill="#1c252c" />
        {/* Legs, socks, boots. Apart, because a keeper stands wide. */}
        <path d="M64 150 H78 L76 178 H62 Z" fill="#5a4636" />
        <path d="M84 150 H98 L100 178 H86 Z" fill="#5a4636" />
        <path d="M61 176 H77 L78 190 H60 Z" fill="#26313a" />
        <path d="M85 176 H101 L102 190 H84 Z" fill="#26313a" />
        <path d="M56 188 H80 L80 197 H54 Z" fill="#14191e" />
        <path d="M82 188 H106 L108 197 H82 Z" fill="#14191e" />

        {/*
          The face, which is the absence of one.
          Brim shadow above, bandana below, and nothing in between but two catchlights -
          so there is no likeness to keep consistent from one frame to the next, and
          nothing for a generated dive clip to drift on.
        */}
        <ellipse cx="80" cy="44" rx="17" ry="19" fill="#6b533c" />
        <path d="M63 44 q17 10 34 0 q-2 20 -17 22 q-15 -2 -17 -22 z" fill="#a8452f" />
        <path d="M63 46 q6 4 5 10" stroke="#8a3423" strokeWidth="2" fill="none" />
        <path d="M96 44 l9 -3 l-1 8 z" fill="#8a3423" />
        <circle cx="73" cy="38" r="1.7" fill="#e8dcc0" opacity="0.8" />
        <circle cx="87" cy="38" r="1.7" fill="#e8dcc0" opacity="0.8" />

        {/* Straw hat. Crown, then the brim over everything - drawn last so its shadow
            falls across the eyes rather than behind them. */}
        <path d="M64 30 q-1 -18 16 -18 q17 0 16 18 z" fill="#b99a5e" />
        <path d="M64 25 q16 5 32 0 l0 5 q-16 5 -32 0 z" fill="#8a6f3d" />
        <ellipse cx="80" cy="31" rx="36" ry="8.5" fill="#8a6f3d" />
        <ellipse cx="80" cy="30" rx="36" ry="8.5" fill="#c2a469" />
      </svg>
    </div>
  )
}

export function Pitch({ t, board, shown, shot, live, buying, ballKey, onKick }: Props) {
  const rows = new Map(board.map((r) => [r.zone, r]))

  return (
    <div className={`pitch${shot?.stole ? ' stolen' : ''}`}>
      <div className="sky" aria-hidden="true" />
      <Bunting />
      <div className="horizon" aria-hidden="true">
        <svg viewBox="0 0 400 80" preserveAspectRatio="none" width="100%" height="100%">
          {/* Buttes, flat-topped, because that is what says "west" in one shape. */}
          {/* Tall enough to clear the crossbar and be seen against the sky. Shorter, they
              sat entirely behind the net and the horizon read as nothing at all. */}
          <path d="M0 80 L0 40 L24 40 L30 14 L74 14 L80 40 L124 40 L124 80 Z" fill="#453529" />
          <path d="M248 80 L248 32 L262 32 L268 8 L322 8 L326 32 L348 32 L348 80 Z" fill="#3e3025" />
          <path d="M0 80 L0 58 L60 51 L140 58 L210 49 L290 56 L360 49 L400 56 L400 80 Z" fill="#2e251c" />
          {/* A windpump - four straight vanes rather than a wheel, because this band is
              stretched vertically and a circle came out an oval big enough to read as a
              lasso hanging in mid-air. Straight strokes distort into straight strokes. */}
          <path
            d="M206 58 L206 32 M201 28 L211 28 M206 23 L206 34 M202 24 L210 32 M210 24 L202 32"
            stroke="#231c15"
            strokeWidth="1.6"
          />
          {/* The cantina the pitch is behind, with one lit window - the only warm
              interior in the picture and the reason anybody is out here. */}
          <path d="M132 80 L132 42 L150 34 L186 34 L186 80 Z" fill="#241d16" />
          {/* The only warm interior in the picture, and the reason anybody is out here. */}
          <path d="M156 48 H172 V60 H156 Z" fill="#ffd98a" />
          <path d="M140 52 H150 V62 H140 Z" fill="#ffd98a" opacity="0.55" />
          {/* The floodlight that does not quite cover the pitch. */}
          <path d="M366 80 L366 22" stroke="#231c15" strokeWidth="3" />
          <path d="M358 22 H376 L372 14 H362 Z" fill="#231c15" />
          <ellipse cx="367" cy="20" rx="7" ry="3" fill="#f0d79a" opacity="0.7" />
        </svg>
      </div>
      {/* Chain link. Drawn as crossed gradients rather than elements, because two
          hundred DOM nodes of fence is a phone performance bug and a gradient is free. */}
      <div className="fence" aria-hidden="true" />
      {/* Two pickups nose-in behind the fence, headlights left on. This is the lighting
          motif: it gives the dirt a direction of light and the keeper a reason to be a
          silhouette. */}
      <div className="trucks" aria-hidden="true">
        <svg viewBox="0 0 400 60" preserveAspectRatio="none" width="100%" height="100%">
          <path d="M18 60 L18 34 L44 34 L52 20 L86 20 L92 34 L118 34 L118 60 Z" fill="#1a1f24" />
          <path d="M296 60 L296 38 L318 38 L324 26 L352 26 L358 38 L378 38 L378 60 Z" fill="#161b1f" />
          {/* Left on, and bright, because they are the light source the whole scene is
              lit by. Dim they were two grey dots nobody could read as headlights. */}
          <circle cx="24" cy="30" r="9" fill="#fff8e2" opacity="0.35" />
          <circle cx="112" cy="30" r="9" fill="#fff8e2" opacity="0.35" />
          <circle cx="24" cy="30" r="4.5" fill="#fffdf4" />
          <circle cx="112" cy="30" r="4.5" fill="#fffdf4" />
          <circle cx="302" cy="34" r="7" fill="#fff8e2" opacity="0.3" />
          <circle cx="302" cy="34" r="3.5" fill="#fffdf4" />
        </svg>
      </div>
      <div className="beams" aria-hidden="true" />
      <div className="dirt" aria-hidden="true" />

      <div className="mouth">
        <div className="net" aria-hidden="true" />
        <div className="post left" aria-hidden="true" />
        <div className="post right" aria-hidden="true" />
        <div className="bar" aria-hidden="true" />

        <Keeper
          dive={shot?.phase === 'resolved' ? (shot.dive ?? null) : null}
          lean={shot === null ? shown : null}
          bought={buying}
        />

        {/* The net takes the ball. A goal has to land somewhere, and a ripple where it
            lands is the cheapest confirmation there is. */}
        {shot?.phase === 'resolved' && shot.result === 'goal' && (
          <div className={`ripple at-${shot.zone}`} aria-hidden="true" />
        )}

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
                {/* The zone's name lives in the aria-label and nowhere on screen: a third
                    line does not fit in the gap between the crossbar and the keeper's
                    head, and a player aiming at a corner does not need to be told it is a
                    corner. */}
                <span className="mult">{row?.multiplier.toFixed(2)}x</span>
                <span className="prob">{((row?.p ?? 0) * 100).toFixed(0)}%</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* The ball. Sits on the mark between kicks and flies to the chosen zone, which is
          the only thing on screen the player's choice moves. */}
      <div
        key={ballKey}
        className={`ball${shot ? ` flying to-${shot.zone}` : ''}${shot?.result === 'missed' ? ' wide' : ''}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="20" r="19" fill="#e8e2d2" />
          {/* Panels, worn and dust-stained rather than printed black - this ball has been
              on a dirt pitch. */}
          <g fill="#2b2f36">
            <path d="M20 13 L26.66 17.84 L24.11 25.66 L15.89 25.66 L13.34 17.84 Z" />
            <path d="M20 29.5 L25.23 33.3 L23.23 39.45 L16.77 39.45 L14.77 33.3 Z" />
            <path d="M34.27 19.14 L39.5 22.94 L37.5 29.09 L31.04 29.09 L29.04 22.94 Z" />
            <path d="M5.73 19.14 L10.96 22.94 L8.96 29.09 L2.5 29.09 L0.5 22.94 Z" />
            <path d="M11.18 2.36 L16.41 6.16 L14.41 12.31 L7.95 12.31 L5.95 6.16 Z" />
            <path d="M28.82 2.36 L34.05 6.16 L32.05 12.31 L25.59 12.31 L23.59 6.16 Z" />
          </g>
          <circle cx="20" cy="20" r="19" fill="#a8763f" opacity="0.16" />
          {/* The hot edge, top left, where the headlights are coming from. */}
          <ellipse cx="12" cy="10" rx="8" ry="6" fill="#fff6dd" opacity="0.4" />
        </svg>
      </div>

      {/* Dust off the mark. Only on a kick, and it is the one thing that sells the ball
          having been hit rather than having started moving. */}
      {shot !== null && <div className="dust" aria-hidden="true" />}

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
