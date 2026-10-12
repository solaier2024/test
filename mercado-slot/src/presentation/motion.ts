export type Quality = "lite" | "full";

export type ReelMotion = {
  travel: number;
  velocity: number;
  startAt: number;
  accelerate: number;
  cruise: number;
  brake: number;
  settle: number;
  stopAt: number;
};

export function reelMotion(
  column: number,
  turbo: boolean,
  reduced = false,
): ReelMotion {
  if (!Number.isInteger(column) || column < 0 || column > 2)
    throw new Error("Invalid reel column");
  if (reduced)
    return {
      travel: 0,
      velocity: 0,
      startAt: 0.1 + column * 0.025,
      accelerate: 0,
      cruise: 0,
      brake: 0,
      settle: 0,
      stopAt: 0.1 + column * 0.025,
    };
  const velocity = turbo ? 32 : 22;
  const travel = turbo ? 22 + column * 2 : 28 + column * 4;
  const startAt = turbo ? column * 0.012 : 0.02 + column * 0.026;
  const accelerate = turbo ? 0.09 : 0.16;
  const brake = turbo ? 0.16 : 0.26;
  // Quadratic acceleration/deceleration each cover half v * time. Their
  // derivatives match the cruise velocity exactly, for every accepted stop.
  const cruise = travel / velocity - (accelerate + brake) / 2;
  return {
    travel,
    velocity,
    startAt,
    accelerate,
    cruise,
    brake,
    settle: turbo ? 0.055 : 0.09,
    stopAt: startAt + accelerate + cruise + brake,
  };
}

export function spinTiming(turbo: boolean, reduced = false) {
  const reels = [0, 1, 2].map((column) => reelMotion(column, turbo, reduced));
  const last = reels[2]!;
  const baseAt =
    last.stopAt + last.settle + (reduced ? 0.02 : turbo ? 0.03 : 0.04);
  const multiplierAt = baseAt + (reduced ? 0.04 : turbo ? 0.12 : 0.18);
  return {
    id: reduced ? "reduced" : turbo ? "turbo" : "normal",
    reels,
    baseAt,
    multiplierAt,
    lineAt: multiplierAt + (reduced ? 0.04 : turbo ? 0.09 : 0.16),
    lineGap: reduced ? 0.025 : turbo ? 0.05 : 0.09,
    countScale: reduced ? 0.3 : turbo ? 0.65 : 1,
    pulse: reduced ? 0.04 : turbo ? 0.07 : 0.1,
    bottleSettle: reduced ? 0.06 : turbo ? 0.1 : 0.13,
    bounce: reduced ? 0 : turbo ? 3 : 5,
    axisSteps: reduced ? 0 : turbo ? 10 : 18,
  } as const;
}

// Presentation-only strip: the existing window flows offscreen first; the
// genuine accepted strip window enters at the tail. Every texture is chosen
// before animation. This avoids racing 64–127 cells to hit a random offset.
export function reelSequence(
  strip: readonly number[],
  current: number,
  stop: number,
  travel: number,
): readonly number[] {
  if (
    strip.length < 3 ||
    !Number.isInteger(current) ||
    current < 0 ||
    !Number.isInteger(stop) ||
    stop < 0 ||
    stop >= strip.length ||
    !Number.isInteger(travel) ||
    travel < 8
  )
    throw new Error("Invalid presentation strip");
  const index = (i: number) =>
    ((i % strip.length) + strip.length) % strip.length;
  return Array.from({ length: travel + 5 }, (_, i) => {
    const cell = i - 2;
    return strip[
      index(cell >= travel - 4 ? stop + cell - travel : current + cell)
    ]!;
  });
}

export function stopPosition(
  current: number,
  stop: number,
  length: number,
  turns = 1,
) {
  if (
    !Number.isFinite(current) ||
    current < 0 ||
    !Number.isInteger(stop) ||
    stop < 0 ||
    stop >= length ||
    !Number.isInteger(length) ||
    length < 3 ||
    !Number.isInteger(turns) ||
    turns < 1
  )
    throw new Error("Invalid reel motion");
  const first = Math.floor(current / length) * length + stop;
  return (
    first + Math.ceil((current + turns * length - first) / length) * length
  );
}
export function reelFrame(position: number, length: number) {
  if (
    !Number.isFinite(position) ||
    position < 0 ||
    !Number.isInteger(length) ||
    length < 3
  )
    throw new Error("Invalid frame");
  const index = Math.floor(position);
  return { center: index % length, fraction: position - index };
}
export function awardAt(payout: bigint, progress: number) {
  if (!Number.isFinite(progress)) return 0n;
  const step = BigInt(Math.round(Math.max(0, Math.min(1, progress)) * 10_000));
  return (payout * step) / 10_000n;
}
export function winTier(
  payout: bigint,
  cost: bigint,
): "none" | "return" | "win" | "big" | "grand" {
  if (payout === 0n) return "none";
  if (payout <= cost) return "return";
  if (payout >= cost * 20n) return "grand";
  if (payout >= cost * 5n) return "big";
  return "win";
}
