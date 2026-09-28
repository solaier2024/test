import { ac, isMuted, reverbIn, sfxBus } from './engine'
import type { Lang } from '../i18n/strings'

/*
 * Her voice: the dealer calling the cards and the totals.
 *
 * Two layers, because neither one is enough on its own.
 *
 * 1. A COO, synthesised here. Three detuned saws through two vowel formants with
 *    a rise and a fall on the pitch - a short soft "mmh" with a lift at the end,
 *    which is where the coquettish quality actually comes from. It is WebAudio,
 *    so it goes through the room like everything else, it ducks and mutes with
 *    everything else, and it is always available.
 *
 * 2. THE WORDS, through the platform speech synthesiser. Free, nothing to
 *    license, no audio files. Pitched well up and slowed a little, which is the
 *    whole trick: a high pitch with a slow rate reads as soft and teasing where
 *    the same words at default settings read as a train announcement.
 *
 * The coo leads and the words follow about 180ms later, so the phrase starts
 * before the sentence does. If the platform has no voices installed - which is
 * the normal state of a headless browser - layer one still plays, so there is
 * never silence where she should be.
 *
 * Speech synthesis does not run through WebAudio and therefore cannot be routed
 * or ducked; all that can be done is to set its volume under the band and to
 * make certain the mute switch silences it. Both are done below.
 */

/* ------------------------------------------------------------------- lines */

const NUMBERS: Record<Lang, string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty', 'twenty one'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
    'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho',
    'diecinueve', 'veinte', 'veintiuno'],
}

const word = (lang: Lang, n: number) =>
  n >= 0 && n < NUMBERS[lang].length ? NUMBERS[lang][n] : String(n)

/**
 * Short, and addressed to you. The endearments are the point: they are what makes
 * a total being read out sound like she is enjoying herself.
 */
const LINES: Record<Lang, Record<string, string[]>> = {
  en: {
    deal: ['Cards, sugar.', 'Here you are, sweetheart.', 'For you, darling.', 'Watch closely now.'],
    hit: ['One more?', 'There you go.', 'Mm, another.'],
    shuffle: ['A fresh deck, just for you.', 'New cards, darling.'],
    blackjack: ['Blackjack. Aren\u2019t you lucky.'],
    bust: ['Ooh, too much, sweetheart.', 'Over. Such a shame.'],
    win: ['You take it. This time.', 'Lucky you, darling.'],
    lose: ['The house takes it, sugar.', 'Mine, I\u2019m afraid.'],
    push: ['A push. How polite.'],
    caught: ['Mm. How did you see that?'],
    missed: ['Nothing there, sweetheart.'],
    sit: ['Sit down, darling. Place your bet.'],
  },
  es: {
    deal: ['Cartas, mi vida.', 'Para ti, corazón.', 'Aquí tienes, guapo.', 'Mírame bien las manos.'],
    hit: ['¿Otra más?', 'Ahí va.', 'Mm, otra.'],
    shuffle: ['Baraja nueva, sólo para ti.', 'Cartas nuevas, corazón.'],
    blackjack: ['Blackjack. Qué suerte tienes.'],
    bust: ['Uy, te pasaste, corazón.', 'Se te fue. Qué pena.'],
    win: ['Te la llevas. Por esta vez.', 'Qué suerte, mi vida.'],
    lose: ['Se la lleva la casa, guapo.', 'Mía, lo siento.'],
    push: ['Empate. Qué educado.'],
    caught: ['Mm. ¿Cómo lo viste?'],
    missed: ['Ahí no había nada, corazón.'],
    sit: ['Siéntate, mi vida. Pon tu apuesta.'],
  },
}

export type Line = keyof (typeof LINES)['en']

/* -------------------------------------------------------------------- coo */

/**
 * A soft syllable with a lift on the end. The rise is doing the flirting: a flat
 * one sounds bored, and one that falls sounds disappointed.
 */
function coo(seconds = 0.5, base = 372, gain = 0.055, rise = 260): void {
  const c = ac()
  const out = c.createGain()
  const at = c.currentTime + 0.01
  out.gain.setValueAtTime(0.0001, at)
  out.gain.linearRampToValueAtTime(gain, at + seconds * 0.22)
  out.gain.setValueAtTime(gain, at + seconds * 0.6)
  out.gain.linearRampToValueAtTime(0.0001, at + seconds)

  // Breath over the top, which is most of what makes a voice sound close.
  const air = c.createBufferSource()
  air.buffer = (() => {
    const n = Math.floor(c.sampleRate * seconds)
    const b = c.createBuffer(1, n, c.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.5
    return b
  })()
  const airBp = c.createBiquadFilter()
  airBp.type = 'bandpass'
  airBp.frequency.value = 2600
  airBp.Q.value = 0.8
  const airGain = c.createGain()
  airGain.gain.setValueAtTime(0.0001, at)
  airGain.gain.linearRampToValueAtTime(gain * 0.4, at + seconds * 0.2)
  airGain.gain.linearRampToValueAtTime(0.0001, at + seconds)
  air.connect(airBp).connect(airGain).connect(out)
  air.start(at)
  air.stop(at + seconds + 0.05)

  // Two vowel formants; a high first formant is what keeps it light.
  for (const [hz, q, amp] of [[760, 7, 1], [1320, 8, 0.7], [2900, 9, 0.22]] as const) {
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = hz
    bp.Q.value = q
    const lvl = c.createGain()
    lvl.gain.value = amp
    bp.connect(lvl).connect(out)
    for (const det of [-6, 0, 7]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      const f0 = base * 2 ** (det / 1200)
      o.frequency.setValueAtTime(f0 * 0.94, at)
      o.frequency.linearRampToValueAtTime(f0, at + seconds * 0.2)
      o.frequency.linearRampToValueAtTime(f0 * 2 ** (rise / 1200), at + seconds * 0.95)
      // A late, shallow vibrato: an unwavering pitch sounds synthetic.
      const lfo = c.createOscillator()
      lfo.frequency.value = 5.4
      const depth = c.createGain()
      depth.gain.setValueAtTime(0, at)
      depth.gain.linearRampToValueAtTime(f0 * 0.012, at + seconds * 0.5)
      lfo.connect(depth).connect(o.frequency)
      lfo.start(at)
      lfo.stop(at + seconds + 0.05)
      const g = c.createGain()
      g.gain.value = 0.2
      o.connect(g).connect(bp)
      o.start(at)
      o.stop(at + seconds + 0.05)
    }
  }

  const room = c.createGain()
  room.gain.value = 0.22
  out.connect(room).connect(reverbIn())
  out.connect(sfxBus())
}

/* ------------------------------------------------------------------ speech */

let voices: SpeechSynthesisVoice[] = []
let picked: Record<Lang, SpeechSynthesisVoice | null> = { en: null, es: null }
let lastSpoke = 0
let spoken = 0

const FEMININE = /female|woman|girl|samantha|victoria|karen|moira|tessa|fiona|zira|hazel|monica|paulina|helena|sabina|luciana|ava|allison|susan|serena|amelie|anna|nicky|joana|catherine/i

function refreshVoices(): void {
  if (typeof speechSynthesis === 'undefined') return
  voices = speechSynthesis.getVoices()
  for (const lang of ['en', 'es'] as Lang[]) {
    const want = lang === 'es' ? /^es/i : /^en/i
    const matching = voices.filter((v) => want.test(v.lang))
    // Prefer a Mexican or US Spanish voice, and prefer a feminine one; fall back
    // to whatever the platform has rather than going silent.
    picked[lang] =
      matching.find((v) => FEMININE.test(v.name) && /MX|US/i.test(v.lang)) ??
      matching.find((v) => FEMININE.test(v.name)) ??
      matching.find((v) => /MX|US/i.test(v.lang)) ??
      matching[0] ??
      voices[0] ??
      null
  }
}

if (typeof speechSynthesis !== 'undefined') {
  refreshVoices()
  speechSynthesis.addEventListener('voiceschanged', refreshVoices)
}

export function voiceAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined' && voices.length > 0
}

export function utterancesSpoken(): number {
  return spoken
}

function speak(text: string, lang: Lang): void {
  if (typeof speechSynthesis === 'undefined') return
  const u = new SpeechSynthesisUtterance(text)
  const v = picked[lang]
  if (v) u.voice = v
  u.lang = lang === 'es' ? (v?.lang ?? 'es-MX') : (v?.lang ?? 'en-US')
  // High and unhurried. This pair is the entire character of the voice.
  u.pitch = 1.75
  u.rate = 0.9
  // Under the band on purpose: she is talking over music, not presenting.
  u.volume = 0.72
  spoken += 1
  // Never let lines stack up; the newest one is the one that matters.
  try {
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
    /* platform refused; the coo already played */
  }
}

/* -------------------------------------------------------------------- api */

let lang: Lang = 'en'
let enabled = true

export function setVoiceLang(next: Lang): void {
  lang = next
}

export function setVoiceEnabled(on: boolean): void {
  enabled = on
  if (!on && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

function allowed(minGap: number): boolean {
  if (!enabled || isMuted()) return false
  const now = performance.now()
  if (now - lastSpoke < minGap) return false
  lastSpoke = now
  return true
}

/** One of her lines, with the coo in front of it. */
export function say(line: Line, opts: { gap?: number; base?: number } = {}): void {
  if (!allowed(opts.gap ?? 900)) return
  coo(0.42, opts.base ?? 372, 0.05, 240)
  const options = LINES[lang][line]
  const text = options[Math.floor(Math.random() * options.length)]
  window.setTimeout(() => {
    if (enabled && !isMuted()) speak(text, lang)
  }, 180)
}

/**
 * A total, read out. Kept separate from `say` because it is the line that fires
 * most often and it has to be shorter and flatter, or it wears out fast.
 */
export function sayTotal(n: number, who: 'you' | 'house'): void {
  if (!allowed(650)) return
  coo(0.3, who === 'you' ? 392 : 350, 0.04, 180)
  const n21 = Math.max(0, Math.min(NUMBERS[lang].length - 1, n))
  const text =
    who === 'you'
      ? word(lang, n21)
      : lang === 'es'
        ? `la casa, ${word(lang, n21)}`
        : `house has ${word(lang, n21)}`
  window.setTimeout(() => {
    if (enabled && !isMuted()) speak(text, lang)
  }, 150)
}

/** Just the coo, for beats that want a sound but not a sentence. */
export function purr(): void {
  if (!enabled || isMuted()) return
  coo(0.34, 400, 0.042, 300)
}

export function stopVoice(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}
