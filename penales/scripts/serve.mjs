/*
 * Runs the House on a socket, so `VITE_API=http://127.0.0.1:8787 npm run dev`
 * plays the same game with the House out of the browser.
 *
 * Every player is handed a pile of chips on their first request, because there is
 * nowhere else for chips to come from.
 */

import { createServer } from 'node:http'
import { webcrypto } from 'node:crypto'
import { handler } from '../src/server/http.ts'
import { House } from '../src/server/service.ts'

const PORT = Number(process.env.PORT ?? 8787)
const STARTING_CHIPS = Number(process.env.STARTING_CHIPS ?? 50_000)

/* Named out loud rather than defaulted, which is the point of House taking it as an
 * argument: a verifiable game with a guessable server seed is theatre, and the
 * entropy source is the one thing a player cannot check from the outside. */
const house = new House((n) => webcrypto.getRandomValues(new Uint8Array(n)))

const serve = handler(house)
const funded = new Set()

createServer((req, res) => {
  const playerId = req.headers['x-player'] ?? 'invitado'
  if (!funded.has(playerId)) {
    funded.add(playerId)
    house.fund(playerId, STARTING_CHIPS, `chips:${playerId}`)
  }
  serve(req, res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`la tanda - House on http://127.0.0.1:${PORT}`)
  console.log(`${STARTING_CHIPS.toLocaleString('en-US')} chips per player\n`)
  console.log(`  VITE_API=http://127.0.0.1:${PORT} npm run dev\n`)
})
