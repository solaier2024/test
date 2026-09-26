import type { ModeId, VenueId } from '../game/types'
import type { OpponentId } from '../game/ai'

export type Lang = 'en' | 'es'

/** Selection-screen copy for one table variant. */
export interface ModeCopy {
  name: string
  tag: string
  blurb: string
  /** The two or three lines that actually differ from the house game. */
  rules: string[]
}

export interface OpponentCopy {
  name: string
  where: string
  blurb: string
}

/**
 * Every player-facing string. English is the source of truth; es-MX is written
 * for a northern-Mexico ear rather than translated literally, so a few lines
 * deliberately diverge in imagery instead of matching word for word.
 */
export interface Strings {
  langName: string

  modes: Record<ModeId, ModeCopy>
  opponents: Record<OpponentId, OpponentCopy>
  venues: Record<VenueId, string>

  title: {
    kicker: string
    name: string
    tagline: string
    sit: string
    disclaimer: string
  }

  menu: {
    chooseTable: string
    chooseMode: string
    chooseOpponent: string
    rules: string
    back: string
    deal: string
    stakes: string
    chambers: string
    betting: string
    bettingOn: string
    bettingOff: string
  }

  hud: {
    pot: string
    round: string
    you: string
    across: string
    yourTurn: string
    thinking: string
    liveNext: string
    certain: string
    tell: string
    tellCalm: string
    tellEasy: string
    tellRattled: string
    tellCounter: (seen: number, bluffs: number) => string
    live: string
    spent: string
    blanks: string
  }

  load: {
    question: string
    dealerPicks: string
    hint: (ante: number) => string
    go: string
  }

  actions: {
    raiseLabel: string
    push: (amount: number) => string
    atSelf: string
    atSelfHint: string
    atThem: string
    atThemHint: string
    call: (amount: number) => string
    fold: string
    foldHint: string
    owed: (amount: number) => string
    pass: string
    passHint: (toll: number) => string
  }

  beats: {
    sealedYouFirst: string
    sealedTheyFirst: string
    loading: string
    youAimSelf: string
    youAimThem: string
    theyAimSelf: string
    theyAimYou: string
    click: string
    bangYou: string
    bangThem: string
    youRaise: (amount: number) => string
    theyRaise: (amount: number) => string
    youCall: string
    theyCall: string
    youFold: string
    theyFold: string
    youPass: string
    theyPass: string
    dealerLoads: (live: number) => string
    blankBonus: (amount: number) => string
  }

  result: {
    youWin: (pot: number) => string
    youLose: (pot: number) => string
    byFold: string
    next: string
    chambersWere: string
    matchWon: string
    matchLost: string
    rematch: string
    changeTable: string
  }

  keys: {
    hint: string
  }
}

const en: Strings = {
  langName: 'English',

  modes: {
    classic: {
      name: 'STRAIGHT SIX',
      tag: 'The house game',
      blurb:
        'Six chambers, you set the load, and the money keeps moving between every shot. Everything else on this list is a variation on it.',
      rules: [
        'Six chambers · you load 1 to 5 live rounds',
        'Raise, call and fold are open between chambers',
        'The ante climbs with how heavy you load',
      ],
    },
    quickdraw: {
      name: 'QUICK DRAW',
      tag: 'Four chambers, one round',
      blurb:
        'No raising, no talking, no time to think. One live round in four and a flat ante — hands are over in about a minute, and the whole fight is over who holds the turn.',
      rules: [
        'Four chambers · exactly one live round',
        'Ante only — there is no betting',
        'Everything plays faster. Built for one more hand',
      ],
    },
    widowmaker: {
      name: 'WIDOWMAKER',
      tag: 'Half the cylinder is loaded',
      blurb:
        'Never fewer than three live rounds. Every chamber the two of you survive drags another 18 out of each stack, so waiting is its own way of losing.',
      rules: [
        'Six chambers · 3 to 5 live rounds',
        'Every chamber survived costs both sides 18',
        'Betting is open, but the cylinder is the clock',
      ],
    },
    diablo: {
      name: 'EL PASE',
      tag: 'Cantina rules',
      blurb:
        'Down in the cantina you do not load your own cylinder — they do. To square it, each of you may slide the iron across once a hand without firing, for thirty.',
      rules: [
        'Six chambers · they choose the load, 2 to 5',
        'Once a hand you may pass your chamber for 30',
        'Passing buys you out of one bad spot, not two',
      ],
    },
  },

  opponents: {
    calloway: {
      name: 'Amos Calloway',
      where: 'Bitter Creek Saloon · West Texas',
      blurb:
        'Freight money and a short fuse. He tells on himself more often than he believes, and when the price turns rude he lets the hand go.',
    },
    viuda: {
      name: 'La Viuda',
      where: 'Cantina La Cruz · Coahuila',
      blurb:
        'She has held this table longer than anyone will say out loud. Her face lies about twice as often as his, and she almost never lets go of a hand.',
    },
  },

  venues: {
    saloon: 'Bitter Creek Saloon',
    cantina: 'Cantina La Cruz',
  },

  title: {
    kicker: 'A WEST TEXAS WAGER',
    name: 'THE LAST ROUND',
    tagline:
      'Six chambers. You say how many are loaded. You both know the count — neither of you knows the order.\nRide out your own chamber and the turn stays yours. Point it across the table and it passes, loaded or not.',
    sit: 'TAKE A SEAT',
    disclaimer: 'Entertainment only · No real money, no wagering, no payouts',
  },

  menu: {
    chooseTable: 'PICK YOUR TABLE',
    chooseMode: 'THE GAME',
    chooseOpponent: 'THE COMPANY',
    rules: 'HOUSE RULES',
    back: 'BACK',
    deal: 'SIT DOWN',
    stakes: 'Stakes',
    chambers: 'Chambers',
    betting: 'Betting',
    bettingOn: 'Raise, call, fold',
    bettingOff: 'Ante only',
  },

  hud: {
    pot: 'POT',
    round: 'Hand',
    you: 'YOU',
    across: 'ACROSS THE TABLE',
    yourTurn: 'YOUR MOVE',
    thinking: 'THINKING',
    liveNext: 'ODDS THE NEXT ONE IS LIVE',
    certain: 'THIS ONE CANNOT MISS',
    tell: 'THEIR FACE',
    tellCalm: 'Nothing at all',
    tellEasy: 'Loose. A little amused',
    tellRattled: 'Tight jaw. Sweating',
    tellCounter: (seen, bluffs) =>
      `${seen} tell${seen === 1 ? '' : 's'} read · ${bluffs} of them were an act`,
    live: 'live',
    spent: 'spent',
    blanks: 'empty',
  },

  load: {
    question: 'How many live rounds go in?',
    dealerPicks: 'They load the cylinder. You only get to watch.',
    hint: (ante) =>
      `Load it heavier and the ante climbs — but you reach the chamber that cannot miss that much sooner. Ante ${ante}.`,
    go: 'LOAD AND SPIN',
  },

  actions: {
    raiseLabel: 'RAISE',
    push: (amount) => `PUSH ${amount}`,
    atSelf: 'AT YOURSELF',
    atSelfHint: 'Ride it out and the turn stays yours',
    atThem: 'ACROSS THE TABLE',
    atThemHint: 'Live or empty, the turn passes',
    call: (amount) => `CALL ${amount}`,
    fold: 'FOLD THE HAND',
    foldHint: 'Lose the pot, keep your skin',
    owed: (amount) => `They want ${amount} more out of you.`,
    pass: 'PASS THE IRON',
    passHint: (toll) => `Skip your chamber for ${toll} · once a hand`,
  },

  beats: {
    sealedYouFirst: 'The cylinder snaps shut. Nobody knows where the first one sits. You go.',
    sealedTheyFirst: 'The cylinder snaps shut. They reach for the iron first.',
    loading: 'You thumb the rounds home, swing it closed, and spin.',
    youAimSelf: 'You set the muzzle against your own temple.',
    youAimThem: 'You level the muzzle across the table.',
    theyAimSelf: 'They put the barrel to their own head without blinking.',
    theyAimYou: 'They bring the muzzle up, square on you.',
    click: 'Click. Empty.',
    bangYou: 'The shot lands. The room tilts away from you.',
    bangThem: 'The shot lands. They go back hard, and the chair goes with them.',
    youRaise: (amount) => `You slide ${amount} into the middle.`,
    theyRaise: (amount) => `They push ${amount} out and wait on you.`,
    youCall: 'You call.',
    theyCall: 'They look at you a long moment, then call.',
    youFold: 'You take your hand off the iron and push the pot away. Alive beats even.',
    theyFold: 'They shake their head and let go. Not this hand.',
    youPass: 'You slide the iron across untouched. That one costs you.',
    theyPass: 'They pass the iron back to you, unfired, and pay for the privilege.',
    dealerLoads: (live) => `They thumb ${live} live round${live === 1 ? '' : 's'} in, and spin.`,
    blankBonus: (amount) => `The house adds ${amount} for riding that one out.`,
  },

  result: {
    youWin: (pot) => `You are still breathing. The ${pot} is yours.`,
    youLose: (pot) => `Their hand. They rake in ${pot}.`,
    byFold: ' Nobody fired.',
    next: 'NEXT HAND',
    chambersWere: 'The cylinder held',
    matchWon: 'They have nothing left to put up. The room goes very quiet.',
    matchLost: 'You are cleaned out. They tip their hat and walk into the dark.',
    rematch: 'DEAL AGAIN',
    changeTable: 'CHANGE TABLE',
  },

  keys: {
    hint: '1 at yourself · 2 across the table · R raise · Space continue',
  },
}

const es: Strings = {
  langName: 'Español (MX)',

  modes: {
    classic: {
      name: 'LAS SEIS',
      tag: 'El juego de la casa',
      blurb:
        'Seis recámaras, tú decides cuántas van cargadas, y el dinero se mueve entre cada tiro. Todo lo demás en esta lista sale de aquí.',
      rules: [
        'Seis recámaras · tú cargas de 1 a 5 balas',
        'Subir, ver y retirarse entre recámara y recámara',
        'Entre más cargas, más sube la entrada',
      ],
    },
    quickdraw: {
      name: 'MANO RÁPIDA',
      tag: 'Cuatro recámaras, una bala',
      blurb:
        'Sin subir, sin plática, sin tiempo de pensarle. Una bala entre cuatro y entrada fija — la mano se acaba en un minuto y todo se reduce a quién se queda con el turno.',
      rules: [
        'Cuatro recámaras · exactamente una bala',
        'Sólo la entrada — aquí no se apuesta',
        'Todo va más rápido. Hecho para una mano más',
      ],
    },
    widowmaker: {
      name: 'TAMBOR CARGADO',
      tag: 'Medio tambor va con bala',
      blurb:
        'Nunca menos de tres balas. Cada recámara que los dos aguantan les saca otros 18 a cada uno, así que esperar también es una forma de perder.',
      rules: [
        'Seis recámaras · de 3 a 5 balas',
        'Cada recámara aguantada les cuesta 18 a los dos',
        'Se puede apostar, pero el tambor es el reloj',
      ],
    },
    diablo: {
      name: 'EL PASE',
      tag: 'Reglas de cantina',
      blurb:
        'Aquí en la cantina tú no cargas tu tambor — lo cargan ellos. Para emparejarla, cada quien puede deslizar el fierro una vez por mano sin disparar, por treinta.',
      rules: [
        'Seis recámaras · ellos deciden la carga, de 2 a 5',
        'Una vez por mano puedes pasar tu recámara por 30',
        'El pase te saca de un mal momento, no de dos',
      ],
    },
  },

  opponents: {
    calloway: {
      name: 'Amos Calloway',
      where: 'Cantina Bitter Creek · Oeste de Texas',
      blurb:
        'Dinero de fletes y muy poca paciencia. Se le nota más de lo que él cree, y en cuanto el precio se pone feo suelta la mano.',
    },
    viuda: {
      name: 'La Viuda',
      where: 'Cantina La Cruz · Coahuila',
      blurb:
        'Lleva en esta mesa más tiempo del que nadie dice en voz alta. Su cara miente como el doble que la de él, y casi nunca suelta una mano.',
    },
  },

  venues: {
    saloon: 'Cantina Bitter Creek',
    cantina: 'Cantina La Cruz',
  },

  title: {
    kicker: 'UNA APUESTA EN LA FRONTERA',
    name: 'LA ÚLTIMA BALA',
    tagline:
      'Seis recámaras. Tú dices cuántas van cargadas. Los dos saben cuántas son — ninguno sabe en qué orden.\nAguanta tu propia recámara y el turno sigue siendo tuyo. Apúntale al otro y el turno se va, salga bala o no.',
    sit: 'SIÉNTATE',
    disclaimer: 'Solo entretenimiento · Sin dinero real, sin apuestas, sin premios',
  },

  menu: {
    chooseTable: 'ESCOGE TU MESA',
    chooseMode: 'EL JUEGO',
    chooseOpponent: 'LA COMPAÑÍA',
    rules: 'REGLAS DE LA CASA',
    back: 'ATRÁS',
    deal: 'SIÉNTATE',
    stakes: 'Apuesta',
    chambers: 'Recámaras',
    betting: 'Apuestas',
    bettingOn: 'Subir, ver, retirarse',
    bettingOff: 'Solo la entrada',
  },

  hud: {
    pot: 'POZO',
    round: 'Mano',
    you: 'TÚ',
    across: 'AL OTRO LADO',
    yourTurn: 'TE TOCA',
    thinking: 'PENSANDO',
    liveNext: 'PROBABILIDAD DE QUE LA SIGUIENTE SEA BALA',
    certain: 'ÉSTA NO FALLA',
    tell: 'SU CARA',
    tellCalm: 'Nada. Absolutamente nada',
    tellEasy: 'Suelto. Le da risa',
    tellRattled: 'Mandíbula apretada. Sudando',
    tellCounter: (seen, bluffs) =>
      `${seen} gesto${seen === 1 ? '' : 's'} leído${seen === 1 ? '' : 's'} · ${bluffs} eran puro teatro`,
    live: 'balas',
    spent: 'quemadas',
    blanks: 'vacías',
  },

  load: {
    question: '¿Cuántas balas le metes?',
    dealerPicks: 'Ellos cargan el tambor. A ti sólo te toca mirar.',
    hint: (ante) =>
      `Entre más cargado, más sube la entrada — pero llegas más rápido a la recámara que no falla. Entrada ${ante}.`,
    go: 'CARGAR Y GIRAR',
  },

  actions: {
    raiseLabel: 'SUBIR',
    push: (amount) => `EMPUJAR ${amount}`,
    atSelf: 'A TI MISMO',
    atSelfHint: 'Si aguantas, el turno sigue siendo tuyo',
    atThem: 'AL OTRO LADO',
    atThemHint: 'Salga o no salga, el turno se pasa',
    call: (amount) => `VER ${amount}`,
    fold: 'RETIRARSE',
    foldHint: 'Pierdes el pozo, conservas el pellejo',
    owed: (amount) => `Te quieren sacar ${amount} más.`,
    pass: 'PASAR EL FIERRO',
    passHint: (toll) => `Sáltate tu recámara por ${toll} · una vez por mano`,
  },

  beats: {
    sealedYouFirst: 'El tambor cierra de golpe. Nadie sabe dónde quedó la primera. Empiezas tú.',
    sealedTheyFirst: 'El tambor cierra de golpe. Ellos alcanzan el fierro primero.',
    loading: 'Metes las balas, cierras el tambor y lo giras.',
    youAimSelf: 'Te pones el cañón en la sien.',
    youAimThem: 'Levantas el cañón y apuntas al otro lado de la mesa.',
    theyAimSelf: 'Se ponen el cañón en la cabeza sin parpadear.',
    theyAimYou: 'Levantan el cañón y te apuntan de frente.',
    click: 'Clic. Vacía.',
    bangYou: 'Suena el tiro. El cuarto se te va de lado.',
    bangThem: 'Suena el tiro. Se van para atrás y la silla se va con ellos.',
    youRaise: (amount) => `Deslizas ${amount} al centro.`,
    theyRaise: (amount) => `Empujan ${amount} y se te quedan viendo.`,
    youCall: 'Ves la apuesta.',
    theyCall: 'Te miran un buen rato, y ven la apuesta.',
    youFold: 'Quitas la mano del fierro y empujas el pozo. Vivo vale más que a mano.',
    theyFold: 'Niegan con la cabeza y sueltan. Esta mano no.',
    youPass: 'Deslizas el fierro sin dispararlo. Eso te cuesta.',
    theyPass: 'Te regresan el fierro sin disparar, y pagan por el gusto.',
    dealerLoads: (live) => `Meten ${live} bala${live === 1 ? '' : 's'} al tambor y lo giran.`,
    blankBonus: (amount) => `La casa pone ${amount} más por haberla aguantado.`,
  },

  result: {
    youWin: (pot) => `Sigues respirando. Los ${pot} son tuyos.`,
    youLose: (pot) => `Mano para ellos. Se llevan ${pot}.`,
    byFold: ' Nadie disparó.',
    next: 'SIGUIENTE MANO',
    chambersWere: 'El tambor traía',
    matchWon: 'Ya no les queda con qué responder. El cuarto se queda mudo.',
    matchLost: 'Te limpiaron. Se acomodan el sombrero y se van a lo oscuro.',
    rematch: 'OTRA VEZ',
    changeTable: 'CAMBIAR DE MESA',
  },

  keys: {
    hint: '1 a ti mismo · 2 al otro lado · R subir · Espacio continuar',
  },
}

export const STRINGS: Record<Lang, Strings> = { en, es }

const STORAGE_KEY = 'last-round.lang'

export function loadLang(): Lang {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'es') return saved
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) {
    return 'es'
  }
  return 'en'
}

export function saveLang(lang: Lang): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang)
}
