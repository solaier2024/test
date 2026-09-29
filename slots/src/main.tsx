import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rye/400.css'
import './index.css'
import App from './App'
import { ac, tapOutput, unlock } from './audio/engine'
import { react, startRoom } from './audio/crowd'
import { setIntensity, startMusic } from './audio/music'
import { libertyBell, leverPull, payoutCoins } from './audio/sfx'

/*
 * A handle on the live audio graph, for scripts/render-room.mjs and
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
  room: () => startRoom(),
  music: () => startMusic(),
  intensity: (v: number) => setIntensity(v),
  react: (kind: string, density = 0.7) => react(kind as Parameters<typeof react>[0], density),
  lever: () => leverPull(),
  coins: (n: number) => payoutCoins(n),
  bell: (n = 3) => libertyBell(n),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
