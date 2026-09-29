import { useMemo } from 'react'
import { STRINGS, type Lang } from '../i18n/strings'

/** Always reachable, including during the opening, so nobody has to sit
 *  through a language they do not read. */
export function LangToggle({ lang, onPick }: { lang: Lang; onPick: (l: Lang) => void }) {
  const langs = useMemo(() => Object.keys(STRINGS) as Lang[], [])
  return (
    <div className="langtoggle">
      {langs.map((l) => (
        <button
          key={l}
          type="button"
          className={`langtoggle__btn${lang === l ? ' is-on' : ''}`}
          aria-label={STRINGS[l].langName}
          onClick={() => onPick(l)}
        >
          {/* Both are rendered and one is hidden by width, so the label can
              shrink to a code on a phone without the button losing its name. */}
          <span className="langtoggle__full">{STRINGS[l].langName}</span>
          <span className="langtoggle__short">{STRINGS[l].langShort}</span>
        </button>
      ))}
    </div>
  )
}
