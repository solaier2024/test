// World directions always use the penalty taker's point of view, across cameras.
export const DIRECTIONS = ["L", "C", "R"];
export const TARGET_X = { L: -2.65, C: 0, R: 2.65 };
export const GOAL_Z = -11;

// The provider has already resolved the shot. This deterministic choreography
// never samples a match outcome or modifies a quote, score or payout.
export function choreography(resolution) {
  const { phase, dir, success, shot } = resolution;
  if (!DIRECTIONS.includes(dir) || !["attack", "defend"].includes(phase)) {
    throw new Error("Unsupported resolution");
  }
  const saved = phase === "attack" ? !success : success;
  const other = dir === "L" ? "R" : dir === "R" ? "L" : "R";
  const ballDir = phase === "attack" || saved ? dir : other;
  const diveDir = phase === "defend" || saved ? dir : other;
  return {
    saved,
    ballDir,
    diveDir,
    target: {
      x: TARGET_X[ballDir],
      y: ballDir === "C" ? 0.9 : shot === "driven" ? 1.65 : 1.05,
      z: saved ? GOAL_Z + 0.65 : GOAL_Z,
    },
    flightSeconds: shot === "driven" ? 0.48 : 0.7,
    curve: shot === "driven" ? 0.1 : ballDir === "L" ? -0.58 : 0.58,
  };
}

export function ballPosition(plan, t) {
  const u = Math.max(0, Math.min(1, t));
  return {
    x: plan.target.x * u + Math.sin(Math.PI * u) * plan.curve,
    y: 0.14 + (plan.target.y - 0.14) * u + Math.sin(Math.PI * u) * 0.38,
    z: plan.target.z * u,
  };
}
