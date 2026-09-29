import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
 * The preview is published to a GitHub Pages project site, which serves the
 * app from a sub-path rather than the domain root. Only builds carry the base:
 * the dev server stays on / so the capture scripts can keep pointing at it.
 * Every runtime asset URL goes through import.meta.env.BASE_URL, so changing
 * this is the only edit needed to host it somewhere else.
 */
const base = process.env.VITE_BASE ?? '/test/'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? base : '/',
}))
