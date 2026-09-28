import { useCallback, useEffect, useRef, useState } from 'react'
import { plateUrl } from './art'
import { Scene, type ClipRequest, type SceneState } from './components/Scene'
import { usePrefetchClips } from './prefetch'
import { Cylinder } from './components/Cylinder'
import { Intro } from './components/Intro'
import { LangToggle } from './components/LangToggle'
import { SoundToggle } from './components/SoundToggle'
import { useCompact, useReducedMotion, useTouch } from './platform'
import {
  OPPONENTS,
  OPPONENT_ORDER,
  chooseBet,
  choosePass,
  chooseTarget,
  readDealer,
  respondToRaise,
  type DealerRead,
  type OpponentId,
} from './game/ai'
import {
  advanceRound,
  anteFor,
  call,
  canCall,
  canPass,
  canRaise,
  canShootSelf,
  createGame,
  dealerChoosesLoad,
  fire,
  fold,
  isCertain,
  liveOdds,
  liveRemaining,
  maxRaise,
  passIron,
  raise,
  startRound,
} from './game/engine'
import { MODES, MODE_ORDER, type Chamber, type GameState, type ModeId, type Side, type Target } from './game/types'
import { Atmosphere } from './fx/Atmosphere'
import { STRINGS, loadLang, saveLang } from './i18n/strings'
import {
  playChips,
  playClick,
  playCock,
  playGunshot,
  playHeartbeat,
  playSpin,
  playSting,
  setVenue,
  startAmbience,
  unlockAudio,
} from './audio/sfx'
import { setCue, setIntensity, setTempoScale } from './audio/music'
import './App.css'

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

type Screen = 'intro' | 'title' | 'menu' | 'table'

/** Filename stem each opponent's plates and clips are named after. */
const STEM: Record<OpponentId, string> = {
  calloway: 'cowboy',
  viuda: 'viuda',
}

/** The plate each opponent's picker portrait is cropped out of. */
const PORTRAIT: Record<OpponentId, string> = {
  calloway: 'cowboy_neutral',
  viuda: 'viuda_neutral',
}

/**
 * Authored length of each action clip at normal speed. Used only for the
 * watchdog: if a clip stalls mid-download the table has to carry on anyway,
 * and the plate underneath is already the frame the clip would have ended on.
 */
const CLIP_MS = { raise: 970, fire: 700, hit: 1500, chamber: 2430 }

const SEEN_INTRO = 'lastround.intro'

interface TellRecord {
  wasBluff: boolean
}

export default function App() {
  const compact = useCompact()
  const touch = useTouch()
  const stillness = useReducedMotion()

  const [lang, setLang] = useState(loadLang)
  const [screen, setScreen] = useState<Screen>(() =>
    // The opening is worth eleven seconds once, not on every reload.
    stillness || localStorage.getItem(SEEN_INTRO) ? 'title' : 'intro',
  )
  const [modeId, setModeId] = useState<ModeId>('classic')
  const [opponentId, setOpponentId] = useState<OpponentId>('calloway')

  const [state, setState] = useState<GameState>(() => createGame('classic'))
  const [loadChoice, setLoadChoice] = useState(2)
  const [raiseAmount, setRaiseAmount] = useState(20)
  const [sceneState, setSceneState] = useState<SceneState>('neutral')
  const [flash, setFlash] = useState(0)
  const [flashSource, setFlashSource] = useState<Side | null>(null)
  const [hurt, setHurt] = useState(false)
  const [snap, setSnap] = useState(false)
  const [zoom, setZoom] = useState(0)
  const [smokeBursts, setSmokeBursts] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [caption, setCaption] = useState('')
  const [tells, setTells] = useState<TellRecord[]>([])
  const [read, setRead] = useState<DealerRead | null>(null)
  /** Player chips when the hand was dealt, so the result can show the swing. */
  const [handOpening, setHandOpening] = useState(0)
  /** True while a shot or an opponent decision is playing out; locks input. */
  const [cinematic, setCinematic] = useState(false)

  /**
   * The ref is the authoritative game state. React state is a render mirror,
   * because the round orchestrator is async and cannot wait for re-renders.
   */
  const stateRef = useRef<GameState>(state)
  const busyRef = useRef(false)

  const t = STRINGS[lang]
  const persona = OPPONENTS[opponentId]
  const stem = STEM[opponentId]
  const mode = state.mode
  /** Every cinematic pause is scaled by the table's pacing. */
  const beat = useCallback((ms: number) => wait(ms * mode.pacing), [mode.pacing])

  /* ---- action clips ---------------------------------------------------- */

  const [clip, setClip] = useState<ClipRequest | null>(null)
  const clipToken = useRef(0)
  const clipEnd = useRef<(() => void) | null>(null)

  const onClipEnd = useCallback(() => {
    const resolve = clipEnd.current
    clipEnd.current = null
    resolve?.()
  }, [])

  /**
   * Plays one clip and settles when it finishes. Clips are pictures, not
   * rules: a slow connection or a codec the browser will not touch must never
   * be able to stop a hand, so the wait is always bounded and the plates
   * underneath are left showing the frame the clip was going to end on.
   */
  const playClip = useCallback(
    (name: string, authoredMs: number) => {
      const rate = 1 / mode.pacing
      clipToken.current += 1
      setClip({ name, token: clipToken.current, rate })
      return Promise.race([
        new Promise<void>((resolve) => {
          clipEnd.current = resolve
        }),
        wait(authoredMs / rate + 700),
      ])
    },
    [mode.pacing],
  )

  /*
   * Breathing, between beats. It is a loop rather than a one-shot, so it is
   * derived from the settled state instead of being driven: anything the
   * table asks for explicitly takes the layer over.
   */
  const idleClip: ClipRequest | null =
    !clip && sceneState === 'neutral' && !stillness
      ? { name: `${stem}_idle`, token: 0, loop: true }
      : null

  usePrefetchClips(
    screen === 'title' || screen === 'menu' || screen === 'table'
      ? [
          `${stem}_idle`,
          `${stem}_raise`,
          `${stem}_fire`,
          `${stem}_hit`,
          `chamber_${persona.venue}`,
        ]
      : [],
    compact,
  )

  const commit = useCallback((s: GameState) => {
    stateRef.current = s
    setState(s)
  }, [])

  useEffect(() => {
    saveLang(lang)
    document.documentElement.lang = lang === 'es' ? 'es-MX' : 'en'
  }, [lang])

  useEffect(() => {
    setVenue(persona.venue)
  }, [persona.venue])

  /*
   * The score follows the screen. The opening's own cue is started by the
   * Intro itself, because only it knows how far into the film we are; this
   * just makes sure the looping arrangement is out of the way first.
   */
  useEffect(() => {
    setCue(screen)
  }, [screen])

  useEffect(() => {
    setTempoScale(mode.pacing)
  }, [mode.pacing])

  /*
   * Creating the context up front costs nothing and arms the listener that
   * releases it on the player's first touch, whatever that touch was for.
   */
  useEffect(() => {
    unlockAudio()
    return () => setCue('none')
  }, [])

  const odds = liveOdds(state)
  const left = liveRemaining(state)
  const bluffsSeen = tells.length
  const bluffsCaught = tells.filter((x) => x.wasBluff).length

  /** Refreshes the opponent's shown mood and records whether it was a bluff. */
  const refreshTell = useCallback(
    (s: GameState) => {
      const r = readDealer(s, persona)
      setRead(r)
      setSceneState(r.shown)
      if (r.shown !== 'neutral') setTells((prev) => [...prev, { wasBluff: r.bluffing }])
    },
    [persona],
  )

  /** Plays a shot as a beat of cinema rather than an instant state change. */
  const playShot = useCallback(
    async (shooter: Side, target: Target) => {
      const s = stateRef.current
      setZoom(1)
      /** True when we are watching them bring the gun up on us. */
      const drawnOnYou = shooter === 'dealer' && target === 'opponent'
      /** Your own pulse, only when the cylinder has earned it. */
      const pulse = liveOdds(s) >= 0.55

      if (drawnOnYou) {
        // The plate is set first and the clip laid over it, so the dissolve
        // to the aiming frame happens out of sight behind the video and the
        // clip's last frame lands on a plate that has already settled.
        setSceneState('aiming')
        setCaption(t.beats.theyAimYou)
        if (pulse) playHeartbeat()
        await playClip(`${stem}_raise`, CLIP_MS.raise)
      } else if (shooter === 'dealer') {
        setCaption(t.beats.theyAimSelf)
        await beat(800)
      } else {
        setCaption(target === 'self' ? t.beats.youAimSelf : t.beats.youAimThem)
        if (pulse) playHeartbeat()
        await beat(600)
      }

      playCock()
      await beat(560)

      const result = fire(s, shooter, target)

      if (result.chamber === 'live') {
        // Swap the plate under the flash rather than dissolving through it.
        setSnap(true)
        playGunshot()
        setFlashSource(shooter)
        setFlash((n) => n + 1)
        setSmokeBursts((n) => n + 1)
        if (result.victim === 'player') {
          setHurt(true)
          setCaption(t.beats.bangYou)
          if (drawnOnYou) await playClip(`${stem}_fire`, CLIP_MS.fire)
        } else {
          setSceneState('hit')
          setCaption(t.beats.bangThem)
          await playClip(`${stem}_hit`, CLIP_MS.hit)
        }
      } else {
        playClick()
        setCaption(result.blankAnte > 0 ? t.beats.blankBonus(result.blankAnte) : t.beats.click)
      }

      /*
       * Let the shot land before the board updates. Where a clip already
       * played the picture has had its time, so only the beats that ran on
       * stills need the long hold.
       */
      const held = result.chamber !== 'live' ? 900 : result.victim === 'player' ? 1500 : 800
      await beat(held)
      commit(result.state)
      setClip(null)
      setZoom(0)
      setHurt(false)
      setSnap(false)
      if (result.state.phase === 'round_over') playSting(result.state.outcome?.winner === 'player')
      if (result.state.phase === 'betting') refreshTell(result.state)
    },
    [beat, commit, playClip, refreshTell, stem, t],
  )

  /** Runs exactly one opponent decision against the authoritative state. */
  const dealerStep = useCallback(async () => {
    await beat(750)
    let s = stateRef.current

    if (s.phase === 'facing_raise') {
      const answer = respondToRaise(s, persona)
      if (answer === 'fold') {
        setCaption(t.beats.theyFold)
        const next = fold(s, 'dealer')
        commit(next)
        playSting(true)
        return
      }
      playChips()
      setCaption(t.beats.theyCall)
      s = call(s, 'dealer')
      commit(s)
      await beat(800)
      if (s.turn !== 'dealer') return
    }

    if (s.phase !== 'betting') return

    const bet = chooseBet(s, persona)
    if (bet.action === 'raise') {
      playChips()
      setCaption(t.beats.theyRaise(bet.amount))
      commit(raise(s, 'dealer', bet.amount))
      return
    }

    if (choosePass(s, persona)) {
      playChips()
      setCaption(t.beats.theyPass)
      commit(passIron(s, 'dealer'))
      return
    }

    await playShot('dealer', chooseTarget(s, persona))
  }, [beat, commit, persona, playShot, t])

  /**
   * Drives the opponent until the table is waiting on the player again. Called
   * explicitly after every player action, so no state change can be missed.
   */
  const pump = useCallback(async () => {
    let guard = 0
    while (guard++ < 60) {
      const s = stateRef.current
      const dealerToAct =
        s.turn === 'dealer' && (s.phase === 'betting' || s.phase === 'facing_raise')
      if (!dealerToAct) return
      await dealerStep()
    }
  }, [dealerStep])

  /**
   * The last chamber is always live, and so is every chamber once the blanks
   * are gone. At that point the turn holder has exactly one move that is not
   * a way of losing on purpose, so the table makes it instead of asking: a
   * choice between winning and losing is not a choice, it is a button.
   */
  const resolveForced = useCallback(async () => {
    const s = stateRef.current
    if (s.phase !== 'betting' || s.turn !== 'player' || !isCertain(s)) return
    setCaption(t.beats.nothingLeft)
    await beat(900)
    await playShot('player', 'opponent')
  }, [beat, playShot, t])

  /** Serialises every player-initiated action against the opponent driver. */
  const act = useCallback(
    async (fn: () => Promise<void> | void) => {
      if (busyRef.current) return
      busyRef.current = true
      setCinematic(true)
      try {
        await fn()
        await pump()
        await resolveForced()
      } finally {
        busyRef.current = false
        setCinematic(false)
      }
    },
    [pump, resolveForced],
  )

  /** Leaves the title card for the table picker. */
  const openMenu = () => {
    unlockAudio()
    startAmbience()
    setScreen('menu')
  }

  const leaveIntro = useCallback(() => {
    localStorage.setItem(SEEN_INTRO, '1')
    setScreen('title')
  }, [])

  const sitDown = () => {
    unlockAudio()
    startAmbience()
    const fresh = createGame(modeId)
    commit(fresh)
    setLoadChoice(MODES[modeId].loads[0])
    setSceneState('neutral')
    setTells([])
    setRead(null)
    setCaption('')
    setScreen('table')
  }

  const onLoad = () =>
    act(async () => {
      unlockAudio()
      const current = stateRef.current
      const live = current.mode.loadedBy === 'dealer' ? dealerChoosesLoad(current.mode) : loadChoice
      setLoadChoice(live)
      setSpinning(true)
      playSpin()
      setCaption(current.mode.loadedBy === 'dealer' ? t.beats.dealerLoads(live) : t.beats.loading)
      // Cut away to the cylinder itself rather than narrating it over a still.
      await playClip(`chamber_${persona.venue}`, CLIP_MS.chamber)
      setClip(null)
      const s = startRound(current, live)
      commit(s)
      setHandOpening(s.chips.player + s.ante)
      setSpinning(false)
      setRaiseAmount(Math.max(s.mode.anteBase, Math.round(s.pot * 0.4)))
      refreshTell(s)
      setCaption(s.turn === 'player' ? t.beats.sealedYouFirst : t.beats.sealedTheyFirst)
      await beat(500)
    })

  const onPlayerFire = (target: Target) => act(() => playShot('player', target))

  const onPlayerRaise = () =>
    act(async () => {
      const amount = Math.min(raiseAmount, maxRaise(stateRef.current, 'player'))
      playChips()
      setCaption(t.beats.youRaise(amount))
      commit(raise(stateRef.current, 'player', amount))
      await beat(600)
    })

  const onPlayerCall = () =>
    act(async () => {
      playChips()
      setCaption(t.beats.youCall)
      commit(call(stateRef.current, 'player'))
      await beat(600)
    })

  const onPlayerFold = () =>
    act(async () => {
      setCaption(t.beats.youFold)
      commit(fold(stateRef.current, 'player'))
      playSting(false)
      await beat(400)
    })

  const onPlayerPass = () =>
    act(async () => {
      playChips()
      setCaption(t.beats.youPass)
      commit(passIron(stateRef.current, 'player'))
      await beat(600)
    })

  const onNextRound = useCallback(() => {
    // A second tap before React has swapped the panel must not deal twice.
    if (busyRef.current || stateRef.current.phase !== 'round_over') return
    commit(advanceRound(stateRef.current))
    setSceneState('neutral')
    setRead(null)
    setCaption('')
  }, [commit])

  const onRematch = () => {
    commit(createGame(modeId))
    setLoadChoice(MODES[modeId].loads[0])
    setSceneState('neutral')
    setTells([])
    setRead(null)
    setCaption('')
  }

  const playerToAct =
    !cinematic &&
    state.turn === 'player' &&
    (state.phase === 'betting' || state.phase === 'facing_raise')
  const waitingOnDealer =
    state.turn === 'dealer' && (state.phase === 'betting' || state.phase === 'facing_raise')
  const raiseCap = Math.max(1, maxRaise(state, 'player'))
  const clampedRaise = Math.min(raiseAmount, raiseCap)
  const canLoad = state.phase === 'loading' && !cinematic
  const raiseOpen = playerToAct && state.phase === 'betting' && canRaise(state, 'player')
  const passOpen = playerToAct && canPass(state, 'player')
  /*
   * Everything a certain chamber takes off the table. The hand normally never
   * reaches the player with one of these showing, because `resolveForced`
   * settles it first, but the buttons answer to the rules rather than to the
   * orchestrator so that a beat missed here can only cost a beat.
   */
  const selfOpen = playerToAct && canShootSelf(state, 'player')
  const callOpen = playerToAct && canCall(state, 'player')
  /*
   * Once a hand is settled the board stops describing it. The narration would
   * otherwise collide with the result panel, and the odds and the read on
   * their face are both stale the moment the cylinder is revealed.
   */
  const handLive = state.phase === 'betting' || state.phase === 'facing_raise'
  const settled = state.phase === 'round_over' || state.phase === 'match_over'
  const oddsShown = handLive && state.cylinder.length > 0
  const sidePanels = oddsShown || Boolean(read && handLive)
  /*
   * One word for how bad it is, so the readout, the bar and the two shooting
   * buttons can all answer to the same thing instead of each carrying their
   * own threshold and drifting apart.
   */
  const heat = odds >= 1 ? 'certain' : odds >= 0.6 ? 'hot' : odds >= 0.4 ? 'warm' : 'cool'

  /*
   * The arrangement is gated on how likely the next chamber is to be live, so
   * a cylinder that is nearly all live rounds sounds like one: the gallop
   * comes in, the guitar starts tremolo picking, the choir climbs. This is
   * the whole reason the music engine takes a number rather than a preset.
   */
  useEffect(() => {
    if (screen !== 'table') setIntensity(0)
    // Loading sits under the gallop's threshold on purpose: the table is
    // quiet until there is something in the cylinder to be afraid of.
    else if (!handLive) setIntensity(0.06)
    else setIntensity(0.16 + odds * 0.84)
  }, [screen, handLive, odds])

  /* Keyboard shortcuts keep a fast table fast; every one mirrors a button. */
  useEffect(() => {
    if (screen !== 'table') return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return
      const key = e.key.toLowerCase()
      if (key === ' ') {
        e.preventDefault()
        if (canLoad) onLoad()
        else if (state.phase === 'round_over' && !cinematic) onNextRound()
        else if (callOpen) onPlayerCall()
        return
      }
      if (!playerToAct) return
      if (key === '1' && selfOpen) onPlayerFire('self')
      if (key === '2' && state.phase === 'betting') onPlayerFire('opponent')
      if (key === 'r' && raiseOpen) onPlayerRaise()
      if (key === 'p' && passOpen) onPlayerPass()
      if (key === 'f' && state.phase === 'facing_raise') onPlayerFold()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const swing = state.outcome ? state.chips.player - handOpening : 0

  if (screen === 'intro') {
    return (
      <div className="app">
        <Intro t={t} lang={lang} onLang={setLang} small={compact} onDone={leaveIntro} />
      </div>
    )
  }

  if (screen === 'title') {
    return (
      <div className="app">
        <Scene
          opponent={opponentId}
          state="neutral"
          flash={0}
          flashSource={null}
          hurt={false}
          zoom={0}
          showRevolver
          snap={false}
          clip={idleClip}
          small={compact}
          touch={touch}
        />
        <Atmosphere smokeBursts={0} />
        <div className="toolbar">
          <LangToggle lang={lang} onPick={setLang} />
          <SoundToggle t={t} />
        </div>
        <div className="title">
          <p className="title__kicker">{t.title.kicker}</p>
          <h1 className="title__name">{t.title.name}</h1>
          <p className="title__sub">
            {t.title.tagline.split('\n').map((line, i) => (
              <span key={i}>
                {line}
                <br />
              </span>
            ))}
          </p>
          <button className="btn btn--primary btn--lg" onClick={openMenu}>
            {t.title.sit}
          </button>
          <button className="linkbtn" onClick={() => setScreen('intro')}>
            {t.intro.replay}
          </button>
          <p className="title__note">{t.title.disclaimer}</p>
        </div>
      </div>
    )
  }

  if (screen === 'menu') {
    const picked = MODES[modeId]
    const copy = t.modes[modeId]
    return (
      <div className="app">
        <Scene
          opponent={opponentId}
          state="neutral"
          flash={0}
          flashSource={null}
          hurt={false}
          zoom={0}
          showRevolver
          snap={false}
          clip={idleClip}
          small={compact}
          touch={touch}
        />
        <Atmosphere smokeBursts={0} />
        <div className="toolbar">
          <LangToggle lang={lang} onPick={setLang} />
          <SoundToggle t={t} />
        </div>
        <div className="menu">
          <h2 className="menu__heading">{t.menu.chooseTable}</h2>

          <div className="menu__cols">
            <section className="menu__col">
              <h3 className="menu__label">{t.menu.chooseMode}</h3>
              <div className="menu__list">
                {MODE_ORDER.map((id) => (
                  <button
                    key={id}
                    className={`pick${modeId === id ? ' is-on' : ''}`}
                    onClick={() => setModeId(id)}
                  >
                    <span className="pick__name">{t.modes[id].name}</span>
                    <span className="pick__tag">{t.modes[id].tag}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="menu__col">
              <h3 className="menu__label">{t.menu.chooseOpponent}</h3>
              <div className="menu__list">
                {OPPONENT_ORDER.map((id) => (
                  <button
                    key={id}
                    className={`pick pick--who${opponentId === id ? ' is-on' : ''}`}
                    onClick={() => setOpponentId(id)}
                  >
                    <span
                      className={`pick__face pick__face--${id}`}
                      style={{ backgroundImage: `url(${plateUrl(PORTRAIT[id])})` }}
                    />
                    <span className="pick__who">
                      <span className="pick__name">{t.opponents[id].name}</span>
                      <span className="pick__tag">{t.opponents[id].where}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="menu__col menu__col--wide">
              <h3 className="menu__label">{t.menu.rules}</h3>
              <p className="menu__blurb">{copy.blurb}</p>
              <ul className="menu__rules">
                {copy.rules.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <dl className="menu__stats">
                <div>
                  <dt>{t.menu.chambers}</dt>
                  <dd>{picked.chambers}</dd>
                </div>
                <div>
                  <dt>{t.menu.stakes}</dt>
                  <dd>
                    {anteFor(picked, Math.min(...picked.loads))}–
                    {anteFor(picked, Math.max(...picked.loads))}
                  </dd>
                </div>
                <div>
                  <dt>{t.menu.betting}</dt>
                  <dd>{picked.betting ? t.menu.bettingOn : t.menu.bettingOff}</dd>
                </div>
              </dl>
              <p className="menu__blurb menu__blurb--who">{t.opponents[opponentId].blurb}</p>
            </section>
          </div>

          <div className="menu__go">
            <button className="btn" onClick={() => setScreen('title')}>
              {t.menu.back}
            </button>
            <button className="btn btn--primary btn--lg" onClick={sitDown}>
              {t.menu.deal}
            </button>
          </div>
          <p className="title__note">{t.title.disclaimer}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Scene
        opponent={opponentId}
        state={sceneState}
        flash={flash}
        flashSource={flashSource}
        hurt={hurt}
        zoom={zoom}
        showRevolver={state.phase !== 'loading' && sceneState !== 'aiming'}
        snap={snap}
        clip={clip ?? idleClip}
        onClipEnd={onClipEnd}
        small={compact}
        touch={touch}
      />
      <Atmosphere smokeBursts={smokeBursts} />
      <div className="toolbar toolbar--corner">
        <SoundToggle t={t} />
      </div>

      <div className={`hud heat-${oddsShown ? heat : 'cool'}`}>
        <header className="hud__top">
          <div className={`chipstack${waitingOnDealer ? ' is-active' : ''}`}>
            <span className="chipstack__label">{t.opponents[opponentId].name}</span>
            <span className="chipstack__value">{state.chips.dealer}</span>
            <span className="chipstack__turn">{waitingOnDealer ? t.hud.thinking : ''}</span>
          </div>
          <div className="pot">
            <span className="pot__label">{t.hud.pot}</span>
            <span className="pot__value">{state.pot}</span>
            <span className="pot__round">
              {t.modes[mode.id].name} · {t.hud.round} {state.round}
            </span>
          </div>
          <div className={`chipstack chipstack--me${playerToAct ? ' is-active' : ''}`}>
            <span className="chipstack__label">{t.hud.you}</span>
            <span className="chipstack__value">{state.chips.player}</span>
            <span className="chipstack__turn">{playerToAct ? t.hud.yourTurn : ''}</span>
          </div>
        </header>

        <aside className={`readout${sidePanels ? '' : ' readout--bare'}`}>
          <Cylinder
            size={compact ? (sidePanels ? 78 : 88) : 132}
            live={state.phase === 'loading' ? loadChoice : state.loadedLive}
            chambers={mode.chambers}
            fired={state.fired}
            liveLeft={left}
            mode={
              state.phase !== 'loading'
                ? 'sealed'
                : mode.loadedBy === 'dealer'
                  ? 'unknown'
                  : 'open'
            }
            spinning={spinning}
            liveLabel={t.hud.live}
            blankLabel={t.hud.blanks}
          />
          {oddsShown && (
            <div className={`readout__odds is-${heat}`}>
              <span className="readout__oddsLabel">{t.hud.liveNext}</span>
              {/* Keyed on the number so a changed chamber remounts it and the
                  odds tick over rather than silently becoming a worse figure. */}
              <span className="readout__oddsValue" key={Math.round(odds * 100)}>
                {Math.round(odds * 100)}%
              </span>
              <div className="readout__bar">
                <div className="readout__barFill" style={{ width: `${odds * 100}%` }} />
              </div>
              {odds >= 1 && <span className="readout__warn">{t.hud.certain}</span>}
            </div>
          )}
          {read && handLive && (
            <div className="readout__tell">
              <span className="readout__tellLabel">{t.hud.tell}</span>
              <span className="readout__tellValue">
                {read.shown === 'confident'
                  ? t.hud.tellEasy
                  : read.shown === 'rattled'
                    ? t.hud.tellRattled
                    : t.hud.tellCalm}
              </span>
              <span className="readout__tellHint">{t.hud.tellCounter(bluffsSeen, bluffsCaught)}</span>
            </div>
          )}
        </aside>

        {caption && !(settled && !cinematic) && <div className="caption">{caption}</div>}

        <footer className="actions">
          {canLoad && (
            <div className="loadpanel">
              <p className="loadpanel__title">
                {mode.loadedBy === 'dealer' ? t.load.dealerPicks : t.load.question}
              </p>
              {mode.loadedBy === 'player' && mode.loads.length > 1 && (
                <div className="loadpanel__choices">
                  {mode.loads.map((n) => (
                    <button
                      key={n}
                      className={`chamberbtn${loadChoice === n ? ' is-on' : ''}`}
                      onClick={() => setLoadChoice(n)}
                    >
                      <span className="chamberbtn__n">{n}</span>
                      <span className="chamberbtn__x">{anteFor(mode, n)}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="loadpanel__hint">
                {mode.loadedBy === 'dealer'
                  ? t.load.dealerHint(
                      anteFor(mode, Math.min(...mode.loads)),
                      anteFor(mode, Math.max(...mode.loads)),
                    )
                  : t.load.hint(anteFor(mode, loadChoice))}
              </p>
              <button className="btn btn--primary" onClick={onLoad} disabled={spinning}>
                {t.load.go}
              </button>
            </div>
          )}

          {playerToAct && state.phase === 'betting' && (
            <div className={`actionrow${selfOpen ? '' : ' actionrow--single'}`}>
              {mode.betting && (
                <div className="raisebox">
                  <span className="raisebox__label">{t.actions.raiseLabel}</span>
                  <input
                    type="range"
                    min={1}
                    max={raiseCap}
                    value={clampedRaise}
                    onChange={(e) => setRaiseAmount(Number(e.target.value))}
                    disabled={!raiseOpen}
                  />
                  <button className="btn btn--slim" onClick={onPlayerRaise} disabled={!raiseOpen}>
                    {t.actions.push(clampedRaise)}
                  </button>
                </div>
              )}
              {passOpen && (
                <button className="btn btn--slim btn--pass" onClick={onPlayerPass}>
                  {t.actions.pass}
                  <small>{t.actions.passHint(mode.passToll)}</small>
                </button>
              )}
              {selfOpen && (
                <button className="btn btn--risk" onClick={() => onPlayerFire('self')}>
                  {t.actions.atSelf}
                  <small>{t.actions.atSelfHint}</small>
                </button>
              )}
              <button className="btn btn--kill" onClick={() => onPlayerFire('opponent')}>
                {selfOpen ? t.actions.atThem : t.actions.onlyShot}
                <small>{selfOpen ? t.actions.atThemHint : t.actions.onlyShotHint}</small>
              </button>
            </div>
          )}

          {playerToAct && state.phase === 'facing_raise' && (
            <div className={`actionrow${callOpen ? '' : ' actionrow--single'}`}>
              <div className="callnote">
                {callOpen ? t.actions.owed(state.toCall) : t.actions.nothingToCall}
              </div>
              {callOpen && (
                <button className="btn btn--primary" onClick={onPlayerCall}>
                  {t.actions.call(Math.min(state.toCall, state.chips.player))}
                </button>
              )}
              <button className={`btn${callOpen ? '' : ' btn--primary'}`} onClick={onPlayerFold}>
                {t.actions.fold}
                <small>{t.actions.foldHint}</small>
              </button>
            </div>
          )}

          {state.phase === 'round_over' && !cinematic && state.outcome && (
            <div className="result">
              <p
                className={`result__line${
                  state.outcome.winner === 'player' ? ' is-win' : ' is-loss'
                }`}
              >
                {state.outcome.winner === 'player'
                  ? t.result.youWin(state.outcome.pot)
                  : t.result.youLose(state.outcome.pot)}
                {state.outcome.reason === 'fold' ? t.result.byFold : ''}
              </p>
              <p className={`result__swing${swing >= 0 ? ' is-win' : ' is-loss'}`}>
                {swing >= 0 ? '+' : '−'}
                {Math.abs(swing)}
              </p>
              <Reveal chambers={state.outcome.revealed} label={t.result.chambersWere} />
              <div className="actionrow">
                <button className="btn btn--quiet" onClick={() => setScreen('menu')}>
                  {t.result.changeTable}
                </button>
                <button className="btn btn--primary" onClick={onNextRound}>
                  {t.result.next}
                </button>
              </div>
            </div>
          )}

          {state.phase === 'match_over' && (
            <div className="result">
              <p className="result__line">
                {state.chips.player <= 0 ? t.result.matchLost : t.result.matchWon}
              </p>
              <div className="actionrow">
                <button className="btn" onClick={() => setScreen('menu')}>
                  {t.result.changeTable}
                </button>
                <button className="btn btn--primary" onClick={onRematch}>
                  {t.result.rematch}
                </button>
              </div>
            </div>
          )}
        </footer>

        <p className="keyhint">
          {[
            t.keys.fire,
            mode.betting ? t.keys.raise : null,
            mode.passes > 0 ? t.keys.pass : null,
            t.keys.next,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  )
}

/** The cylinder as it actually sat, shown only once the hand cannot be replayed. */
function Reveal({ chambers, label }: { chambers: Chamber[]; label: string }) {
  return (
    <div className="reveal">
      <span className="reveal__label">{label}</span>
      <span className="reveal__pips">
        {chambers.map((c, i) => (
          <i key={i} className={`reveal__pip reveal__pip--${c}`} />
        ))}
      </span>
    </div>
  )
}

