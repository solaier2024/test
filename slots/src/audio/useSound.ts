import { useEffect, useState } from 'react'
import { isMuted, isUnlocked, onAudioState } from './engine'

export function useSoundState(): { muted: boolean; unlocked: boolean } {
  const [state, setState] = useState(() => ({ muted: isMuted(), unlocked: isUnlocked() }))
  useEffect(() => onAudioState(() => setState({ muted: isMuted(), unlocked: isUnlocked() })), [])
  return state
}
