import {
  CYLINDER_SIZE,
  MAX_RAISES_PER_CHAMBER,
  type Chamber,
  type GameState,
  type Side,
  type Target,
} from './types'

export const STARTING_CHIPS = 240
export const ANTE = 20

const other = (s: Side): Side => (s === 'player' ? 'dealer' : 'player')

function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function buildCylinder(live: number): Chamber[] {
  const chambers: Chamber[] = []
  for (let i = 0; i < CYLINDER_SIZE; i++) {
    chambers.push(i < live ? 'live' : 'blank')
  }
  return shuffle(chambers)
}

export function createGame(): GameState {
  return {
    phase: 'loading',
    cylinder: [],
    loadedLive: 0,
    loadedTotal: CYLINDER_SIZE,
    fired: 0,
    turn: 'player',
    chips: { player: STARTING_CHIPS, dealer: STARTING_CHIPS },
    pot: 0,
    ante: ANTE,
    toCall: 0,
    raiser: null,
    raisesThisChamber: 0,
    outcome: null,
    round: 1,
    log: ['木桌上只有一把左轮。对面的人没有说话。'],
  }
}

/**
 * Odds that the next chamber under the hammer is live. Both sides know the
 * load count, so this is common knowledge and updates as chambers are spent.
 */
export function liveOdds(state: GameState): number {
  if (state.cylinder.length === 0) return 0
  const live = state.cylinder.filter((c) => c === 'live').length
  return live / state.cylinder.length
}

export function liveRemaining(state: GameState): number {
  return state.cylinder.filter((c) => c === 'live').length
}

/** The round stake scales with how loaded the cylinder is. */
export function riskMultiplier(live: number): number {
  return 1 + (live - 1) * 0.6
}

function pushLog(state: GameState, line: string): void {
  state.log = [...state.log, line].slice(-40)
}

/** Seals a new cylinder, takes the ante from both sides and opens betting. */
export function startRound(state: GameState, live: number): GameState {
  const next: GameState = { ...state }
  const ante = Math.round(ANTE * riskMultiplier(live))
  const paid = Math.min(ante, next.chips.player, next.chips.dealer)

  next.cylinder = buildCylinder(live)
  next.loadedLive = live
  next.loadedTotal = CYLINDER_SIZE
  next.fired = 0
  next.ante = paid
  next.chips = {
    player: next.chips.player - paid,
    dealer: next.chips.dealer - paid,
  }
  next.pot = paid * 2
  next.toCall = 0
  next.raiser = null
  next.raisesThisChamber = 0
  next.outcome = null
  next.phase = 'betting'
  // The side that lost the previous round gets to move first as compensation.
  next.turn = state.outcome ? other(state.outcome.winner) : 'player'
  pushLog(
    next,
    `第 ${next.round} 局 · 弹巢装入 ${live} 发实弹，底注 ${paid}。`,
  )
  return next
}

export function maxRaise(state: GameState, side: Side): number {
  const room = Math.min(state.chips[side], state.chips[other(side)])
  return Math.max(0, room)
}

export function canRaise(state: GameState, side: Side): boolean {
  return (
    state.raisesThisChamber < MAX_RAISES_PER_CHAMBER &&
    maxRaise(state, side) > 0
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
  pushLog(next, `${side === 'player' ? '你' : '对面'}把 ${bet} 枚筹码推到桌心。`)
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
  pushLog(next, `${side === 'player' ? '你' : '对面'}跟了。`)
  return next
}

/** Concedes the pot rather than face the chamber. Cheaper than a bullet. */
export function fold(state: GameState, side: Side): GameState {
  const next: GameState = { ...state }
  const winner = other(side)
  next.chips = { ...next.chips, [winner]: next.chips[winner] + next.pot }
  next.outcome = { winner, reason: 'fold', pot: next.pot }
  next.pot = 0
  next.toCall = 0
  next.raiser = null
  next.phase = 'round_over'
  pushLog(
    next,
    side === 'player'
      ? '你把手从枪上挪开，推走了筹码。活着比赢重要。'
      : '他摇了摇头，松开了手。这一局他不跟了。',
  )
  return next
}

export interface ShotResult {
  state: GameState
  chamber: Chamber
  shooter: Side
  target: Target
  /** Who ate the round, if it was live. */
  victim: Side | null
}

/** Fires the next chamber at the chosen target and settles the round if live. */
export function fire(state: GameState, shooter: Side, target: Target): ShotResult {
  const next: GameState = { ...state }
  const [chamber, ...rest] = next.cylinder
  next.cylinder = rest
  next.fired += 1
  next.raisesThisChamber = 0
  next.toCall = 0
  next.raiser = null

  const victimSide: Side = target === 'self' ? shooter : other(shooter)
  const who = shooter === 'player' ? '你' : '他'
  const at = target === 'self' ? '自己的太阳穴' : who === '你' ? '他的眉心' : '你的眉心'

  if (chamber === 'live') {
    const winner = other(victimSide)
    next.chips = { ...next.chips, [winner]: next.chips[winner] + next.pot }
    next.outcome = { winner, reason: 'shot', pot: next.pot }
    next.pot = 0
    next.phase = 'round_over'
    pushLog(next, `${who}把枪口抵住${at}，扣下扳机 —— 枪响了。`)
    return { state: next, chamber, shooter, target, victim: victimSide }
  }

  pushLog(next, `${who}把枪口抵住${at}，扣下扳机 —— 空响。`)
  // Firing at yourself and surviving is rewarded with another turn.
  next.turn = target === 'self' ? shooter : other(shooter)
  next.phase = 'betting'
  return { state: next, chamber, shooter, target, victim: null }
}

/** Called after a round is acknowledged; sets up the next load or ends the match. */
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
