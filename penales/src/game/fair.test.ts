import { describe, expect, it } from 'vitest'
import { commit, commitmentHolds, floatAt, floatsAt, newSeedPair, SEED_BYTES } from './fair.ts'
import { fromHex, hmacHex } from './sha256.ts'

const SERVER = 'a'.repeat(64)
const CLIENT = 'mi-semilla'

/** Counting, so the vectors below are fixed by arithmetic and not by whatever ran first. */
const counter = (start = 0) => {
  let n = start
  return (len: number) => new Uint8Array(len).fill(n++)
}

describe('the commitment', () => {
  it('is the hash of the server seed, and a player can check it', () => {
    const pair = newSeedPair(counter(0x41))
    expect(pair.serverSeed).toBe('41'.repeat(SEED_BYTES))
    expect(pair.commitment).toBe(commit(pair.serverSeed))
    expect(commitmentHolds(pair.serverSeed, pair.commitment)).toBe(true)
  })

  it('refuses a seed that does not match', () => {
    const pair = newSeedPair(counter(0x41))
    expect(commitmentHolds('b'.repeat(64), pair.commitment)).toBe(false)
    /* One flipped nibble. The whole value of the scheme is that this is caught. */
    expect(commitmentHolds('41'.repeat(SEED_BYTES - 1) + '40', pair.commitment)).toBe(false)
  })

  it('refuses an entropy source that short-changes it', () => {
    /* A silently short seed would still hash, still commit, and still verify -
     * and have a fraction of the entropy. The one failure mode of this scheme
     * that leaves every visible property intact, so it is checked at the source. */
    expect(() => newSeedPair((n) => new Uint8Array(n - 1))).toThrow(/wanted 32/)
  })
})

describe('the derivation', () => {
  it('is HMAC of the seed over client:nonce:cursor, and nothing else', () => {
    /*
     * Pinned as a vector rather than described in prose, because this is the one
     * formula a player has to reimplement to check us. If it changes, every
     * previously published reveal becomes unverifiable - so this test failing is
     * not an inconvenience, it is a breaking change to a promise.
     */
    const bytes = fromHex(hmacHex(SERVER, `${CLIENT}:7:2`))
    const expected = bytes[0] / 256 + bytes[1] / 256 ** 2 + bytes[2] / 256 ** 3 + bytes[3] / 256 ** 4
    expect(floatAt(SERVER, CLIENT, 7, 2)).toBe(expected)
  })

  it('gives the same answer every time', () => {
    expect(floatAt(SERVER, CLIENT, 1, 0)).toBe(floatAt(SERVER, CLIENT, 1, 0))
  })

  it('moves when any one input moves', () => {
    const base = floatAt(SERVER, CLIENT, 1, 0)
    expect(floatAt('b'.repeat(64), CLIENT, 1, 0)).not.toBe(base)
    expect(floatAt(SERVER, 'otra', 1, 0)).not.toBe(base)
    expect(floatAt(SERVER, CLIENT, 2, 0)).not.toBe(base)
    expect(floatAt(SERVER, CLIENT, 1, 1)).not.toBe(base)
  })

  it('cannot be confused by a client seed containing the separator', () => {
    /*
     * `${clientSeed}:${nonce}:${cursor}` is concatenation, and the player picks
     * the first field - so "a:1" at nonce 1 cursor 0 and "a" at nonce 1 cursor 0
     * must not collide. They do not, because the nonce and cursor are appended
     * after, but the pair that WOULD collide under a naive scheme is worth
     * pinning: a player who could steer their own seed onto a nonce they had
     * already seen revealed would have broken the game.
     */
    expect(floatAt(SERVER, 'a:1', 1, 0)).not.toBe(floatAt(SERVER, 'a', 1, 1))
    expect(floatAt(SERVER, 'a:9:9', 1, 0)).not.toBe(floatAt(SERVER, 'a', 9, 9))
  })

  it('stays inside [0, 1)', () => {
    for (let n = 0; n < 500; n++) {
      const f = floatAt(SERVER, CLIENT, n, 0)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })

  it('refuses a negative or fractional nonce instead of hashing it', () => {
    /* `${1.5}` is a perfectly good string, so without this the derivation would
     * happily produce a float for a nonce that cannot exist and nobody could
     * reproduce. */
    expect(() => floatAt(SERVER, CLIENT, -1, 0)).toThrow(/nonce/)
    expect(() => floatAt(SERVER, CLIENT, 1.5, 0)).toThrow(/nonce/)
    expect(() => floatAt(SERVER, CLIENT, 0, -1)).toThrow(/cursor/)
  })

  it('is uniform enough to price a paytable against', () => {
    /*
     * Not a claim about SHA-256, which needs no help from this file. It is a
     * claim about the 20 lines that turn it into a number: an off-by-one in the
     * byte weights, or reading the wrong four bytes, would leave the floats
     * looking random and land them in the wrong band a few per cent of the time,
     * which is the kind of bug that shows up as an RTP that will not settle.
     */
    const buckets = new Array(10).fill(0)
    const n = 50_000
    const floats = floatsAt(SERVER, CLIENT, 0, n)
    for (const f of floats) buckets[Math.floor(f * 10)]++

    const expected = n / 10
    const chi = buckets.reduce((a, b) => a + (b - expected) ** 2 / expected, 0)
    /* 9 degrees of freedom; 27.88 is the 0.999 critical value. */
    expect(chi).toBeLessThan(27.88)

    const mean = floats.reduce((a, b) => a + b, 0) / n
    expect(mean).toBeCloseTo(0.5, 2)
  })

  it('walks the cursor in order, so a round is one contiguous read', () => {
    const many = floatsAt(SERVER, CLIENT, 3, 5)
    expect(many).toEqual([0, 1, 2, 3, 4].map((c) => floatAt(SERVER, CLIENT, 3, c)))
  })
})
