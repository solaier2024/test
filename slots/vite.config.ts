import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * Published to a static host from a sub-path rather than the domain root, so
 * every runtime asset URL goes through import.meta.env.BASE_URL (see src/art.ts)
 * and changing VITE_BASE is the only edit needed to host it somewhere else.
 * Builds carry the base; the dev server stays on / so the capture scripts can
 * keep pointing at it.
 *
 * The default is the GitHub Pages path. Three tables in this series share one
 * gh-pages branch, so each one lives in its own directory there rather than at
 * the root - see .github/workflows/slots-preview.yml.
 */
const base = process.env.VITE_BASE ?? '/test/slots/'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? base : '/',
}))
