// Development page under ?gallery: every face part and every seal attribute side by side,
// to check that each variant is clearly distinguishable.

import '../ui/styles.css'
import type { FacePart, FaceSpec } from '../core/faces'
import { FACE_RANGES, photoOf, randomFace } from '../core/faces'
import { rngFor } from '../core/rng'
import type { SealSpec } from '../core/seals'
import { ALL_AUTHORITIES, AUTHORITY_NAMES, BASE_SEALS, SEAL_GLYPHS } from '../core/seals'
import { portraitCanvas } from '../ui/components/portrait'
import { sealCanvas } from '../ui/components/seal'
import { el } from '../ui/dom'

const BASE: FaceSpec = {
  sex: 'M',
  skin: 1,
  head: 0,
  eyes: 0,
  brows: 0,
  nose: 0,
  mouth: 0,
  scar: 0,
  hair: 1,
  hairColor: 1,
  beard: 0,
  glasses: 0,
  hat: 0,
}

function partRow(part: FacePart, base: FaceSpec): HTMLElement {
  const cells: HTMLElement[] = []
  for (let v = 0; v < FACE_RANGES[part]; v++) {
    const face = { ...base, [part]: v }
    cells.push(
      el(
        'figure',
        { className: 'gallery-cell' },
        portraitCanvas(face, 3, { coat: v }),
        portraitCanvas(photoOf(face), 2, { sepia: true, background: '#efe9dc' }),
        el('figcaption', { text: `${part} ${v}` }),
      ),
    )
  }
  return el('div', { className: 'gallery-row' }, ...cells)
}

export function mountGallery(): void {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) return
  document.documentElement.classList.add('gallery-page')
  document.body.classList.add('gallery-page')
  const parts = Object.keys(FACE_RANGES) as FacePart[]
  const rows = parts.map((p) => partRow(p, p === 'beard' ? BASE : { ...BASE, sex: 'F' }))
  // Full beard, curls and glasses combined must still show every core part
  const busy: FaceSpec = { ...BASE, beard: 3, hair: 4, glasses: 2, hat: 2, hairColor: 0 }
  rows.push(partRow('mouth', busy), partRow('eyes', busy), partRow('brows', busy))

  const rng = rngFor(7, 'gallery')
  const randoms = Array.from({ length: 16 }, (_, i) => {
    const face = randomFace(rng, i % 2 === 0 ? 'M' : 'F')
    return el(
      'figure',
      { className: 'gallery-cell' },
      portraitCanvas(face, 3, { coat: i }),
      portraitCanvas(photoOf(face), 2, { sepia: true, background: '#efe9dc' }),
    )
  })

  const seals = ALL_AUTHORITIES.map((authority) => {
    const spec = BASE_SEALS[authority]
    const variants: SealSpec[] = [spec]
    if (spec.shape === 'star') variants.push({ ...spec, points: spec.points + 1 })
    variants.push({ ...spec, ringDots: spec.ringDots === 16 ? 8 : spec.ringDots + 4 })
    variants.push({ ...spec, glyph: SEAL_GLYPHS[(SEAL_GLYPHS.indexOf(spec.glyph) + 1) % 10]! })
    return el(
      'div',
      { className: 'gallery-row' },
      el('span', { className: 'gallery-label', text: AUTHORITY_NAMES[authority] }),
      ...variants.map((v) => sealCanvas(v, 2)),
    )
  })

  root.append(
    el('h1', { text: 'Portrait and seal gallery' }),
    ...rows,
    el('div', { className: 'gallery-row' }, ...randoms),
    ...seals,
  )
}
