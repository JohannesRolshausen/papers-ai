// Static world data: countries, cities, names, employers, items.
// All names are invented for this game.

export type CountryId = 'velmark' | 'drastia' | 'kelmar' | 'ostrevia' | 'lunmark' | 'tarvenne'

export const HOME_COUNTRY: CountryId = 'velmark'

export interface Country {
  id: CountryId
  name: string
  adjective: string
  code: string
  cities: readonly string[]
  given: { M: readonly string[]; F: readonly string[] }
  surnames: readonly string[]
}

export const COUNTRIES: Record<CountryId, Country> = {
  velmark: {
    id: 'velmark',
    name: 'Velmark',
    adjective: 'Velmarkan',
    code: 'VM',
    cities: ['Halvenburg', 'Ostmarch', 'Kessling'],
    given: {
      M: ['Anders', 'Tomas', 'Lukas', 'Matthis', 'Oren', 'Felix', 'Gerold', 'Jannik'],
      F: ['Mira', 'Ilse', 'Hanna', 'Petra', 'Liesl', 'Vera', 'Greta', 'Nele'],
    },
    surnames: ['Halden', 'Brenner', 'Vossberg', 'Kettel', 'Marhold', 'Dremmel', 'Ostrand', 'Wendt'],
  },
  drastia: {
    id: 'drastia',
    name: 'Drastia',
    adjective: 'Drastian',
    code: 'DR',
    cities: ['Dravik', 'Sorna', 'Velec'],
    given: {
      M: ['Dragan', 'Mirko', 'Stanek', 'Boris', 'Zoran', 'Ivo', 'Tadej', 'Milan'],
      F: ['Jelena', 'Daria', 'Nadja', 'Vesna', 'Mila', 'Zora', 'Katja', 'Lena'],
    },
    surnames: ['Kovar', 'Dresnik', 'Valek', 'Moravic', 'Strohan', 'Pelich', 'Brankov', 'Sudec'],
  },
  kelmar: {
    id: 'kelmar',
    name: 'Kelmar',
    adjective: 'Kelmari',
    code: 'KM',
    cities: ['Kelholm', 'Ardvik', 'Stenmark'],
    given: {
      M: ['Arvid', 'Henrik', 'Sten', 'Joakim', 'Leif', 'Torben', 'Ulrik', 'Espen'],
      F: ['Liv', 'Sigrun', 'Maren', 'Tove', 'Ingrid', 'Solveig', 'Ylva', 'Hedda'],
    },
    surnames: ['Kjelmar', 'Aasen', 'Lund', 'Brekk', 'Ronning', 'Hval', 'Strand', 'Ekdal'],
  },
  ostrevia: {
    id: 'ostrevia',
    name: 'Ostrevia',
    adjective: 'Ostrevian',
    code: 'OS',
    cities: ['Ostrevan', 'Bresu', 'Calina'],
    given: {
      M: ['Andrei', 'Matei', 'Sorin', 'Radu', 'Codrin', 'Tudor', 'Vasile', 'Emil'],
      F: ['Ilinca', 'Oana', 'Irina', 'Corina', 'Sanda', 'Dora', 'Livia', 'Anca'],
    },
    surnames: ['Ostrescu', 'Vadu', 'Petrin', 'Lazar', 'Dumitran', 'Coman', 'Varga', 'Iliescu'],
  },
  lunmark: {
    id: 'lunmark',
    name: 'Lunmark',
    adjective: 'Lunmarker',
    code: 'LM',
    cities: ['Lunby', 'Marrow', 'Eskeld'],
    given: {
      M: ['Elias', 'Jonas', 'Teodor', 'Niklas', 'Viggo', 'Albin', 'Hugo', 'Malte'],
      F: ['Selma', 'Ronja', 'Alva', 'Freja', 'Elsa', 'Wilma', 'Saga', 'Edit'],
    },
    surnames: ['Lunde', 'Marsk', 'Holm', 'Varg', 'Elling', 'Sorn', 'Dahl', 'Fjell'],
  },
  tarvenne: {
    id: 'tarvenne',
    name: 'Tarvenne',
    adjective: 'Tarvennois',
    code: 'TV',
    cities: ['Tarvel', 'Montaine', 'Silvere'],
    given: {
      M: ['Luc', 'Mathis', 'Remy', 'Bastien', 'Gaspard', 'Theo', 'Armand', 'Noel'],
      F: ['Celine', 'Odile', 'Mireille', 'Anouk', 'Margaux', 'Lise', 'Agathe', 'Ines'],
    },
    surnames: ['Tarvel', 'Duvenne', 'Marchal', 'Roux', 'Lefevre', 'Garnier', 'Brissac', 'Vautrin'],
  },
}

export const COUNTRY_IDS: readonly CountryId[] = [
  'velmark',
  'drastia',
  'kelmar',
  'ostrevia',
  'lunmark',
  'tarvenne',
]

export const FOREIGN_COUNTRY_IDS: readonly CountryId[] = COUNTRY_IDS.filter(
  (id) => id !== HOME_COUNTRY,
)

// Cities that belong to no country. Forgers sometimes print these.
export const FAKE_CITIES: readonly string[] = [
  'Grauheim',
  'Polvar',
  'Nordesk',
  'Vintra',
  'Belcastra',
]

export const VELMARK_DISTRICTS: readonly string[] = [
  'North Halven',
  'Riverside',
  'Old Kessling',
  'Ostmarch Plains',
  'Greywater',
]

export const FAKE_DISTRICTS: readonly string[] = ['South Halven', 'Kessling Heights', 'Lowmarch']

export interface Employer {
  name: string
  field: string
  tools: string
}

export const EMPLOYERS: readonly Employer[] = [
  { name: 'Halden Steelworks', field: 'Welding', tools: 'welding kit' },
  { name: 'Kessling Rail Authority', field: 'Rail maintenance', tools: 'rail track gauges' },
  { name: 'Ostmarch Textile Mill', field: 'Textiles', tools: 'industrial sewing parts' },
  { name: 'Greywater Shipyards', field: 'Shipbuilding', tools: 'rivet gun' },
  { name: 'Velmark Grain Board', field: 'Agriculture', tools: 'seed sampling kit' },
  { name: 'Halvenburg General Hospital', field: 'Nursing', tools: 'medical bag' },
]

export const OCCUPATIONS: readonly string[] = [
  'Teacher',
  'Accountant',
  'Farmer',
  'Clerk',
  'Mechanic',
  'Retired',
  'Student',
  'Shopkeeper',
  'Musician',
  'Driver',
]

export const CONTRABAND: readonly string[] = [
  'unregistered pistol',
  'twelve packets of narcotics',
  'counterfeit banknotes',
  'undeclared radio transmitter',
  'smuggled medication crates',
]

export const COMMON_LUGGAGE: readonly string[] = [
  'suitcase',
  'backpack',
  'duffel bag',
  'briefcase',
  'shopping bag',
  'small rucksack',
]

export const VACCINES: readonly string[] = ['MF-3', 'RK-12', 'TV-5']

export const REQUIRED_VACCINE = 'MF-3'

export const CLINIC_CITIES: readonly string[] = ['Halvenburg', 'Ostmarch', 'Kessling']

export function countryName(id: CountryId): string {
  return COUNTRIES[id].name
}

export function isCountryId(value: string): value is CountryId {
  return (COUNTRY_IDS as readonly string[]).includes(value)
}
