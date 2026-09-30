/*
 * The boundary, from the client's side.
 *
 * Two implementations of one interface. Which one runs is decided by an
 * environment variable and by nothing in the UI:
 *
 *   inProcess   the House runs inside the page. What the static preview uses,
 *               because a static host has nowhere else to put it.
 *   overHttp    the House runs on a server and this speaks to it. What a real
 *               money deployment uses, where the House is never shipped to a
 *               browser at all.
 *
 * The in-process one is a demo and the difference matters, so it is worth saying
 * exactly what is and is not being demonstrated by it. What is NOT demonstrated
 * is secrecy: a House inside the page has the server seed inside the page, and
 * anybody with a debugger can read it. What IS demonstrated is that nothing in
 * the UI depends on being able to - the client asks for a view and is handed a
 * redaction, exactly as it would be over a socket, and the only file that has to
 * change to make the secrecy real is this one.
 *
 * That is the thing the brief asked for. "The grey box has to be layered this way
 * or it is a rewrite later" is a claim about where the seams are, and a seam is
 * only real if you can show both sides of it working.
 *
 * IDEMPOTENCY KEYS ARE MINTED HERE, AND THAT IS DELIBERATE
 *
 * A key belongs to the player's intention, not to the HTTP request. One press of
 * CASH OUT is one key, however many times the request is sent - so a dropped
 * response, a retry, a reconnect and a double tap all collapse onto the same
 * settlement. Minting the key inside the retry loop would make every attempt a
 * new intention, which is precisely the bug the key exists to prevent.
 */

import type { House, PlayerView } from '../server/service.ts'
import type { Zone } from '../game/table.ts'

export interface Api {
  view(): Promise<PlayerView>
  open(stake: number): Promise<PlayerView>
  kick(roundId: string, zone: Zone): Promise<PlayerView>
  cashOut(roundId: string): Promise<PlayerView>
  setClientSeed(seed: string): Promise<PlayerView>
  rotateSeed(next: string): Promise<PlayerView>
}

/** Thrown for a refusal the server meant. Distinct from a connection problem. */
export class ApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

const newKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

/**
 * Retries a call that failed to reach an answer, reusing the key.
 *
 * Only for transport failures. A refusal is an answer and retrying it would just
 * annoy the server with a question it has already declined.
 */
async function reaching<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof ApiError) throw e
      last = e
      await new Promise((r) => setTimeout(r, 150 * 2 ** i))
    }
  }
  throw last
}

/* --------------------------------------------------------------- in process */

/**
 * @param latency milliseconds of pretend network, because a UI that has only
 *        ever been driven by an instant answer has never had its pending states
 *        exercised - and on this game one of those pending states is a player
 *        waiting to find out whether they still have their money.
 */
export function inProcess(house: House, playerId: string, latency = 140): Api {
  const call = async <T>(fn: () => T): Promise<T> => {
    await new Promise((r) => setTimeout(r, latency))
    try {
      return fn()
    } catch (e) {
      const err = e as { name?: string; code?: string; message?: string }
      if (err.name === 'Rejected') throw new ApiError(err.code ?? 'rejected', err.message ?? 'refused')
      throw e
    }
  }

  return {
    view: () => call(() => house.view(playerId)),
    open: (stake) => {
      const key = newKey()
      return reaching(() => call(() => house.open(playerId, stake, key)))
    },
    kick: (roundId, zone) => {
      const key = newKey()
      return reaching(() => call(() => house.kick(playerId, roundId, zone, key)))
    },
    cashOut: (roundId) => {
      const key = newKey()
      return reaching(() => call(() => house.cashOut(playerId, roundId, key)))
    },
    setClientSeed: (seed) => {
      const key = newKey()
      return reaching(() => call(() => house.setClientSeed(playerId, seed, key)))
    },
    rotateSeed: (next) => {
      const key = newKey()
      return reaching(() => call(() => house.rotateSeed(playerId, next, key)))
    },
  }
}

/* ---------------------------------------------------------------- over http */

export function overHttp(base: string): Api {
  const send = async (path: string, body: Record<string, unknown>): Promise<PlayerView> => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    /* 409 is a refusal the server meant; anything else in the 5xx range is worth
     * retrying with the same key. */
    if (res.status === 409) {
      const { code, message } = (await res.json()) as { code: string; message: string }
      throw new ApiError(code, message)
    }
    if (!res.ok) throw new Error(`${path} answered ${res.status}`)
    return (await res.json()) as PlayerView
  }

  const withKey = (path: string, body: Record<string, unknown>) => {
    const key = newKey()
    return reaching(() => send(path, { ...body, key }))
  }

  return {
    view: () => send('/view', {}),
    open: (stake) => withKey('/open', { stake }),
    kick: (roundId, zone) => withKey('/kick', { roundId, zone }),
    cashOut: (roundId) => withKey('/cash-out', { roundId }),
    setClientSeed: (seed) => withKey('/client-seed', { seed }),
    rotateSeed: (next) => withKey('/rotate-seed', { next }),
  }
}
