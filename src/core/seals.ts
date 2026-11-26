// Official seals. The UI draws them procedurally from these specs.
// A forged seal differs from a real one in exactly one visible attribute.

import type { Rng } from './rng'
import type { CountryId } from './world'
import { COUNTRY_IDS } from './world'

export type SealShape = 'round' | 'star' | 'shield' | 'hex'
export type SealGlyph =
  'tower' | 'eye' | 'key' | 'wheel' | 'crown' | 'leaf' | 'anchor' | 'sun' | 'bird' | 'scales'

export const SEAL_SHAPES: readonly SealShape[] = ['round', 'star', 'shield', 'hex']
export const SEAL_GLYPHS: readonly SealGlyph[] = [
  'tower',
  'eye',
  'key',
  'wheel',
  'crown',
  'leaf',
  'anchor',
  'sun',
  'bird',
  'scales',
]
export const RING_DOT_OPTIONS: readonly number[] = [0, 8, 12, 16]

export type AuthorityId = `passport:${CountryId}` | 'ministry' | 'labour' | 'health' | 'civil'

export interface SealSpec {
  authority: AuthorityId
  shape: SealShape
  points: number
  glyph: SealGlyph
  ringDots: number
  color: string
}

export const AUTHORITY_NAMES: Record<AuthorityId, string> = {
  'passport:velmark': 'Velmark Passport Office',
  'passport:drastia': 'Drastian Passport Authority',
  'passport:kelmar': 'Kelmari Passport Directorate',
  'passport:ostrevia': 'Ostrevian Passport Bureau',
  'passport:lunmark': 'Lunmark Passport Office',
  'passport:tarvenne': 'Tarvennois Passport Service',
  ministry: 'Velmark Ministry of Admission',
  labour: 'Velmark Labour Office',
  health: 'Velmark Health Directorate',
  civil: 'Velmark Civil Registry',
}

export function passportAuthority(country: CountryId): AuthorityId {
  return `passport:${country}`
}

export const ALL_AUTHORITIES: readonly AuthorityId[] = [
  ...COUNTRY_IDS.map(passportAuthority),
  'ministry',
  'labour',
  'health',
  'civil',
]

export const BASE_SEALS: Record<AuthorityId, SealSpec> = {
  'passport:velmark': seal('passport:velmark', 'round', 0, 'tower', 12, '#7a2e2e'),
  'passport:drastia': seal('passport:drastia', 'star', 6, 'wheel', 0, '#3e4f7a'),
  'passport:kelmar': seal('passport:kelmar', 'shield', 0, 'anchor', 8, '#2e5a4f'),
  'passport:ostrevia': seal('passport:ostrevia', 'hex', 0, 'sun', 12, '#7a5a2e'),
  'passport:lunmark': seal('passport:lunmark', 'round', 0, 'bird', 16, '#4f3e7a'),
  'passport:tarvenne': seal('passport:tarvenne', 'star', 8, 'leaf', 8, '#5a2e4f'),
  ministry: seal('ministry', 'star', 7, 'eye', 12, '#8a3b1f'),
  labour: seal('labour', 'hex', 0, 'key', 8, '#4a4a2a'),
  health: seal('health', 'round', 0, 'scales', 8, '#2a5a5a'),
  civil: seal('civil', 'shield', 0, 'crown', 12, '#5a3a2a'),
}

function seal(
  authority: AuthorityId,
  shape: SealShape,
  points: number,
  glyph: SealGlyph,
  ringDots: number,
  color: string,
): SealSpec {
  return { authority, shape, points, glyph, ringDots, color }
}

// Color is ignored: ink varies between stamps, the design does not
export function sealsEqual(a: SealSpec, b: SealSpec): boolean {
  return (
    a.authority === b.authority &&
    a.shape === b.shape &&
    a.points === b.points &&
    a.glyph === b.glyph &&
    a.ringDots === b.ringDots
  )
}

export function sealMatchesAny(candidate: SealSpec, valid: readonly SealSpec[]): boolean {
  return valid.some((v) => sealsEqual(candidate, v))
}

export type SealDifference = 'shape' | 'points' | 'glyph' | 'ringDots'

export function sealDifferences(a: SealSpec, b: SealSpec): SealDifference[] {
  const diffs: SealDifference[] = []
  if (a.shape !== b.shape) diffs.push('shape')
  if (a.points !== b.points) diffs.push('points')
  if (a.glyph !== b.glyph) diffs.push('glyph')
  if (a.ringDots !== b.ringDots) diffs.push('ringDots')
  return diffs
}

// A forgery that is wrong in exactly one attribute and matches none of the valid seals
export function forgeSealVariant(
  original: SealSpec,
  rng: Rng,
  valid: readonly SealSpec[] = [original],
): SealSpec {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = mutateSeal(original, rng)
    if (!sealMatchesAny(candidate, valid)) return candidate
  }
  // Fallback: change glyph to one that no valid seal uses
  const usedGlyphs = new Set(valid.map((v) => v.glyph))
  const glyph = SEAL_GLYPHS.find((g) => !usedGlyphs.has(g)) ?? 'eye'
  return { ...original, glyph }
}

function mutateSeal(original: SealSpec, rng: Rng): SealSpec {
  const attribute = rng.pick<SealDifference>(
    original.shape === 'star' ? ['points', 'glyph', 'ringDots'] : ['glyph', 'ringDots', 'shape'],
  )
  switch (attribute) {
    case 'points':
      return { ...original, points: original.points + (rng.chance(0.5) ? 1 : -1) }
    case 'glyph':
      return { ...original, glyph: rng.pick(SEAL_GLYPHS.filter((g) => g !== original.glyph)) }
    case 'ringDots':
      return {
        ...original,
        ringDots: rng.pick(RING_DOT_OPTIONS.filter((d) => d !== original.ringDots)),
      }
    case 'shape': {
      const shape = rng.pick(SEAL_SHAPES.filter((s) => s !== original.shape && s !== 'star'))
      return { ...original, shape }
    }
  }
}

// New official design after a seal rotation. Deterministic per generation.
export function rotatedSeal(original: SealSpec, generation: number): SealSpec {
  if (generation <= 0) return original
  const glyphIndex = SEAL_GLYPHS.indexOf(original.glyph)
  const glyph = SEAL_GLYPHS[(glyphIndex + generation * 3) % SEAL_GLYPHS.length] as SealGlyph
  const ringDots = RING_DOT_OPTIONS[
    (RING_DOT_OPTIONS.indexOf(original.ringDots) + generation) % RING_DOT_OPTIONS.length
  ] as number
  return { ...original, glyph, ringDots }
}
