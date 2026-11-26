// The renderers must show every attribute the engine compares. These tests run without a DOM.

import { describe, expect, it } from 'vitest'
import type { FacePart, FaceSpec } from '../src/core/faces'
import { CORE_PARTS, FACE_RANGES, STYLE_PARTS, photoOf, randomFace } from '../src/core/faces'
import { rngFor } from '../src/core/rng'
import type { SealSpec } from '../src/core/seals'
import {
  ALL_AUTHORITIES,
  BASE_SEALS,
  RING_DOT_OPTIONS,
  SEAL_GLYPHS,
  SEAL_SHAPES,
  forgeSealVariant,
} from '../src/core/seals'
import { PHOTO_BG, portraitPixels } from '../src/ui/components/portrait'
import { sealPixels } from '../src/ui/components/seal'

function same(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

function withStyle(face: FaceSpec, style: Partial<FaceSpec>): FaceSpec {
  return { ...face, ...style }
}

describe('portrait renderer', () => {
  it('draws every value of every part differently', () => {
    const rng = rngFor(11, 'render-parts')
    for (let n = 0; n < 40; n++) {
      const base = randomFace(rng, n % 2 === 0 ? 'M' : 'F')
      for (const part of Object.keys(FACE_RANGES) as FacePart[]) {
        // A bald, beardless face shows no hair color
        if (part === 'hairColor' && base.hair === 0 && base.beard === 0) continue
        const seen: (string | null)[][] = []
        for (let v = 0; v < FACE_RANGES[part]; v++) {
          const px = portraitPixels({ ...base, [part]: v })
          for (const other of seen) expect(same(px, other)).toBe(false)
          seen.push(px)
        }
      }
    }
  })

  it('keeps core differences visible under any style, live and as a sepia photo', () => {
    const rng = rngFor(12, 'render-core')
    let cases = 0
    for (let n = 0; n < 1500; n++) {
      const base = randomFace(rng, rng.chance(0.5) ? 'M' : 'F')
      const part = rng.pick(CORE_PARTS)
      const range = FACE_RANGES[part as keyof typeof FACE_RANGES]
      const other = { ...base, [part]: (base[part] + rng.int(1, range - 1)) % range }
      const style: Partial<FaceSpec> = {}
      for (const s of STYLE_PARTS) {
        ;(style as Record<string, number>)[s] = rng.int(0, FACE_RANGES[s] - 1)
      }
      // Live face with any style against a photo-styled version of the other face
      const live = portraitPixels(withStyle(base, style))
      const liveOther = portraitPixels(withStyle(other, style))
      expect(same(live, liveOther)).toBe(false)
      const photo = portraitPixels(photoOf(withStyle(base, style)), {
        sepia: true,
        background: PHOTO_BG,
      })
      const photoOther = portraitPixels(photoOf(withStyle(other, style)), {
        sepia: true,
        background: PHOTO_BG,
      })
      expect(same(photo, photoOther)).toBe(false)
      cases++
    }
    expect(cases).toBe(1500)
  })

  it('never lets a style part paint over the pixels of a core part', () => {
    const rng = rngFor(13, 'render-cover')
    for (let n = 0; n < 300; n++) {
      const base = randomFace(rng, rng.chance(0.5) ? 'M' : 'F')
      const part = rng.pick(CORE_PARTS)
      const range = FACE_RANGES[part as keyof typeof FACE_RANGES]
      const other = { ...base, [part]: (base[part] + rng.int(1, range - 1)) % range }
      // Pixels where the bare faces differ are the visible core feature
      const bareA = portraitPixels({ ...base, hair: 0, beard: 0, glasses: 0, hat: 0 })
      const bareB = portraitPixels({ ...other, hair: 0, beard: 0, glasses: 0, hat: 0 })
      const featurePixels = bareA
        .map((p, i) => (p !== bareB[i] ? i : -1))
        .filter((i) => i >= 0 && i < 32 * 30)
      const styled: FaceSpec = {
        ...base,
        hair: rng.int(0, FACE_RANGES.hair - 1),
        beard: rng.int(0, FACE_RANGES.beard - 1),
        glasses: rng.int(0, FACE_RANGES.glasses - 1),
        hat: rng.int(0, FACE_RANGES.hat - 1),
      }
      const styledPx = portraitPixels(styled)
      // Skin color changes everything, so only shape parts are checked pixel by pixel
      if (part === 'skin' || part === 'head') continue
      for (const i of featurePixels) expect(styledPx[i]).toBe(bareA[i])
    }
  })
})

describe('seal renderer', () => {
  it('shows every single-attribute change', () => {
    for (const authority of ALL_AUTHORITIES) {
      const spec = BASE_SEALS[authority]
      const base = sealPixels(spec)
      const variants: SealSpec[] = [
        ...SEAL_GLYPHS.filter((g) => g !== spec.glyph).map((glyph) => ({ ...spec, glyph })),
        ...RING_DOT_OPTIONS.filter((d) => d !== spec.ringDots).map((ringDots) => ({
          ...spec,
          ringDots,
        })),
        ...SEAL_SHAPES.filter((s) => s !== spec.shape && s !== 'star').map((shape) => ({
          ...spec,
          shape,
        })),
      ]
      if (spec.shape === 'star') {
        variants.push({ ...spec, points: spec.points + 1 }, { ...spec, points: spec.points - 1 })
      }
      for (const variant of variants) expect(same(base, sealPixels(variant))).toBe(false)
    }
  })

  it('shows the forgeries the engine produces', () => {
    const rng = rngFor(21, 'render-forge')
    for (let n = 0; n < 200; n++) {
      const spec = BASE_SEALS[rng.pick(ALL_AUTHORITIES)]
      const forged = forgeSealVariant(spec, rng)
      expect(same(sealPixels(spec), sealPixels(forged))).toBe(false)
    }
  })

  it('ignores ink color for the design but keeps the same layout', () => {
    const spec = BASE_SEALS.ministry
    const a = sealPixels(spec).map((p) => p !== null)
    const b = sealPixels({ ...spec, color: '#123456' }).map((p) => p !== null)
    expect(a).toEqual(b)
  })
})
