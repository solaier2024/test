import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  AXIS_WEIGHTS,
  BASE_STAKES,
  CONFIG_HASH,
  CONFIG_ID,
  LINES,
  MULTIPLIERS,
  PAY_TENTHS,
  REELS,
  SYMBOLS,
  type Mode,
  type SymbolId,
} from "../src/core/config.ts";
import { evaluate, linePay, totalCost } from "../src/core/math.ts";
import { gridAt } from "../src/core/rng.ts";

const gcd = (a: bigint, b: bigint): bigint =>
  b ? gcd(b, a % b) : a < 0n ? -a : a;
const fraction = (n: bigint, d: bigint) => {
  const g = gcd(n, d);
  return `${n / g}/${d / g}`;
};
const approximate = (n: bigint, d: bigint) => Number(n) / Number(d);
for (const reel of REELS) {
  assert.equal(reel.length, 64);
  assert.deepEqual(
    SYMBOLS.map((_, id) => reel.filter((s) => s === id).length),
    [10, 8, 7, 6, 6, 5, 9, 13],
  );
}
let grids = 0,
  sum = 0n,
  sumSquares = 0n,
  hits = 0,
  max = 0;
let witness: number[] = [];
const frequencies = new Map<number, number>();
for (let a = 0; a < 64; a++)
  for (let b = 0; b < 64; b++)
    for (let c = 0; c < 64; c++) {
      const grid = gridAt([a, b, c]);
      const e = evaluate(grid, 1_000_000n, 1);
      const s = e.sumPayTenths;
      grids++;
      sum += BigInt(s);
      sumSquares += BigInt(s * s);
      if (s) hits++;
      if (s > max) {
        max = s;
        witness = [a, b, c];
      }
      frequencies.set(s, (frequencies.get(s) ?? 0) + 1);
    }
assert.equal(grids, 262144);
assert.equal(max, 1250);
const n = BigInt(grids);
const gDen = 50n * n;
assert.equal(sum * 655360n, gDen * 351209n);
const profiles: Record<string, unknown> = {};
const moments: bigint[] = [];
for (const mode of ["standard", "extra"] as const) {
  const weights = AXIS_WEIGHTS[mode].map(BigInt);
  assert(weights.every((w) => w >= 0n));
  const denominator = weights.reduce((s, w) => s + w, 0n);
  const m1 = weights.reduce((s, w, i) => s + w * BigInt(MULTIPLIERS[i]!), 0n);
  const m2 = weights.reduce(
    (s, w, i) => s + w * BigInt(MULTIPLIERS[i]! ** 2),
    0n,
  );
  const factorNumerator = mode === "extra" ? 3n : 1n;
  const factorDenominator = mode === "extra" ? 2n : 1n;
  const rtpN = sum * m1 * factorDenominator;
  const rtpD = gDen * denominator * factorNumerator;
  assert.equal(rtpN * 200n, rtpD * 193n);
  const return2N = sumSquares * m2 * factorDenominator ** 2n;
  const return2D = 2500n * n * denominator * factorNumerator ** 2n;
  const varianceN = return2N * 40000n - return2D * 193n ** 2n;
  const varianceD = return2D * 40000n;
  let profits = 0n,
    partial = 0n,
    breakeven = 0n;
  for (const [s, count] of frequencies)
    for (let i = 0; i < MULTIPLIERS.length; i++) {
      const scaledP = BigInt(s * MULTIPLIERS[i]!) * factorDenominator;
      const cost = 50n * factorNumerator;
      const mass = BigInt(count) * weights[i]!;
      if (scaledP > cost) profits += mass;
      else if (scaledP === cost) breakeven += mass;
      else if (s > 0) partial += mass;
    }
  moments.push(m2 * factorDenominator ** 2n * (mode === "standard" ? 9n : 1n));
  profiles[mode] = {
    weights: AXIS_WEIGHTS[mode],
    axis_weight_sum: denominator.toString(),
    multiplier_mean: fraction(m1, denominator),
    multiplier_second_moment: fraction(m2, denominator),
    rtp: fraction(rtpN, rtpD),
    rtp_percent: approximate(rtpN, rtpD) * 100,
    normalized_return_variance: fraction(varianceN, varianceD),
    normalized_return_stddev: Math.sqrt(approximate(varianceN, varianceD)),
    profit_probability: approximate(profits, n * denominator),
    partial_return_probability: approximate(partial, n * denominator),
    breakeven_probability: approximate(breakeven, n * denominator),
    max_return_per_actual_payment: mode === "extra" ? 250 : 375,
  };
}
assert.equal(AXIS_WEIGHTS.extra[0], 0);
assert(AXIS_WEIGHTS.extra[1]! > AXIS_WEIGHTS.standard[1]!);
assert(AXIS_WEIGHTS.extra[5]! > AXIS_WEIGHTS.standard[5]!);
assert(moments[1]! > moments[0]!); // normalized second moment is higher in Extra
let moneyCases = 0;
for (let a = 0; a < 8; a++)
  for (let b = 0; b < 8; b++)
    for (let c = 0; c < 8; c++) {
      const pay = linePay([a, b, c] as SymbolId[])?.payTenths ?? 0;
      assert(pay >= 0 && pay <= 250);
      for (const base of BASE_STAKES)
        for (const m of MULTIPLIERS) {
          assert.equal((base * BigInt(pay * m)) % 50n, 0n);
          for (const mode of ["standard", "extra"] as Mode[])
            assert.equal(totalCost(base, mode) % 10_000n, 0n);
          moneyCases++;
        }
    }
const configuration = JSON.stringify({
  CONFIG_ID,
  SYMBOLS,
  PAY_TENTHS,
  LINES,
  REELS,
  MULTIPLIERS,
  AXIS_WEIGHTS,
});
assert.equal(
  createHash("sha256").update(configuration).digest("hex"),
  CONFIG_HASH,
);
const report = {
  status: "PASS",
  config: CONFIG_ID,
  configuration_sha256: createHash("sha256")
    .update(configuration)
    .digest("hex"),
  scope:
    "Exact enumeration of this original local demo configuration, not an RNG or real-money certification",
  grid_combinations: grids,
  multiplier_outcomes_per_grid: 6,
  reachable_grid_and_axis_pairs: { standard: grids * 6, extra: grids * 5 },
  grid_mean: fraction(sum, gDen),
  grid_second_moment: fraction(sumSquares, 2500n * n),
  any_line_hit_probability: hits / grids,
  maximum_witness_stops: witness,
  maximum_grid_multiplier: max / 50,
  fixed_point_cases: moneyCases,
  profiles,
};
await writeFile(
  new URL("../docs/math-certificate.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
