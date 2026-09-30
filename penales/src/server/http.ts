/*
 * The House behind real HTTP.
 *
 * It exists to make one claim checkable rather than rhetorical: that the House is
 * already on the far side of a boundary, and putting a socket in the middle of it
 * is an adapter and not a refactor. This file is the whole adapter. Nothing in
 * service.ts, ledger.ts, store.ts or the game knows it is here.
 *
 * It is not a production server. There is no authentication, no TLS, no rate limit
 * and no request log - the player is whoever the header says. All of those belong in
 * front of it, and none of them change it. What it does get right is the two things
 * that would be expensive to change later:
 *
 *   - The idempotency key comes from the client and is passed through untouched,
 *     so a retry over a dropped connection lands on the same settlement.
 *   - A refusal is 409 with a code, and a fault is 5xx. The client retries one and
 *     not the other, and getting that backwards is how a "safe" retry turns into a
 *     double charge.
 */

import type { Zone } from '../game/table.ts'
import type { House, PlayerView } from './service.ts'

/*
 * Node's request and response, described structurally rather than imported.
 *
 * Two things fall out of that, and the second is the reason for it. The file
 * typechecks in the browser project alongside everything else it imports, instead
 * of needing its own tsconfig and its own pass; and the adapter does not name a
 * runtime, so Bun, Deno and a Workers shim satisfy it unchanged. Nothing about a
 * request-in, view-out adapter needs to know which one is underneath.
 */
export interface HttpRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  on(event: 'data', cb: (chunk: Uint8Array) => void): void
  on(event: 'end', cb: () => void): void
  on(event: 'error', cb: (e: unknown) => void): void
}

export interface HttpResponse {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
}

interface Body {
  key?: string
  stake?: number
  roundId?: string
  zone?: Zone
  bribe?: boolean
  seed?: string
  next?: string
}

const read = (req: HttpRequest): Promise<Body> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      /* A body this small cannot legitimately be large, and an unbounded read on
       * an unauthenticated endpoint is a denial of service waiting to be found. */
      if (size > 8_192) reject(new Error('body too large'))
      else chunks.push(c)
    })
    req.on('end', () => {
      const joined = new Uint8Array(size)
      let at = 0
      for (const c of chunks) {
        joined.set(c, at)
        at += c.length
      }
      const raw = new TextDecoder().decode(joined)
      try {
        resolve(raw.length === 0 ? {} : (JSON.parse(raw) as Body))
      } catch {
        reject(new Error('body is not json'))
      }
    })
    req.on('error', reject)
  })

const send = (res: HttpResponse, status: number, body: unknown): void => {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    /* The dev server is on another origin, so the preview needs this to talk to
     * a locally served House at all. A real deployment sets an allowlist. */
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-player',
  })
  res.end(json)
}

const required = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) throw new Error(`${name} is required`)
  return value
}

/**
 * @param house one House, shared by every connection - which is the whole point.
 *        Two Houses over one set of chips would be two sets of books.
 */
export function handler(house: House): (req: HttpRequest, res: HttpResponse) => void {
  return (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {})
    if (req.method !== 'POST') return send(res, 405, { code: 'bad_method', message: 'POST only' })

    const path = (req.url ?? '/').split('?')[0]
    /* Stands in for a session. A real one reads a signed token, and the important
     * part - that the server decides who is asking rather than believing a field
     * in the body - is the same either way. */
    const playerId = (req.headers['x-player'] as string | undefined) ?? 'invitado'

    read(req)
      .then((body): PlayerView => {
        const key = () => required(body.key, 'key')
        switch (path) {
          case '/view':
            return house.view(playerId)
          case '/open':
            return house.open(playerId, required(body.stake, 'stake'), key())
          case '/kick':
            return house.kick(
              playerId,
              required(body.roundId, 'roundId'),
              required(body.zone, 'zone'),
              key(),
              body.bribe === true,
            )
          case '/cash-out':
            return house.cashOut(playerId, required(body.roundId, 'roundId'), key())
          case '/call':
            return house.call(playerId, required(body.roundId, 'roundId'), key())
          case '/client-seed':
            return house.setClientSeed(playerId, required(body.seed, 'seed'), key())
          case '/rotate-seed':
            return house.rotateSeed(playerId, required(body.next, 'next'), key())
          default:
            throw new Error(`no route ${path}`)
        }
      })
      .then((view) => send(res, 200, view))
      .catch((e: { name?: string; code?: string; message?: string }) => {
        /*
         * The distinction the client's retry logic depends on. A Rejected is the
         * server's considered answer and must not be retried; anything else might
         * be transient and must be, with the same key.
         */
        if (e.name === 'Rejected') return send(res, 409, { code: e.code, message: e.message })
        send(res, 500, { code: 'fault', message: e.message ?? 'unknown' })
      })
  }
}
