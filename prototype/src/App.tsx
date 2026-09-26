import { useCallback, useRef, useState } from 'react'
import { Scene, type SceneState } from './components/Scene'
import { Cylinder } from './components/Cylinder'
import {
  CALLOWAY,
  chooseBet,
  chooseTarget,
  readDealer,
  respondToRaise,
  type DealerRead,
} from './game/ai'
import {
  ANTE,
  advanceRound,
  call,
  canRaise,
  createGame,
  fire,
  fold,
  liveOdds,
  liveRemaining,
  maxRaise,
  raise,
  riskMultiplier,
  startRound,
} from './game/engine'
import type { GameState, Side, Target } from './game/types'
import { Atmosphere } from './fx/Atmosphere'
import {
  playChips,
  playClick,
  playCock,
  playGunshot,
  playSpin,
  startAmbience,
  unlockAudio,
} from './audio/sfx'
import './App.css'

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

interface TellRecord {
  wasBluff: boolean
}

export default function App() {
  const [state, setState] = useState<GameState>(createGame)
  const [started, setStarted] = useState(false)
  const [loadChoice, setLoadChoice] = useState(2)
  const [raiseAmount, setRaiseAmount] = useState(ANTE)
  const [sceneState, setSceneState] = useState<SceneState>('neutral')
  const [flash, setFlash] = useState(0)
  const [flashSource, setFlashSource] = useState<Side | null>(null)
  const [hurt, setHurt] = useState(false)
  const [zoom, setZoom] = useState(0)
  const [smokeBursts, setSmokeBursts] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [caption, setCaption] = useState('')
  const [tells, setTells] = useState<TellRecord[]>([])
  const [read, setRead] = useState<DealerRead | null>(null)
  /** True while a shot or an opponent decision is playing out; locks input. */
  const [cinematic, setCinematic] = useState(false)

  /**
   * The ref is the authoritative game state. React state is a render mirror,
   * because the round orchestrator is async and cannot wait for re-renders.
   */
  const stateRef = useRef<GameState>(state)
  const busyRef = useRef(false)

  const commit = useCallback((s: GameState) => {
    stateRef.current = s
    setState(s)
  }, [])

  const odds = liveOdds(state)
  const left = liveRemaining(state)
  const bluffsSeen = tells.length
  const bluffsCaught = tells.filter((t) => t.wasBluff).length

  /** Refreshes the opponent's shown mood and records whether it was a bluff. */
  const refreshTell = useCallback((s: GameState) => {
    const r = readDealer(s, CALLOWAY)
    setRead(r)
    setSceneState(r.shown)
    if (r.shown !== 'neutral') setTells((prev) => [...prev, { wasBluff: r.bluffing }])
  }, [])

  /** Plays a shot as a beat of cinema rather than an instant state change. */
  const playShot = useCallback(
    async (shooter: Side, target: Target) => {
      const s = stateRef.current
      setZoom(1)

      if (shooter === 'dealer' && target === 'opponent') {
        setSceneState('aiming')
        setCaption('他抬起枪口，对准了你。')
        await wait(1000)
      } else if (shooter === 'dealer') {
        setCaption('他把枪口抵住自己的太阳穴。')
        await wait(800)
      } else {
        setCaption(target === 'self' ? '你把枪口对准自己。' : '你把枪口对准他。')
        await wait(600)
      }

      playCock()
      await wait(560)

      const result = fire(s, shooter, target)

      if (result.chamber === 'live') {
        playGunshot()
        setFlashSource(shooter)
        setFlash((n) => n + 1)
        setSmokeBursts((n) => n + 1)
        if (result.victim === 'player') {
          setHurt(true)
          setCaption('枪响。你的视野塌了下去。')
        } else {
          setSceneState('rattled')
          setCaption('枪响。他向后仰了过去，帽子落在地上。')
        }
      } else {
        playClick()
        setCaption('咔哒 —— 空的。')
      }

      // Let the shot land before the board updates, so the hit reads on screen.
      await wait(result.chamber === 'live' ? 1900 : 900)
      commit(result.state)
      setZoom(0)
      setHurt(false)
      if (result.state.phase === 'betting') refreshTell(result.state)
    },
    [commit, refreshTell],
  )

  /** Runs exactly one opponent decision against the authoritative state. */
  const dealerStep = useCallback(async () => {
    await wait(750)
    let s = stateRef.current

    if (s.phase === 'facing_raise') {
      const answer = respondToRaise(s, CALLOWAY)
      if (answer === 'fold') {
        setCaption('他把手从筹码上收了回去。这一局他不跟。')
        commit(fold(s, 'dealer'))
        return
      }
      playChips()
      setCaption('他盯了你很久，然后跟了。')
      s = call(s, 'dealer')
      commit(s)
      await wait(800)
      if (s.turn !== 'dealer') return
    }

    if (s.phase !== 'betting') return

    const bet = chooseBet(s, CALLOWAY)
    if (bet.action === 'raise') {
      playChips()
      setCaption(`他把 ${bet.amount} 枚筹码推到桌心，等你表态。`)
      commit(raise(s, 'dealer', bet.amount))
      return
    }

    await playShot('dealer', chooseTarget(s, CALLOWAY))
  }, [commit, playShot])

  /**
   * Drives the opponent until the table is waiting on the player again. Called
   * explicitly after every player action, so no state change can be missed.
   */
  const pump = useCallback(async () => {
    let guard = 0
    while (guard++ < 40) {
      const s = stateRef.current
      const dealerToAct =
        s.turn === 'dealer' && (s.phase === 'betting' || s.phase === 'facing_raise')
      if (!dealerToAct) return
      await dealerStep()
    }
  }, [dealerStep])

  /** Serialises every player-initiated action against the opponent driver. */
  const act = useCallback(
    async (fn: () => Promise<void> | void) => {
      if (busyRef.current) return
      busyRef.current = true
      setCinematic(true)
      try {
        await fn()
        await pump()
      } finally {
        busyRef.current = false
        setCinematic(false)
      }
    },
    [pump],
  )

  const begin = () => {
    unlockAudio()
    startAmbience()
    setStarted(true)
  }

  const onLoad = () =>
    act(async () => {
      unlockAudio()
      setSpinning(true)
      playSpin()
      setCaption('你把子弹压进弹巢，合上，旋转。')
      await wait(1150)
      const s = startRound(stateRef.current, loadChoice)
      commit(s)
      setSpinning(false)
      setRaiseAmount(Math.max(ANTE, Math.round(s.pot * 0.4)))
      refreshTell(s)
      await wait(500)
    })

  const onPlayerFire = (target: Target) => act(() => playShot('player', target))

  const onPlayerRaise = () =>
    act(async () => {
      const amount = Math.min(raiseAmount, maxRaise(stateRef.current, 'player'))
      playChips()
      setCaption(`你把 ${amount} 枚筹码推过桌心。`)
      commit(raise(stateRef.current, 'player', amount))
      await wait(600)
    })

  const onPlayerCall = () =>
    act(async () => {
      playChips()
      setCaption('你跟了。')
      commit(call(stateRef.current, 'player'))
      await wait(600)
    })

  const onPlayerFold = () =>
    act(async () => {
      setCaption('你把手从枪上挪开，推走了筹码。活着比赢重要。')
      commit(fold(stateRef.current, 'player'))
      await wait(400)
    })

  const onNextRound = () => {
    commit(advanceRound(stateRef.current))
    setSceneState('neutral')
    setRead(null)
    setCaption('')
  }

  const onRestart = () => {
    commit(createGame())
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

  if (!started) {
    return (
      <div className="app">
        <Scene state="neutral" flash={0} flashSource={null} hurt={false} zoom={0} showRevolver />
        <Atmosphere smokeBursts={0} />
        <div className="title">
          <p className="title__kicker">西 部 · 赌 命</p>
          <h1 className="title__name">最 后 一 发</h1>
          <p className="title__sub">
            六个弹巢，你决定装几发实弹。你们都知道装了多少，却谁也不知道顺序。
            <br />
            对准自己活下来，行动权还在你手里；对准他，无论空实都换他上。
          </p>
          <button className="btn btn--primary btn--lg" onClick={begin}>
            坐 下
          </button>
          <p className="title__note">纯娱乐模拟 · 不涉及任何真实货币</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Scene
        state={sceneState}
        flash={flash}
        flashSource={flashSource}
        hurt={hurt}
        zoom={zoom}
        showRevolver={state.phase !== 'loading'}
      />
      <Atmosphere smokeBursts={smokeBursts} />

      <div className="hud">
        <header className="hud__top">
          <div className={`chipstack${waitingOnDealer ? ' is-active' : ''}`}>
            <span className="chipstack__label">对面 · {CALLOWAY.name}</span>
            <span className="chipstack__value">{state.chips.dealer}</span>
            <span className="chipstack__turn">{waitingOnDealer ? '他在想' : ''}</span>
          </div>
          <div className="pot">
            <span className="pot__label">桌 心</span>
            <span className="pot__value">{state.pot}</span>
            <span className="pot__round">第 {state.round} 局</span>
          </div>
          <div className={`chipstack chipstack--me${playerToAct ? ' is-active' : ''}`}>
            <span className="chipstack__label">你</span>
            <span className="chipstack__value">{state.chips.player}</span>
            <span className="chipstack__turn">{playerToAct ? '该你了' : ''}</span>
          </div>
        </header>

        <aside className="readout">
          <Cylinder
            live={state.phase === 'loading' ? loadChoice : state.loadedLive}
            fired={state.fired}
            liveLeft={left}
            mode={state.phase === 'loading' ? 'open' : 'sealed'}
            spinning={spinning}
          />
          {state.phase !== 'loading' && state.cylinder.length > 0 && (
            <div className="readout__odds">
              <span className="readout__oddsLabel">下一发是实弹</span>
              <span
                className={`readout__oddsValue${odds >= 0.6 ? ' is-hot' : ''}${
                  odds >= 1 ? ' is-certain' : ''
                }`}
              >
                {Math.round(odds * 100)}%
              </span>
              <div className="readout__bar">
                <div className="readout__barFill" style={{ width: `${odds * 100}%` }} />
              </div>
              {odds >= 1 && <span className="readout__warn">这一发必响</span>}
            </div>
          )}
          {read && state.phase !== 'loading' && (
            <div className="readout__tell">
              <span className="readout__tellLabel">他的神色</span>
              <span className="readout__tellValue">
                {read.shown === 'confident'
                  ? '松弛，嘴角有笑'
                  : read.shown === 'rattled'
                    ? '紧绷，额头出汗'
                    : '毫无波澜'}
              </span>
              <span className="readout__tellHint">
                已看过他 {bluffsSeen} 次表情，其中 {bluffsCaught} 次是演的
              </span>
            </div>
          )}
        </aside>

        {caption && <div className="caption">{caption}</div>}

        <footer className="actions">
          {state.phase === 'loading' && !cinematic && (
            <div className="loadpanel">
              <p className="loadpanel__title">往六个弹巢里装几发实弹？</p>
              <div className="loadpanel__choices">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`chamberbtn${loadChoice === n ? ' is-on' : ''}`}
                    onClick={() => setLoadChoice(n)}
                  >
                    <span className="chamberbtn__n">{n}</span>
                    <span className="chamberbtn__x">×{riskMultiplier(n).toFixed(1)}</span>
                  </button>
                ))}
              </div>
              <p className="loadpanel__hint">
                装得越满，底注越高，也越快逼出「必响」那一发。本局底注{' '}
                {Math.round(ANTE * riskMultiplier(loadChoice))}。
              </p>
              <button className="btn btn--primary" onClick={onLoad} disabled={spinning}>
                装弹并旋转
              </button>
            </div>
          )}

          {playerToAct && state.phase === 'betting' && (
            <div className="actionrow">
              <div className="raisebox">
                <span className="raisebox__label">加注</span>
                <input
                  type="range"
                  min={1}
                  max={raiseCap}
                  value={clampedRaise}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  disabled={!canRaise(state, 'player')}
                />
                <button className="btn btn--slim" onClick={onPlayerRaise} disabled={!canRaise(state, 'player')}>
                  推出 {clampedRaise}
                </button>
              </div>
              <button className="btn btn--risk" onClick={() => onPlayerFire('self')}>
                对准自己
                <small>空响则继续由你行动</small>
              </button>
              <button className="btn btn--kill" onClick={() => onPlayerFire('opponent')}>
                对准他
                <small>无论空实都换他行动</small>
              </button>
            </div>
          )}

          {playerToAct && state.phase === 'facing_raise' && (
            <div className="actionrow">
              <div className="callnote">他要你再压 {state.toCall} 枚才能继续。</div>
              <button className="btn btn--primary" onClick={onPlayerCall}>
                跟 {Math.min(state.toCall, state.chips.player)}
              </button>
              <button className="btn" onClick={onPlayerFold}>
                放弃这局
                <small>输掉桌心，但不用碰枪</small>
              </button>
            </div>
          )}

          {state.phase === 'round_over' && !cinematic && (
            <div className="result">
              <p
                className={`result__line${
                  state.outcome?.winner === 'player' ? ' is-win' : ' is-loss'
                }`}
              >
                {state.outcome?.winner === 'player'
                  ? `这一局你活下来了，${state.outcome.pot} 枚筹码归你。`
                  : `这一局归他，桌心 ${state.outcome?.pot ?? 0} 枚被他收走。`}
                {state.outcome?.reason === 'fold' ? '（有人退了，枪没响）' : ''}
              </p>
              <button className="btn btn--primary" onClick={onNextRound}>
                继续
              </button>
            </div>
          )}

          {state.phase === 'match_over' && (
            <div className="result">
              <p className="result__line">
                {state.chips.player <= 0
                  ? '你输光了。他把帽子压低，起身走进夜色里。'
                  : '他一枚筹码都不剩了。酒馆忽然很安静。'}
              </p>
              <button className="btn btn--primary" onClick={onRestart}>
                再坐一次
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
