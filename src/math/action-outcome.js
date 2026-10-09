// Physical directions are part of the accepted result and match the reviewed
// video matrix. These are result-conditioned presentation directions, not a
// second random sample of the opponent's advertised probability distribution.
export function actionOutcome({ phase, dir, success, shot }) {
  if (!["L", "C", "R"].includes(dir) || !["attack", "defend"].includes(phase))
    throw new Error("Unsupported resolution");
  const saved = phase === "attack" ? !success : success;
  const other = dir === "L" ? "R" : dir === "R" ? "L" : "R";
  const ballDir = phase === "attack" || saved ? dir : other;
  const sameSideGoal =
    phase === "attack" && dir === "R" && shot === "driven" && !saved;
  const diveDir = phase === "defend" || saved || sameSideGoal ? dir : other;
  return { saved, ballDir, diveDir };
}
