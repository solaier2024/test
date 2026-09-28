import { setMuted, unlock } from '../audio/engine'
import { useSoundState } from '../audio/useSound'
import type { Strings } from '../i18n/strings'

/**
 * Three states, because "muted" and "the browser has not let us make a sound
 * yet" are different problems and only one of them is the player's fault. The
 * button is also the unlock, and a deliberate mute is never overridden.
 */
export function SoundToggle({ t }: { t: Strings }) {
  const { muted, unlocked } = useSoundState()
  const label = !unlocked ? t.soundTapFor : muted ? t.soundOff : t.soundOn

  return (
    <button
      type="button"
      className={`chrome sound${!unlocked ? ' waiting' : ''}`}
      onClick={() => {
        void unlock()
        if (unlocked) setMuted(!muted)
        else setMuted(false)
      }}
    >
      <span aria-hidden="true">{!unlocked || muted ? '🔇' : '🔊'}</span> {label}
    </button>
  )
}

export function LangToggle({ lang, onLang }: { lang: 'en' | 'es'; onLang: (l: 'en' | 'es') => void }) {
  return (
    <button type="button" className="chrome lang" onClick={() => onLang(lang === 'en' ? 'es' : 'en')}>
      {lang === 'en' ? 'ESPAÑOL' : 'ENGLISH'}
    </button>
  )
}
