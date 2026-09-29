import type { ReactNode } from 'react'
import { PROOF } from '../game/engine'
import { PAYS, type Face } from '../game/types'
import { FaceMark } from './Face'

/*
 * The two things bolted to the sides of this table.
 *
 * On the left, the count: not a percentage, and deliberately not a percentage.
 * A number that says 71% after nine pulls looks like knowledge and is not one,
 * and this whole table is about the difference. It is notches cut into the bar
 * rail, the way somebody actually keeping count would do it, and the only
 * reading it gives is how far along the rail you are.
 *
 * On the right, the payout card, which is honest on every machine in the house
 * and is therefore the most misleading object in the room.
 */

interface TallyProps {
  pulls: number
  bells: number
  evidence: number
  label: string
  legend: string
  hint: string
}

const NOTCHES = 22

export function Tally({ pulls, bells, evidence, label, legend, hint }: TallyProps) {
  const filled = Math.max(0, Math.min(NOTCHES, Math.round((evidence / PROOF) * NOTCHES)))
  const proven = evidence >= PROOF
  return (
    <div className={`tally${proven ? ' proven' : ''}`}>
      <span className="tally-label">{label}</span>
      <div className="rail" role="img" aria-label={`${legend}: ${filled} of ${NOTCHES}`}>
        {Array.from({ length: NOTCHES }, (_, i) => (
          <span key={i} className={`notch${i < filled ? ' cut' : ''}`} />
        ))}
        <span className="bar-mark" />
      </div>
      <span className="tally-count">
        {bells} / {pulls}
      </span>
      <span className="tally-hint">{hint}</span>
    </div>
  )
}

const LABEL: Record<string, Face> = {
  bell: 'bell',
  shoe: 'shoe',
  star: 'star',
}

/*
 * The stake goes in the card's footer rather than beside the lever, and it is
 * the right place for a reason beyond finding room for it: the card is the
 * only object here that says what a coin is worth, and every number printed
 * on it is now a number per coin. Putting the multiplier anywhere else leaves
 * the card saying 100 while the machine pays 300.
 */
export function PayCard({
  title,
  suit,
  anyBell,
  note,
  stake,
}: {
  title: string
  suit: string
  anyBell: string
  note: string
  stake?: ReactNode
}) {
  return (
    <div className="paycard">
      <span className="paycard-title">{title}</span>
      <ul>
        {PAYS.map((row) => (
          <li key={`${row.of}-${row.count}`}>
            <span className="paycard-row">
              {row.of === 'suit' ? (
                <span className="paycard-text">{suit}</span>
              ) : row.of === 'bells' ? (
                <span className="paycard-text">
                  {row.count}
                  <FaceMark name="bell" />
                  {row.count === 1 ? ` ${anyBell}` : ''}
                </span>
              ) : (
                <span className="paycard-text">
                  {Array.from({ length: row.count }, (_, i) => (
                    <FaceMark key={i} name={LABEL[row.of as string]} />
                  ))}
                </span>
              )}
            </span>
            <span className="paycard-coins">{row.coins}</span>
          </li>
        ))}
      </ul>
      <span className="paycard-note">{note}</span>
      {stake}
    </div>
  )
}
