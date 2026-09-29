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
