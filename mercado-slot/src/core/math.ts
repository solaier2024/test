import {
  BASE_STAKES,
  LINES,
  MULTIPLIERS,
  PAY_TENTHS,
  type Grid,
  type Mode,
  type Multiplier,
  type SymbolId,
} from "./config.ts";

export type LineWin = Readonly<{
  line: number;
  symbol: SymbolId;
  payTenths: number;
  payoutUnits: bigint;
}>;
export const totalCost = (base: bigint, mode: Mode) =>
  mode === "extra" ? (base * 3n) / 2n : base;

export function linePay(
  symbols: readonly SymbolId[],
): { symbol: SymbolId; payTenths: number } | null {
  if (symbols.length !== 3) throw new Error("Invalid line");
  const first = symbols.find((s) => s !== 7);
  if (first === undefined) return { symbol: 7, payTenths: 250 };
  return symbols.every((s) => s === first || s === 7)
    ? { symbol: first, payTenths: PAY_TENTHS[first] }
    : null;
}

export function evaluate(grid: Grid, base: bigint, multiplier: Multiplier) {
  if (
    !BASE_STAKES.includes(base as (typeof BASE_STAKES)[number]) ||
    !MULTIPLIERS.includes(multiplier)
  )
    throw new Error("Invalid stake or multiplier");
  if (
    grid.length !== 3 ||
    grid.some(
      (row) =>
        row.length !== 3 ||
        row.some((s) => !Number.isInteger(s) || s < 0 || s > 7),
    )
  )
    throw new Error("Invalid grid");
  const lineWins: LineWin[] = [];
  for (const [index, rows] of LINES.entries()) {
    const hit = linePay(rows.map((row, column) => grid[row]![column]!));
    if (hit)
      lineWins.push(
        Object.freeze({
          line: index + 1,
          ...hit,
          payoutUnits:
            (base * BigInt(hit.payTenths) * BigInt(multiplier)) / 50n,
        }),
      );
  }
  const sumPayTenths = lineWins.reduce((sum, hit) => sum + hit.payTenths, 0);
  const baseWinUnits = (base * BigInt(sumPayTenths)) / 50n;
  const payoutUnits = baseWinUnits * BigInt(multiplier);
  if (payoutUnits !== lineWins.reduce((sum, hit) => sum + hit.payoutUnits, 0n))
    throw new Error("Unsupported precision");
  return Object.freeze({
    lineWins: Object.freeze(lineWins),
    sumPayTenths,
    baseWinUnits,
    payoutUnits,
  });
}

// Formatting does not convert the monetary amount to a floating point number.
export function formatMoney(
  units: bigint,
  locale: "es-MX" | "en-US",
  signed = false,
): string {
  const negative = units < 0n;
  const amount = negative ? -units : units;
  const integer = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(amount / 1_000_000n);
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${negative ? "−" : signed && units > 0n ? "+" : ""}$${integer}.${fraction}`;
}
