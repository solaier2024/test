import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * Published to a static host from a sub-path, like the other tables in this
 * repository, so changing VITE_BASE is the only edit needed to host it
 * elsewhere. Builds carry the base; the dev server stays on / so capture
 * scripts can keep pointing at it.
 *
 * A note about what the static build is and is not. On a static host the House
 * runs inside the page, because there is nowhere else for it to run. That is a
 * demo, not the product, and the reason it is harmless is the reason the
 * boundary was built: src/client/api.ts talks to a transport, and the choice
 * between the in-page House and real HTTP is one environment variable. A real
 * money deployment sets VITE_API and the House is never shipped to the browser
 * at all - see src/server/http.ts.
 */
const base = process.env.VITE_BASE ?? '/test/penales/'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? base : '/',
}))
