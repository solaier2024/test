/*
 * Where the glass is, as fractions of the plate.
 *
 * The bands are DOM laid over the picture, so this is the seam between the art
 * and the game, and it is the one number in this project that two different
 * disciplines have to agree about. scripts/verify-window.mjs measures the glass
 * on every registered plate and fails the build if these fractions have drifted
 * away from it, so the seam cannot rot quietly.
 *
 * Measured on the registered 1280x720 plates: left 445, top 226, right 673,
 * bottom 372. Three bands across and three rows down, so a cell comes out about
 * 76 by 49 - which is the smallest a bell can be and still be countable from a
 * stool, and being countable is the entire game.
 */
export const WINDOW = {
  left: 0.3477,
  top: 0.3139,
  width: 0.1781,
  height: 0.2028,
} as const

/** Kept off the bevel, in fractions of the window's own size. */
export const INSET = 0.035

/*
 * Where the lever is, in pixels of the same registered 1280x720 plate.
 *
 * The second seam between the art and the game, and it exists for the same
 * reason the first one does: the brief asked for a hand that works the lever,
 * and a PULL button at the bottom of the screen is not that. So the knob in
 * the picture has to be a thing you can take hold of, which means the game has
 * to know where it is.
 *
 * Measured off the two plates that bracket the movement rather than guessed:
 * the knob sits at (829, 111) on machine_rest and at (946, 574) on
 * machine_pull, and the arm pivots on the boss at (775, 388). Radius 282 at
 * rest and 252 down - a real lever would hold one radius, and the eight per
 * cent between them is the camera's perspective on an arm swinging towards it,
 * so the arc is interpolated between the two measurements instead of being
 * drawn as a circle.
 *
 * Only the knob is a hit target. The arm is a 300px sweep across the crowd and
 * making all of it live would mean the room could not be looked at without
 * grabbing the machine.
 */
export const LEVER = {
  pivot: { x: 775, y: 388 },
  /** Degrees clockwise from east, and the radius, at each end of the throw. */
  rest: { deg: -79, r: 282 },
  down: { deg: 47.4, r: 252 },
  plate: { w: 1280, h: 720 },
} as const

/**
 * Where the knob is at a given point in the throw, as percentages of the
 * frame. 0 is resting, 1 is all the way down.
 */
export function leverAt(grip: number): { left: number; top: number } {
  const { pivot, rest, down, plate } = LEVER
  const rad = ((rest.deg + (down.deg - rest.deg) * grip) * Math.PI) / 180
  const r = rest.r + (down.r - rest.r) * grip
  return {
    left: ((pivot.x + r * Math.cos(rad)) / plate.w) * 100,
    top: ((pivot.y + r * Math.sin(rad)) / plate.h) * 100,
  }
}

/**
 * The inverse: how far down the throw a given height is.
 *
 * Needed because the two are not proportional and assuming they were felt
 * wrong in a way that took a measurement to see. At the top of the swing the
 * arm is nearly vertical, so the first part of the throw moves the knob
 * SIDEWAYS - dragging 40px down walked it 50px right and only 18px down. That
 * is what a lever does, but it means a ring driven by how far the finger has
 * moved slides out from under the finger. Driven by where the finger IS, the
 * ring stays under it and the arm swings out from beneath, which is both the
 * true motion and the one that feels attached to your hand.
 *
 * Monotonic over the throw - sine is, on this arc - so a bisection is exact
 * enough and needs no table.
 */
export function gripAtTop(top: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (leverAt(mid).top < top) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
