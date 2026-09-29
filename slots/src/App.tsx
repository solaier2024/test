import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Atmosphere } from './fx/Atmosphere'
import { Intro } from './components/Intro'
import { Reels, planReel, type ReelPlan } from './components/Reels'
import { Scene, type Room } from './components/Scene'
import { LangToggle, SoundToggle } from './components/SoundToggle'
import { PayCard, Tally } from './components/Tally'
import type { ClipRequest } from './components/Clip'
import { useNarrow, useReducedMotion } from './platform'
import { prefetchClips } from './prefetch'
import { unlock } from './audio/engine'
import { pianoStops, setIntensity, startMusic } from './audio/music'
import { callOut, hush, react, setRoomDensity, startRoom } from './audio/crowd'
import { coinIn, leverPull, leverReturn, libertyBell, notch, payoutCoins, reelStop, shutDown } from './audio/sfx'
import { useSoundState } from './audio/useSound'
import {
  MACHINES,
  PROOF,
  STAKE,
  callHouse,
  cool,
  opening,
  pull as spin,
  reactionTo,
  rng,
  settle,
} from './game/engine'
import { STOPS, type Face, type Machine, type Outcome, type Reaction, type Session } from './game/types'
import { STRINGS, type Lang } from './i18n/strings'

/*
 * The table.
 *
 * One rule runs through all of this and it is the same one the sibling projects
 * settled on: THE ENGINE OWNS THE CLOCK. Every beat of a pull is a time on a
 * queue measured from performance.now(), and the video layer is a picture of
 * that clock rather than the source of it. A clip that stalls, fails to decode
 * or never arrives cannot move the moment the third reel lands, cannot change
 * what the room reacts to, and cannot freeze a pull. Clips are pictures. Never
 * rules.
 */

const now = () => performance.now() / 1000

/** How long the arm takes to come down before the bands are let go. */
const LEVER = 0.3
/** When each band comes to rest, measured from the release. */
const RESTS = [1.25, 2.0, 2.85]
/** What the third band does instead when the first two agree. */
const HANG = 4.15
/** After the last band stops, before the room says anything. */
const BEAT = 0.26

type Screen = 'intro' | 'pick' | 'table'

interface Beat {
  at: number
  run: () => void
}

/** The line the room says, per reaction, so a muted player reads it instead. */
const SAID: Record<Reaction, keyof (typeof STRINGS)['en']> = {
  roar: 'crowdRoar',
  cheer: 'crowdCheer',
  gasp: 'crowdGasp',
  sigh: 'crowdSigh',
  murmur: 'crowdMurmur',
  jeer: 'crowdJeer',
}

const ROOM_FOR: Record<Reaction, Room> = {
  roar: 'roar',
  cheer: 'roar',
  gasp: 'sigh',
  sigh: 'sigh',
  murmur: 'back',
  jeer: 'sigh',
}

/*
 * The footage for each reaction, and which room it has to be starting from.
 *
 * Every crowd clip is conditioned on two approved plates, so it only joins up
 * if the room is already on its first one. There are two entry points into a
 * reaction and they are not interchangeable:
 *
 *   from 'back'  - an ordinary pull settles and the room responds from resting.
 *   from 'in'    - the first two bands matched, the third hung, and the room
 *                  came forward to watch. The reaction now has to break out of
 *                  a held breath rather than out of nothing, which looks
 *                  completely different and is the best moment in the game.
 *
 * Laid out this way the four footage clips are a 2x2 of loud against held, and
 * the held pair are the bigger picture of the two every time - which is the
 * whole reason the third band hangs at all.
 *
 * A near miss only ever arrives from 'in', because the engine cannot produce
 * one without the first two bands agreeing first. Giving it sigh_held was a
 * correction: it used to hold on the leaning clip, so at the exact moment the
 * third band landed one stop off, nothing in the picture changed and the only
 * thing that answered was a line of text. A capture run caught it by printing
 * the same plate and the same clip at 2.5s and at 5.1s.
 *
 * A reaction with no clip is not a gap. The plate cross-fade in Scene.tsx
 * covers it, which is the right reading for a murmur anyway: a room muttering
 * is a room that did not really do anything.
 */
const CROWD_CLIP: Record<Reaction, { back?: string; in?: string }> = {
  roar: { back: 'roar', in: 'roar_held' },
  cheer: { back: 'roar', in: 'roar_held' },
  gasp: { back: 'sigh', in: 'sigh_held' },
  sigh: { back: 'sigh', in: 'sigh_held' },
  jeer: { back: 'sigh', in: 'sigh_held' },
  murmur: {},
}

/** How long the plates take to cross-fade, from App.css. */
const FADE = 0.95

export default function App() {
  const [lang, setLang] = useState<Lang>('en')
  const t = STRINGS[lang]
  const small = useNarrow()
  const reduced = useReducedMotion()
  const { muted } = useSoundState()

  const [screen, setScreen] = useState<Screen>('intro')
  const [machine, setMachine] = useState<Machine>(MACHINES[0])
  const [session, setSession] = useState<Session>(() => opening(MACHINES[0]))
  const [room, setRoom] = useState<Room>('back')
  const [clip, setClip] = useState<ClipRequest | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [plans, setPlans] = useState<[ReelPlan | null, ReelPlan | null, ReelPlan | null]>([null, null, null])
  const [rest, setRest] = useState<[number, number, number]>([0, 0, 0])
  const [wanted, setWanted] = useState<Face | null>(null)
  const [busy, setBusy] = useState(false)
  const [called, setCalled] = useState(false)
  const [heard, setHeard] = useState('')

  /*
   * Authority lives in refs and React state is a mirror of it. Driving the
   * round from effects is how the sibling project deadlocked: a lock released
   * without a state change and nothing woke up again.
   */
  const sessionRef = useRef(session)
  sessionRef.current = session
  /* Which plate the room is on right now, so a reaction can pick the clip that
   * actually starts from there rather than the one that starts from resting. */
  const roomRef = useRef(room)
  roomRef.current = room
  const queue = useRef<Beat[]>([])
  const random = useRef(rng((Date.now() ^ 0x9e3779b9) >>> 0))
  const token = useRef(0)
  const busyRef = useRef(false)

  const push = (at: number, run: () => void) => queue.current.push({ at, run })

  /* One loop: the scheduled beats of a pull, and the room forgetting. */
  useEffect(() => {
    let raf = 0
    let last = now()
    const frame = () => {
      const t0 = now()
      const due = queue.current.filter((b) => b.at <= t0)
      if (due.length) {
        queue.current = queue.current.filter((b) => b.at > t0)
        for (const b of due) b.run()
      }
      if (t0 - last > 0.25) {
        const cooled = cool(sessionRef.current, t0 - last)
        if (cooled !== sessionRef.current) setSession(cooled)
        last = t0
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    prefetchClips(small)
  }, [small])

  // The room and the piano follow how hard you are being looked at.
  const attention = Math.min(1, session.heat * 0.8 + (session.evidence > 0 ? Math.min(0.3, session.evidence / PROOF * 0.3) : 0))
  useEffect(() => {
    if (screen !== 'table') return
    setRoomDensity(attention)
    setIntensity(attention)
  }, [attention, screen])

  const sit = useCallback(
    (m: Machine) => {
      void unlock()
      startRoom()
      startMusic()
      setMachine(m)
      setSession(opening(m))
      setRest([0, 0, 0])
      setPlans([null, null, null])
      setWanted(null)
      setRoom('back')
      setSaid(null)
      setCalled(false)
      setHeard('')
      setScreen('table')
      queue.current = []
      busyRef.current = false
      setBusy(false)
      setClip({ name: 'idle', token: ++token.current, loop: true })
    },
    [],
  )

  /*
   * The room reacting.
   *
   * Four channels fire on the same tick and every one of them is sufficient on
   * its own: synthesised voices, the footage, the plate underneath it, and a
   * line of text. That is not belt and braces - a reaction is information in
   * this game, because what the room does tells you how close that pull came,
   * and a muted player, a deaf player or a player whose browser will not decode
   * VP9 has to be reading the same game as everybody else.
   */
  const roomSays = useCallback(
    (kind: Reaction, density: number, hold = 2.1) => {
      react(kind, density)

      const from = roomRef.current === 'in' ? 'in' : 'back'
      const film = CROWD_CLIP[kind][from]
      if (film) setClip({ name: film, token: ++token.current })

      setRoom(ROOM_FOR[kind])
      setSaid(STRINGS[lang][SAID[kind]])

      const mine = ++token.current
      push(now() + hold, () => {
        if (token.current !== mine) return
        /*
         * Drop the footage FIRST and let the plates dissolve back on their own,
         * rather than cutting to the idle loop here. The idle clip opens on
         * machine_rest, and cutting to it straight out of a roar would snap the
         * room empty in one frame. Pulling the video away instead reveals the
         * reaction plate it finished on, which then cross-fades out slowly -
         * and a room going quiet again really is slow and gradual, so the
         * dissolve is not standing in for anything, it IS the shot.
         */
        setClip(null)
        setRoom('back')
        setSaid(null)
        push(now() + FADE, () => {
          if (token.current !== mine) return
          setClip({ name: 'idle', token: ++token.current, loop: true })
        })
      })
    },
    [lang],
  )

  const resolve = useCallback(
    (out: Outcome) => {
      const before = sessionRef.current
      const after = settle(before, out)
      setSession(after)
      notch()
      if (out.coins > 0) payoutCoins(out.coins)
      if (out.coins >= 20) libertyBell(3)
      const kind = reactionTo(out)
      roomSays(kind, Math.min(1, 0.4 + after.heat * 0.7))
      setHeard(
        `${out.bellOnThird ? STRINGS[lang].bellSeen : STRINGS[lang].bellNot} · ` +
          `${STRINGS[lang].paid} ${out.coins || STRINGS[lang].nothing}`,
      )
      busyRef.current = false
      setBusy(false)
      if (after.phase === 'over') {
        push(now() + 1.4, () => setScreen('table'))
      }
    },
    [lang, roomSays],
  )

  const doPull = useCallback(() => {
    const s = sessionRef.current
    if (busyRef.current || s.phase === 'over' || s.bank < STAKE) return
    void unlock()
    busyRef.current = true
    setBusy(true)
    setSaid(null)
    setWanted(null)
    setRoom('back')

    const out = spin(machine, random.current)
    const t0 = now()
    const scale = reduced ? 0.45 : 1
    const release = t0 + LEVER * scale
    const restAt: [number, number, number] = [
      release + RESTS[0] * scale,
      release + RESTS[1] * scale,
      release + (out.tease ? HANG : RESTS[2]) * scale,
    ]

    coinIn()
    leverPull()
    setClip({ name: 'pull', token: ++token.current })
    push(t0 + 0.5 * scale, () => {
      leverReturn()
      setClip({ name: 'release', token: ++token.current })
    })
    push(t0 + 1.1 * scale, () => setClip({ name: 'idle', token: ++token.current, loop: true }))

    setPlans([
      planReel(rest[0], release, restAt[0], out.stops[0]),
      planReel(rest[1], release, restAt[1], out.stops[1]),
      planReel(rest[2], release, restAt[2], out.stops[2]),
    ])

    restAt.forEach((at, i) => push(at, () => reelStop(i)))

    /* The first two agreeing is the moment the room turns round, and it happens
     * whether or not the third one is going to do anything about it. */
    if (out.tease) {
      push(restAt[1] + 0.06, () => {
        setWanted(out.line[0])
        setRoom('in')
        setClip({ name: 'lean', token: ++token.current })
        setIntensity(Math.min(1, attention + 0.45))
      })
    }

    push(restAt[2] + BEAT, () => {
      setRest([out.stops[0], out.stops[1], out.stops[2]])
      setPlans([null, null, null])
      resolve(out)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine, reduced, rest, resolve, attention])

  const doCall = useCallback(() => {
    const s = sessionRef.current
    if (busyRef.current || called || s.phase === 'over') return
    void unlock()
    busyRef.current = true
    setBusy(true)
    setCalled(true)
    setWanted(null)
    callOut()
    hush(1.7)
    pianoStops(2.4)
    /* The room turns round to watch you accuse the house, which is the same
     * shot as it turning round to watch a reel hang. */
    setRoom('in')
    setClip({ name: 'lean', token: ++token.current })
    setSaid(STRINGS[lang].calledOut)

    push(now() + 1.5, () => {
      const r = callHouse(s)
      setSession(r.session)
      if (r.won) {
        shutDown()
        roomSays('roar', 1, 4)
        libertyBell(2)
      } else {
        roomSays('jeer', 0.8, 3)
      }
      busyRef.current = false
      setBusy(false)
      setCalled(false)
    })
  }, [called, lang, roomSays])

  useEffect(() => {
    if (screen !== 'table') return
    const keys = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        doPull()
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        doCall()
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [screen, doPull, doCall])

  const over = session.phase === 'over'
  const ending = useMemo(() => {
    switch (session.ended) {
      case 'proved':
        return { title: t.provedTitle, body: t.provedBody }
      case 'broke':
        return { title: t.brokeTitle, body: t.brokeBody }
      case 'thrown-out':
        return { title: t.thrownTitle, body: t.thrownBody }
      default:
        return null
    }
  }, [session.ended, t])

  if (screen === 'intro') {
    return (
      <Intro
        t={t}
        lang={lang}
        onLang={setLang}
        small={small}
        reduced={reduced}
        onDone={() => setScreen('pick')}
      />
    )
  }

  if (screen === 'pick') {
    const blurbs = [
      { m: MACHINES[0], name: t.honestName, blurb: t.honestBlurb },
      { m: MACHINES[1], name: t.drummerName, blurb: t.drummerBlurb },
      { m: MACHINES[2], name: t.bandidoName, blurb: t.bandidoBlurb },
    ]
    return (
      <div className="pick">
        <div className="chrome-row">
          <LangToggle lang={lang} onLang={setLang} />
          <SoundToggle t={t} />
        </div>
        <h1>{t.title}</h1>
        <p className="tagline">{t.tagline}</p>
        <h2>{t.pick}</h2>
        <div className="machines">
          {blurbs.map(({ m, name, blurb }) => (
            <button key={m.id} type="button" className="machine-card" onClick={() => sit(m)}>
              <span className="machine-name">{name}</span>
              <span className="machine-blurb">{blurb}</span>
            </button>
          ))}
        </div>
        <p className="pick-note">{t.pickNote}</p>
        <p className="disclaimer">{t.disclaimer}</p>
      </div>
    )
  }

  return (
    <div className={`table${over ? ' over' : ''}`}>
      <Scene room={room} clip={clip} small={small} attention={attention}>
        <Reels
          bands={machine.bands}
          plans={plans}
          rest={rest}
          clock={now}
          wanted={wanted}
          muted={muted}
          reduced={reduced}
        />
      </Scene>

      <Atmosphere reduced={reduced} heat={session.heat} lean={wanted ? 0.5 : 0} />

      <div className="chrome-row">
        <LangToggle lang={lang} onLang={setLang} />
        <SoundToggle t={t} />
      </div>

      <Tally
        pulls={session.pulls}
        bells={session.bells}
        evidence={session.evidence}
        label={t.tally}
        legend={t.tallyLegend}
        hint={t.tallyHint}
      />

      <PayCard title={t.card} suit={t.cardSuit} anyBell={t.cardAnyBell} note={t.cardNote} />

      <div className="hud">
        <span>
          <em>{t.bank}</em>
          {session.bank}
        </span>
        <span>
          <em>{t.pulls}</em>
          {session.pulls}
        </span>
        <span>
          <em>{t.took}</em>
          {session.best}
        </span>
        <span className="heat">
          <em>{t.heat}</em>
          <span className="heat-bar">
            <span style={{ transform: `scaleX(${session.heat})` }} />
          </span>
        </span>
      </div>

      {said && <p className="said">{said}</p>}

      <p className="heard" role="status" aria-live="polite">
        {heard}
      </p>

      <div className="controls">
        <button type="button" className="lever" onClick={doPull} disabled={busy || over}>
          {t.pull}
          <em>{t.pullHint}</em>
        </button>
        <button
          type="button"
          className={`callout${session.evidence >= PROOF ? ' ready' : ''}`}
          onClick={doCall}
          disabled={busy || over}
        >
          {t.call}
          <em>{t.callHint}</em>
        </button>
      </div>

      {over && ending && (
        <div className="ending">
          <h2>{ending.title}</h2>
          <p>{ending.body}</p>
          <div className="ending-row">
            <button type="button" className="chrome" onClick={() => sit(machine)}>
              {t.again}
            </button>
            <button type="button" className="chrome" onClick={() => setScreen('pick')}>
              {t.backToPick}
            </button>
          </div>
        </div>
      )}

      <p className="disclaimer floating">{t.disclaimer}</p>
      <span className="hidden-stops" aria-hidden="true">
        {STOPS}
      </span>
    </div>
  )
}
