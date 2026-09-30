/*
 * The panel where the player checks us.
 *
 * The important thing about this component is where the arithmetic happens: here,
 * on the player's device, in the same functions the House used. `recompute` and
 * `verifyCommitment` are imported from the game, take three strings, and touch
 * nothing on the network. A player who does not trust the panel can read the
 * formula in game/fair.ts, paste the three values into any HMAC tool, and get the
 * same bytes back - which is the reason fair.ts keys HMAC with the seed's hex text
 * rather than its bytes.
 *
 * It shows the kicks that were never taken as well as the ones that were. That is
 * not a technical requirement and it is probably the single most persuasive thing
 * in the game: a player who banked after three goals can see where he was going on
 * the fourth. It makes the commitment concrete in a way that a matching hash never
 * does, because it is about the round they actually remember.
 */

import { useMemo, useState } from 'react'
import { recompute, verifyCommitment, type PlayerView, type RoundView } from '../server/service.ts'
import type { Zone } from '../game/table.ts'
import type { Strings } from '../i18n/strings.ts'
import { ZONE_LABEL } from './zones.ts'

const short = (hex: string) => (hex.length > 20 ? `${hex.slice(0, 10)}...${hex.slice(-10)}` : hex)

/** One retired seed, and every round it produced, recomputed here. */
function Revealed({
  t,
  serverSeed,
  commitment,
  clientSeed,
  rounds,
}: {
  t: Strings
  serverSeed: string
  commitment: string
  clientSeed: string
  rounds: readonly RoundView[]
}) {
  const ok = useMemo(() => verifyCommitment(serverSeed, commitment), [serverSeed, commitment])

  return (
    <div className="revealed">
      <div className={`seal ${ok ? 'ok' : 'bad'}`}>{ok ? t.verified : t.notVerified}</div>

      <dl className="seedfields">
        <dt>{t.commitment}</dt>
        <dd className="mono">{short(commitment)}</dd>
        <dt>{t.serverSeed}</dt>
        <dd className="mono">{short(serverSeed)}</dd>
        <dt>{t.clientSeed}</dt>
        <dd className="mono">{clientSeed}</dd>
      </dl>

      {rounds.map((round) => (
        <Recomputed key={round.id} t={t} serverSeed={serverSeed} round={round} />
      ))}
    </div>
  )
}

function Recomputed({ t, serverSeed, round }: { t: Strings; serverSeed: string; round: RoundView }) {
  const rows = useMemo(
    () =>
      recompute(
        serverSeed,
        round.fair.clientSeed,
        round.fair.nonce,
        round.kicks.map((k) => ({ zone: k.zone as Zone, bribed: k.bribed })),
      ),
    [serverSeed, round],
  )

  return (
    <div className="recomputed">
      <div className="rhead">
        {t.nonce} {round.fair.nonce} &middot; {t.recomputeHelp}
      </div>
      <ol className="rkicks">
        {/* The r- prefix is not cosmetic. These classes were bare result names, and
            `goal` collided with the goal mouth's own `.goal` rule, so every scored
            kick in this list was absolutely positioned into the middle of the
            pitch. Scene classes are scene words now, and these are prefixed. */}
        {rows.map((r) => (
          <li key={r.kick} className={`r-${r.result === 'not taken' ? 'untaken' : r.result}`}>
            <span className="n">{r.kick}</span>
            <span className="d">
              {t.hisDive} {t[ZONE_LABEL[r.dive]]}
              {r.tell ? ' *' : ''}
              {/* The line the panel exists for. A player who was saved and did not call
                  it can see, for certain, that he was off his line and they missed it -
                  which is a lesson they can take to the next round. */}
              {r.stole ? <b className="stolemark"> {t.offHisLine}</b> : null}
            </span>
            <span className="s">
              {r.zone === null ? t.notTaken : `${t.yourShot} ${t[ZONE_LABEL[r.zone]]}`}
              {r.bribed ? (r.bought ? ` · ${t.boughtHim}` : ` · ${t.refusedYou}`) : ''}
            </span>
            <span className="r">
              {r.result === 'goal'
                ? t.goal
                : r.result === 'saved'
                  ? t.saved
                  : r.result === 'missed'
                    ? t.missed
                    : '—'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

interface Props {
  t: Strings
  view: PlayerView
  /** Disabled while a round is running, because revealing then would give it away. */
  canRotate: boolean
  busy: boolean
  onClientSeed(seed: string): void
  onRotate(next: string): void
}

export function Verify({ t, view, canRotate, busy, onClientSeed, onRotate }: Props) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)

  /* Rounds grouped under the seed that produced them, so a reveal can be checked
   * against the rounds it explains rather than against a flat list. */
  const byCommitment = new Map<string, RoundView[]>()
  for (const round of view.history) {
    const list = byCommitment.get(round.fair.commitment) ?? []
    list.push(round)
    byCommitment.set(round.fair.commitment, list)
  }

  return (
    <section className="verify">
      <button type="button" className="disclose" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t.fair} {open ? '−' : '+'}
      </button>

      {open && (
        <div className="verifybody">
          <dl className="seedfields">
            <dt>{t.commitment}</dt>
            <dd className="mono">{short(view.fair.commitment)}</dd>
            <dt>{t.clientSeed}</dt>
            <dd className="mono">{view.fair.clientSeed}</dd>
            <dt>{t.nonce}</dt>
            <dd>
              {view.fair.nonce} {t.rounds}
            </dd>
          </dl>

          <div className="seedform">
            <input
              value={draft}
              maxLength={64}
              placeholder={t.clientSeed}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t.clientSeed}
            />
            <button type="button" disabled={!canRotate || busy || draft.length === 0} onClick={() => onClientSeed(draft)}>
              {t.changeSeed}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canRotate || busy}
              onClick={() => onRotate(draft.length > 0 ? draft : view.fair.clientSeed)}
            >
              {t.reveal}
            </button>
          </div>
          <p className="note">{t.revealHelp}</p>

          {view.revealed.map((seed) => (
            <Revealed
              key={seed.commitment}
              t={t}
              serverSeed={seed.serverSeed}
              commitment={seed.commitment}
              clientSeed={seed.clientSeed}
              rounds={byCommitment.get(seed.commitment) ?? []}
            />
          ))}
        </div>
      )}
    </section>
  )
}
