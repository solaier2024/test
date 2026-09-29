import { useSyncExternalStore } from 'react'
import { onAudioChange, soundState, type SoundState } from './engine'

/**
 * Whether sound is on, muted, or still being held back by the browser for
 * want of a gesture. A plain string rather than an object so the store can be
 * read without allocating, and so React can compare it.
 */
const blocked = (): SoundState => 'blocked'

export const useSoundState = (): SoundState =>
  useSyncExternalStore(onAudioChange, soundState, blocked)
