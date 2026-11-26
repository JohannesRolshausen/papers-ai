// Face descriptions. The UI renders these as pixel portraits.
// Core parts never change for a real person. Style parts (hair, beard, glasses, hat)
// may change between the passport photo and today, which is legal.

import type { Rng } from './rng'

export type Sex = 'M' | 'F'

export interface FaceSpec {
  sex: Sex
  skin: number
  head: number
  eyes: number
  brows: number
  nose: number
  mouth: number
  scar: number
  hair: number
  hairColor: number
  beard: number
  glasses: number
  hat: number
}

export const FACE_RANGES = {
  skin: 6,
  head: 4,
  eyes: 6,
  brows: 4,
  nose: 5,
  mouth: 5,
  scar: 3,
  hair: 8,
  hairColor: 6,
  beard: 4,
  glasses: 3,
  hat: 4,
} as const

export type FacePart = keyof typeof FACE_RANGES

export const CORE_PARTS: readonly FacePart[] = [
  'skin',
  'head',
  'eyes',
  'brows',
  'nose',
  'mouth',
  'scar',
]
export const STYLE_PARTS: readonly FacePart[] = ['hair', 'hairColor', 'beard', 'glasses', 'hat']

// Parts a look-alike may differ in. Skin and head shape would be too obvious.
const LOOKALIKE_PARTS: readonly FacePart[] = ['eyes', 'brows', 'nose', 'mouth']

export function randomFace(rng: Rng, sex: Sex): FaceSpec {
  return {
    sex,
    skin: rng.int(0, FACE_RANGES.skin - 1),
    head: rng.int(0, FACE_RANGES.head - 1),
    eyes: rng.int(0, FACE_RANGES.eyes - 1),
    brows: rng.int(0, FACE_RANGES.brows - 1),
    nose: rng.int(0, FACE_RANGES.nose - 1),
    mouth: rng.int(0, FACE_RANGES.mouth - 1),
    scar: rng.chance(0.15) ? rng.int(1, FACE_RANGES.scar - 1) : 0,
    hair: rng.int(0, FACE_RANGES.hair - 1),
    hairColor: rng.int(0, FACE_RANGES.hairColor - 1),
    beard: sex === 'M' && rng.chance(0.35) ? rng.int(1, FACE_RANGES.beard - 1) : 0,
    glasses: rng.chance(0.2) ? rng.int(1, FACE_RANGES.glasses - 1) : 0,
    hat: 0,
  }
}

export function coreFaceEqual(a: FaceSpec, b: FaceSpec): boolean {
  return a.sex === b.sex && CORE_PARTS.every((part) => a[part] === b[part])
}

export function coreFaceDifferences(a: FaceSpec, b: FaceSpec): FacePart[] {
  return CORE_PARTS.filter((part) => a[part] !== b[part])
}

// Passport photos are taken bare-headed
export function photoOf(face: FaceSpec): FaceSpec {
  return { ...face, hat: 0 }
}

// Everyday variation of a real person: harmless style changes
export function everydayLook(face: FaceSpec, rng: Rng): FaceSpec {
  const look = { ...face }
  if (rng.chance(0.25)) look.hat = rng.int(1, FACE_RANGES.hat - 1)
  if (rng.chance(0.1)) look.glasses = look.glasses === 0 ? 1 : 0
  return look
}

// A disguise changes every style part it can
export function disguise(face: FaceSpec, rng: Rng): FaceSpec {
  const look = { ...face }
  look.hair = (face.hair + rng.int(2, FACE_RANGES.hair - 2)) % FACE_RANGES.hair
  look.hairColor = (face.hairColor + rng.int(1, FACE_RANGES.hairColor - 1)) % FACE_RANGES.hairColor
  look.glasses = face.glasses === 0 ? rng.int(1, FACE_RANGES.glasses - 1) : 0
  look.hat = rng.int(1, FACE_RANGES.hat - 1)
  if (face.sex === 'M') look.beard = face.beard === 0 ? rng.int(1, FACE_RANGES.beard - 1) : 0
  return look
}

// Someone who looks similar: same skin and head, one feature different
export function lookAlike(face: FaceSpec, rng: Rng): FaceSpec {
  const other = { ...face }
  const part = rng.pick(LOOKALIKE_PARTS)
  const range = FACE_RANGES[part]
  other[part] = (face[part] + rng.int(1, range - 1)) % range
  if (rng.chance(0.5)) other.hair = (face.hair + 1) % FACE_RANGES.hair
  return other
}
