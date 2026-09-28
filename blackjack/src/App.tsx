import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Scene, Shoe, type SceneState } from './components/Scene'
import { LangToggle, SoundToggle } from './components/SoundToggle'
import { Intro } from './components/Intro'
import { Atmosphere } from './fx/Atmosphere'
import { PlayingCard } from './cards/Card'
import { STRINGS, type Lang } from './i18n/strings'
import { useNarrow, useReducedMotion } from './platform'
import { prefetchClips } from './prefetch'
import * as sfx from './audio/sfx'
import { setCue, setMood, shuffleSeam, startIntroScore, stopIntroScore } from './audio/score'
import { stopThePiano, unlock } from './audio/engine'
import {
  ROSA,
  chooseCheat,
  chooseCold,
  chooseHouseRule,
  heatFromLean,
  readDealer,
  reactionTo,
  scoreParams,
  type DealerRead,
} from './game/ai'
import {
  callCheat,
  callHouseRule,
  canDouble,
  canSplit,
  coolOff,
  createGame,
  double,
  edge,
  hit,
  makeTell,
  nextRound,
  playDealer,
  reshuffle,
  score,
  setBet,
  split,
  stand,
  startRound,
  total,
} from './game/engine'
import { CARD_LANDS_AT, RULES, RULE_ORDER, type CheatKind, type GameState, type RuleId } from './game/types'
import type { ClipRequest } from './components/Clip'

type Screen = 'intro' | 'title' | 'tables' | 'table'

const INTRO_SEEN = 'dc.intro.seen'
const LANG_KEY = 'dc.lang'

/** When each of the four cards touches the felt, in ms into the deal. */
const BEATS = [130, 300, CARD_LANDS_AT, 700]

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

export default function App() {
  const narrow = useNarrow()
  const reduced = useReducedMotion()

  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(LANG_KEY) as Lang) ?? 'en')
  const t = STRINGS[lang]
  useEffect(() => localStorage.setItem(LANG_KEY, lang), [lang])

  const [screen, setScreen] = useState<Screen>(() =>
    localStorage.getItem(INTRO_SEEN) ? 'title' : 'intro',
  )

  /*
   * The authoritative copy of the game lives in a ref. Turn orchestration is
   * asynchronous - it waits on clips - so it cannot depend on the timing of a
   * re-render, and the dealer is driven by an explicit await after each of your
   * actions rather than by an effect. An effect would deadlock the moment the
   * lock was released without the state having changed.
   */
  const gref = useRef<GameState>(createGame('single'))
  const [game, setGame] = useState<GameState>(gref.current)
  const sync = useCallback(() => setGame({ ...gref.current }), [])

  const [face, setFace] = useState<SceneState>('cool')
  const [clip, setClip] = useState<ClipRequest | null>(null)
  const [flicker, setFlicker] = useState(false)
  const [lean, setLean] = useState(0)
  const [note, setNote] = useState<string>('')
  const [banner, setBanner] = useState<{ head: string; body?: string; good: boolean } | null>(null)
  /** How many of the round's four cards are on the felt. */
  const [revealed, setRevealed] = useState(0)
  const [busy, setBusy] = useState(false)

  const readRef = useRef<DealerRead>({ truth: 'cool', shown: 'cool', bluffing: false })
  const cheatRef = useRef<CheatKind | null>(null)
  const dealAtRef = useRef(0)
  const leaningRef = useRef(false)
  const tokenRef = useRef(0)

  useEffect(() => {
    prefetchClips(narrow)
  }, [narrow])

  /* ------------------------------------------------------------- the score */

  useEffect(() => {
    if (screen === 'intro') return
    setCue(screen === 'table' ? 'table' : 'title')
  }, [screen])

  useEffect(() => {
    if (screen !== 'table') return
    const p = scoreParams(game, readRef.current)
    setMood(p)
  }, [game, screen])

  /* --------------------------------------------------------------- leaning */

  const setLeaning = useCallback(
    (on: boolean) => {
      if (leaningRef.current === on) return
      leaningRef.current = on
      setLean(on ? 1 : 0)
      sfx.leanIn(on)
    },
    [],
  )

  // Watching her hands is not free: she notices, and the room notices her
  // noticing. This is the only thing that raises heat on its own.
  useEffect(() => {
    if (screen !== 'table') return
    const id = window.setInterval(() => {
      const g = gref.current
      if (g.phase === 'over') return
      if (leaningRef.current) {
        gref.current = { ...g, heat: Math.min(1, g.heat + heatFromLean(ROSA, 0.25)) }
        sync()
      } else if (g.heat > 0) {
        gref.current = coolOff(g, 0.25)
        sync()
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [screen, sync])

  /* ------------------------------------------------------------ the rounds */

  const play = useCallback(
    (name: string, opts: Partial<ClipRequest> = {}) => {
      tokenRef.current += 1
      setClip({ name, token: tokenRef.current, ...opts })
    },
    [],
  )

  const idle = useCallback(() => {
    if (reduced) {
      setClip(null)
      return
    }
    tokenRef.current += 1
    setClip({ name: 'idle', token: tokenRef.current, loop: true })
  }, [reduced])

  const showFace = useCallback(
    (next: SceneState, clipName?: string) => {
      setFace(next)
      if (clipName && !reduced) play(clipName)
    },
    [play, reduced],
  )

  const finish = useCallback(async () => {
    let g = gref.current
    if (g.phase === 'dealer') {
      setNote(t.herMove)
      g = playDealer(g, { cheat: cheatRef.current }, Math.random)
      gref.current = g
      setRevealed(BEATS.length + g.dealerHand.cards.length)
      sfx.cardFlip()
      sync()
      await sleep(reduced ? 120 : 520)
    }
    g = gref.current
    const s = g.settlement
    if (!s) return

    const head = s.caught
      ? t.caughtHer(t.cheatName[s.caught])
      : s.falseCall
        ? t.calledWrong
        : s.perHand.includes('natural')
          ? t.natural
          : s.perHand.every((r) => r === 'bust')
            ? t.bust
            : s.net > 0
              ? t.youWin
              : s.net < 0
                ? t.youLose
                : t.push

    setBanner({ head, body: s.net !== 0 ? `${s.net > 0 ? '+' : ''}${s.net}` : undefined, good: s.net > 0 })
    setNote(s.falseCall ? t.voidWhy : '')
    sfx.sting(s.net > 0)

    const mood = reactionTo(s.net, Boolean(s.caught), s.falseCall)
    if (mood === 'caught') showFace('caught', 'caught')
    else showFace(mood, mood === 'warm' ? 'warm' : mood === 'sharp' ? 'sharp' : 'cool')
    sync()
  }, [reduced, showFace, sync, t])

  /** Deals the round out, running the tell against the engine's own clock. */
  const deal = useCallback(async () => {
    const g0 = gref.current
    if (g0.phase !== 'betting' || busy) return
    setBusy(true)
    setBanner(null)
    setRevealed(0)
    void unlock()

    let g = g0
    const rule = chooseHouseRule(g, Math.random)
    if (rule) {
      g = callHouseRule(g, rule.which, rule.fee)
      setNote(t.houseCallSaid(t.houseCallName[rule.which], rule.fee))
      sfx.chips(2)
    } else {
      setNote(t.dealing)
    }

    const cheat = chooseCheat(g, ROSA, Math.random)
    cheatRef.current = cheat
    const tell = makeTell(cheat, leaningRef.current, Math.random)

    g = startRound(g, { cheat, tell }, Math.random)
    gref.current = g
    readRef.current = readDealer(g, ROSA, Math.random)
    sync()

    // The video is never the clock. Judgement runs off performance.now(), so a
    // stalled or dropped clip cannot move the window a player is aiming at.
    dealAtRef.current = performance.now()
    play('deal', { rate: 1 })
    sfx.shoeClick()

    for (let i = 0; i < BEATS.length; i++) {
      const wait = BEATS[i] - (i === 0 ? 0 : BEATS[i - 1])
      await sleep(wait)
      setRevealed(i + 1)
      sfx.cardSlide()
    }

    setBusy(false)
    if (gref.current.phase === 'player') {
      setNote(t.yourMove)
      showFace(readRef.current.shown === 'warm' ? 'warm' : readRef.current.shown === 'sharp' ? 'sharp' : 'cool',
        readRef.current.shown === 'warm' ? 'warm' : readRef.current.shown === 'sharp' ? 'sharp' : undefined)
    } else {
      await finish()
    }
  }, [busy, finish, play, showFace, sync, t])

  /** The flicker itself, fired on the engine clock and cancelled if the round ends. */
  useEffect(() => {
    if (game.phase !== 'player' && game.phase !== 'dealing') return
    const tell = game.tell
    if (!tell) return
    const elapsed = performance.now() - dealAtRef.current
    const wait = tell.at - elapsed
    if (wait < -tell.hold) return

    const on = window.setTimeout(() => {
      setFlicker(true)
      sfx.tellWhisper()
      window.setTimeout(() => setFlicker(false), tell.hold)
    }, Math.max(0, wait))
    return () => window.clearTimeout(on)
  }, [game.tell, game.phase])

  const act = useCallback(
    async (what: 'hit' | 'stand' | 'double' | 'split') => {
      const g = gref.current
      if (g.phase !== 'player' || busy) return
      setBusy(true)
      const before = g.hands.reduce((n, h) => n + h.cards.length, 0)

      let next = g
      if (what === 'hit') next = hit(g, Math.random)
      else if (what === 'stand') next = stand(g, Math.random)
      else if (what === 'double') next = double(g, Math.random)
      else next = split(g, Math.random)

      gref.current = next
      const after = next.hands.reduce((n, h) => n + h.cards.length, 0)
      if (after > before) {
        play('deal', { rate: 1.3 })
        sfx.cardSlide()
        setRevealed((r) => r + (after - before))
      }
      if (what === 'double' || what === 'split') sfx.chips(3)
      sync()
      await sleep(reduced ? 80 : 340)

      setBusy(false)
      if (gref.current.phase === 'player') setNote(t.yourMove)
      else await finish()
    },
    [busy, finish, play, reduced, sync, t],
  )

  /** You say it out loud, and the room goes quiet. */
  const callHer = useCallback(async () => {
    const g = gref.current
    if (g.called || busy) return
    if (g.phase !== 'player' && g.phase !== 'dealing') return

    const since = performance.now() - dealAtRef.current
    setBusy(true)
    sfx.callOut()
    // The oldest gesture in the genre, and free: the upright has its own bus.
    stopThePiano(6)

    const next = callCheat(g, since)
    gref.current = next
    sync()
    await sleep(reduced ? 120 : 420)
    setBusy(false)
    await finish()
  }, [busy, finish, reduced, sync])

  const again = useCallback(async () => {
    let g = nextRound(gref.current, Math.random)
    gref.current = g
    setRevealed(0)
    setBanner(null)
    sync()

    if (g.phase === 'over') {
      setCue('title')
      return
    }
    if (g.phase === 'shuffling') {
      setBusy(true)
      setNote(t.shuffling)
      showFace('shuffling', 'shuffle')
      sfx.riffle(1.1)
      // The seam: the score turns its phrase over on her shuffle, so the form is
      // longer than what is written and every reset has a reason on screen.
      shuffleSeam()
      await sleep(reduced ? 200 : 1180)
      g = reshuffle(gref.current, chooseCold(gref.current, ROSA, Math.random), Math.random)
      gref.current = g
      showFace('cool')
      idle()
      sync()
      setBusy(false)
    } else {
      idle()
    }
    setNote('')
  }, [idle, reduced, showFace, sync, t])

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    if (screen !== 'table') return
    const down = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (e.key.toLowerCase() === 'l') setLeaning(true)
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'l') return setLeaning(true)
      const g = gref.current
      if (k === 'c') return void callHer()
      if (g.phase === 'settled') {
        if (k === ' ' || k === 'enter') {
          e.preventDefault()
          return void again()
        }
        return
      }
      if (g.phase === 'betting' && (k === ' ' || k === 'enter')) {
        e.preventDefault()
        return void deal()
      }
      if (k === 'h') return void act('hit')
      if (k === 's') return void act('stand')
      if (k === 'd') return void act('double')
      if (k === 'p') return void act('split')
    }
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'l') setLeaning(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [act, again, callHer, deal, screen, setLeaning])

  /* ---------------------------------------------------------------- screens */

  const sit = useCallback(
    (id: RuleId) => {
      gref.current = createGame(id)
      setGame(gref.current)
      setFace('cool')
      setRevealed(0)
      setBanner(null)
      setNote('')
      setScreen('table')
      idle()
      void unlock()
      sfx.chips(4)
    },
    [idle],
  )

  if (screen === 'intro') {
    return (
      <Intro
        t={t}
        lang={lang}
        onLang={setLang}
        small={narrow}
        reduced={reduced}
        onDone={() => {
          localStorage.setItem(INTRO_SEEN, '1')
          stopIntroScore()
          setScreen('title')
        }}
      />
    )
  }

  if (screen === 'title') {
    return (
      <main className="page title-page">
        <div className="page-art" style={{ backgroundImage: `url(${plateBg()})` }} />
        <div className="chrome-row">
          <LangToggle lang={lang} onLang={setLang} />
          <SoundToggle t={t} />
        </div>
        <div className="title-block">
          <p className="kicker">{t.subtitle}</p>
          <h1>{t.title}</h1>
          <p className="tagline">{t.tagline}</p>
          <button type="button" className="big" onClick={() => { sfx.click(); setScreen('tables') }}>
            {t.play}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setScreen('intro')
              void unlock()
              startIntroScore(0)
            }}
          >
            {t.watchOpening}
          </button>
          <p className="disclaimer">{t.disclaimer}</p>
        </div>
        <Atmosphere reduced={reduced} heat={0} lean={0} />
      </main>
    )
  }

  if (screen === 'tables') {
    return (
      <main className="page tables-page">
        <div className="page-art dim" style={{ backgroundImage: `url(${plateBg()})` }} />
        <div className="chrome-row">
          <LangToggle lang={lang} onLang={setLang} />
          <SoundToggle t={t} />
        </div>
        <h2 className="section">{t.pickTable}</h2>
        <div className="tables">
          {RULE_ORDER.map((id) => {
            const r = RULES[id]
            return (
              <article className="table-card" key={id}>
                <h3>{t.tableName[id]}</h3>
                <p className="note">{t.tableNote[id]}</p>
                <ul className="rules">
                  <li>{t.decks(r.decks)}</li>
                  <li>{r.hitsSoft17 ? t.soft17Hits : t.soft17Stands}</li>
                  <li>{t.naturalPays(r.naturalPays[0], r.naturalPays[1])}</li>
                  <li>{t.splitsTo(r.resplits)}</li>
                  {r.houseMayRule && <li className="hot">{t.houseMayRule}</li>}
                  <li>{t.minimum(r.minBet)}</li>
                </ul>
                <button type="button" className="big" onClick={() => sit(id)}>
                  {t.sit}
                </button>
              </article>
            )
          })}
        </div>
        <p className="disclaimer">{t.disclaimer}</p>
        <Atmosphere reduced={reduced} heat={0} lean={0} />
      </main>
    )
  }

  return (
    <Table
      t={t}
      lang={lang}
      onLang={setLang}
      game={game}
      face={face}
      clip={clip}
      flicker={flicker}
      lean={lean}
      note={note}
      banner={banner}
      revealed={revealed}
      busy={busy}
      narrow={narrow}
      reduced={reduced}
      onDeal={deal}
      onAct={act}
      onCall={callHer}
      onAgain={again}
      onLean={setLeaning}
      onBet={(n) => {
        gref.current = setBet(gref.current, n)
        sync()
        sfx.chips(1)
      }}
      onLeave={() => {
        setScreen('tables')
        setCue('title')
      }}
      onClipEnded={(name) => {
        if (name !== 'idle' && gref.current.phase !== 'over') idle()
      }}
    />
  )
}

const plateBg = () => `${import.meta.env.BASE_URL}art/dealer_cool.jpg`

/* ------------------------------------------------------------------- table */

interface TableProps {
  t: ReturnType<typeof useTStub>
  lang: Lang
  onLang: (l: Lang) => void
  game: GameState
  face: SceneState
  clip: ClipRequest | null
  flicker: boolean
  lean: number
  note: string
  banner: { head: string; body?: string; good: boolean } | null
  revealed: number
  busy: boolean
  narrow: boolean
  reduced: boolean
  onDeal: () => void
  onAct: (what: 'hit' | 'stand' | 'double' | 'split') => void
  onCall: () => void
  onAgain: () => void
  onLean: (on: boolean) => void
  onBet: (n: number) => void
  onLeave: () => void
  onClipEnded: (name: string) => void
}

// Only used to give TableProps a name for the strings object without a cycle.
function useTStub() {
  return STRINGS.en
}

function Table(p: TableProps) {
  const { t, game: g } = p
  const dealerTotal = total(g.dealerHand.cards)
  const shownDealer = g.holeDown ? g.dealerHand.cards.slice(0, 1) : g.dealerHand.cards
  const shownDealerTotal = total(shownDealer)
  const e = edge(g)

  const canCall = !g.called && (g.phase === 'player' || g.phase === 'dealing')
  const over = g.phase === 'over'

  const chipSteps = useMemo(() => [g.rules.minBet, g.rules.minBet * 2, g.rules.minBet * 5, g.rules.minBet * 10], [g.rules.minBet])

  return (
    <main className={`page table-page${p.lean ? ' leaning' : ''}`}>
      <Scene
        state={p.face}
        clip={p.clip}
        small={p.narrow}
        reduced={p.reduced}
        lean={p.lean}
        flicker={p.flicker}
        onClipEnded={p.onClipEnded}
      />

      <div className="chrome-row">
        <LangToggle lang={p.lang} onLang={p.onLang} />
        <SoundToggle t={t} />
      </div>

      {/* The felt. Cards and chips are drawn here, over the footage, laid onto
          the table plane - she is video, the cards never are. Each row is
          label, cards, stake in one line, so nothing can land on top of
          anything else however many cards a hand ends up holding. */}
      <div className={`felt${g.hands.length > 1 ? ' split' : ''}`}>
        <div className="hand dealer">
          <span className="hand-label">
            <em>{t.herHand}</em>
            <b>{g.holeDown ? shownDealerTotal : dealerTotal}</b>
          </span>
          <div className="cards">
            {g.dealerHand.cards.map((c, i) => (
              <PlayingCard key={c.id} card={c} down={g.holeDown && i === 1} fresh />
            ))}
          </div>
        </div>

        <div className="hands-row">
          {g.hands.map((h, i) => {
            const s = score(h.cards)
            const result = g.settlement?.perHand[i]
            return (
              <div className={`hand player${i === g.active && g.phase === 'player' ? ' active' : ''}`} key={i}>
                <span className="hand-label">
                  <em>{t.yourHand}</em>
                  <b className={s.total > 21 ? 'bust' : ''}>{s.total}</b>
                  {h.doubled && <i className="tag">×2</i>}
                  {result && (
                    <i className={`tag ${g.settlement?.falseCall ? 'voided' : result}`}>
                      {g.settlement?.falseCall ? t.voidTag : result}
                    </i>
                  )}
                  <span className="stake">{h.bet}</span>
                </span>
                <div className="cards">
                  {h.cards.map((c) => (
                    <PlayingCard key={c.id} card={c} fresh />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <aside className="readouts">
        <Shoe left={g.shoe.length} size={g.shoeSize} edge={e} label={t.shoeLeft} />
        <div className="gauge">
          <span className="gauge-label">{t.heat}</span>
          <div className="gauge-body">
            <div className="gauge-fill" style={{ width: `${g.heat * 100}%` }} />
          </div>
          <span className="tally">{t.callsMade(g.seen.calls, g.seen.caught)}</span>
        </div>
      </aside>

      {/* The result goes on the bare baize to the left of the cards, beside the
          chips. Centred over the picture there is no height that clears both the
          dealer and the hand labels at every window size, and in the control bar
          it costs vertical room the bar does not have. That corner is empty. */}
      {p.banner && (
        <p className={`banner${p.banner.good ? ' good' : ''}`}>
          <strong>{p.banner.head}</strong>
          {p.banner.body && <span>{p.banner.body}</span>}
        </p>
      )}

      <div className="hud">
        <div className="money">
          <span>
            {t.chips}
            <b>{g.chips}</b>
          </span>
          <span>
            {t.bet}
            <b>{g.bet}</b>
          </span>
          {g.houseCall && (
            <em className="house-call">
              {t.houseCallName[g.houseCall]} <b data-fee={g.houseFee}>+{g.houseFee}</b>
            </em>
          )}
        </div>

        <p className="note-line">{p.note || '\u00a0'}</p>

        {over ? (
          <div className="over">
            <h2>{g.heat >= 1 ? t.thrownTitle : t.brokeTitle}</h2>
            <p>{g.heat >= 1 ? t.thrownBody : t.brokeBody}</p>
            <button type="button" className="big" onClick={p.onLeave}>
              {t.again}
            </button>
          </div>
        ) : (
          <div className="controls">
            <div className="acts">
              {/* Chips share the action row. Their own row made the bar taller in
                  the betting phase than in any other, and on a short window that
                  overflow landed on the felt. */}
              {g.phase === 'betting' && (
                <>
                  {chipSteps.map((n) => (
                    <button
                      type="button"
                      key={n}
                      className={`chip${g.bet === n ? ' on' : ''}`}
                      onClick={() => p.onBet(n)}
                      disabled={n > g.chips}
                    >
                      {n}
                    </button>
                  ))}
                  <button type="button" data-act="deal" className="act primary" onClick={p.onDeal} disabled={p.busy}>
                    {t.deal}
                  </button>
                </>
              )}

              {g.phase === 'player' && (
                <>
                  <button type="button" data-act="hit" className="act primary" onClick={() => p.onAct('hit')} disabled={p.busy}>
                    {t.hit}
                  </button>
                  <button type="button" data-act="stand" className="act" onClick={() => p.onAct('stand')} disabled={p.busy}>
                    {t.stand}
                  </button>
                  <button type="button" data-act="double" className="act" onClick={() => p.onAct('double')} disabled={p.busy || !canDouble(g)}>
                    {t.double}
                  </button>
                  <button type="button" data-act="split" className="act" onClick={() => p.onAct('split')} disabled={p.busy || !canSplit(g)}>
                    {t.split}
                  </button>
                </>
              )}

              {g.phase === 'settled' && (
                <button type="button" data-act="next" className="act primary wide" onClick={p.onAgain} disabled={p.busy}>
                  {t.next}
                </button>
              )}

              <span className="acts-gap" aria-hidden="true" />

              {/* Hold to lean in. A plain click toggles instead: holding a button
                  down is not possible for every player and both are equivalent. */}
              <button
                type="button"
                data-act="lean"
                className={`act lean${p.lean ? ' on' : ''}`}
                onPointerDown={() => p.onLean(true)}
                onPointerUp={() => p.onLean(false)}
                onPointerLeave={() => p.onLean(false)}
                onClick={(ev) => {
                  if (ev.detail === 0) p.onLean(!p.lean)
                }}
              >
                {p.lean ? t.leaning : t.lean}
              </button>
              <button type="button" data-act="call" className={`act call${canCall ? ' live' : ''}`} onClick={p.onCall} disabled={!canCall || p.busy}>
                {t.call}
              </button>
            </div>

            <p className="keys">{t.keys}</p>
          </div>
        )}
      </div>

      <button type="button" className="chrome leave" onClick={p.onLeave}>
        {t.leave}
      </button>

      <p className="hint">{p.lean ? t.tellHint : t.watchHands}</p>
      <p className="disclaimer floating">{t.disclaimer}</p>
      <Atmosphere reduced={p.reduced} heat={g.heat} lean={p.lean} />
    </main>
  )
}
