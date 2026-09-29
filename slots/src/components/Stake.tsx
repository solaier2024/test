import { STAKES } from '../game/engine'

/*
 * Coins on the next pull.
 *
 * Three buttons rather than a slider or a pair of arrows, because the whole
 * point of the control is the comparison: all three prices are on screen at
 * once with what each one buys, and choosing is reading a row rather than
 * counting clicks.
 *
 * The note underneath is the part that makes it a decision instead of a
 * variance dial, and it is not decoration - the trade is invisible otherwise.
 * A pull is one look at the third window whatever it cost, so three coins in
 * buys the same evidence at three times the price. The purse is therefore the
 * clock, and the stake sets how fast it runs.
 */
interface StakeProps {
  stake: number
  bank: number
  disabled: boolean
  onStake: (n: number) => void
  title: string
  note: string
  /** "N coins a pull", for anything reading the buttons out. */
  label: (n: number) => string
}

export function Stake({ stake, bank, disabled, onStake, title, note, label }: StakeProps) {
  return (
    <div className="stake">
      <h3>{title}</h3>
      <div className="stake-row" role="group" aria-label={title}>
        {STAKES.map((n) => (
          <button
            key={n}
            type="button"
            className={`stake-coin${n === stake ? ' on' : ''}`}
            onClick={() => onStake(n)}
            disabled={disabled || n > bank}
            aria-pressed={n === stake}
            aria-label={label(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="stake-note">{note}</p>
    </div>
  )
}
