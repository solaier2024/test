import { setMuted, unlock } from '../audio/engine'
import { useSoundState } from '../audio/useSound'
import type { Lang, STRINGS } from '../i18n/strings'

type Strings = (typeof STRINGS)['en']

/**
 * Three states, because "muted" and "the browser has not let us make a sound
 * yet" are different problems and only one of them is the player's fault. The
 * button is also the unlock, and a deliberate mute is never overridden.
 *
 * It matters more on this table than on the others in the series: the crowd is
 * the opponent here, so a player who never finds this button is playing against
 * nobody. Every reaction has a visual twin for exactly that reason, but the
 * button should still be the loudest piece of chrome on the screen.
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

export function LangToggle({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <button type="button" className="chrome lang" onClick={() => onLang(lang === 'en' ? 'es' : 'en')}>
      {lang === 'en' ? 'ESPAÑOL' : 'ENGLISH'}
    </button>
  )
}
