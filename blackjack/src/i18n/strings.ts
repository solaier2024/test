export type Lang = 'en' | 'es'

/**
 * English is the single source of truth. Every line the UI can show is listed
 * here, so a missing translation is a compile error rather than a blank label.
 *
 * The Spanish is rewritten with a northern-Mexico ear rather than translated
 * word for word: the title is not a translation of the English one, and the
 * table copy uses the words a cantina would use.
 */
export interface Strings {
  title: string
  subtitle: string
  tagline: string
  play: string
  watchOpening: string
  disclaimer: string

  pickTable: string
  houseRules: string
  decks: (n: number) => string
  soft17Hits: string
  soft17Stands: string
  naturalPays: (n: number, d: number) => string
  splitsTo: (n: number) => string
  minimum: (n: number) => string
  sit: string

  tableName: Record<'single' | 'casa' | 'sixfive', string>
  tableNote: Record<'single' | 'casa' | 'sixfive', string>

  chips: string
  bet: string
  raise: string
  lower: string
  deal: string
  hit: string
  stand: string
  double: string
  split: string
  lean: string
  leaning: string
  next: string
  leave: string

  shoeLeft: string
  yourHand: string
  herHand: string

  /*
   * What a card is called out loud. Only a screen reader ever reads these - the
   * printed face is a rank and a pip - but "7 of H" is what it used to say, so
   * they have to be words, and words in the language the rest of the table is in.
   */
  suitName: Record<'S' | 'H' | 'D' | 'C', string>
  rankName: Record<'A' | 'J' | 'Q' | 'K', string>
  cardName: (rank: string, suit: string) => string
  faceDown: string

  dealing: string
  yourMove: string
  herMove: string
  shuffling: string

  youWin: string
  youLose: string
  push: string
  natural: string
  bust: string
  dealerBust: string

  /** The standing line under the felt when she has nothing to say. */
  hint: string
  /** Replaces it while you are leaning over the table. */
  watching: string

  brokeTitle: string
  brokeBody: string
  again: string

  soundTapFor: string
  soundOn: string
  soundOff: string
  skip: string
  keys: string

  introLines: string[]
}

const en: Strings = {
  title: "DEALER'S CHOICE",
  subtitle: 'BITTER CREEK, 1884',
  tagline: 'One lamp, one deck, and all night to lose it.',
  play: 'FIND A TABLE',
  watchOpening: 'WATCH THE OPENING',
  disclaimer: 'Entertainment only · No real money, no wagering, no payouts',

  pickTable: 'THREE TABLES ARE OPEN',
  houseRules: 'HOUSE RULES',
  decks: (n) => (n === 1 ? 'Single deck' : `${n} decks`),
  soft17Hits: 'Dealer draws on soft 17',
  soft17Stands: 'Dealer stands on all 17s',
  naturalPays: (n, d) => `Blackjack pays ${n}:${d}`,
  splitsTo: (n) => (n === 1 ? 'Split once' : `Split up to ${n} times`),
  minimum: (n) => `Minimum ${n}`,
  sit: 'SIT DOWN',

  tableName: {
    single: 'ONE DECK',
    casa: 'LA CASA MANDA',
    sixfive: 'SIX TO FIVE',
  },
  tableNote: {
    single: 'The shortest shoe in the house. Counting bites from the first hand, and she knows it.',
    casa: 'Six decks and she draws on soft seventeen. The count moves slowly and the night moves slower.',
    sixfive: 'The sign is on the felt and it is still the worst table in the room.',
  },

  chips: 'CHIPS',
  bet: 'BET',
  raise: '+',
  lower: '−',
  deal: 'DEAL',
  hit: 'HIT',
  stand: 'STAND',
  double: 'DOUBLE',
  split: 'SPLIT',
  lean: 'LEAN IN',
  leaning: 'LEANING IN',
  next: 'NEXT HAND',
  leave: 'LEAVE THE TABLE',

  shoeLeft: 'SHOE',
  yourHand: 'YOU',
  herHand: 'THE HOUSE',

  suitName: { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' },
  rankName: { A: 'ace', J: 'jack', Q: 'queen', K: 'king' },
  cardName: (rank, suit) => `${rank} of ${suit}`,
  faceDown: 'face down',

  dealing: 'She deals.',
  yourMove: 'Your move.',
  herMove: 'She plays her hand.',
  shuffling: 'The cut card came up. She shuffles.',

  youWin: 'YOU TAKE IT',
  youLose: 'THE HOUSE TAKES IT',
  push: 'A PUSH',
  natural: 'BLACKJACK',
  bust: 'BUST',
  dealerBust: 'SHE BREAKS',

  hint: 'The shoe is the only thing at this table that will tell you anything.',
  watching: 'Close enough to hear the cards come off the deck.',

  brokeTitle: 'CLEANED OUT',
  brokeBody: 'The stack is gone. She racks the shoe and looks past you at the next one.',
  again: 'ANOTHER NIGHT',

  soundTapFor: 'TAP FOR SOUND',
  soundOn: 'SOUND ON',
  soundOff: 'SOUND OFF',
  skip: 'SKIP',
  keys: 'H hit · S stand · D double · P split · L lean in · Space continue',

  introLines: [
    'In this town the last lamp burning is always over a card table.',
    'Faro. Monte. Dice. Pick how you want to lose.',
    'Everyone ends up at the same table anyway.',
    'She has cut this deck ten thousand times.',
    'Sit down. The deck does not care who you are.',
  ],
}

const es: Strings = {
  title: 'LA CASA MANDA',
  subtitle: 'BITTER CREEK, 1884',
  tagline: 'Una lámpara, una baraja y toda la noche para perderla.',
  play: 'BUSCAR MESA',
  watchOpening: 'VER LA APERTURA',
  disclaimer: 'Solo entretenimiento · Sin dinero real, sin apuestas, sin premios',

  pickTable: 'HAY TRES MESAS ABIERTAS',
  houseRules: 'REGLAS DE LA CASA',
  decks: (n) => (n === 1 ? 'Una baraja' : `${n} barajas`),
  soft17Hits: 'La casa pide con 17 suave',
  soft17Stands: 'La casa se planta con todo 17',
  naturalPays: (n, d) => `El blackjack paga ${n}:${d}`,
  splitsTo: (n) => (n === 1 ? 'Se abre una vez' : `Se abre hasta ${n} veces`),
  minimum: (n) => `Mínimo ${n}`,
  sit: 'SENTARSE',

  tableName: {
    single: 'UNA BARAJA',
    casa: 'LA CASA MANDA',
    sixfive: 'SEIS A CINCO',
  },
  tableNote: {
    single: 'La baraja más corta del salón. Contar sirve desde la primera mano, y ella lo sabe.',
    casa: 'Seis barajas, y pide con 17 suave. La cuenta va lenta y la noche más.',
    sixfive: 'El letrero está en el paño y sigue siendo la peor mesa del salón.',
  },

  chips: 'FICHAS',
  bet: 'APUESTA',
  raise: '+',
  lower: '−',
  deal: 'REPARTE',
  hit: 'PIDO',
  stand: 'ME PLANTO',
  double: 'DOBLO',
  split: 'ABRO',
  lean: 'ACERCARSE',
  leaning: 'ACERCÁNDOSE',
  next: 'OTRA MANO',
  leave: 'DEJAR LA MESA',

  shoeLeft: 'BARAJA',
  yourHand: 'TÚ',
  herHand: 'LA CASA',

  suitName: { S: 'espadas', H: 'corazones', D: 'diamantes', C: 'tréboles' },
  rankName: { A: 'as', J: 'jota', Q: 'reina', K: 'rey' },
  cardName: (rank, suit) => `${rank} de ${suit}`,
  faceDown: 'boca abajo',

  dealing: 'Reparte.',
  yourMove: 'Te toca.',
  herMove: 'Juega su mano.',
  shuffling: 'Salió la carta de corte. Está barajando.',

  youWin: 'TE LA LLEVAS',
  youLose: 'SE LA LLEVA LA CASA',
  push: 'EMPATE',
  natural: 'BLACKJACK',
  bust: 'TE PASASTE',
  dealerBust: 'SE PASA',

  hint: 'La baraja es lo único en esta mesa que te dice algo.',
  watching: 'Tan cerca que oyes salir las cartas.',

  brokeTitle: 'SIN UN PESO',
  brokeBody: 'Se acabaron las fichas. Ella acomoda la baraja y mira por encima de ti al que sigue.',
  again: 'OTRA NOCHE',

  soundTapFor: 'TOCA PARA SONIDO',
  soundOn: 'CON SONIDO',
  soundOff: 'SIN SONIDO',
  skip: 'SALTAR',
  keys: 'H pido · S me planto · D doblo · P abro · L acercarse · Espacio seguir',

  introLines: [
    'En este pueblo la última luz encendida siempre alumbra una mesa.',
    'Faro. Monte. Dados. Escoge cómo quieres perder.',
    'Al final todos acaban en la misma mesa.',
    'Ella ha cortado esta baraja diez mil veces.',
    'Siéntate. A la baraja le da igual quién eres.',
  ],
}

export const STRINGS: Record<Lang, Strings> = { en, es }
