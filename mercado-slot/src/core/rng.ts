import {
  AXIS_WEIGHTS,
  MULTIPLIERS,
  REELS,
  type Grid,
  type Mode,
  type SymbolId,
} from "./config.ts";

export type RandomWord = () => number;
function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}
export function stream(
  seed: string,
  requestId: string,
  channel: string,
): RandomWord {
  let hash = 0x811c9dc5;
  for (const ch of `${seed}:${requestId}:${channel}`)
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193);
  const s = [mix(hash), mix(hash + 1), mix(hash + 2), mix(hash + 3)];
  return () => {
    const product = Math.imul(s[1]!, 5);
    const result = Math.imul((product << 7) | (product >>> 25), 9) >>> 0;
    const t = s[1]! << 9;
    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = (s[3]! << 11) | (s[3]! >>> 21);
    return result;
  };
}

export function below(bound: bigint, word: RandomWord): bigint {
  if (bound <= 0n || bound > 1n << 64n) throw new Error("Invalid RNG bound");
  const domain = 1n << 64n;
  const limit = domain - (domain % bound);
  for (;;) {
    const value = (BigInt(word() >>> 0) << 32n) | BigInt(word() >>> 0);
    if (value < limit) return value % bound;
  }
}
export function weighted(weights: readonly number[], word: RandomWord): number {
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0))
    throw new Error("Invalid RNG weights");
  let draw = below(
    weights.reduce((sum, w) => sum + BigInt(w), 0n),
    word,
  );
  for (const [i, weight] of weights.entries()) {
    if (draw < BigInt(weight)) return i;
    draw -= BigInt(weight);
  }
  throw new Error("Empty distribution");
}

export function gridAt(stops: readonly number[]): Grid {
  if (
    stops.length !== 3 ||
    stops.some((s, c) => !Number.isInteger(s) || s < 0 || s >= REELS[c]!.length)
  )
    throw new Error("Invalid stops");
  return Object.freeze(
    [0, 1, 2].map((row) =>
      Object.freeze(
        stops.map((stop, c) => {
          const reel = REELS[c]!;
          return reel[
            (stop + row - 1 + reel.length) % reel.length
          ]! as SymbolId;
        }),
      ),
    ),
  );
}
export function draw(seed: string, requestId: string, mode: Mode) {
  const stops = REELS.map((reel, c) =>
    Number(below(BigInt(reel.length), stream(seed, requestId, `reel-${c}`))),
  );
  const multiplier =
    MULTIPLIERS[weighted(AXIS_WEIGHTS[mode], stream(seed, requestId, "axis"))]!;
  return { reelStops: Object.freeze(stops), grid: gridAt(stops), multiplier };
}
