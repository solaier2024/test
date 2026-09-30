import { describe, expect, it } from 'vitest'
import { fromHex, hmacHex, hmacSha256, sha256Hex, toHex, utf8 } from './sha256.ts'

/*
 * Published vectors, not self-consistency checks. A hash implementation that
 * only agrees with itself is worse than no hash at all here: the player's
 * verifier and the server's derivation would agree perfectly while both
 * computing something that is not SHA-256, and the first person to check our
 * numbers with a real library would find a mismatch and reasonably conclude the
 * house was lying.
 */

describe('sha256, against FIPS-180-4', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes abc', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  /* 56 bytes: the length that needs a second padding block. The classic place
   * for a hand-written implementation to be wrong and never notice. */
  it('hashes a message that pads into a second block', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  /* Exactly 64 bytes, where the padding block is entirely padding. */
  it('hashes a message exactly one block long', () => {
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb')
  })

  it('hashes a million a', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })
})

describe('hmac-sha256, against RFC-4231', () => {
  it('case 1', () => {
    expect(hmacHex('\x0b'.repeat(20), 'Hi There')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })

  it('case 2', () => {
    expect(hmacHex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  /*
   * A key longer than the 64-byte block, which is the branch that hashes the key
   * first - the other branch that is easy to get wrong.
   *
   * Given as bytes rather than as a string on purpose: 0xaa is not ASCII, and
   * TextEncoder would helpfully turn each one into the two bytes of U+00AA and
   * the vector would fail for a reason that has nothing to do with HMAC. Worth
   * the extra line, because fair.ts keys HMAC with a hex string and this is the
   * test that says why that is a safe thing to do.
   */
  it('case 6, with an over-long key', () => {
    const key = new Uint8Array(131).fill(0xaa)
    const data = utf8('Test Using Larger Than Block-Size Key - Hash Key First')
    expect(toHex(hmacSha256(key, data))).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54')
  })
})

describe('hex', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255])
    expect(toHex(bytes)).toBe('00010f107f80feff')
    expect([...fromHex('00010f107f80feff')]).toEqual([...bytes])
  })

  it('refuses what is not hex, rather than returning NaN bytes', () => {
    expect(() => fromHex('abc')).toThrow(/odd-length/)
    expect(() => fromHex('zz')).toThrow(/not hex/)
  })
})
