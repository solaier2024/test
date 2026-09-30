import { useCallback, useEffect, useRef, useState } from 'react'
import { clipKind, clipPoster, clipUrl } from '../art'
import { CUES, TITLE_AT } from '../opening'
import { unlock } from '../audio/engine'
import { startMusic } from '../audio/music'
import { useSoundState } from '../audio/useSound'
import { LangToggle, SoundToggle } from './SoundToggle'
import type { Lang, STRINGS } from '../i18n/strings'

type Strings = (typeof STRINGS)['en']

/*
 * Four shots, about eleven seconds, all of them inside the saloon: the crowd
 * along the bar, the room down to the one knot of people not talking, a macro
 * of a reel band with a bell cut out of it, and the machine with a hand on the
 * arm. Shot three is the reason the opening exists - it puts the player's
 * attention on the bands rather than on the payout card without a tutorial
 * ever saying so, which is the whole game - and shot four is the handover,
 * because the screen after this one asks which machine you want.
 *
 * Captions are placed by fraction of the clip rather than in seconds, so
 * recutting the opening cannot push a line onto the wrong shot. That is a
 * claim about arithmetic, and scripts/verify-opening.mjs measures it against
 * the encoded file rather than taking it on trust.
 */
interface IntroProps {
  t: Strings
  lang: Lang
  onLang: (l: Lang) => void
  small: boolean
  reduced: boolean
  onDone: () => void
}

export function Intro({ t, lang, onLang, small, reduced, onDone }: IntroProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [line, setLine] = useState(-1)
  const [titled, setTitled] = useState(false)
  const [progress, setProgress] = useState(0)
  const [needsTap, setNeedsTap] = useState(false)
  const kind = useRef(clipKind())
  const { unlocked } = useSoundState()
  const scored = useRef(false)

  const done = useCallback(() => onDone(), [onDone])

  // Anyone who has asked for less motion gets the table instead.
  useEffect(() => {
    if (reduced) done()
  }, [reduced, done])

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ([' ', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        done()
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [done])

  useEffect(() => {
    if (!unlocked || scored.current) return
    scored.current = true
    startMusic()
  }, [unlocked])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const play = el.play()
    if (play && typeof play.catch === 'function') play.catch(() => setNeedsTap(true))
  }, [])

  const lines = [t.openingA, t.openingB, t.openingC, t.openingD]

  const onTime = () => {
    const el = ref.current
    if (!el || !el.duration) return
    const f = el.currentTime / el.duration
    setProgress(f)
    setLine(CUES.findIndex(([a, b]) => f >= a && f < b))
    setTitled(f >= TITLE_AT)
  }

  return (
    <div
      className="intro"
      onClick={() => {
        void unlock()
        done()
      }}
    >
      <video
        ref={ref}
        className="intro-video"
        src={clipUrl('intro', kind.current, small)}
        poster={clipPoster('intro')}
        muted
        playsInline
        preload="auto"
        onTimeUpdate={onTime}
        onEnded={done}
        onError={done}
      />

      <div className="chrome-row" onClick={(e) => e.stopPropagation()}>
        <LangToggle lang={lang} onLang={onLang} />
        <SoundToggle t={t} />
      </div>

      {line >= 0 && <p className="intro-line">{lines[line]}</p>}

      {titled && (
        <div className="intro-title">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      )}

      {needsTap && <p className="intro-line tap">{t.soundTapFor}</p>}

      <div className="intro-bar" style={{ transform: `scaleX(${progress})` }} />
      <button type="button" className="chrome skip" onClick={done}>
        {t.skip} ▸
      </button>
      <p className="disclaimer floating">{t.disclaimer}</p>
    </div>
  )
}
