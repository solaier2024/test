/*
 * Runs the House on a socket, so `VITE_API=http://127.0.0.1:8787 npm run dev`
 * plays the same game with the House out of the browser.
 *
 * Every player starts with a demo balance, because there is no wallet to ask.
 * That is the one piece of this that a real deployment replaces rather than
 * configures - see PENALES.md section 6.
 */

import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { handler } from '../src/server/http.ts'
import { House } from '../src/server/service.ts'

const PORT = Number(process.env.PORT ?? 8787)
const DEMO_BALANCE = Number(process.env.DEMO_BALANCE ?? 50_000)

/* Named out loud rather than defaulted, which is the point of House taking it as
 * an argument: a provably fair game with a guessable server seed is theatre, and
 * the entropy source is the one thing that cannot be checked from the outside. */
const house = new House((n) => webcrypto.getRandomValues(new Uint8Array(n)))

const serve = handler(house)
const funded = new Set()

createServer((req, res) => {
  const playerId = req.headers['x-player'] ?? 'invitado'
  if (!funded.has(playerId)) {
    funded.add(playerId)
    house.fund(playerId, DEMO_BALANCE, `demo:${playerId}`)
  }
  serve(req, res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`la tanda - House on http://127.0.0.1:${PORT}`)
  console.log(`demo balance ${(DEMO_BALANCE / 100).toFixed(2)} per player\n`)
  console.log(`  VITE_API=http://127.0.0.1:${PORT} npm run dev\n`)
})
