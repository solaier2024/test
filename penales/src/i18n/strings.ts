/*
 * English is the source of truth and Spanish is typed against it, so a missing
 * translation is a compile error rather than a blank label somebody finds in
 * production. Same pattern as the other tables in this repository.
 *
 * The default here is Spanish, which is a reversal of the others and is not a
 * preference. This game is aimed at Mexico, and a game that opens in English and
 * offers Spanish is a game that has decided who it is for. The English exists to
 * be the reference the translation is checked against, and for a reviewer who does
 * not read Spanish.
 *
 * Written in northern Mexican register rather than translated word for word -
 * "la tanda" for the shootout, "la escuadra" for the top corner, "el portero"
 * rather than the neutral "guardameta". A player hears the difference immediately
 * and it is the cheapest credibility a game of this kind can buy. This still needs
 * a native reviewer before release; a careful non-native draft is a starting point
 * and not a substitute.
 */

export const en = {
  title: 'LA TANDA',
  subtitle: 'The shootout',

  /* The table */
  stake: 'Stake',
  balance: 'Balance',
  kick: 'Shoot',
  cashOut: 'Take it',
  newRound: 'Step up',
  kicksTaken: 'Kick',
  of: 'of',
  regulation: 'Regulation',
  suddenDeath: 'Sudden death',
  onTheBoard: 'On the board',
  ifItGoesIn: 'if it goes in',

  /* What happened */
  goal: 'GOAL',
  saved: 'SAVED',
  missed: 'OFF TARGET',
  cashed: 'Banked',
  busted: 'Over',
  waiting: 'The ball is in the air',

  /* Zones */
  zoneTl: 'Top left',
  zoneTc: 'Over him',
  zoneTr: 'Top right',
  zoneBl: 'Low left',
  zoneBc: 'Down the middle',
  zoneBr: 'Low right',

  /* The keeper */
  keeper: 'EL CANCERBERO',
  tell: 'He has committed',
  tellHelp: 'He moved early. Shoot where he is not and the payout drops, because it is an easier goal.',

  /* Provably fair */
  fair: 'Provably fair',
  commitment: 'Commitment (published before you played)',
  clientSeed: 'Your seed',
  serverSeed: 'Server seed',
  nonce: 'Round',
  rounds: 'rounds',
  changeSeed: 'Change my seed',
  reveal: 'Reveal the seed and start a new one',
  revealHelp:
    'Retiring a seed publishes it. You can then recompute every keeper it produced - including the kicks you never took.',
  verified: 'Checked: the published hash matches the revealed seed',
  notVerified: 'THE HASH DOES NOT MATCH THE SEED',
  recomputeHelp: 'Recomputed on this device from the three values above',
  kickN: 'Kick',
  hisDive: 'He went',
  yourShot: 'You shot',
  notTaken: 'not taken',
  history: 'Recent rounds',

  /* The odds, published */
  odds: 'The odds',
  chance: 'Chance',
  pays: 'Pays',
  rtp: 'Return to player',
  rtpNote: 'Identical in all six zones, and identical however long you stay in.',
  maxWin: 'Most a round can pay',

  /* Errors and housekeeping */
  refused: 'Refused',
  tryAgain: 'Try again',
  demoMoney: 'Demo balance. No real money, no wagering, no payouts.',
  serverAuthoritative: 'Every outcome is decided on the server before you shoot.',
} as const

/*
 * Keys from English, values widened to string. `typeof en` on its own would fix
 * every value to its literal, so the Spanish below would fail to compile for
 * saying anything other than the English - which is the opposite of the point.
 * This keeps the part that matters: a missing or misspelled key is a type error.
 */
export type Strings = { readonly [K in keyof typeof en]: string }

export const es: Strings = {
  title: 'LA TANDA',
  subtitle: 'Los penales',

  stake: 'Apuesta',
  balance: 'Saldo',
  kick: 'Tirar',
  cashOut: 'Retirar',
  newRound: 'Pasar al manchón',
  kicksTaken: 'Tiro',
  of: 'de',
  regulation: 'Los cinco',
  suddenDeath: 'Muerte súbita',
  onTheBoard: 'Acumulado',
  ifItGoesIn: 'si entra',

  goal: 'GOL',
  saved: 'ATAJADA',
  missed: 'FUERA',
  cashed: 'Cobrado',
  busted: 'Se acabó',
  waiting: 'El balón va en el aire',

  zoneTl: 'Escuadra izquierda',
  zoneTc: 'Por encima de él',
  zoneTr: 'Escuadra derecha',
  zoneBl: 'Abajo izquierda',
  zoneBc: 'Por el centro',
  zoneBr: 'Abajo derecha',

  keeper: 'EL CANCERBERO',
  tell: 'Ya se movió',
  tellHelp: 'Se adelantó. Si tiras donde no está, el premio baja: es un gol más fácil.',

  fair: 'Juego verificable',
  commitment: 'Compromiso (publicado antes de que jugaras)',
  clientSeed: 'Tu semilla',
  serverSeed: 'Semilla del servidor',
  nonce: 'Ronda',
  rounds: 'rondas',
  changeSeed: 'Cambiar mi semilla',
  reveal: 'Revelar la semilla y empezar otra',
  revealHelp:
    'Al retirar una semilla la publicamos. Puedes recalcular cada portero que produjo, incluidos los tiros que no hiciste.',
  verified: 'Comprobado: el hash publicado coincide con la semilla revelada',
  notVerified: 'EL HASH NO COINCIDE CON LA SEMILLA',
  recomputeHelp: 'Recalculado en este dispositivo con los tres valores de arriba',
  kickN: 'Tiro',
  hisDive: 'Se fue',
  yourShot: 'Tiraste',
  notTaken: 'sin tirar',
  history: 'Rondas recientes',

  odds: 'Las probabilidades',
  chance: 'Probabilidad',
  pays: 'Paga',
  rtp: 'Retorno al jugador',
  rtpNote: 'El mismo en las seis zonas, y el mismo por cuantos tiros aguantes.',
  maxWin: 'Máximo por ronda',

  refused: 'Rechazado',
  tryAgain: 'Inténtalo otra vez',
  demoMoney: 'Saldo de demostración. Sin dinero real, sin apuestas, sin premios.',
  serverAuthoritative: 'Cada resultado se decide en el servidor antes de que tires.',
}

export const LOCALES = { es, en }
export type Locale = keyof typeof LOCALES
