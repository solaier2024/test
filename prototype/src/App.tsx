import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  shown: 'confident' | 'rattled'
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

  const stateRef = useRef(state)
  stateRef.current = state
  const busyRef = useRef(false)

  const odds = liveOdds(state)
  const left = liveRemaining(state)
  const isSealed = state.cylinder.length > 0 || state.phase === 'round_over'

  const bluffsSeen = tells.length
  const bluffsCaught = tells.filter((t) => t.wasBluff).length

  /** Refresh the opponent's visible mood, recording whether it was a bluff. */
  const refreshTell = useCallback((s: GameState) => {
    const r = readDealer(s, CALLOWAY)
    setRead(r)
    setSceneState(r.shown === 'confident' ? 'confident' : r.shown === 'rattled' ? 'rattled' : 'neutral')
    if (r.shown !== 'neutral') {
      setTells((prev) => [...prev, { shown: r.shown as 'confident' | 'rattled', wasBluff: r.bluffing }])
    }
  }, [])

  /** Plays a shot out as a beat of cinema rather than an instant state change. */
  const playShot = useCallback(
    async (shooter: Side, target: Target) => {
      const s = stateRef.current
      setZoom(1)
      if (shooter === 'dealer' && target === 'opponent') {
        setSceneState('aiming')
        setCaption('他抬起枪口，对准了你。')
        await wait(900)
      } else if (shooter === 'dealer') {
        setCaption('他把枪口抵住自己的太阳穴。')
        await wait(700)
      } else {
        setCaption(target === 'self' ? '你把枪口对准自己。' : '你把枪口对准他。')
        await wait(520)
      }

      playCock()
      await wait(520)

      const result = fire(s, shooter, target)
      const victim = result.victim

      if (result.chamber === 'live') {
        playGunshot()
        setFlashSource(shooter)
        setFlash((n) => n + 1)
        setSmokeBursts((n) => n + 1)
        if (victim === 'player') {
          setHurt(true)
          setCaption('枪响。你的视野塌了下去。')
        } else {
          setSceneState('rattled')
          setCaption('枪响。他向后倒了下去。')
        }
      } else {
        playClick()
        setCaption('咔哒 —— 空的。')
      }

      setState(result.state)
      await wait(result.chamber === 'live' ? 1500 : 850)
      setZoom(0)
      setHurt(false)
      if (result.state.phase === 'betting') {
        refreshTell(result.state)
      }
    },
    [refreshTell],
  )

  /** The opponent's full turn: decide on chips first, then on the chamber. */
  const runDealerTurn = useCallback(async () => {
    await wait(700)
    let s = stateRef.current
    if (s.turn !== 'dealer') return

    if (s.phase === 'facing_raise') {
      const answer = respondToRaise(s, CALLOWAY)
      setCaption(answer === 'call' ? '他盯了你很久，然后跟了。' : '他把手收了回去。')
      if (answer === 'call') {
        playChips()
        s = call(s, 'dealer')
        setState(s)
        await wait(700)
      } else {
        s = fold(s, 'dealer')
        setState(s)
        return
      }
      if (s.turn !== 'dealer') return
    }

    if (s.phase !== 'betting') return

    const bet = chooseBet(s, CALLOWAY)
    if (bet.action === 'raise') {
      playChips()
      setCaption(`他加注 ${bet.amount}。`)
      s = raise(s, 'dealer', bet.amount)
      setState(s)
      return
    }

    const target = chooseTarget(s, CALLOWAY)
    await playShot('dealer', target)
  }, [playShot])

  // Drives the opponent whenever the table is waiting on him.
  useEffect(() => {
    if (!started) return
    const needsDealer =
      state.turn === 'dealer' && (state.phase === 'betting' || state.phase === 'facing_raise')
    if (!needsDealer || busyRef.current) return
    busyRef.current = true
    void runDealerTurn().finally(() => {
      busyRef.current = false
    })
  }, [started, state.turn, state.phase, state.fired, state.pot, runDealerTurn])

  const begin = () => {
    unlockAudio()
    startAmbience()
    setStarted(true)
  }

  const onLoad = async () => {
    unlockAudio()
    setSpinning(true)
    playSpin()
    setCaption('你把子弹压进弹巢，合上，旋转。')
    await wait(1100)
    const s = startRound(stateRef.current, loadChoice)
    setState(s)
    setSpinning(false)
    setRaiseAmount(Math.max(ANTE, Math.round(s.pot * 0.4)))
    refreshTell(s)
  }

  const onPlayerFire = async (target: Target) => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await playShot('player', target)
    } finally {
      busyRef.current = false
    }
  }

  const onPlayerRaise = () => {
    playChips()
    const s = raise(stateRef.current, 'player', raiseAmount)
    setState(s)
    setCaption(`你推出 ${raiseAmount} 枚筹码。`)
  }

  const onPlayerCall = () => {
    playChips()
    setState(call(stateRef.current, 'player'))
    setCaption('你跟了。')
  }

  const onPlayerFold = () => {
    setState(fold(stateRef.current, 'player'))
  }

  const onNextRound = () => {
    const s = advanceRound(stateRef.current)
    setState(s)
    setSceneState('neutral')
    setRead(null)
    setCaption('')
    setLoadChoice(Math.min(5, Math.max(1, loadChoice)))
  }

  const onRestart = () => {
    setState(createGame())
    setSceneState('neutral')
    setTells([])
    setRead(null)
    setCaption('')
  }

  const playerTurn =
    state.turn === 'player' && (state.phase === 'betting' || state.phase === 'facing_raise')

  const oddsLabel = useMemo(() => {
    if (!isSealed || state.cylinder.length === 0) return '—'
    return `${Math.round(odds * 100)}%`
  }, [isSealed, odds, state.cylinder.length])

  if (!started) {
    return (
      <div className="app">
        <Scene state="neutral" flash={0} flashSource={null} hurt={false} zoom={0} showRevolver />
        <Atmosphere smokeBursts={0} />
        <div className="title">
          <p className="title__kicker">西部 · 单人赌命</p>
          <h1 className="title__name">最 后 一 发</h1>
          <p className="title__sub">
            六个弹巢。你决定装几发实弹。你们都知道装了多少，但谁都不知道顺序。
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
          <div className="chipstack">
            <span className="chipstack__label">{CALLOWAY.name}</span>
            <span className="chipstack__value">{state.chips.dealer}</span>
          </div>
          <div className="pot">
            <span className="pot__label">桌心</span>
            <span className="pot__value">{state.pot}</span>
            <span className="pot__round">第 {state.round} 局</span>
          </div>
          <div className="chipstack chipstack--me">
            <span className="chipstack__label">你</span>
            <span className="chipstack__value">{state.chips.player}</span>
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
          {state.phase !== 'loading' && (
            <div className="readout__odds">
              <span className="readout__oddsLabel">下一发是实弹</span>
              <span
                className={`readout__oddsValue${odds >= 0.6 ? ' is-hot' : ''}${
                  odds >= 1 ? ' is-certain' : ''
                }`}
              >
                {oddsLabel}
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
                {read.shown === 'confident' ? '松弛、带笑' : read.shown === 'rattled' ? '紧绷、出汗' : '毫无波澜'}
              </span>
              <span className="readout__tellHint">
                他不一定在说真话（已观察 {bluffsSeen} 次，其中 {bluffsCaught} 次是演的）
              </span>
            </div>
          )}
        </aside>

        {caption && <div className="caption">{caption}</div>}

        <footer className="actions">
          {state.phase === 'loading' && (
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
                装得越满，底注越高，也越快逼到「必响」那一发。底注 {Math.round(ANTE * riskMultiplier(loadChoice))}。
              </p>
              <button className="btn btn--primary" onClick={onLoad} disabled={spinning}>
                装弹并旋转
              </button>
            </div>
          )}

          {playerTurn && state.phase === 'betting' && (
            <div className="actionrow">
              <div className="raisebox">
                <input
                  type="range"
                  min={1}
                  max={Math.max(1, maxRaise(state, 'player'))}
                  value={Math.min(raiseAmount, Math.max(1, maxRaise(state, 'player')))}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  disabled={!canRaise(state, 'player')}
                />
                <button
                  className="btn"
                  onClick={onPlayerRaise}
                  disabled={!canRaise(state, 'player')}
                >
                  加注 {Math.min(raiseAmount, Math.max(1, maxRaise(state, 'player')))}
                </button>
              </div>
              <button className="btn btn--risk" onClick={() => onPlayerFire('self')}>
                对准自己
                <small>空响就继续由你行动</small>
              </button>
              <button className="btn btn--kill" onClick={() => onPlayerFire('opponent')}>
                对准他
                <small>无论空实都换他行动</small>
              </button>
            </div>
          )}

          {playerTurn && state.phase === 'facing_raise' && (
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

          {state.phase === 'round_over' && (
            <div className="result">
              <p className="result__line">
                {state.outcome?.winner === 'player' ? '这一局你活下来了。' : '这一局归他。'}
                {state.outcome?.reason === 'fold' ? ' （有人退了）' : ''}
                {state.outcome ? ` 桌心 ${state.outcome.pot}。` : ''}
              </p>
              <button className="btn btn--primary" onClick={onNextRound}>
                继续
              </button>
            </div>
          )}

          {state.phase === 'match_over' && (
            <div className="result">
              <p className="result__line">
                {state.chips.player <= 0 ? '你输光了。他把帽子压低，起身走了。' : '他没有筹码了。酒馆很安静。'}
              </p>
              <button className="btn btn--primary" onClick={onRestart}>
                再来一局
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
