import { useCallback, useEffect, useRef, useState } from 'react'
import { clipKind, clipPoster, clipUrl } from '../art'
import { startIntroScore, stopIntroScore } from '../audio/score'
import { unlock } from '../audio/engine'
import { useSoundState } from '../audio/useSound'
import { thinConnection } from '../platform'
import { LangToggle, SoundToggle } from './SoundToggle'
import type { Lang, Strings } from '../i18n/strings'

/*
 * Where each caption sits, as a fraction of the clip rather than in seconds,
 * matching the six shots assembled in scripts/build-clips.mjs. Fractions mean
 * recutting the opening cannot silently push a line onto the wrong shot.
 *
 * Shot four is her hands cutting the deck, and the last line lands on her face.
 * Between them they are the reason this opening exists: it is not a tutorial,
 * it is the room, and by the end of it you want to sit down in it.
 */
const CUES: [number, number][] = [
  [0.02, 0.15],
  [0.18, 0.3],
  [0.33, 0.46],
  [0.5, 0.6],
  [0.63, 0.78],
]
const TITLE_AT = 0.82

interface IntroProps {
  t: Strings
  lang: Lang
  onLang: (l: Lang) => void
  small: boolean
  reduced: boolean
  onDone: () => void
}

/**
 * The opening. Skippable from the first frame by tapping anywhere or with any of
 * the obvious keys, and it gets out of the way by itself if the clip will not
 * play - there is no state here worth blocking the game on.
 */
export function Intro({ t, lang, onLang, small, reduced, onDone }: IntroProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [line, setLine] = useState(-1)
  const [titled, setTitled] = useState(false)
  const [progress, setProgress] = useState(0)
  const [needsTap, setNeedsTap] = useState(false)
  const kind = useRef(clipKind())
  /*
   * The opening is the one asset a visitor waits on with nothing else to look at,
   * so a thin connection takes the small tier even on a wide screen. Frozen at
   * mount: swapping the source of a playing film is worse than either choice.
   */
  const tier = useRef(small || thinConnection())
  const { unlocked } = useSoundState()
  const scored = useRef(false)

  const done = useCallback(() => {
    stopIntroScore()
    onDone()
  }, [onDone])

  // Anyone who has asked for less motion gets the title page instead.
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

  // The score takes an offset, because audio is usually still locked when the
  // opening starts: turning the sound on halfway should join at the right bar.
  useEffect(() => {
    if (!unlocked || scored.current) return
    scored.current = true
    startIntroScore(ref.current?.currentTime ?? 0)
  }, [unlocked])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const play = el.play()
    if (play && typeof play.catch === 'function') play.catch(() => setNeedsTap(true))
  }, [])

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
        src={clipUrl('intro', kind.current, tier.current)}
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

      {line >= 0 && <p className="intro-line">{t.introLines[line]}</p>}

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
