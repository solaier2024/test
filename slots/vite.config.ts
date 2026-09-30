import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/*
 * WHICH COMMIT IS THE LIVE PAGE?
 *
 * Vite content-hashes every asset, so a new build means new filenames and a
 * cache cannot serve an old one by accident. index.html is the exception: it
 * has a fixed name, it is the thing that names the hashed bundle, and a CDN
 * holding a stale copy of it will happily keep a whole old release alive. The
 * githack mirror caches aggressively and this table is republished on every
 * push, so "did I just reload the same build" is a real question rather than a
 * theoretical one, and it cannot be answered by looking at the page.
 *
 * So the build signs itself, in two places that can disagree:
 *
 *   A <meta name="build"> in index.html says which build the HTML came from.
 *   __BUILD__ inside the bundle says which build the code that ran came from.
 *
 * Stale HTML pins a stale bundle, so the two normally agree and both go old
 * together - which is the case worth catching. They come apart only when a
 * host mixes a fresh index.html with a cached asset under the same name, and
 * then the disagreement is itself the diagnosis. scripts/verify-deploy.mjs
 * reads both off the deployed page and fails unless they are the commit it was
 * told to expect.
 */
function stamp() {
  const sha =
    process.env.GITHUB_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
      } catch {
        return 'unknown'
      }
    })()
  return { commit: sha.slice(0, 40), short: sha.slice(0, 7), built: new Date().toISOString() }
}

/** Puts the same stamp in the HTML, where a cache can strand it. */
function stampHtml(build: ReturnType<typeof stamp>): Plugin {
  return {
    name: 'stamp-build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { name: 'build', content: `${build.commit} ${build.built}` },
        injectTo: 'head',
      },
    ],
  }
}

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

export default defineConfig(({ command }) => {
  const build = stamp()
  return {
    plugins: [react(), stampHtml(build)],
    base: command === 'build' ? base : '/',
    define: { __BUILD__: JSON.stringify(build) },
  }
})
