/**
 * Solves the target choice exactly, for every position every table can reach.
 *
 * The question is the one the whole game is built on: with the cylinder in a
 * known state, is it better to ride out your own chamber and keep the turn,
 * or to point it across the table? Both sides know the load count, so this is
 * a finite game of perfect information about the odds and it can just be
 * enumerated.
 *
 *   W(L, B) = the probability that the side holding the iron wins, with L
 *             live rounds and B blanks left in the cylinder.
 *
 * A live chamber always settles the hand, so W(L, 0) = 1: the last chamber is
 * always live and whoever holds the turn simply fires it across. From there,
 *
 *   across = p + (1 - p) * (1 - W(L, B - 1))     a chance to end it now, then
 *                                                the turn goes over
 *   self   =     (1 - p) * W(L, B - 1)           no chance to end it, but the
 *                                                turn stays here
 *
 * Run with: node scripts/solve-targets.mjs
 */

/** Kept in step with src/game/types.ts by hand; this script is not shipped. */
const MODES = {
  classic: { chambers: 6, loads: [1, 2, 3, 4, 5] },
  quickdraw: { chambers: 4, loads: [1] },
  widowmaker: { chambers: 6, loads: [3, 4, 5] },
  diablo: { chambers: 6, loads: [2, 3, 4, 5] },
}

const memo = new Map()

function W(L, B) {
  if (B === 0) return 1
  const key = `${L},${B}`
  if (memo.has(key)) return memo.get(key)
  const p = L / (L + B)
  const next = W(L, B - 1)
  const v = Math.max(p + (1 - p) * (1 - next), (1 - p) * next)
  memo.set(key, v)
  return v
}

const rows = []
let selfWins = 0
let ties = 0
let acrossWins = 0

for (const [id, mode] of Object.entries(MODES)) {
  for (const load of mode.loads) {
    for (let spent = 0; spent < mode.chambers - load; spent++) {
      const L = load
      const B = mode.chambers - load - spent
      const p = L / (L + B)
      const next = W(L, B - 1)
      const across = p + (1 - p) * (1 - next)
      const self = (1 - p) * next
      const verdict =
        Math.abs(across - self) < 1e-9 ? 'tie' : across > self ? 'across' : 'SELF IS BETTER'
      if (verdict === 'tie') ties++
      else if (verdict === 'across') acrossWins++
      else selfWins++
      rows.push(
        [
          id.padEnd(11),
          `${L} live / ${B} blank`.padEnd(18),
          `p=${p.toFixed(2)}`,
          `across=${across.toFixed(3)}`,
          `self=${self.toFixed(3)}`,
          verdict,
        ].join('  '),
      )
    }
  }
}

console.log(rows.join('\n'))
console.log(
  `\n${acrossWins} positions favour firing across, ${ties} are exactly even, ` +
    `${selfWins} favour firing at yourself.`,
)
if (selfWins === 0) {
  console.log(
    '\nFiring across weakly dominates: under the current rules there is no\n' +
      'position on any table where riding out your own chamber wins the hand\n' +
      'more often. The tempo choice is flavour, not strategy. Giving a\n' +
      'survived self-shot a chip reward is the smallest fix that would make\n' +
      'it a real decision.',
  )
}
