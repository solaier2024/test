/*
 * Provably fair: commit, play, reveal, verify.
 *
 * The property being bought is narrow and worth stating exactly, because
 * "provably fair" gets used to mean much more than it delivers:
 *
 *   Every keeper in this game was decided before the player touched anything,
 *   and the player can check that afterwards without trusting us.
 *
 * It does NOT prove the paytable is generous, or that the entropy behind the seed
 * was any good. What it buys is one thing, and it is the thing worth buying: the
 * house cannot look at the shot and then decide where the keeper went.
 *
 * Which matters here for a reason that has nothing to do with money, since there is
 * none. This series is about reading an opponent - SERIES.md calls it reading the
 * hands rather than the face - and a read is only a skill if the thing being read
 * was already decided. If the keeper could be chosen after the kick, then studying
 * him is superstition, the tell in table.ts is a decoration, and the game quietly
 * becomes the one thing the first table's README said it must not be. The envelope
 * is what makes the read real, and the player can check it themselves.
 *
 * The scheme is the commit-and-reveal one players of this kind of game have already
 * been taught elsewhere, deliberately: an unfamiliar scheme would have to earn
 * trust from zero.
 *
 *   serverSeed      32 random bytes, hex. Secret until the seed is retired.
 *   commitment      sha256 of the server seed's hex STRING. Published first.
 *   clientSeed      the player's, any string. Bound to the round at creation.
 *   nonce           which round this is in the seed's life. Never reused.
 *   cursor          which float within the round. 0,1,2,... as needed.
 *
 *   float(cursor) = first 4 bytes of
 *                   HMAC-SHA256(key = serverSeed, msg = `clientSeed:nonce:cursor`)
 *                   read as a base-256 fraction.
 *
 * Both the hash and the HMAC key treat the server seed as its 64-character hex
 * TEXT, not as the 32 bytes it encodes. That is a real choice and it is made for
 * the player: it means every value in a reveal is a string, and a player who
 * does not trust our verifier can paste the three fields into any off-the-shelf
 * HMAC tool and get our number back. Keying with the decoded bytes would be
 * marginally more elegant and would make independent verification a tooling
 * puzzle, which defeats the purpose of publishing it. 64 ASCII characters is
 * exactly HMAC-SHA256's block size and carries the full 256 bits, so nothing is
 * given up in exchange.
 *
 * Two rules keep it honest, and both are enforced in server/service.ts rather
 * than here, because they are lifecycle rules and this file has no state:
 *
 *   - A server seed is revealed only after it is retired, and retiring it is
 *     irreversible. Revealing a live seed would let the player compute the
 *     keeper before choosing.
 *   - The client seed is bound when the round opens and cannot be changed
 *     while the round is open. Otherwise the shape of the commitment survives
 *     but the thing committed to does not.
 */

import { hmacSha256, sha256Hex, toHex, utf8 } from './sha256.ts'

/** Bytes of server seed. 32 is the convention and leaves nothing to argue. */
export const SEED_BYTES = 32

export interface SeedPair {
  /** Secret while the seed is live. */
  serverSeed: string
  /** Published before the first round on this seed. */
  commitment: string
}

/**
 * @param random injected so tests are deterministic and so the production
 *        wiring has to name its entropy source out loud instead of reaching
 *        for Math.random by default.
 */
export function newSeedPair(random: (n: number) => Uint8Array): SeedPair {
  const serverSeed = toHex(random(SEED_BYTES))
  if (serverSeed.length !== SEED_BYTES * 2) {
    throw new Error(`entropy source returned ${serverSeed.length / 2} bytes, wanted ${SEED_BYTES}`)
  }
  return { serverSeed, commitment: commit(serverSeed) }
}

/** Web Crypto, the only entropy source that belongs anywhere near this. */
export const cryptoRandom = (n: number): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(n))

export const commit = (serverSeed: string): string => sha256Hex(serverSeed)

/** What a player runs on the revealed seed to check we published its hash. */
export const commitmentHolds = (serverSeed: string, commitment: string): boolean =>
  commit(serverSeed) === commitment

/**
 * One uniform float in [0, 1).
 *
 * Four bytes read as a base-256 fraction, which is Stake's construction. It
 * gives 2^-32 granularity - far finer than any probability in table.ts, and
 * the bias from consuming a fixed number of bytes is below the resolution of
 * any test that could be run against it.
 */
export function floatAt(serverSeed: string, clientSeed: string, nonce: number, cursor: number): number {
  if (!Number.isInteger(nonce) || nonce < 0) throw new Error(`nonce must be a non-negative integer, got ${nonce}`)
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error(`cursor must be a non-negative integer, got ${cursor}`)

  const bytes = hmacSha256(utf8(serverSeed), utf8(`${clientSeed}:${nonce}:${cursor}`))

  let f = 0
  let scale = 1
  for (let i = 0; i < 4; i++) {
    scale /= 256
    f += bytes[i] * scale
  }
  return f
}

/** The floats a whole round needs, in cursor order. What the verifier walks. */
export const floatsAt = (serverSeed: string, clientSeed: string, nonce: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => floatAt(serverSeed, clientSeed, nonce, i))

/** A cursor into one round's floats. */
export type Floats = (cursor: number) => number

/**
 * The same floats, computed only when something asks for them.
 *
 * Worth the indirection for two unrelated reasons. A round can run to ten kicks
 * but most end in two or three, so deriving the whole round up front does an
 * order of magnitude more HMAC than the round needs - which showed up first as an
 * RTP measurement that would not finish, and second as every single call to
 * view() re-deriving forty floats to answer a question about one kick.
 *
 * Memoised per round, so a kick resolved and then re-read costs one derivation
 * and not two. Nothing here is security-relevant: it is the same function of the
 * same inputs, and floatsAt above remains the definition.
 */
export function floatsFor(serverSeed: string, clientSeed: string, nonce: number): Floats {
  const seen = new Map<number, number>()
  return (cursor) => {
    let f = seen.get(cursor)
    if (f === undefined) {
      f = floatAt(serverSeed, clientSeed, nonce, cursor)
      seen.set(cursor, f)
    }
    return f
  }
}

/** Reads a round's floats out of an array. For tests and for the verifier. */
export const floatsOf =
  (floats: readonly number[]): Floats =>
  (cursor) =>
    floats[cursor]
