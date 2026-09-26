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
          onClick={() => onPick(l)}
        >
          {STRINGS[l].langName}
        </button>
      ))}
    </div>
  )
}
