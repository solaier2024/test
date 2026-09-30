/*
 * English is the source of truth and Spanish is typed against it, so a missing
 * translation is a compile error rather than a blank label somebody finds later.
 * Same pattern as the other tables in this repository, and the same default:
 * English labels, Spanish title and Spanish in the mouth of anybody on the lot.
 *
 * The register is northern border Spanish rather than a word-for-word translation.
 * "La tanda" is the round of kicks; "la escuadra" is where the post meets the bar;
 * "el manchón" is the mark you kick from. A player hears the difference immediately
 * and it is the cheapest credibility a game set on this border can buy. It still
 * wants a native reviewer before anybody calls it finished - a careful non-native
 * draft is a starting point, not a substitute.
 *
 * One deliberate pun carries the whole thing, and it is why this table exists in a
 * western series at all: a run of kicks at a goal is a SHOOTOUT, and so is the game
 * in the back room. Same word, same lot, same evening.
 */

export const en = {
  title: 'LA TANDA',
  subtitle: 'The shootout on the lot',

  /* The table */
  stake: 'Ante',
  balance: 'Chips',
  kick: 'Kick',
  cashOut: 'Take it',
  newRound: 'Step to the mark',
  kicksTaken: 'Kick',
  of: 'of',
  regulation: 'The five',
  suddenDeath: 'Sudden death',
  onTheBoard: 'Riding on it',
  ifItGoesIn: 'if it goes in',

  /* What happened */
  goal: 'IN',
  saved: 'HE HAD IT',
  missed: 'WIDE',
  cashed: 'Took it',
  busted: 'That is that',
  waiting: 'The ball is in the air',

  /* Zones */
  zoneTl: 'Top left, off the post',
  zoneTc: 'Over his hat',
  zoneTr: 'Top right, off the post',
  zoneBl: 'Low left',
  zoneBc: 'Straight at him',
  zoneBr: 'Low right',

  /* The keeper */
  keeper: 'EL PORTERO',
  tell: 'He tipped it',
  tellHelp: 'He leaned early. Shoot where he is not and it pays less, because it is an easier goal.',

  /* Verifiable play */
  fair: 'Check the house',
  commitment: 'Sealed before you played',
  clientSeed: 'Your word',
  serverSeed: 'The house word',
  nonce: 'Round',
  rounds: 'rounds',
  changeSeed: 'Change my word',
  reveal: 'Open the envelope and seal a new one',
  revealHelp:
    'Retiring a seal publishes it. You can then work out every dive it produced - including the kicks you never took.',
  verified: 'Checked: the seal matches what was in it',
  notVerified: 'THE SEAL DOES NOT MATCH',
  recomputeHelp: 'Worked out on this device from the three values above',
  kickN: 'Kick',
  hisDive: 'He went',
  yourShot: 'You hit it',
  notTaken: 'never taken',
  history: 'Recent rounds',

  /* The odds, published */
  odds: 'The odds',
  chance: 'Chance',
  pays: 'Pays',
  rtp: 'Chips back over a long night',
  rtpNote: 'The same in all six corners, and the same however long you stay in.',
  maxWin: 'Most one round can pay',

  /* Housekeeping */
  refused: 'No',
  tryAgain: 'Again',
  demoMoney: 'Entertainment only. Chips have no value: no real money, no wagering, no payouts.',
  serverAuthoritative: 'Where he dives is settled before you pick a corner, and you can check it afterwards.',
} as const

/*
 * Keys from English, values widened to string. `typeof en` on its own would fix each
 * value to its literal, so the Spanish below would fail to compile for saying
 * anything other than the English - the opposite of the point. This keeps the part
 * that matters: a missing or misspelled key is a type error.
 */
export type Strings = { readonly [K in keyof typeof en]: string }

export const es: Strings = {
  title: 'LA TANDA',
  subtitle: 'Los penales en el llano',

  stake: 'Postura',
  balance: 'Fichas',
  kick: 'Tirar',
  cashOut: 'Retirar',
  newRound: 'Al manchón',
  kicksTaken: 'Tiro',
  of: 'de',
  regulation: 'Los cinco',
  suddenDeath: 'Muerte súbita',
  onTheBoard: 'Va acumulado',
  ifItGoesIn: 'si entra',

  goal: 'ENTRÓ',
  saved: 'LA ATAJÓ',
  missed: 'FUERA',
  cashed: 'Se retiró',
  busted: 'Se acabó',
  waiting: 'El balón va en el aire',

  zoneTl: 'Escuadra izquierda',
  zoneTc: 'Por encima del sombrero',
  zoneTr: 'Escuadra derecha',
  zoneBl: 'Abajo izquierda',
  zoneBc: 'Directo a él',
  zoneBr: 'Abajo derecha',

  keeper: 'EL PORTERO',
  tell: 'Se delató',
  tellHelp: 'Se adelantó. Si tiras donde no está, paga menos: es un gol más fácil.',

  fair: 'Revisa a la casa',
  commitment: 'Sellado antes de que jugaras',
  clientSeed: 'Tu palabra',
  serverSeed: 'La palabra de la casa',
  nonce: 'Ronda',
  rounds: 'rondas',
  changeSeed: 'Cambiar mi palabra',
  reveal: 'Abrir el sobre y sellar otro',
  revealHelp:
    'Al retirar un sello lo publicamos. Puedes sacar cada estirada que produjo, incluidos los tiros que no hiciste.',
  verified: 'Comprobado: el sello coincide con lo que traía dentro',
  notVerified: 'EL SELLO NO COINCIDE',
  recomputeHelp: 'Sacado en este aparato con los tres valores de arriba',
  kickN: 'Tiro',
  hisDive: 'Se fue',
  yourShot: 'Tiraste',
  notTaken: 'sin tirar',
  history: 'Rondas recientes',

  odds: 'Las probabilidades',
  chance: 'Probabilidad',
  pays: 'Paga',
  rtp: 'Fichas de vuelta en una noche larga',
  rtpNote: 'Las mismas en las seis escuadras, y las mismas por cuantos tiros aguantes.',
  maxWin: 'Máximo de una ronda',

  refused: 'No',
  tryAgain: 'Otra vez',
  demoMoney: 'Sólo entretenimiento. Las fichas no valen nada: sin dinero real, sin apuestas, sin premios.',
  serverAuthoritative: 'A dónde se tira se decide antes de que escojas escuadra, y puedes comprobarlo después.',
}

export const LOCALES = { en, es }
export type Locale = keyof typeof LOCALES
