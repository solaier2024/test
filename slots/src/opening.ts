/*
 * Where the opening's captions sit, as fractions of the clip rather than as
 * seconds, so recutting the film cannot push a line onto the wrong shot.
 *
 * This lives in its own module for one reason: scripts/verify-opening.mjs
 * imports it and measures the encoded film against it. Keeping the table in
 * Intro.tsx would mean the check had to carry its own copy of the numbers,
 * and a check held against a second copy of its own intention is not checking
 * anything.
 *
 * One window per shot, in shot order - the bar, the room, the band on the
 * bench, the machine.
 */
export const CUES: [number, number][] = [
  [0.065, 0.215],
  [0.275, 0.465],
  [0.495, 0.71],
  [0.755, 0.885],
]

/** When the card comes up, which is over the last shot and nothing else. */
export const TITLE_AT = 0.9
