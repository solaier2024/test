export type Quality = "lite" | "full";
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
