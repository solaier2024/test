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
import { grito, setCue, setMood, shuffleSeam, startIntroScore, stopIntroScore } from './audio/score'
import { isMuted, onAudioState, stopThePiano, unlock } from './audio/engine'
import { purr, say, sayTotal, setVoiceEnabled, setVoiceLang, stopVoice } from './audio/voice'
import { ROSA, readDealer, reactionTo, scoreParams, type DealerRead } from './game/ai'
import {
  busted,
  canDouble,
  canSplit,
  createGame,
  double,
  edge,
  hit,
  nextRound,
  playDealer,
  pressure,
  reshuffle,
  score,
  setBet,
  split,
  stand,
  startRound,
  total,
} from './game/engine'
import { CARD_LANDS_AT, RULES, RULE_ORDER, type GameState, type RuleId } from './game/types'
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
  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang)
    setVoiceLang(lang)
    // The document language decides which voice a screen reader uses, so it has
    // to follow the toggle or Spanish is read aloud with English pronunciation.
    document.documentElement.lang = lang
  }, [lang])

  // Speech synthesis is outside WebAudio, so the mute switch has to reach it by
  // hand or she keeps talking over a silent table.
  useEffect(
    () =>
      onAudioState(() => {
        setVoiceEnabled(!isMuted())
        if (isMuted()) stopVoice()
      }),
    [],
  )

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
  const [lean, setLean] = useState(0)
  const [note, setNote] = useState<string>('')
  const [banner, setBanner] = useState<{ head: string; body?: string; good: boolean } | null>(null)
  /** How many of the round's four cards are on the felt. */
  const [revealed, setRevealed] = useState(0)
  const [busy, setBusy] = useState(false)

  const readRef = useRef<DealerRead>({ truth: 'cool', shown: 'cool', bluffing: false })
  const leaningRef = useRef(false)
  const tokenRef = useRef(0)

  /*
   * The fallback plates are warmed as soon as the opening is out of the way, and
   * deliberately not before it. Four full-frame JPEGs is about 650 KB, and firing
   * them on mount put that in front of the film on the same connection: throttled
   * to 3 Mbps the opening stalled four times, for bytes it would not need for
   * another thirteen seconds. Clip.tsx already works this way with the idle bed -
   * whatever the player is looking at gets the pipe first.
   */
  useEffect(() => {
    if (screen !== 'intro') prefetchClips()
  }, [screen])

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

  /*
   * Leaning in is free. It costs nothing and changes nothing about the cards:
   * it pushes the camera a few degrees closer, tightens the vignette and lets
   * the shoe and the chips come up in the mix. The point of the table is being
   * at it, so the one gesture that is purely about being there has no price.
   */
  const setLeaning = useCallback((on: boolean) => {
    if (leaningRef.current === on) return
    leaningRef.current = on
    setLean(on ? 1 : 0)
    sfx.leanIn(on)
  }, [])

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
      g = playDealer(g, Math.random)
      gref.current = g
      setRevealed(BEATS.length + g.dealerHand.cards.length)
      sfx.cardFlip()
      sayTotal(total(g.dealerHand.cards), 'house')
      sync()
      await sleep(reduced ? 120 : 760)
    }
    g = gref.current
    const s = g.settlement
    if (!s) return

    const head = s.perHand.includes('natural')
      ? t.natural
      : s.perHand.every((r) => r === 'bust')
        ? t.bust
        : busted(g.dealerHand.cards)
          ? t.dealerBust
          : s.net > 0
            ? t.youWin
            : s.net < 0
              ? t.youLose
              : t.push

    setBanner({ head, body: s.net !== 0 ? `${s.net > 0 ? '+' : ''}${s.net}` : undefined, good: s.net > 0 })
    setNote('')
    sfx.sting(s.net > 0)
    // Somebody in the corner lets one out when the band lands a turnaround, and
    // when you take a pot off the house.
    if (s.net > 0) grito()
    // The upright in the corner falters when a natural turns over. It is the
    // rarest hand at the table, so the room is allowed to notice it.
    if (s.perHand.includes('natural')) stopThePiano(4)
    window.setTimeout(() => {
      if (s.perHand.includes('natural')) say('blackjack', { gap: 0 })
      else if (s.perHand.every((r) => r === 'bust')) say('bust', { gap: 0 })
      else if (s.net > 0) say('win', { gap: 0 })
      else if (s.net < 0) say('lose', { gap: 0 })
      else say('push', { gap: 0 })
    }, 520)

    /*
     * Reading cool plays nothing: staying in the idle loop *is* her staying cool.
     * It used to play a `cool` clip, which ran warm -> cool, so a cool read snapped
     * her into a smile on the first frame and then eased out of it - a pose jump at
     * the end of every hand she was not reacting to.
     */
    const mood = reactionTo(s.net, s.perHand)
    if (mood === 'natural') showFace('warm', 'natural')
    else showFace(mood, mood === 'cool' ? undefined : mood)
    sync()
  }, [reduced, showFace, sync, t])

  const deal = useCallback(async () => {
    const g0 = gref.current
    if (g0.phase !== 'betting' || busy) return
    setBusy(true)
    setBanner(null)
    setRevealed(0)
    void unlock()

    setNote(t.dealing)

    const g = startRound(g0, Math.random)
    gref.current = g
    readRef.current = readDealer(g, ROSA, Math.random)
    sync()

    play('deal', { rate: 1 })
    sfx.shoeClick()
    say('deal')

    for (let i = 0; i < BEATS.length; i++) {
      const wait = BEATS[i] - (i === 0 ? 0 : BEATS[i - 1])
      await sleep(wait)
      setRevealed(i + 1)
      sfx.cardSlide()
    }

    setBusy(false)
    if (gref.current.phase === 'player') {
      // She reads your total out. This is the line that fires most often, so it
      // is the short one.
      const mine = gref.current.hands[0]
      if (mine) window.setTimeout(() => sayTotal(total(mine.cards), 'you'), 260)
      setNote(t.yourMove)
      const shown = readRef.current.shown
      showFace(shown, shown === 'cool' ? undefined : shown)
    } else {
      /*
       * A natural settles the hand before she ever gets a turn, so neither the
       * total above nor the house's fires, and the one hand most worth naming was
       * the only one she went quiet on. The deal line is already 700ms behind us,
       * so this clears the gap that keeps her from talking over herself.
       */
      const mine = gref.current.hands[0]
      if (mine) sayTotal(total(mine.cards), 'you')
      await finish()
    }
  }, [busy, finish, play, showFace, sync, t])

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
        if (what === 'hit') purr()
      }
      if (what === 'double' || what === 'split') sfx.chips(3)
      sync()
      await sleep(reduced ? 80 : 340)

      setBusy(false)
      if (gref.current.phase === 'player') {
        const h = gref.current.hands[gref.current.active]
        if (h && after > before) window.setTimeout(() => sayTotal(total(h.cards), 'you'), 120)
        setNote(t.yourMove)
      }
      else await finish()
    },
    [busy, finish, play, reduced, sync, t],
  )

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
      say('shuffle')
      // The seam: the score turns its phrase over on her shuffle, so the form is
      // longer than what is written and every reset has a reason on screen.
      shuffleSeam()
      await sleep(reduced ? 200 : 1180)
      g = reshuffle(gref.current, Math.random)
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
  }, [act, again, deal, screen, setLeaning])

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
      setVoiceEnabled(true)
      window.setTimeout(() => say('sit'), 700)
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
      lean={lean}
      note={note}
      banner={banner}
      revealed={revealed}
      busy={busy}
      narrow={narrow}
      reduced={reduced}
      onDeal={deal}
      onAct={act}
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
        if (name === 'idle' || gref.current.phase === 'over') return
        /*
         * Every clip in the vocabulary is a round trip now, so it hands back on the
         * resting pose. The still underneath is only ever the fallback, and it has
         * to match the frame the clip finished on rather than the one it held in the
         * middle - otherwise losing a clip strands her mid-expression.
         */
        setFace('cool')
        idle()
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
  lean: number
  note: string
  banner: { head: string; body?: string; good: boolean } | null
  revealed: number
  busy: boolean
  narrow: boolean
  reduced: boolean
  onDeal: () => void
  onAct: (what: 'hit' | 'stand' | 'double' | 'split') => void
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

  const over = g.phase === 'over'

  const chipSteps = useMemo(() => [g.rules.minBet, g.rules.minBet * 2, g.rules.minBet * 5, g.rules.minBet * 10], [g.rules.minBet])

  return (
    <main className={`page table-page${p.lean ? ' leaning' : ''}`}>
      <Scene
        state={p.face}
        clip={p.clip}
        small={p.narrow}
        reduced={p.reduced}
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
              <PlayingCard key={c.id} card={c} t={t} down={g.holeDown && i === 1} fresh />
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
                  {result && <i className={`tag ${result}`}>{result}</i>}
                  <span className="stake">{h.bet}</span>
                </span>
                <div className="cards">
                  {h.cards.map((c) => (
                    <PlayingCard key={c.id} card={c} t={t} fresh />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <aside className="readouts">
        <Shoe left={g.shoe.length} size={g.shoeSize} edge={e} label={t.shoeLeft} />
      </aside>

      {/* The result goes on the bare baize to the left of the cards, beside the
          chips. Centred over the picture there is no height that clears both the
          dealer and the hand labels at every window size, and in the control bar
          it costs vertical room the bar does not have. That corner is empty. */}
      {/* The outcome reaches a screen reader through a node that never unmounts.
          The visible banner is remounted on every hand so its entrance animation
          replays, and a live region that appears together with its own text is
          announced unreliably. */}
      <p className="sr-live" role="status">
        {p.banner ? [p.banner.head, p.banner.body].filter(Boolean).join('. ') : ''}
      </p>
      {p.banner && (
        <p className={`banner${p.banner.good ? ' good' : ''}`} aria-hidden="true">
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
        </div>

        {/* Narration, or the standing hint when there is nothing to narrate.
            Leaning wins over both, because that is the moment it is for. */}
        <p className={`note-line${p.lean ? ' watching' : ''}`} aria-live="polite">
          {p.lean ? t.watching : p.note || t.hint}
        </p>

        {over ? (
          <div className="over">
            <h2>{t.brokeTitle}</h2>
            <p>{t.brokeBody}</p>
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
            </div>

            <p className="keys">{t.keys}</p>
          </div>
        )}
      </div>

      <button type="button" className="chrome leave" onClick={p.onLeave}>
        {t.leave}
      </button>

      <p className="disclaimer floating">{t.disclaimer}</p>
      <Atmosphere reduced={p.reduced} heat={pressure(g)} lean={p.lean} />
    </main>
  )
}
