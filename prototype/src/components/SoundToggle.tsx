import { setMuted, unlockAudio } from '../audio/engine'
import { useSoundState } from '../audio/useSound'
import type { Strings } from '../i18n/strings'

/**
 * Mute, and the way out of the autoplay block.
 *
 * A browser will not let a page make a sound until it has been touched, and
 * during the opening the only other thing to touch is the film itself, which
 * skips it. So when audio is still held back this says so and offers itself
 * as the thing to press.
 */
export function SoundToggle({ t }: { t: Strings }) {
  const state = useSoundState()

  const toggle = () => {
    if (state === 'on') setMuted(true)
    else {
      setMuted(false)
      unlockAudio()
    }
  }

  return (
    <button
      type="button"
      className={`soundtoggle is-${state}`}
      onClick={toggle}
      aria-label={t.sound[state]}
      title={t.sound[state]}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 9.5h3.6L12.5 5v14L7.6 14.5H4z" />
        {state === 'off' ? (
          <path d="M16 9.4l5 5.2M21 9.4l-5 5.2" className="soundtoggle__cross" />
        ) : (
          <>
            <path d="M15.8 9.2a4 4 0 0 1 0 5.6" className="soundtoggle__wave" />
            <path d="M18.4 6.8a7.6 7.6 0 0 1 0 10.4" className="soundtoggle__wave" />
          </>
        )}
      </svg>
      {state === 'blocked' && <span className="soundtoggle__hint">{t.sound.blocked}</span>}
    </button>
  )
}
