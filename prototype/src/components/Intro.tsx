import { useCallback, useEffect, useRef, useState } from 'react'
import { clipPoster, clipUrl } from '../art'
import { LangToggle } from './LangToggle'
import type { Lang, Strings } from '../i18n/strings'

/**
 * Where each caption sits, as a fraction of the clip, matching the five shots
 * assembled in scripts/build-clips.mjs. Fractions rather than seconds so
 * recutting the opening does not silently push the lines off their shots.
 */
const CUES: [number, number][] = [
  [0.06, 0.29],
  [0.33, 0.55],
  [0.57, 0.71],
  [0.72, 0.86],
  [0.86, 0.99],
]

interface IntroProps {
  t: Strings
  lang: Lang
  onLang: (l: Lang) => void
  small: boolean
  onDone: () => void
}

/**
 * The opening cinematic. Skippable from the first frame, by tapping anywhere
 * or with any of the obvious keys, and it gets out of the way by itself if
 * the clip will not play - there is no state here worth blocking the game on.
 */
export function Intro({ t, lang, onLang, small, onDone }: IntroProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [line, setLine] = useState(-1)
  const [progress, setProgress] = useState(0)
  /** Set when autoplay is refused, so there is something to tap. */
  const [needsTap, setNeedsTap] = useState(false)
  const left = useRef(false)

  const leave = useCallback(() => {
    if (left.current) return
    left.current = true
    onDone()
  }, [onDone])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.play().catch(() => setNeedsTap(true))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ([' ', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        leave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leave])

  const onTime = () => {
    const el = ref.current
    if (!el || !el.duration) return
    const at = el.currentTime / el.duration
    setProgress(at)
    setLine(CUES.findIndex(([from, to]) => at >= from && at < to))
  }

  return (
    <div className="intro" onClick={leave}>
      <video
        ref={ref}
        className="intro__film"
        poster={clipPoster('intro')}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onTimeUpdate={onTime}
        onEnded={leave}
        onError={leave}
      >
        <source src={clipUrl('intro', 'webm', small)} type="video/webm" />
        <source src={clipUrl('intro', 'mp4', small)} type="video/mp4" />
      </video>

      <div className="intro__grade" />

      {line >= 0 && (
        <p key={line} className="intro__line">
          {t.intro.lines[line]}
        </p>
      )}

      {needsTap && <p className="intro__tap">{t.title.sit}</p>}

      <div className="intro__lang" onClick={(e) => e.stopPropagation()}>
        <LangToggle lang={lang} onPick={onLang} />
      </div>

      <button type="button" className="intro__skip" onClick={leave}>
        {t.intro.skip}
      </button>

      <p className="intro__note">{t.title.disclaimer}</p>
      <div className="intro__bar" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}
