/*
 * Zone presentation tables, kept out of the component files.
 *
 * Partly so fast refresh works - a module that exports both a component and a
 * constant cannot be hot-replaced - and partly because these are the numbers that
 * have to line up with whatever art eventually arrives. The geometry is where the
 * goal mouth is divided, and the dive targets are where the keeper ends up; when
 * the placeholder keeper becomes six short clips, this file is the mapping from a
 * zone to a clip and the transforms below are what the clips have to match.
 */

import type { Dive, Zone } from '../game/table.ts'
import type { Strings } from '../i18n/strings.ts'

/** Which cell of the 3x2 grid over the goal mouth each zone is. */
export const GEOMETRY: Record<Zone, { column: number; row: number }> = {
  tl: { column: 1, row: 1 },
  tc: { column: 2, row: 1 },
  tr: { column: 3, row: 1 },
  bl: { column: 1, row: 2 },
  bc: { column: 2, row: 2 },
  br: { column: 3, row: 2 },
}

/**
 * Where he ends up, as a percentage of his own size, and how far he tilts.
 *
 * Six entries, which is the entire animation budget for the character in this
 * game - and the reason the brief's camera choice is worth what it is worth. A
 * full-body dive rig would be the most expensive asset in the project; six
 * transforms, or later six one-second clips, is not.
 */
export const DIVE_TO: Record<Dive, { x: number; y: number; tilt: number }> = {
  tl: { x: -62, y: -46, tilt: -24 },
  tc: { x: 0, y: -54, tilt: 0 },
  tr: { x: 62, y: -46, tilt: 24 },
  bl: { x: -70, y: 10, tilt: -62 },
  bc: { x: 0, y: 4, tilt: 0 },
  br: { x: 70, y: 10, tilt: 62 },
}

export const ZONE_LABEL: Record<Zone, keyof Strings> = {
  tl: 'zoneTl',
  tc: 'zoneTc',
  tr: 'zoneTr',
  bl: 'zoneBl',
  bc: 'zoneBc',
  br: 'zoneBr',
}
