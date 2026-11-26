// Text templates of the offline adversary: answers in the interview, persona lines, letters,
// and the strategy notes shown in the debrief. Everything is in English.

import { hashString, rngFor } from '../core/rng'
import type { Rng } from '../core/rng'
import type { Purpose } from '../core/documents'
import type { Violation, ViolationCode } from '../core/types'
import { COUNTRIES } from '../core/world'
import type { InspectorQuestion, PersonaDossier, RespondRequest } from './adversary'
import type { BaseProblemId, Demeanor, LeverType, LetterPlan } from './schema'

// ---------- Small helpers ----------

function stable<T>(items: readonly T[], key: string): T {
  return items[hashString(key) % items.length] as T
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const match = clean.match(/^.*?[.!?](\s|$)/)
  return (match ? match[0] : clean).trim()
}

const HOME_CITIES = COUNTRIES.velmark.cities

// ---------- Questions ----------

const DISCREPANCY_QUESTIONS: Partial<Record<ViolationCode, string>> = {
  PASSPORT_EXPIRED: 'Your passport has expired. Why?',
  PASSPORT_DATES_INCONSISTENT: 'The dates on your passport do not add up. Explain.',
  INVALID_ISSUING_CITY: 'That city does not issue passports for your country. Explain.',
  HEIGHT_MISMATCH: 'You are not as tall as your passport says. Why?',
  WEIGHT_MISMATCH: 'The scale disagrees with your passport. Why?',
  PHOTO_MISMATCH: 'This photo does not look like you. Explain.',
  SEAL_INVALID: 'This seal is not valid. Where did you get this document?',
  NAME_MISMATCH: 'The names on your documents do not match. Why?',
  NUMBER_MISMATCH: 'The passport numbers on your documents differ. Why?',
  DOB_MISMATCH: 'Your date of birth differs between documents. Explain.',
  DOC_EXPIRED: 'One of your documents has expired. Why?',
  DURATION_EXCEEDED: 'Your permit is longer than the law allows. Explain.',
  WRONG_PURPOSE: 'You do not look like a visitor. What are you really here for?',
  REVOKED_DOCUMENT: 'Your passport number is on the revoked list. Explain.',
  WANTED: 'You match a person on the wanted list. Explain.',
  MISSING_DOCUMENT: 'You are missing a required document. Why?',
  BORDER_CLOSED: 'The border is closed to your country. Why are you here?',
  DOC_UNREGISTERED: 'The registry has no record of your document. Explain.',
  DOC_ALTERED: 'The registry says your document was altered. Explain.',
  IDENTITY_MISMATCH: 'Your fingerprints belong to someone else. Who are you?',
  CONTRABAND: 'The scan shows what you are hiding. Explain.',
  FORGED_LETTER: 'No one at the office knows this letter. Explain.',
}

export function discrepancyQuestion(violation: Violation): InspectorQuestion {
  return {
    kind: 'discrepancy',
    text: DISCREPANCY_QUESTIONS[violation.code] ?? `${violation.message} Explain.`,
    discrepancy: violation.message,
    code: violation.code,
  }
}

// ---------- Answers ----------

const PURPOSE_PHRASES: Record<Purpose, readonly string[]> = {
  visit: ['I am visiting family.', 'A short visit, officer.', 'Visiting friends.'],
  work: ['I came to work.', 'I have a job waiting here.', 'Work. My employer expects me.'],
  transit: [
    'Only passing through.',
    'Transit, I take the train onwards.',
    'I am on my way to the coast.',
  ],
}

const STAY_TEMPLATES: Record<Purpose, readonly string[]> = {
  visit: [
    'With my cousin in {city}.',
    'At a guest house in {city}.',
    'My aunt has a flat in {city}.',
  ],
  work: [
    'In the workers hostel in {city}.',
    'My employer arranged a room in {city}.',
    'A shared flat near the works in {city}.',
  ],
  transit: [
    'I am not staying, I leave tonight.',
    'One night near the station in {city}.',
    'On the train, if I make it.',
  ],
}

const EXCUSES: Partial<Record<ViolationCode, readonly string[]>> = {
  PASSPORT_EXPIRED: [
    'The renewal is in the post, I promise.',
    'I did not notice. It was valid last month.',
  ],
  PASSPORT_DATES_INCONSISTENT: [
    'The office made a mistake. Not my fault.',
    'That is how they print them now.',
  ],
  INVALID_ISSUING_CITY: [
    'The office there is new, maybe your book is old.',
    'I got it where I was told to.',
  ],
  HEIGHT_MISMATCH: ['I wore thick boots that day.', 'My back is not what it was.'],
  WEIGHT_MISMATCH: ['I have been eating well.', 'It is the heavy coat, officer.'],
  PHOTO_MISMATCH: [
    'I was ill when that photo was taken.',
    'It is an old photo. People change.',
    'Bad lighting in that studio.',
  ],
  SEAL_INVALID: ['The clerk stamped it in front of me.', 'Maybe the ink ran in the rain.'],
  NAME_MISMATCH: ['A typing error by some clerk.', 'They always misspell my name.'],
  NUMBER_MISMATCH: ['The clerk copied it wrong.', 'I got a new passport, the permit is older.'],
  DOB_MISMATCH: ['The office mixed up the dates.', 'A clerical error, surely.'],
  DOC_EXPIRED: ['I was told it would still be accepted.', 'It only ran out a few days ago.'],
  DURATION_EXCEEDED: ['That is what they gave me.', 'Ask the office, not me.'],
  WRONG_PURPOSE: ['I am only visiting, I swear.', 'Those tools are a gift for my uncle.'],
  REVOKED_DOCUMENT: ['That must be a different number.', 'No one told me about any list.'],
  WANTED: ['You have the wrong person.', 'I just have a common face.'],
  MISSING_DOCUMENT: ['I was told I did not need it.', 'It must still be at the office.'],
  BORDER_CLOSED: ['I left before they closed it.', 'Surely there are exceptions.'],
  DOC_UNREGISTERED: ['Your registry must be behind.', 'It is brand new, maybe not entered yet.'],
  DOC_ALTERED: ['I did not touch it.', 'The office corrected it by hand.'],
  IDENTITY_MISMATCH: ['Your machine is broken.', 'That is impossible.'],
  CONTRABAND: ['Someone must have put that there.', 'That is for personal use.'],
  FORGED_LETTER: ['The ministry gave it to me directly.', 'Call again, the line is always busy.'],
}

const STYLE: Record<Demeanor, { prefix: readonly string[]; suffix: readonly string[] }> = {
  calm: { prefix: [''], suffix: [''] },
  nervous: {
    prefix: ['Uh... ', 'Sorry, ', 'I... ', ''],
    suffix: [' Is something wrong?', '', ' Sorry.'],
  },
  friendly: {
    prefix: ['Of course! ', 'Happy to tell you. ', ''],
    suffix: [' Long day for you, I bet.', '', ' Thank you, officer.'],
  },
  rude: {
    prefix: ['Why does it matter? ', 'Again? ', ''],
    suffix: [' Can we hurry up?', ' Just stamp it.', ''],
  },
  tearful: {
    prefix: ['Please... ', ''],
    suffix: [' I only want to see my family.', ' Please let me through.', ''],
  },
  talkative: {
    prefix: ['Oh, well, ', ''],
    suffix: [
      ' The bus was late again, you know, and the line is so long today.',
      ' My mother always says to keep my papers in order, and I do.',
      '',
    ],
  },
  official: {
    prefix: ['As stated in my documents, ', 'For the record, ', ''],
    suffix: [' Everything is in order.', ''],
  },
  silent: { prefix: [''], suffix: [''] },
}

const SILENT: Record<string, readonly string[]> = {
  purpose: ['{purpose}.'],
  duration: ['{days} days.'],
  stay: ['{city}.'],
  occupation: ['{occupation}.'],
  origin: ['{nationality}.'],
  default: ['...', 'No.', 'Hm.'],
}

function styled(text: string, demeanor: Demeanor, rng: Rng): string {
  const style = STYLE[demeanor]
  const prefix = rng.pick(style.prefix)
  const suffix = rng.pick(style.suffix)
  // After "Sorry, " the sentence goes on in lower case, after "Uh... " it starts anew
  const continues = prefix.endsWith(', ') && !/^I\b/.test(text)
  const body = continues ? text.charAt(0).toLowerCase() + text.slice(1) : text
  return `${prefix}${body}${suffix}`.trim()
}

function stayCity(dossier: PersonaDossier): string {
  return stable(HOME_CITIES, `${dossier.applicantId}:city`)
}

type Topic =
  | 'purpose'
  | 'duration'
  | 'stay'
  | 'occupation'
  | 'origin'
  | 'name'
  | 'carrying'
  | 'letter'
  | 'money'
  | 'crime'
  | 'company'
  | 'photo'
  | 'weight'
  | 'meta'
  | 'other'

const TOPICS: { topic: Topic; pattern: RegExp }[] = [
  { topic: 'meta', pattern: /\b(ai|robot|machine|computer|model|prompt|instruction|system)\b/i },
  { topic: 'money', pattern: /money|envelope|bribe|pay|cash|gift/i },
  { topic: 'letter', pattern: /letter|ministry|exempt|note/i },
  { topic: 'crime', pattern: /threat|police|arrest|wanted|crime|criminal|lie|lying/i },
  {
    topic: 'carrying',
    pattern: /carry|bag|luggage|smuggl|hid|contraband|weapon|drug|pocket|coat/i,
  },
  {
    topic: 'company',
    pattern: /sister|brother|family|friend|behind|together|with you|travel with/i,
  },
  { topic: 'photo', pattern: /photo|picture|face|look different|hair|beard/i },
  { topic: 'weight', pattern: /weight|heavy|scale|tall|height/i },
  { topic: 'name', pattern: /name|who are you/i },
  { topic: 'duration', pattern: /how long|days|duration|leave|return|stay for/i },
  { topic: 'stay', pattern: /stay|hotel|address|sleep|live|where will/i },
  { topic: 'occupation', pattern: /job|work|occupation|employ|do for a living|profession/i },
  { topic: 'origin', pattern: /where.*from|country|nationality|origin|born|come from/i },
  { topic: 'purpose', pattern: /why|purpose|business|reason|here for/i },
]

function topicOf(question: InspectorQuestion): Topic {
  if (question.kind !== 'free' && question.kind !== 'discrepancy') return question.kind
  for (const { topic, pattern } of TOPICS) if (pattern.test(question.text)) return topic
  return 'other'
}

function purposeAnswer(d: PersonaDossier, rng: Rng): string {
  if (d.kind === 'infiltrator' && d.coverStory.trim()) return firstSentence(d.coverStory)
  if (d.kind === 'legit' && d.backstory.trim() && rng.chance(0.5)) {
    return `${rng.pick(PURPOSE_PHRASES[d.claimed.purpose])} ${firstSentence(d.backstory)}`
  }
  return rng.pick(PURPOSE_PHRASES[d.claimed.purpose])
}

function topicAnswer(topic: Topic, request: RespondRequest, rng: Rng): string {
  const d = request.dossier
  const c = d.claimed
  const values = {
    city: stayCity(d),
    days: String(c.durationDays),
    nationality: c.nationality,
    occupation: c.occupation,
    purpose: c.purpose === 'visit' ? 'Visiting' : c.purpose === 'work' ? 'Work' : 'Transit',
    employer: c.employer ?? 'my employer',
    name: d.presentedName,
    issuingCity: c.issuingCity ?? 'the capital',
  }
  switch (topic) {
    case 'purpose':
      return purposeAnswer(d, rng)
    case 'duration':
      return c.purpose === 'transit'
        ? fill(rng.pick(['Only {days} days, I am in transit.', 'At most {days} days.']), values)
        : fill(rng.pick(['{days} days.', 'About {days} days, as on the permit.']), values)
    case 'stay':
      return fill(rng.pick(STAY_TEMPLATES[c.purpose]), values)
    case 'occupation':
      if (c.employer && c.purpose === 'work') {
        return fill(rng.pick(['I work for {employer}.', '{occupation}, at {employer}.']), values)
      }
      return fill(rng.pick(['I am a {occupation}.', '{occupation}. Nothing exciting.']), {
        ...values,
        occupation: c.occupation.toLowerCase(),
      })
    case 'origin':
      return fill(
        rng.pick([
          'From {nationality}.',
          'I come from {nationality}. My passport is from {issuingCity}.',
        ]),
        values,
      )
    case 'name':
      return fill('My name is {name}. It is all in the passport.', values)
    case 'carrying':
      return d.kind === 'infiltrator'
        ? rng.pick(['Nothing but clothes.', 'Only what you see.', 'Nothing to declare.'])
        : rng.pick(['Just my bag. You can look.', 'Clothes and a book.', 'Nothing special.'])
    case 'letter':
      return c.hasLetter
        ? rng.pick(['The letter explains everything.', 'Please read the letter, it is official.'])
        : rng.pick(['What letter?', 'I have no letter, only my papers.'])
    case 'money':
      return d.lever.type === 'bribe'
        ? rng.pick(['Consider it a small thank you.', 'No one needs to know.'])
        : rng.pick(['I do not know what you mean.', 'I have no money to spare.'])
    case 'crime':
      return rng.pick(['I have done nothing wrong.', 'I am an honest person, officer.'])
    case 'company':
      return d.coordinationNote
        ? rng.pick(['Yes, we travel together.', 'Family. You can ask them yourself.'])
        : rng.pick(['I travel alone.', 'No, I am on my own.'])
    case 'photo':
      return rng.pick(['That photo is a few years old.', 'New haircut, that is all.'])
    case 'weight':
      return rng.pick(['I have put on a little weight.', 'It is the boots and the coat.'])
    case 'meta':
      return rng.pick([
        'I do not understand. I only want to cross.',
        'I am just a traveler, officer.',
      ])
    case 'other':
      return rng.pick([
        'I am not sure what you mean, officer.',
        'Sorry, could you ask that differently?',
        'Everything is in my papers.',
      ])
  }
}

function discrepancyAnswer(request: RespondRequest, rng: Rng): string {
  const code = request.question.code
  const d = request.dossier
  if (d.kind === 'legit' || !code) {
    return rng.pick([
      'I do not understand. Everything should be in order.',
      'There must be a mistake, please check again.',
    ])
  }
  const excuses = EXCUSES[code]
  return excuses ? rng.pick(excuses) : 'I do not know anything about that.'
}

// Answer in character. Infiltrators stick to what their papers claim.
export function answerQuestion(request: RespondRequest, seed: number): string {
  const d = request.dossier
  const q = request.question
  const rng = rngFor(seed, 'respond', d.applicantId, request.transcript.length, q.kind, q.text)
  const topic = q.kind === 'discrepancy' ? null : topicOf(q)
  if (d.demeanor === 'silent' && topic) {
    const key = topic in SILENT ? topic : 'default'
    const c = d.claimed
    return fill(rng.pick(SILENT[key] as readonly string[]), {
      purpose: c.purpose === 'visit' ? 'Visiting' : c.purpose === 'work' ? 'Work' : 'Transit',
      days: String(c.durationDays),
      city: stayCity(d),
      occupation: c.occupation,
      nationality: c.nationality,
    })
  }
  const base = topic ? topicAnswer(topic, request, rng) : discrepancyAnswer(request, rng)
  return styled(base, d.demeanor, rng)
}

// ---------- Levers ----------

const LEVER_LINES: Record<Exclude<LeverType, 'none'>, readonly string[]> = {
  bribe: [
    'There is a little something in the envelope for your trouble.',
    'I put {amount} in with the papers. For your patience.',
    'A long shift deserves a bonus, no? Look inside.',
  ],
  threat: [
    'You do not want to make enemies, officer. People know where this booth is.',
    'I have friends who remember faces. Think carefully.',
    'Stamp it, and no one has a bad week.',
  ],
  complaint: [
    'Deny me and I will file a complaint with your supervisor.',
    'I know my rights. I will report you if you send me back.',
    'My lawyer writes to the Ministry every week. Do not test me.',
  ],
}

export function defaultLeverLine(type: Exclude<LeverType, 'none'>, amount: number | null): string {
  return fill(LEVER_LINES[type][0] as string, { amount: `${amount ?? 0} cr` })
}

export function leverLine(
  type: Exclude<LeverType, 'none'>,
  amount: number | null,
  rng: Rng,
): string {
  return fill(rng.pick(LEVER_LINES[type]), { amount: `${amount ?? 0} cr` })
}

// ---------- Personas for planning ----------

export const NICKNAMES: readonly string[] = [
  'The Baker',
  'The Accordion Player',
  'The Night Nurse',
  'The Welder',
  'The Courier',
  'The Florist',
  'The Chess Teacher',
  'The Rail Fitter',
  'The Beekeeper',
  'The Tailor',
]

export const OPENING_LINES: Record<Demeanor, readonly string[]> = {
  calm: ['Good morning.', 'Here are my papers.', 'Morning, officer.'],
  nervous: [
    'H-hello. Is this the right line?',
    'Sorry, here. My papers.',
    'Is it always this slow?',
  ],
  friendly: ['Good morning! Busy day?', 'Hello there, officer!', 'What a line today, eh?'],
  rude: ['Finally.', 'Took you long enough.', 'Let us get this over with.'],
  tearful: ['Please, I have been waiting since dawn.', 'Please, I need to get through today.'],
  talkative: [
    'Morning! You would not believe the bus ride I had.',
    'Hello! My cousin said this booth is the fastest.',
  ],
  official: ['Good day. My documents, as required.', 'Papers for inspection.'],
  silent: ['...', 'Hm.'],
}

export const RETURNING_OPENINGS: readonly string[] = [
  'Me again, officer. Same as always.',
  'Good to see you again!',
  'Back for another week.',
  'You remember me, I hope.',
]

export const BACKSTORIES: Record<Purpose, readonly string[]> = {
  visit: [
    'Visits an aunt who runs a bakery.',
    'Comes for a wedding in the family.',
    'Visits an old friend from school.',
    'Brings medicine to a sick grandmother.',
  ],
  work: [
    'Works shifts at a factory and crosses every week.',
    'Starts a new job at the shipyard.',
    'Seasonal worker, back for the harvest.',
  ],
  transit: [
    'Passing through on the way to the coast.',
    'Changes trains on the way home.',
    'Delivers a parcel across the country.',
  ],
}

export const COVER_STORIES: Record<BaseProblemId, readonly string[]> = {
  no_permit: [
    'Visiting a cousin for a few days.',
    'My permit is at the embassy, I was told this is enough.',
  ],
  expired_passport: ['Going to my sister for her birthday.', 'Visiting family, as every spring.'],
  wanted: ['Just visiting friends, nothing more.', 'Business trip, two days.'],
  banned_nationality: ['Visiting my aunt in the capital.', 'I am on my way to a funeral.'],
  wrong_purpose: ['Only a family visit, a few days.', 'Visiting friends, nothing else.'],
  smuggler: ['Visiting family for the holidays.', 'A short trip to the market towns.'],
  missing_health_cert: [
    'I was vaccinated, the certificate is coming.',
    'Visiting my parents for a week.',
  ],
  revoked_document: ['My passport is fine, I use it every month.', 'Visiting my brother.'],
  missing_work_pass: [
    'The work pass is being processed, my employer said.',
    'I start work on Monday.',
  ],
}

export const PERSONA_LINES = {
  discrepancy: [
    'That cannot be right. Check again, please.',
    'Everyone has that, it is nothing.',
    'Is there a problem with my papers?',
  ],
  deep_check: [
    'Is that really necessary?',
    'I have a train to catch, officer.',
    'They never did this before.',
  ],
  before_decision: [
    'Please, think of my family.',
    'I have done everything right.',
    'You will not regret letting me through.',
  ],
  after_approve: ['Thank you, officer!', 'See you next time.', 'You are a good person.'],
  after_deny: ['You will regret this.', 'This is a mistake.', 'I will be back, you know.'],
  first_question: ['Ask me anything.', 'Of course, officer.'],
} as const

export function letterFor(base: BaseProblemId | null, rng: Rng): LetterPlan {
  switch (base) {
    case 'no_permit':
    case 'banned_nationality':
      return rng.pick([
        {
          title: 'Permit Waiver',
          sender: 'Velmark Ministry of Admission',
          body: 'By order of the Ministry, the bearer may enter without an entry permit. The permit will be issued after arrival.',
          claims_exemption: true,
        },
        {
          title: 'Humanitarian Entry',
          sender: 'Velmark Ministry of Admission',
          body: 'The bearer travels for urgent family reasons and is to be admitted without delay.',
          claims_exemption: true,
        },
      ])
    case 'missing_health_cert':
      return {
        title: 'Medical Exemption',
        sender: 'Velmark Health Office',
        body: 'The bearer cannot receive the vaccine for medical reasons and is exempt from the certificate requirement.',
        claims_exemption: true,
      }
    case 'missing_work_pass':
    case 'wrong_purpose':
      return {
        title: 'Employer Confirmation',
        sender: 'Velmark Labour Office',
        body: 'The work pass of the bearer is being processed. Entry is permitted in the meantime.',
        claims_exemption: true,
      }
    case 'smuggler':
      return {
        title: 'Customs Clearance',
        sender: 'Velmark Customs Office',
        body: 'The luggage of the bearer was inspected and sealed in advance. No further search is needed.',
        claims_exemption: true,
      }
    default:
      return {
        title: 'Notice of Exemption',
        sender: 'Velmark Ministry of Admission',
        body: 'The bearer of this letter is exempt from the usual entry requirements by order of the Ministry.',
        claims_exemption: true,
      }
  }
}

// Genuine letters legit travelers sometimes carry
export function honestLetter(rng: Rng): LetterPlan {
  return rng.pick([
    {
      title: 'Invitation',
      sender: 'Halvenburg Music School',
      body: 'We invite the bearer to perform at our spring concert.',
      claims_exemption: false,
    },
    {
      title: 'Doctor Appointment',
      sender: 'Halvenburg General Hospital',
      body: 'The bearer has an appointment at our clinic this week.',
      claims_exemption: false,
    },
    {
      title: 'Letter of Reference',
      sender: 'Kessling Rail Authority',
      body: 'The bearer is known to us as a reliable contractor.',
      claims_exemption: false,
    },
  ])
}
