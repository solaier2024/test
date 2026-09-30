/*
 * The table.
 *
 * One rule shapes the whole file, and it is the same one the other tables in this
 * repository arrived at the hard way:
 *
 *   The server's answer is the truth. The animation is a performance of it.
 *
 * So a kick does not wait for the ball to land before asking; it asks immediately
 * and then spends the flight time it has already committed to. If the answer
 * arrives early, the flight still takes FLIGHT_MS, because a keeper who dives
 * before the ball leaves the spot looks like a bug. If it arrives late, the flight
 * holds and says so - which is honest, and the alternative is a UI that decides
 * the round is lost because a packet was slow.
 *
 * Nothing on screen is ever derived from a guess about the outcome. There is no
 * optimistic update anywhere in this file, and on a real money game there must
 * not be: an optimistic goal that turns out to be a save is a player who watched
 * their money appear and then vanish.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cryptoRandom } from './game/fair.ts'
import { MAX_KICKS, MAX_WIN_MULTIPLIER, REGULATION_KICKS, RTP, type Zone } from './game/table.ts'
import { ApiError, inProcess, overHttp, type Api } from './client/api.ts'
import { Pitch, type Shot } from './client/Pitch.tsx'
import { ZONE_LABEL } from './client/zones.ts'
import { Verify } from './client/Verify.tsx'
import { House, MAX_STAKE, MIN_STAKE, type PlayerView } from './server/service.ts'
import { LOCALES, type Locale } from './i18n/strings.ts'
import './App.css'

/** Long enough to read the dive, short enough not to be in the way by kick six. */
const FLIGHT_MS = 780
const VERDICT_MS = 700

const PLAYER = 'invitado'
const DEMO_BALANCE = 50_000

const STAKES = [100, 250, 500, 1_000, 2_500, 5_000]

const pesos = (centavos: number) => (centavos / 100).toFixed(2)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One House for the life of the page when there is no server to talk to.
 *
 * The in-page House is the static preview's compromise and nothing else depends
 * on it: swapping in overHttp changes this function and no other line in the app.
 * See client/api.ts for what that does and does not prove.
 */
function connect(): Api {
  const remote = import.meta.env.VITE_API
  if (typeof remote === 'string' && remote.length > 0) return overHttp(remote)

  const house = new House(cryptoRandom)
  house.fund(PLAYER, DEMO_BALANCE, 'demo')
  return inProcess(house, PLAYER)
}

export default function App() {
  const api = useMemo(() => connect(), [])
  const [locale, setLocale] = useState<Locale>('es')
  const t = LOCALES[locale]

  const [view, setView] = useState<PlayerView | null>(null)
  const [shot, setShot] = useState<Shot | null>(null)
  /* Remounts the ball between kicks. See Pitch's `ballKey`. */
  const [ballKey, setBallKey] = useState(0)
  const [stake, setStake] = useState(500)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  /* Guards a double tap during the window where the button is still on screen but
   * the request is already out. The server is idempotent and the round's own state
   * refuses a second settlement, so this is politeness rather than safety - but a
   * player who taps twice should not see an error they did not cause. */
  const inFlight = useRef(false)

  const run = useCallback(async (job: () => Promise<PlayerView>) => {
    if (inFlight.current) return null
    inFlight.current = true
    setBusy(true)
    setRefused(null)
    try {
      const next = await job()
      setView(next)
      return next
    } catch (e) {
      setRefused(e instanceof ApiError ? e.message : (e as Error).message)
      return null
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [])

  /*
   * The first read. Not routed through `run` on purpose: `run` flips `busy`
   * synchronously, and a synchronous setState inside an effect starts a second
   * render before the first has been shown. Awaiting first also gives somewhere to
   * hang the unmount guard, which StrictMode's double-invoke needs.
   */
  useEffect(() => {
    let alive = true
    api.view().then(
      (first) => {
        if (alive) setView(first)
      },
      (e: Error) => {
        if (alive) setRefused(e.message)
      },
    )
    return () => {
      alive = false
    }
  }, [api])

  const round = view?.round ?? null
  const open = round?.status === 'open'

  const takeKick = useCallback(
    async (zone: Zone) => {
      if (round === null || !open || inFlight.current) return

      /* Ask first, then perform. The order matters: the request is not waiting on
       * an animation, so a slow frame cannot delay a settlement. */
      setShot({ zone, phase: 'flight' })
      const started = performance.now()

      const next = await run(() => api.kick(round.id, zone))
      if (next === null) {
        setShot(null)
        return
      }

      const played = next.round?.kicks.at(-1)
      await sleep(Math.max(0, FLIGHT_MS - (performance.now() - started)))
      setShot({ zone, phase: 'resolved', result: played?.result, dive: played?.dive as Zone | undefined })
      await sleep(VERDICT_MS)
      setShot(null)
      setBallKey((k) => k + 1)
    },
    [api, open, round, run],
  )

  if (view === null) {
    return (
      <main className="boot">
        <h1>{t.title}</h1>
      </main>
    )
  }

  const scored = round?.kicks.filter((k) => k.result === 'goal').length ?? 0
  const inSuddenDeath = scored >= REGULATION_KICKS
  /* Zones are live only when there is a round, it is open, and nothing is in the
   * air. Every other state is a way to take a kick that is not owed. */
  const live = open && shot === null && !busy

  return (
    <main className="table">
      <header className="top">
        <div className="brand">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="purse">
          <span className="label">{t.balance}</span>
          <strong>${pesos(view.balance)}</strong>
        </div>
        <button
          type="button"
          className="lang"
          onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
          aria-label="Language"
        >
          {locale === 'es' ? 'EN' : 'ES'}
        </button>
      </header>

      <Pitch
        t={t}
        board={round?.board ?? []}
        shown={open ? round?.shown ?? null : null}
        shot={shot}
        live={live}
        ballKey={ballKey}
        onKick={takeKick}
      />

      {open && round?.shown !== null && shot === null && (
        <div className="tell" role="status">
          <strong>{t.tell}</strong> {t.tellHelp}
        </div>
      )}

      <section className="controls">
        {round === null || !open ? (
          <div className="between">
            <div className="stakes" role="group" aria-label={t.stake}>
              {STAKES.filter((s) => s >= MIN_STAKE && s <= MAX_STAKE).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${stake === s ? ' on' : ''}`}
                  disabled={s > view.balance}
                  onClick={() => setStake(s)}
                >
                  ${pesos(s)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="go"
              disabled={busy || stake > view.balance}
              onClick={() => void run(() => api.open(stake))}
            >
              {t.newRound} &middot; ${pesos(stake)}
            </button>
          </div>
        ) : (
          <div className="during">
            <div className="ladder">
              <span className="label">
                {t.kicksTaken} {round.taken + 1} {t.of} {MAX_KICKS}
                {inSuddenDeath ? ` · ${t.suddenDeath}` : ` · ${t.regulation}`}
              </span>
              <ol className="pips">
                {Array.from({ length: MAX_KICKS }, (_, i) => {
                  const k = round.kicks[i]
                  return (
                    <li
                      key={i}
                      className={`pip ${k ? k.result : 'todo'}${i === REGULATION_KICKS ? ' split' : ''}`}
                      title={k ? `${t[ZONE_LABEL[k.zone as Zone]]}` : undefined}
                    />
                  )
                })}
              </ol>
            </div>
            <div className="bank">
              <span className="label">{t.onTheBoard}</span>
              <strong>{round.multiplier.toFixed(2)}x</strong>
            </div>
            <button
              type="button"
              className="cash"
              disabled={busy || shot !== null || round.cashOut === 0}
              onClick={() => void run(() => api.cashOut(round.id))}
            >
              {t.cashOut} &middot; ${pesos(round.cashOut)}
            </button>
          </div>
        )}

        {round !== null && !open && (
          <p className={`outcome ${round.status}`}>
            {round.status === 'cashed' && round.payout > 0
              ? `${t.cashed} ${round.multiplier.toFixed(2)}x · $${pesos(round.payout)}`
              : t.busted}
          </p>
        )}

        {refused !== null && (
          <p className="refused" role="alert">
            {t.refused}: {refused}
          </p>
        )}
      </section>

      <Verify
        t={t}
        view={view}
        canRotate={!open}
        busy={busy}
        onClientSeed={(seed) => void run(() => api.setClientSeed(seed))}
        onRotate={(next) => void run(() => api.rotateSeed(next))}
      />

      <footer className="foot">
        <p>
          {t.rtp} <strong>{(RTP * 100).toFixed(2)}%</strong> · {t.rtpNote} · {t.maxWin}{' '}
          <strong>{MAX_WIN_MULTIPLIER.toLocaleString('en-US')}x</strong>
        </p>
        <p className="quiet">{t.serverAuthoritative}</p>
        <p className="quiet">{t.demoMoney}</p>
      </footer>
    </main>
  )
}
