import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rye/400.css'
import './index.css'
import App from './App'
import { ac, pianoBus, sfxBus, tapOutput, unlock } from './audio/engine'
import { react, startRoom, talkBus } from './audio/crowd'
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
  /*
   * The layers, so a script can measure one at a time.
   *
   * The brief is about the BALANCE between them - the room and the machine in
   * front, the upright behind them - and a probe on the output can only ever
   * report their sum. `talk` is the conversation inside the saloon bus, which
   * verify-audio needs on its own to show it is voices rather than noise.
   * These are the live nodes the game plays through, not a second graph built
   * for measuring.
   */
  buses: () => ({ sfx: sfxBus(), piano: pianoBus(), talk: talkBus() }),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
