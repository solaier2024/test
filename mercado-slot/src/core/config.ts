export const SYMBOLS = [
  "tortilla",
  "chile",
  "lime",
  "avocado",
  "esquite",
  "tamal",
  "taco",
  "wild",
] as const;
export type SymbolId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Mode = "standard" | "extra";
export type Grid = readonly (readonly SymbolId[])[];
export const PAY_TENTHS = [4, 10, 16, 20, 24, 30, 40, 250] as const;
export const LINES = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
] as const;
export const MULTIPLIERS = [1, 2, 3, 5, 10, 15] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];
export const BASE_STAKES = [
  200_000n,
  400_000n,
  1_000_000n,
  2_000_000n,
  5_000_000n,
  10_000_000n,
  20_000_000n,
  50_000_000n,
] as const;
export const INITIAL_BALANCE = 1_000_000_000n;
export const MAX_SESSION_SPINS = 2000;
export const CONFIG_ID = "mercado-96.5-v1";
// This version must change whenever probability rules change. The verification
// report additionally records a SHA-256 of the entire frozen configuration.
export const CONFIG_HASH =
  "ee5204b959076aed2a7041aab2360babc9a16175865f243efe3c7e36a312e2f4";
// Independent cyclic strips. A stop selects the middle symbol. Each strip
// contains [10,8,7,6,6,5,9,13] symbols; each has one all-Wild window.
export const REELS: readonly (readonly SymbolId[])[] = [
  [
    7, 7, 7, 3, 5, 4, 4, 7, 3, 5, 1, 6, 5, 7, 1, 0, 6, 4, 0, 7, 0, 3, 2, 0, 1,
    7, 2, 3, 1, 6, 1, 7, 6, 6, 6, 2, 1, 7, 0, 2, 5, 2, 0, 7, 4, 3, 2, 1, 6, 7,
    1, 4, 2, 0, 3, 7, 4, 6, 0, 0, 6, 7, 5, 0,
  ],
  [
    0, 1, 0, 4, 7, 2, 6, 0, 3, 6, 7, 5, 6, 2, 0, 1, 7, 4, 3, 3, 4, 6, 7, 0, 5,
    1, 1, 3, 7, 5, 0, 6, 2, 3, 7, 6, 0, 0, 0, 6, 7, 1, 3, 5, 2, 2, 7, 2, 4, 5,
    6, 1, 7, 2, 4, 7, 7, 7, 4, 6, 1, 0, 7, 1,
  ],
  [
    1, 2, 7, 2, 2, 0, 1, 3, 7, 4, 0, 1, 0, 0, 7, 6, 0, 3, 0, 4, 7, 6, 6, 3, 3,
    1, 7, 6, 4, 6, 2, 4, 7, 4, 3, 1, 6, 0, 7, 2, 1, 7, 7, 7, 6, 4, 2, 1, 7, 5,
    6, 0, 1, 2, 7, 0, 5, 6, 3, 5, 7, 5, 0, 5,
  ],
];
// E[G]=351209/655360. Means of M enforce 96.5% for both actual costs.
const total = 45_657_170_000;
const meanNumerator = 82_214_912_000;
const normalHigher = [
  total / 10,
  (total * 3) / 100,
  (total * 15) / 1000,
  (total * 8) / 1000,
];
const normalTwo =
  meanNumerator -
  total -
  normalHigher.reduce((s, w, i) => s + w * (MULTIPLIERS[i + 2]! - 1), 0);
const normalOne = total - normalTwo - normalHigher.reduce((s, w) => s + w, 0);
const extraHigher = [
  (total * 2) / 100,
  (total * 15) / 1000,
  (total * 5) / 1000,
];
const extraFifteen =
  ((meanNumerator * 3) / 2 -
    2 * total -
    extraHigher.reduce((s, w, i) => s + w * (MULTIPLIERS[i + 2]! - 2), 0)) /
  13;
const extraTwo = total - extraFifteen - extraHigher.reduce((s, w) => s + w, 0);
export const AXIS_WEIGHTS: Readonly<Record<Mode, readonly number[]>> = {
  standard: [normalOne, normalTwo, ...normalHigher],
  extra: [0, extraTwo, ...extraHigher, extraFifteen],
};
