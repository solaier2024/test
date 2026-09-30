import type { Session } from './types'

/**
 * The session, and the one thing allowed to write it.
 *
 * The table is driven by a single requestAnimationFrame loop that does two
 * unrelated jobs in one pass: it runs whichever beats of a pull have come due,
 * and it lets the room's attention cool off. Both of them change the session.
 *
 * While the session lived in React state with a ref alongside it as a mirror,
 * that was a bug, and it was a bug that ate money. The ref is only refreshed
 * when a render happens, and a render does not happen between two statements
 * of the same frame. So a frame in which a pull resolved AND the cooling tick
 * came round went like this: settle reads the session and queues the result;
 * the cooling tick, four lines later, reads the SAME pre-pull session, subtracts
 * a little heat from it, and queues that. React applies both in order, the
 * second wins, and the entire pull - the coin in, the count, a twenty-coin
 * payout - is gone. The reels had already spun and the room had already
 * cheered, so nothing on screen said anything was wrong; the purse simply did
 * not move. It happened on about one pull in fifteen, and only once the heat
 * was above zero, which is why it always seemed to follow a win.
 *
 * The rule that prevents it is not "remember to be careful with the ref". It is
 * that there is nowhere else to keep the session: no second copy to go stale,
 * and no way to write one except through `commit`, which hands every writer the
 * value the last writer left. React subscribes to this and renders it; it does
 * not own it.
 */
export interface Table {
  /** What the session is right now, not as of the last render. */
  readonly current: Session
  /** Writes it. The updater form is given the live value, never a snapshot. */
  commit(next: Session | ((s: Session) => Session)): void
  subscribe(listener: () => void): () => void
  /** For useSyncExternalStore, which wants a plain function. */
  snapshot(): Session
}

export function createTable(start: Session): Table {
  let current = start
  const listeners = new Set<() => void>()
  return {
    get current() {
      return current
    },
    commit(next) {
      const value = typeof next === 'function' ? next(current) : next
      /* The engine returns the same object when nothing happened - cool() does
       * this constantly - and re-rendering on that would be a render a frame. */
      if (value === current) return
      current = value
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => current,
  }
}
