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
  houseMayRule: string
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
  call: string
  next: string
  leave: string

  shoeLeft: string
  heat: string
  yourHand: string
  herHand: string

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
  caughtHer: (kind: string) => string
  calledWrong: string
  cheatName: Record<'second' | 'peek' | 'cold', string>
  houseCallName: Record<'no_double' | 'flat_natural' | 'no_split', string>
  houseCallSaid: (rule: string, fee: number) => string

  watchHands: string
  tellHint: string
  callsMade: (calls: number, caught: number) => string

  brokeTitle: string
  brokeBody: string
  thrownTitle: string
  thrownBody: string
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
  tagline: 'The cards are clean. Nobody ever said she was.',
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
  houseMayRule: 'The house may rewrite a rule, and pays you for it',
  minimum: (n) => `Minimum ${n}`,
  sit: 'SIT DOWN',

  tableName: {
    single: 'ONE DECK',
    casa: 'LA CASA MANDA',
    sixfive: 'SIX TO FIVE',
  },
  tableNote: {
    single: 'The shortest shoe in the house. Counting bites from the first hand, and she knows it.',
    casa: 'She may change one rule whenever she likes, as long as she pays the table for it.',
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
  leaning: 'WATCHING HER HANDS',
  call: 'CALL HER',
  next: 'NEXT HAND',
  leave: 'LEAVE THE TABLE',

  shoeLeft: 'SHOE',
  heat: 'THE ROOM',
  yourHand: 'YOU',
  herHand: 'THE HOUSE',

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
  caughtHer: (kind) => `CAUGHT HER — ${kind}`,
  calledWrong: 'NOTHING THERE',
  cheatName: {
    second: 'she dealt the second card',
    peek: 'she read her hole card',
    cold: 'she rang in a cold deck',
  },
  houseCallName: {
    no_double: 'no doubling this hand',
    flat_natural: 'blackjack pays even this hand',
    no_split: 'no splitting this hand',
  },
  houseCallSaid: (rule, fee) => `The house says: ${rule}. She pays you ${fee} for it.`,

  watchHands: 'Watch her hands, not her face.',
  tellHint: 'A real tell happens while the card is still in her hand. After it lands, it means nothing.',
  callsMade: (calls, caught) => `Called ${calls} · right ${caught}`,

  brokeTitle: 'CLEANED OUT',
  brokeBody: 'The stack is gone. She racks the shoe and looks past you at the next one.',
  thrownTitle: 'ASKED TO LEAVE',
  thrownBody: 'You watched her hands a little too hard for a little too long. A man in a good coat shows you the door.',
  again: 'ANOTHER NIGHT',

  soundTapFor: 'TAP FOR SOUND',
  soundOn: 'SOUND ON',
  soundOff: 'SOUND OFF',
  skip: 'SKIP',
  keys: 'H hit · S stand · D double · P split · L lean · C call · Space continue',

  introLines: [
    'In this town the last lamp burning is always over a card table.',
    'Faro. Monte. Dice. Pick how you want to lose.',
    'Everyone ends up at the same table anyway.',
    'She has cut this deck ten thousand times.',
    'The cards are clean. Nobody ever said she was.',
  ],
}

const es: Strings = {
  title: 'LA CASA MANDA',
  subtitle: 'BITTER CREEK, 1884',
  tagline: 'Las cartas están limpias. Nadie dijo que ella lo estuviera.',
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
  houseMayRule: 'La casa puede cambiar una regla, y te la paga',
  minimum: (n) => `Mínimo ${n}`,
  sit: 'SENTARSE',

  tableName: {
    single: 'UNA BARAJA',
    casa: 'LA CASA MANDA',
    sixfive: 'SEIS A CINCO',
  },
  tableNote: {
    single: 'La baraja más corta del salón. Contar sirve desde la primera mano, y ella lo sabe.',
    casa: 'Cambia una regla cuando le da la gana, siempre que le pague a la mesa.',
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
  leaning: 'MIRÁNDOLE LAS MANOS',
  call: 'CANTARLE',
  next: 'OTRA MANO',
  leave: 'DEJAR LA MESA',

  shoeLeft: 'BARAJA',
  heat: 'EL SALÓN',
  yourHand: 'TÚ',
  herHand: 'LA CASA',

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
  caughtHer: (kind) => `LA CACHASTE — ${kind}`,
  calledWrong: 'AHÍ NO HABÍA NADA',
  cheatName: {
    second: 'repartió la segunda',
    peek: 'le echó ojo a su tapada',
    cold: 'metió baraja preparada',
  },
  houseCallName: {
    no_double: 'esta mano no se dobla',
    flat_natural: 'esta mano el blackjack paga parejo',
    no_split: 'esta mano no se abre',
  },
  houseCallSaid: (rule, fee) => `Dice la casa: ${rule}. Te paga ${fee} por ello.`,

  watchHands: 'Mírale las manos, no la cara.',
  tellHint: 'El descuido de verdad pasa mientras la carta sigue en su mano. Después de caer, no significa nada.',
  callsMade: (calls, caught) => `Cantadas ${calls} · buenas ${caught}`,

  brokeTitle: 'SIN UN PESO',
  brokeBody: 'Se acabaron las fichas. Ella acomoda la baraja y mira por encima de ti al que sigue.',
  thrownTitle: 'TE INVITAN A SALIR',
  thrownBody: 'Le miraste las manos con demasiadas ganas y por demasiado rato. Un señor de buen saco te señala la puerta.',
  again: 'OTRA NOCHE',

  soundTapFor: 'TOCA PARA SONIDO',
  soundOn: 'CON SONIDO',
  soundOff: 'SIN SONIDO',
  skip: 'SALTAR',
  keys: 'H pido · S me planto · D doblo · P abro · L acercarse · C cantar · Espacio seguir',

  introLines: [
    'En este pueblo la última luz encendida siempre alumbra una mesa.',
    'Faro. Monte. Dados. Escoge cómo quieres perder.',
    'Al final todos acaban en la misma mesa.',
    'Ella ha cortado esta baraja diez mil veces.',
    'Las cartas están limpias. Nadie dijo que ella lo estuviera.',
  ],
}

export const STRINGS: Record<Lang, Strings> = { en, es }
