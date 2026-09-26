import {
  MAX_RAISES_PER_CHAMBER,
  MODES,
  type Chamber,
  type GameState,
  type ModeConfig,
  type ModeId,
  type Side,
  type Target,
} from './types'

export const STARTING_CHIPS = 240

const other = (s: Side): Side => (s === 'player' ? 'dealer' : 'player')

function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function buildCylinder(live: number, chambers: number): Chamber[] {
  const out: Chamber[] = []
  for (let i = 0; i < chambers; i++) out.push(i < live ? 'live' : 'blank')
  return shuffle(out)
}

export function createGame(modeId: ModeId = 'classic'): GameState {
  const mode = MODES[modeId]
  return {
    mode,
    phase: 'loading',
    cylinder: [],
    loadedOrder: [],
    loadedLive: 0,
    loadedTotal: mode.chambers,
    fired: 0,
    turn: 'player',
    chips: { player: STARTING_CHIPS, dealer: STARTING_CHIPS },
    pot: 0,
    ante: mode.anteBase,
    toCall: 0,
    raiser: null,
    raisesThisChamber: 0,
    passesLeft: { player: mode.passes, dealer: mode.passes },
    outcome: null,
    round: 1,
  }
}

/**
 * Odds that the next chamber under the hammer is live. Both sides know the
 * load count, so this is common knowledge and sharpens as chambers are spent.
 */
export function liveOdds(state: GameState): number {
  if (state.cylinder.length === 0) return 0
  return liveRemaining(state) / state.cylinder.length
}

export function liveRemaining(state: GameState): number {
  return state.cylinder.filter((c) => c === 'live').length
}

/** The stake scales with how loaded the cylinder is, relative to the mode. */
export function riskMultiplier(mode: ModeConfig, live: number): number {
  const lightest = Math.min(...mode.loads)
  return 1 + (live - lightest) * 0.55
}

export function anteFor(mode: ModeConfig, live: number): number {
  return Math.round(mode.anteBase * riskMultiplier(mode, live))
}

/** How many live rounds the opponent puts in when the mode lets them load. */
export function dealerChoosesLoad(mode: ModeConfig): number {
  // They lean heavy, but not every hand, so the table stays readable.
  const weighted = mode.loads.flatMap((n) => Array(n).fill(n) as number[])
  return weighted[Math.floor(Math.random() * weighted.length)]
}

/** Takes chips from both sides, capped so neither can be overdrawn. */
function forceAnte(state: GameState, amount: number): number {
  const paid = Math.max(0, Math.min(amount, state.chips.player, state.chips.dealer))
  if (paid === 0) return 0
  state.chips = {
    player: state.chips.player - paid,
    dealer: state.chips.dealer - paid,
  }
  state.pot += paid * 2
  return paid
}

/** Seals a new cylinder, takes the ante from both sides and opens betting. */
export function startRound(state: GameState, live: number): GameState {
  const next: GameState = { ...state }
  const order = buildCylinder(live, next.mode.chambers)

  next.cylinder = order
  next.loadedOrder = order
  next.loadedLive = live
  next.loadedTotal = next.mode.chambers
  next.fired = 0
  next.pot = 0
  next.toCall = 0
  next.raiser = null
  next.raisesThisChamber = 0
  next.passesLeft = { player: next.mode.passes, dealer: next.mode.passes }
  next.outcome = null
  next.phase = 'betting'
  next.ante = forceAnte(next, anteFor(next.mode, live))
  // Whoever lost the previous hand moves first, as some compensation.
  next.turn = state.outcome ? other(state.outcome.winner) : 'player'
  return next
}

export function maxRaise(state: GameState, side: Side): number {
  return Math.max(0, Math.min(state.chips[side], state.chips[other(side)]))
}

export function canRaise(state: GameState, side: Side): boolean {
  return (
    state.mode.betting &&
    state.raisesThisChamber < MAX_RAISES_PER_CHAMBER &&
    maxRaise(state, side) > 0
  )
}

export function canPass(state: GameState, side: Side): boolean {
  return (
    state.passesLeft[side] > 0 &&
    state.phase === 'betting' &&
    state.turn === side &&
    state.chips[side] >= state.mode.passToll
  )
}

/** Puts chips in and hands the decision to the other side. */
export function raise(state: GameState, side: Side, amount: number): GameState {
  const next: GameState = { ...state }
  const bet = Math.max(1, Math.min(amount, maxRaise(state, side)))
  next.chips = { ...next.chips, [side]: next.chips[side] - bet }
  next.pot += bet
  next.toCall = bet
  next.raiser = side
  next.raisesThisChamber += 1
  next.phase = 'facing_raise'
  next.turn = other(side)
  return next
}

/** Matches an outstanding raise; the original raiser resumes their turn. */
export function call(state: GameState, side: Side): GameState {
  const next: GameState = { ...state }
  const bet = Math.min(state.toCall, state.chips[side])
  next.chips = { ...next.chips, [side]: next.chips[side] - bet }
  next.pot += bet
  next.toCall = 0
  next.phase = 'betting'
  next.turn = state.raiser ?? side
  next.raiser = null
  return next
}

function settle(state: GameState, winner: Side, reason: 'shot' | 'fold'): void {
  state.chips = { ...state.chips, [winner]: state.chips[winner] + state.pot }
  state.outcome = { winner, reason, pot: state.pot, revealed: state.loadedOrder }
  state.pot = 0
  state.toCall = 0
  state.raiser = null
  state.phase = 'round_over'
}

/** Concedes the pot rather than face the chamber. Cheaper than a bullet. */
export function fold(state: GameState, side: Side): GameState {
  const next: GameState = { ...state }
  settle(next, other(side), 'fold')
  return next
}

/** Slides the iron across without firing, paying a toll into the pot. */
export function passIron(state: GameState, side: Side): GameState {
  const next: GameState = { ...state }
  const toll = Math.min(next.mode.passToll, next.chips[side])
  next.chips = { ...next.chips, [side]: next.chips[side] - toll }
  next.pot += toll
  next.passesLeft = { ...next.passesLeft, [side]: next.passesLeft[side] - 1 }
  next.toCall = 0
  next.raiser = null
  next.raisesThisChamber = 0
  next.phase = 'betting'
  next.turn = other(side)
  return next
}

export interface ShotResult {
  state: GameState
  chamber: Chamber
  shooter: Side
  target: Target
  /** Who ate the round, if it was live. */
  victim: Side | null
  /** Chips each side was forced to add for surviving the chamber. */
  blankAnte: number
}

/** Fires the next chamber at the chosen target and settles the hand if live. */
export function fire(state: GameState, shooter: Side, target: Target): ShotResult {
  const next: GameState = { ...state }
  const [chamber, ...rest] = next.cylinder
  next.cylinder = rest
  next.fired += 1
  next.raisesThisChamber = 0
  next.toCall = 0
  next.raiser = null

  const victim: Side = target === 'self' ? shooter : other(shooter)

  if (chamber === 'live') {
    settle(next, other(victim), 'shot')
    return { state: next, chamber, shooter, target, victim, blankAnte: 0 }
  }

  // Riding out your own chamber is rewarded with another turn.
  next.turn = target === 'self' ? shooter : other(shooter)
  next.phase = 'betting'
  const blankAnte = next.mode.blankAnte > 0 ? forceAnte(next, next.mode.blankAnte) : 0

  // A forced ante can empty a stack; the hand cannot continue on fumes.
  if (next.chips.player <= 0 || next.chips.dealer <= 0) {
    const winner = next.chips.player > next.chips.dealer ? 'player' : 'dealer'
    settle(next, winner, 'fold')
  }

  return { state: next, chamber, shooter, target, victim: null, blankAnte }
}

/** Sets up the next hand, or ends the match when someone is cleaned out. */
export function advanceRound(state: GameState): GameState {
  const next: GameState = { ...state }
  if (next.chips.player <= 0 || next.chips.dealer <= 0) {
    next.phase = 'match_over'
    return next
  }
  next.round += 1
  next.phase = 'loading'
  next.cylinder = []
  next.fired = 0
  return next
}
