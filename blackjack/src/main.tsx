import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rye/400.css'
import './index.css'
import App from './App'
import { ac, tapOutput, unlock } from './audio/engine'
import { setMood, shuffleSeam, startIntroScore } from './audio/score'
import { utterancesSpoken, voiceAvailable } from './audio/voice'

/*
 * A handle on the live audio graph, for scripts/render-score.mjs and
 * scripts/verify-audio.mjs. It deliberately points at the same modules the game
 * uses: the one thing a second, test-only copy of an arrangement guarantees is
 * that the thing being measured is not the thing being shipped.
 */
declare global {
  interface Window {
    __audio?: Record<string, unknown>
  }
}

window.__audio = {
  ctx: () => ac(),
  tap: (node: AudioNode) => tapOutput(node),
  unlock: () => unlock(),
  mood: (p: { edge?: number; heat?: number; warmth?: number }) => setMood(p),
  seam: () => shuffleSeam(),
  intro: (from = 0) => startIntroScore(from),
  spoken: () => utterancesSpoken(),
  voices: () => voiceAvailable(),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
