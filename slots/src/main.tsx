import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rye/400.css'
import './index.css'
import App from './App'
import { ac, bandBus, sfxBus, tapOutput, unlock } from './audio/engine'
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
  /** Written in by vite.config.ts. See the comment there. */
  const __BUILD__: { commit: string; short: string; built: string }
}

/*
 * The bundle says which commit it was built from, on the element a browser
 * shows you first. `document.documentElement.dataset` rather than a variable
 * because the question it answers - "is the page I am looking at the build I
 * just pushed, or a cached one" - is usually asked of a page that is already
 * open, and an attribute in the inspector answers it without a console.
 */
document.documentElement.dataset.build = __BUILD__.commit
document.documentElement.dataset.built = __BUILD__.built

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
  buses: () => ({ sfx: sfxBus(), band: bandBus(), talk: talkBus() }),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
