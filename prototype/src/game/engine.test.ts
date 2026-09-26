import { describe, expect, it } from 'vitest'
import {
  ANTE,
  STARTING_CHIPS,
  advanceRound,
  buildCylinder,
  call,
  createGame,
  fire,
  fold,
  liveOdds,
  raise,
  riskMultiplier,
  startRound,
} from './engine'
import { CALLOWAY, chooseBet, chooseTarget, respondToRaise } from './ai'
import { CYLINDER_SIZE, type GameState, type Side } from './types'

const TOTAL = STARTING_CHIPS * 2

/** Chips never appear or vanish: stacks plus the pot must stay constant. */
function totalChips(s: GameState): number {
  return s.chips.player + s.chips.dealer + s.pot
}

describe('cylinder', () => {
  it('loads exactly the requested number of live rounds', () => {
    for (let live = 1; live <= 5; live++) {
      const c = buildCylinder(live)
      expect(c).toHaveLength(CYLINDER_SIZE)
      expect(c.filter((x) => x === 'live')).toHaveLength(live)
    }
  })

  it('does not always produce the same order', () => {
    const orders = new Set(
      Array.from({ length: 60 }, () => buildCylinder(2).join(',')),
    )
    expect(orders.size).toBeGreaterThan(1)
  })
})

describe('round setup', () => {
  it('takes an ante from both sides scaled by the load', () => {
    const s = startRound(createGame(), 3)
    const ante = Math.round(ANTE * riskMultiplier(3))
    expect(s.ante).toBe(ante)
    expect(s.pot).toBe(ante * 2)
    expect(s.chips.player).toBe(STARTING_CHIPS - ante)
    expect(s.chips.dealer).toBe(STARTING_CHIPS - ante)
    expect(totalChips(s)).toBe(TOTAL)
  })

  it('reports odds that match the sealed cylinder', () => {
    const s = startRound(createGame(), 2)
    expect(liveOdds(s)).toBeCloseTo(2 / 6)
  })
})

describe('firing', () => {
  /** Forces a known cylinder so outcomes are deterministic. */
  function rigged(order: ('live' | 'blank')[], turn: Side = 'player'): GameState {
    const s = startRound(createGame(), order.filter((c) => c === 'live').length)
    return { ...s, cylinder: order, turn }
  }

  it('a live round at yourself hands the pot to the opponent', () => {
    const s = rigged(['live', 'blank', 'blank', 'blank', 'blank', 'blank'])
    const potBefore = s.pot
    const { state, victim } = fire(s, 'player', 'self')
    expect(victim).toBe('player')
    expect(state.outcome?.winner).toBe('dealer')
    expect(state.chips.dealer).toBe(s.chips.dealer + potBefore)
    expect(state.chips.player).toBe(s.chips.player)
    expect(totalChips(state)).toBe(TOTAL)
  })

  it('a live round at the opponent hands the pot to you', () => {
    const s = rigged(['live', 'blank', 'blank', 'blank', 'blank', 'blank'])
    const potBefore = s.pot
    const { state, victim } = fire(s, 'player', 'opponent')
    expect(victim).toBe('dealer')
    expect(state.outcome?.winner).toBe('player')
    expect(state.chips.player).toBe(s.chips.player + potBefore)
    expect(totalChips(state)).toBe(TOTAL)
  })

  it('surviving your own chamber keeps the turn, shooting across passes it', () => {
    const s = rigged(['blank', 'live', 'blank', 'blank', 'blank', 'blank'])
    expect(fire(s, 'player', 'self').state.turn).toBe('player')
    expect(fire(s, 'player', 'opponent').state.turn).toBe('dealer')
  })

  it('spends one chamber per shot and narrows the odds', () => {
    const s = rigged(['blank', 'blank', 'live', 'blank', 'blank', 'blank'])
    const after = fire(s, 'player', 'self').state
    expect(after.fired).toBe(1)
    expect(after.cylinder).toHaveLength(5)
    expect(liveOdds(after)).toBeCloseTo(1 / 5)
  })

  it('becomes a certainty once only live rounds remain', () => {
    const s = rigged(['live'])
    expect(liveOdds(s)).toBe(1)
  })
})

describe('betting', () => {
  it('a fold gives the pot to the other side without spending a chamber', () => {
    const s = startRound(createGame(), 2)
    const potBefore = s.pot
    const after = fold(s, 'player')
    expect(after.outcome).toEqual({ winner: 'dealer', reason: 'fold', pot: potBefore })
    expect(after.chips.dealer).toBe(s.chips.dealer + potBefore)
    expect(after.fired).toBe(0)
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('a raise moves chips into the pot and passes the decision', () => {
    const s = startRound(createGame(), 1)
    const after = raise(s, 'player', 40)
    expect(after.pot).toBe(s.pot + 40)
    expect(after.chips.player).toBe(s.chips.player - 40)
    expect(after.toCall).toBe(40)
    expect(after.turn).toBe('dealer')
    expect(after.phase).toBe('facing_raise')
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('a call matches the raise and returns the turn to the raiser', () => {
    const s = raise(startRound(createGame(), 1), 'player', 40)
    const after = call(s, 'dealer')
    expect(after.pot).toBe(s.pot + 40)
    expect(after.turn).toBe('player')
    expect(after.phase).toBe('betting')
    expect(after.toCall).toBe(0)
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('never lets a side raise more than the shorter stack can cover', () => {
    const base = startRound(createGame(), 1)
    const lopsided: GameState = { ...base, chips: { player: 500, dealer: 30 } }
    const after = raise(lopsided, 'player', 500)
    expect(after.toCall).toBe(30)
    expect(after.chips.player).toBe(470)
  })
})

describe('full match simulation', () => {
  /**
   * Drives both seats with the opponent AI so the whole state machine gets
   * exercised: every reachable phase must resolve and chips must be conserved.
   */
  it('always reaches a conclusion with chips conserved', () => {
    for (let seed = 0; seed < 300; seed++) {
      let s = createGame()
      let guard = 0

      while (s.phase !== 'match_over' && guard++ < 4000) {
        expect(totalChips(s)).toBe(TOTAL)

        if (s.phase === 'loading') {
          s = startRound(s, 1 + Math.floor(Math.random() * 5))
          continue
        }
        if (s.phase === 'round_over') {
          s = advanceRound(s)
          continue
        }
        if (s.phase === 'facing_raise') {
          s = respondToRaise(s, CALLOWAY) === 'call' ? call(s, s.turn) : fold(s, s.turn)
          continue
        }
        if (s.phase === 'betting') {
          const bet = chooseBet(s, CALLOWAY)
          if (bet.action === 'raise') {
            s = raise(s, s.turn, bet.amount)
            continue
          }
          s = fire(s, s.turn, chooseTarget(s, CALLOWAY)).state
          continue
        }
        throw new Error(`unexpected phase ${s.phase}`)
      }

      expect(guard).toBeLessThan(4000)
      expect(s.phase).toBe('match_over')
      expect(totalChips(s)).toBe(TOTAL)
      expect(Math.min(s.chips.player, s.chips.dealer)).toBeLessThanOrEqual(0)
    }
  })

  it('never leaves a sealed round without a legal move', () => {
    for (let seed = 0; seed < 200; seed++) {
      let s = startRound(createGame(), 1 + Math.floor(Math.random() * 5))
      let guard = 0
      while (s.phase === 'betting' || s.phase === 'facing_raise') {
        expect(s.cylinder.length).toBeGreaterThan(0)
        if (guard++ > 200) throw new Error('round never resolved')
        s =
          s.phase === 'facing_raise'
            ? call(s, s.turn)
            : fire(s, s.turn, chooseTarget(s, CALLOWAY)).state
      }
      expect(s.phase).toBe('round_over')
      expect(s.outcome).not.toBeNull()
    }
  })
})
