import { describe, expect, it } from 'vitest'
import {
  STARTING_CHIPS,
  advanceRound,
  anteFor,
  buildCylinder,
  call,
  canPass,
  canRaise,
  createGame,
  dealerChoosesLoad,
  fire,
  fold,
  liveOdds,
  maxRaise,
  passIron,
  raise,
  startRound,
} from './engine'
import { CALLOWAY, VIUDA, chooseBet, choosePass, chooseTarget, respondToRaise } from './ai'
import { MODES, MODE_ORDER, type GameState, type ModeId, type Side } from './types'

const TOTAL = STARTING_CHIPS * 2

/** Chips never appear or vanish: both stacks plus the pot stay constant. */
function totalChips(s: GameState): number {
  return s.chips.player + s.chips.dealer + s.pot
}

function anyLoad(id: ModeId): number {
  const loads = MODES[id].loads
  return loads[Math.floor(Math.random() * loads.length)]
}

describe('cylinder', () => {
  it('loads exactly the requested rounds into the mode’s chamber count', () => {
    for (const id of MODE_ORDER) {
      const mode = MODES[id]
      for (const live of mode.loads) {
        const c = buildCylinder(live, mode.chambers)
        expect(c).toHaveLength(mode.chambers)
        expect(c.filter((x) => x === 'live')).toHaveLength(live)
      }
    }
  })

  it('does not always produce the same order', () => {
    const orders = new Set(Array.from({ length: 60 }, () => buildCylinder(2, 6).join(',')))
    expect(orders.size).toBeGreaterThan(1)
  })
})

describe('modes', () => {
  it('every mode is playable from a fresh game', () => {
    for (const id of MODE_ORDER) {
      const s = startRound(createGame(id), anyLoad(id))
      expect(s.phase).toBe('betting')
      expect(s.cylinder).toHaveLength(MODES[id].chambers)
      expect(totalChips(s)).toBe(TOTAL)
    }
  })

  it('quick draw is a four chamber, single round, no-betting table', () => {
    const mode = MODES.quickdraw
    expect(mode.chambers).toBe(4)
    expect(mode.loads).toEqual([1])
    const s = startRound(createGame('quickdraw'), 1)
    expect(liveOdds(s)).toBeCloseTo(1 / 4)
    expect(canRaise(s, 'player')).toBe(false)
    expect(canRaise(s, 'dealer')).toBe(false)
  })

  it('widowmaker refuses a light load and taxes both sides per survived chamber', () => {
    const mode = MODES.widowmaker
    expect(Math.min(...mode.loads)).toBe(3)

    // Rig an empty chamber so the forced ante is the only thing that moves.
    const base = startRound(createGame('widowmaker'), 3)
    const rigged: GameState = { ...base, cylinder: ['blank', 'live', 'live', 'live'] }
    const potBefore = rigged.pot
    const { state, blankAnte } = fire(rigged, 'player', 'self')

    expect(blankAnte).toBe(mode.blankAnte)
    expect(state.pot).toBe(potBefore + mode.blankAnte * 2)
    expect(state.chips.player).toBe(rigged.chips.player - mode.blankAnte)
    expect(state.chips.dealer).toBe(rigged.chips.dealer - mode.blankAnte)
    expect(totalChips(state)).toBe(TOTAL)
  })

  it('classic never charges a forced ante between chambers', () => {
    const base = startRound(createGame('classic'), 2)
    const rigged: GameState = { ...base, cylinder: ['blank', 'live', 'blank'] }
    const { state, blankAnte } = fire(rigged, 'player', 'self')
    expect(blankAnte).toBe(0)
    expect(state.pot).toBe(rigged.pot)
  })

  it('the devil’s table loads for you and grants one pass per side', () => {
    const mode = MODES.diablo
    expect(mode.loadedBy).toBe('dealer')
    expect(mode.passes).toBe(1)
    for (let i = 0; i < 40; i++) expect(mode.loads).toContain(dealerChoosesLoad(mode))

    const s = startRound(createGame('diablo'), 3)
    expect(canPass(s, s.turn)).toBe(true)
  })

  it('no other mode allows a pass', () => {
    for (const id of MODE_ORDER.filter((m) => m !== 'diablo')) {
      const s = startRound(createGame(id), anyLoad(id))
      expect(canPass(s, s.turn)).toBe(false)
    }
  })
})

describe('passing the iron', () => {
  function diabloRound(): GameState {
    const s = startRound(createGame('diablo'), 3)
    return { ...s, turn: 'player' }
  }

  it('pays a toll, hands over the turn and spends no chamber', () => {
    const s = diabloRound()
    const after = passIron(s, 'player')
    expect(after.pot).toBe(s.pot + MODES.diablo.passToll)
    expect(after.chips.player).toBe(s.chips.player - MODES.diablo.passToll)
    expect(after.turn).toBe('dealer')
    expect(after.cylinder).toEqual(s.cylinder)
    expect(after.fired).toBe(0)
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('is available only once per side per hand', () => {
    const s = diabloRound()
    const after = passIron(s, 'player')
    expect(canPass(after, 'dealer')).toBe(true)
    const back = passIron(after, 'dealer')
    expect(canPass({ ...back, turn: 'player' }, 'player')).toBe(false)
    expect(canPass({ ...back, turn: 'dealer' }, 'dealer')).toBe(false)
  })

  it('is refreshed when the next hand is dealt', () => {
    const spent = passIron(diabloRound(), 'player')
    const settled = fold(spent, 'dealer')
    const next = startRound(advanceRound(settled), 3)
    expect(next.passesLeft).toEqual({ player: 1, dealer: 1 })
  })
})

describe('firing', () => {
  /** Forces a known cylinder so outcomes are deterministic. */
  function rigged(order: ('live' | 'blank')[], turn: Side = 'player'): GameState {
    const live = order.filter((c) => c === 'live').length
    const s = startRound(createGame('classic'), Math.max(1, Math.min(5, live)))
    return { ...s, cylinder: order, loadedOrder: order, turn }
  }

  it('a live round at yourself hands the pot to the opponent', () => {
    const s = rigged(['live', 'blank', 'blank', 'blank', 'blank', 'blank'])
    const pot = s.pot
    const { state, victim } = fire(s, 'player', 'self')
    expect(victim).toBe('player')
    expect(state.outcome?.winner).toBe('dealer')
    expect(state.chips.dealer).toBe(s.chips.dealer + pot)
    expect(totalChips(state)).toBe(TOTAL)
  })

  it('a live round at the opponent hands the pot to you', () => {
    const s = rigged(['live', 'blank', 'blank', 'blank', 'blank', 'blank'])
    const pot = s.pot
    const { state, victim } = fire(s, 'player', 'opponent')
    expect(victim).toBe('dealer')
    expect(state.outcome?.winner).toBe('player')
    expect(state.chips.player).toBe(s.chips.player + pot)
    expect(totalChips(state)).toBe(TOTAL)
  })

  it('riding out your own chamber keeps the turn, firing across passes it', () => {
    const s = rigged(['blank', 'live', 'blank', 'blank', 'blank', 'blank'])
    expect(fire(s, 'player', 'self').state.turn).toBe('player')
    expect(fire(s, 'player', 'opponent').state.turn).toBe('dealer')
  })

  it('spends one chamber per shot and sharpens the odds', () => {
    const s = rigged(['blank', 'blank', 'live', 'blank', 'blank', 'blank'])
    const after = fire(s, 'player', 'self').state
    expect(after.fired).toBe(1)
    expect(after.cylinder).toHaveLength(5)
    expect(liveOdds(after)).toBeCloseTo(1 / 5)
  })

  it('becomes a certainty once only live rounds remain', () => {
    expect(liveOdds(rigged(['live']))).toBe(1)
  })

  it('reveals the cylinder order once the hand is settled', () => {
    const order: ('live' | 'blank')[] = ['live', 'blank', 'blank', 'blank', 'blank', 'blank']
    const { state } = fire(rigged(order), 'player', 'self')
    expect(state.outcome?.revealed).toEqual(order)
  })
})

describe('betting', () => {
  it('a fold gives the pot to the other side without spending a chamber', () => {
    const s = startRound(createGame('classic'), 2)
    const pot = s.pot
    const after = fold(s, 'player')
    expect(after.outcome?.winner).toBe('dealer')
    expect(after.outcome?.reason).toBe('fold')
    expect(after.chips.dealer).toBe(s.chips.dealer + pot)
    expect(after.fired).toBe(0)
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('a raise moves chips into the pot and passes the decision', () => {
    const s = startRound(createGame('classic'), 1)
    const after = raise(s, 'player', 40)
    expect(after.pot).toBe(s.pot + 40)
    expect(after.toCall).toBe(40)
    expect(after.turn).toBe('dealer')
    expect(after.phase).toBe('facing_raise')
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('a call matches the raise and returns the turn to the raiser', () => {
    const s = raise(startRound(createGame('classic'), 1), 'player', 40)
    const after = call(s, 'dealer')
    expect(after.pot).toBe(s.pot + 40)
    expect(after.turn).toBe('player')
    expect(after.phase).toBe('betting')
    expect(totalChips(after)).toBe(TOTAL)
  })

  it('never lets a side raise more than the shorter stack can cover', () => {
    const base = startRound(createGame('classic'), 1)
    const lopsided: GameState = { ...base, chips: { player: 500, dealer: 30 } }
    expect(maxRaise(lopsided, 'player')).toBe(30)
    expect(raise(lopsided, 'player', 500).toCall).toBe(30)
  })

  it('scales the ante with the load, relative to the mode’s lightest option', () => {
    for (const id of MODE_ORDER) {
      const mode = MODES[id]
      const lightest = Math.min(...mode.loads)
      expect(anteFor(mode, lightest)).toBe(mode.anteBase)
      for (const live of mode.loads) {
        expect(anteFor(mode, live)).toBeGreaterThanOrEqual(mode.anteBase)
      }
    }
  })
})

describe('full match simulation', () => {
  /**
   * Drives both seats with the opponent AI so every reachable phase of every
   * mode is exercised: each match must conclude with chips conserved.
   */
  it.each(MODE_ORDER)('%s always reaches a conclusion with chips conserved', (id) => {
    const persona = MODES[id].venue === 'cantina' ? VIUDA : CALLOWAY

    for (let seed = 0; seed < 120; seed++) {
      let s = createGame(id)
      let guard = 0

      while (s.phase !== 'match_over' && guard++ < 6000) {
        expect(totalChips(s)).toBe(TOTAL)

        if (s.phase === 'loading') {
          s = startRound(s, anyLoad(id))
          continue
        }
        if (s.phase === 'round_over') {
          s = advanceRound(s)
          continue
        }
        if (s.phase === 'facing_raise') {
          s = respondToRaise(s, persona) === 'call' ? call(s, s.turn) : fold(s, s.turn)
          continue
        }
        if (s.phase === 'betting') {
          if (choosePass(s, persona)) {
            s = passIron(s, s.turn)
            continue
          }
          const bet = chooseBet(s, persona)
          if (bet.action === 'raise') {
            s = raise(s, s.turn, bet.amount)
            continue
          }
          s = fire(s, s.turn, chooseTarget(s, persona)).state
          continue
        }
        throw new Error(`unexpected phase ${s.phase}`)
      }

      expect(guard).toBeLessThan(6000)
      expect(s.phase).toBe('match_over')
      expect(totalChips(s)).toBe(TOTAL)
      expect(Math.min(s.chips.player, s.chips.dealer)).toBeLessThanOrEqual(0)
    }
  })

  it.each(MODE_ORDER)('%s never leaves a sealed hand without a legal move', (id) => {
    const persona = MODES[id].venue === 'cantina' ? VIUDA : CALLOWAY

    for (let seed = 0; seed < 120; seed++) {
      let s = startRound(createGame(id), anyLoad(id))
      let guard = 0
      while (s.phase === 'betting' || s.phase === 'facing_raise') {
        expect(s.cylinder.length).toBeGreaterThan(0)
        if (guard++ > 300) throw new Error('hand never resolved')
        s =
          s.phase === 'facing_raise'
            ? call(s, s.turn)
            : fire(s, s.turn, chooseTarget(s, persona)).state
      }
      expect(s.phase).toBe('round_over')
      expect(s.outcome).not.toBeNull()
      expect(s.outcome?.revealed).toHaveLength(MODES[id].chambers)
    }
  })
})
