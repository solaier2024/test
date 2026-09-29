/*
 * English is the source of truth and Spanish is typed against it, so a missing
 * line does not compile. The Spanish is written for the northern border rather
 * than translated word for word - this room is half Sonoran and the crowd in it
 * would not be speaking Castilian.
 */

const en = {
  title: 'EL BANDIDO MANCO',
  subtitle: 'THE ONE-ARMED BANDIT',
  year: 'The same saloon. Fifteen years later.',
  tagline: 'The card on the front is honest. Nobody ever said the reels were.',
  disclaimer: 'Entertainment only · No real money, no wagering, no payouts',
  begin: 'STEP UP',
  skip: 'SKIP',

  openingA: 'By ninety-nine the faro layouts sat empty half the night.',
  openingB: 'Everyone was down the end of the bar, watching a machine.',
  openingC: 'You cannot read a machine the way you read a man.',
  openingD: 'But the odds are not printed on the front. They are pasted on the bands.',

  pick: 'THREE MACHINES, ONE CARD',
  pickNote: 'The payout card is identical on all three. That is not a courtesy.',
  honestName: 'THE HONEST BELL',
  honestBlurb: 'The house machine. Straight bands. This is what clean looks like — learn it here.',
  drummerName: "THE DRUMMER'S FRIEND",
  drummerBlurb: 'Came in on a freight wagon. Something about it runs thin, and it takes all night to say what.',
  bandidoName: 'EL BANDIDO MANCO',
  bandidoBlurb: 'The one they all stand around. It misses by a hair, over and over, and it never quite pays.',

  pull: 'PULL',
  pullHint: 'SPACE',
  /* Read out by anything that cannot see the picture, so it has to say where
   * the thing is as well as what it does. */
  leverLabel: 'THE LEVER ON THE MACHINE. DRAG IT DOWN, OR PRESS TO PULL.',
  call: 'CALL THE HOUSE',
  callHint: 'C',
  bank: 'PURSE',
  pulls: 'PULLS',
  took: 'BEST',
  heat: 'THE ROOM',

  tally: 'THE COUNT',
  tallyLegend: 'evidence that the third band is short of bells',
  tallyHint: 'bells seen on the third band, out of pulls',
  card: 'PAYS',
  cardSuit: 'THREE OF ANY SUIT',
  cardAnyBell: 'ANYWHERE',
  cardNote: 'PER COIN IN · CENTRE LINE ONLY',

  stake: 'COINS A PULL',
  /* The trade, in one line, because it is invisible otherwise: the money
   * scales with the stake and the count does not. */
  stakeNote: 'Pays per coin. The count does not: one look at the third band, whatever it cost you.',
  stakeLabel: (n: number) => `${n} ${n === 1 ? 'COIN' : 'COINS'} A PULL`,

  crowdRoar: 'The room comes off the floor.',
  crowdCheer: 'Somebody slaps the bar.',
  /* A near miss is read at the moment the room lets the breath go, not at the
   * moment it takes it, so the line says how close it came rather than how it
   * felt. A muted player has nothing else to read it from. */
  crowdGasp: 'One stop short. The air goes out of the room.',
  crowdSigh: 'A groan, and two of them turn away.',
  crowdMurmur: 'A murmur, and nobody moves.',
  crowdJeer: 'Laughter. Not the kind you want.',

  calledOut: 'YOU CALL IT OUT',
  provedTitle: 'THE ROOM AGREES',
  provedBody: 'They count it back with you and the machine goes quiet for the night. The house settles rather than have this said any louder.',
  wrongTitle: 'YOU CANNOT SHOW IT',
  wrongBody: 'Being right about a machine you cannot prove is being wrong in a room like this. You pay for the noise.',
  straightTitle: 'IT IS A STRAIGHT MACHINE',
  straightBody: 'Bad odds are not the same thing as a crooked band, and the room knows the difference even when you do not.',
  brokeTitle: 'THAT WAS THE LAST COIN',
  brokeBody: 'The count was going somewhere. It just needed more coins than you had, which is the whole design of the thing.',
  thrownTitle: 'THE COAT COMES OVER',
  thrownBody: 'You have been stood at one machine too long, saying too much. He is very polite about it.',

  again: 'ANOTHER MACHINE',
  backToPick: 'THE OTHER MACHINES',
  sound: 'SOUND',
  soundTapFor: 'tap for sound',
  soundOn: 'sound on',
  soundOff: 'sound off',
  lang: 'ES',

  reduceTitle: 'THE COUNT, IN WORDS',
  bellSeen: 'bell on the third band',
  bellNot: 'no bell on the third band',
  paid: 'paid',
  nothing: 'nothing',
}

type Strings = typeof en

const es: Strings = {
  title: 'EL BANDIDO MANCO',
  subtitle: 'LA MÁQUINA DE UN BRAZO',
  year: 'La misma cantina. Quince años después.',
  tagline: 'La tabla de pagos no miente. De las cintas nadie dijo nada.',
  disclaimer: 'Solo entretenimiento · Sin dinero real, sin apuestas, sin premios',
  begin: 'ARRÍMESE',
  skip: 'SALTAR',

  openingA: 'Para el noventa y nueve las mesas de faro se quedaban vacías media noche.',
  openingB: 'Todos al fondo de la barra, mirando una máquina.',
  openingC: 'A una máquina no se le lee la cara como a un hombre.',
  openingD: 'Pero la ventaja no está pintada al frente. Está pegada en las cintas.',

  pick: 'TRES MÁQUINAS, UNA SOLA TABLA',
  pickNote: 'La tabla de pagos es idéntica en las tres. Eso no es cortesía.',
  honestName: 'LA CAMPANA HONRADA',
  honestBlurb: 'La de la casa. Cintas derechas. Así se ve lo limpio — apréndalo aquí.',
  drummerName: 'LA DEL VIAJANTE',
  drummerBlurb: 'Llegó en un furgón. Algo le sale flaco, y cuesta toda la noche decir qué.',
  bandidoName: 'EL BANDIDO MANCO',
  bandidoBlurb: 'La que todos rodean. Falla por un pelo, una y otra vez, y nunca termina de pagar.',

  pull: 'JALE',
  pullHint: 'ESPACIO',
  leverLabel: 'LA PALANCA DE LA MÁQUINA. ARRÁSTRELA HACIA ABAJO, O PULSE PARA JALAR.',
  call: 'RECLAME',
  callHint: 'C',
  bank: 'BOLSA',
  pulls: 'JALADAS',
  took: 'MEJOR',
  heat: 'LA SALA',

  tally: 'LA CUENTA',
  tallyLegend: 'pruebas de que a la tercera cinta le faltan campanas',
  tallyHint: 'campanas vistas en la tercera cinta, de tantas jaladas',
  card: 'PAGA',
  cardSuit: 'TRES DEL MISMO PALO',
  cardAnyBell: 'DONDE SEA',
  cardNote: 'POR CADA FICHA · SOLO LA LÍNEA DE EN MEDIO',

  stake: 'FICHAS POR JALADA',
  stakeNote: 'Paga por ficha. La cuenta no: una mirada a la tercera cinta, cueste lo que cueste.',
  stakeLabel: (n: number) => `${n} ${n === 1 ? 'FICHA' : 'FICHAS'} POR JALADA`,

  crowdRoar: 'La sala se levanta del suelo.',
  crowdCheer: 'Alguien da un palmazo en la barra.',
  crowdGasp: 'Por un lugar. A la sala se le va el aire.',
  crowdSigh: 'Un quejido, y dos se dan la vuelta.',
  crowdMurmur: 'Un murmullo, y nadie se mueve.',
  crowdJeer: 'Risas. No de las que uno quiere.',

  calledOut: 'LO DICE EN VOZ ALTA',
  provedTitle: 'LA SALA LE DA LA RAZÓN',
  provedBody: 'La cuentan con usted y la máquina se calla por esta noche. La casa arregla antes que esto se diga más fuerte.',
  wrongTitle: 'NO LO PUEDE PROBAR',
  wrongBody: 'Tener razón sin poder mostrarla, en una sala así, es estar equivocado. El ruido se paga.',
  straightTitle: 'LA MÁQUINA ESTÁ DERECHA',
  straightBody: 'Malas probabilidades no son una cinta chueca, y la sala sabe la diferencia aunque usted no.',
  brokeTitle: 'ESA ERA LA ÚLTIMA FICHA',
  brokeBody: 'La cuenta iba para algún lado. Solo pedía más fichas de las que traía, y en eso consiste el aparato.',
  thrownTitle: 'SE ACERCA EL DEL ABRIGO',
  thrownBody: 'Lleva demasiado rato parado en la misma máquina diciendo demasiado. Se lo pide con mucha educación.',

  again: 'OTRA MÁQUINA',
  backToPick: 'LAS OTRAS MÁQUINAS',
  sound: 'SONIDO',
  soundTapFor: 'toque para el sonido',
  soundOn: 'sonido encendido',
  soundOff: 'sonido apagado',
  lang: 'EN',

  reduceTitle: 'LA CUENTA, EN PALABRAS',
  bellSeen: 'campana en la tercera cinta',
  bellNot: 'sin campana en la tercera cinta',
  paid: 'pagó',
  nothing: 'nada',
}

export type Lang = 'en' | 'es'
export const STRINGS: Record<Lang, Strings> = { en, es }
export type Key = keyof Strings
/** The keys that are a finished line, as opposed to the few that take a number. */
export type TextKey = { [K in Key]: Strings[K] extends string ? K : never }[Key]
