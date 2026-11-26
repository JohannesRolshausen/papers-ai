// Procedural pixel seals drawn from a SealSpec.
// A forgery differs in exactly one attribute (shape, points, glyph or ring dots), so each of
// them is drawn crisply: solid outline, one inner ring, single-pixel ring dots, an 11x11 glyph.

import type { SealGlyph, SealSpec } from '../../core/seals'

export const SEAL_SIZE = 44

const C = 21.5

const GLYPHS: Record<SealGlyph, string[]> = {
  tower: [
    '..#.#.#.#..',
    '..#######..',
    '...#####...',
    '...##.##...',
    '...#####...',
    '...#####...',
    '...##.##...',
    '...#####...',
    '...#####...',
    '..#######..',
    '.#########.',
  ],
  eye: [
    '...........',
    '...........',
    '...#####...',
    '..#.....#..',
    '.#..###..#.',
    '#..#####..#',
    '.#..###..#.',
    '..#.....#..',
    '...#####...',
    '...........',
    '...........',
  ],
  key: [
    '...###.....',
    '..#...#....',
    '..#...#....',
    '..#...#....',
    '...###.....',
    '....#......',
    '....#......',
    '....###....',
    '....#......',
    '....##.....',
    '....#......',
  ],
  wheel: [
    '...#####...',
    '..##.#.##..',
    '.#.#.#.#.#.',
    '##..###..##',
    '#...#.#...#',
    '#####.#####',
    '#...#.#...#',
    '##..###..##',
    '.#.#.#.#.#.',
    '..##.#.##..',
    '...#####...',
  ],
  crown: [
    '...........',
    '...........',
    '#....#....#',
    '##..###..##',
    '###.###.###',
    '###########',
    '###########',
    '#.#.#.#.#.#',
    '###########',
    '...........',
    '...........',
  ],
  leaf: [
    '........##.',
    '......####.',
    '....#####.#',
    '...#####.##',
    '..#####.###',
    '..####.####',
    '..###.####.',
    '..##.####..',
    '..#.####...',
    '.#.####....',
    '#..........',
  ],
  anchor: [
    '.....#.....',
    '....#.#....',
    '.....#.....',
    '...#####...',
    '.....#.....',
    '.....#.....',
    '#....#....#',
    '##...#...##',
    '.##..#..##.',
    '..#######..',
    '....###....',
  ],
  sun: [
    '.....#.....',
    '.#...#...#.',
    '..#.....#..',
    '....###....',
    '...#####...',
    '##.#####.##',
    '...#####...',
    '....###....',
    '..#.....#..',
    '.#...#...#.',
    '.....#.....',
  ],
  bird: [
    '...........',
    '##.......##',
    '.##.....##.',
    '..##...##..',
    '...##.##...',
    '....###....',
    '...#####...',
    '....###....',
    '.....#.....',
    '....#.#....',
    '...........',
  ],
  scales: [
    '.....#.....',
    '.#########.',
    '.#...#...#.',
    '.#...#...#.',
    '#.#..#..#.#',
    '###..#..###',
    '.....#.....',
    '.....#.....',
    '.....#.....',
    '...#####...',
    '..#######..',
  ],
}

type Point = [number, number]

function polygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] as Point
    const [xj, yj] = points[j] as Point
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function starPoints(points: number, outer: number, inner: number): Point[] {
  const result: Point[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (Math.PI * i) / points
    result.push([C + r * Math.cos(angle), C + r * Math.sin(angle)])
  }
  return result
}

function hexPoints(r: number): Point[] {
  const result: Point[] = []
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / 3
    result.push([C + r * Math.cos(angle), C + r * Math.sin(angle)])
  }
  return result
}

const SHIELD: Point[] = [
  [3, 3],
  [41, 3],
  [41, 22],
  [36, 33],
  [22, 42.5],
  [8, 33],
  [3, 22],
]

interface Layout {
  inside(x: number, y: number): boolean
  dotRadius: number
  centerY: number
}

function layoutFor(spec: SealSpec): Layout {
  switch (spec.shape) {
    case 'round':
      return {
        inside: (x, y) => (x - C) ** 2 + (y - C) ** 2 <= 20.5 ** 2,
        dotRadius: 14.5,
        centerY: C,
      }
    case 'star': {
      const pts = starPoints(Math.max(3, spec.points), 21, spec.points >= 8 ? 15.5 : 14)
      return { inside: (x, y) => polygon(x, y, pts), dotRadius: 10.5, centerY: C }
    }
    case 'shield':
      return { inside: (x, y) => polygon(x, y, SHIELD), dotRadius: 13, centerY: 19.5 }
    case 'hex': {
      const pts = hexPoints(21.5)
      return { inside: (x, y) => polygon(x, y, pts), dotRadius: 13.5, centerY: C }
    }
  }
}

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2147483647, 1274126177)
  h ^= h >>> 13
  return Math.abs(h)
}

function withAlpha(color: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
  return `${color.slice(0, 7)}${a}`
}

export function sealPixels(spec: SealSpec): (string | null)[] {
  const n = SEAL_SIZE
  const layout = layoutFor(spec)
  const mask = new Array<boolean>(n * n).fill(false)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) mask[y * n + x] = layout.inside(x + 0.5, y + 0.5)
  }
  // Distance to the outside in chessboard steps
  const dist = new Array<number>(n * n).fill(0)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mask[y * n + x]) dist[y * n + x] = 99
  for (let pass = 1; pass <= 6; pass++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x
        if ((dist[i] ?? 0) < pass) continue
        let edge = false
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            const d = xx < 0 || yy < 0 || xx >= n || yy >= n ? 0 : (dist[yy * n + xx] ?? 0)
            if (d < pass) {
              edge = true
              break
            }
          }
        }
        if (edge) dist[i] = pass
      }
    }
  }

  const ink = spec.color
  const fill = withAlpha(ink, 0.16)
  const px: (string | null)[] = new Array(n * n).fill(null)
  const salt = spec.authority.length * 31 + spec.glyph.length
  for (let i = 0; i < n * n; i++) {
    const d = dist[i] ?? 0
    if (d === 0) continue
    if (d === 1 || d === 4) px[i] = ink
    else if (hash(i % n, Math.floor(i / n), salt) % 7 !== 0) px[i] = fill
  }

  // Ring dots
  for (let k = 0; k < spec.ringDots; k++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / spec.ringDots
    const x = Math.round(C + layout.dotRadius * Math.cos(angle) - 0.5)
    const y = Math.round(layout.centerY + layout.dotRadius * Math.sin(angle) - 0.5)
    if (x >= 0 && y >= 0 && x < n && y < n) px[y * n + x] = ink
  }

  // Glyph, 11x11 in the middle
  const rows = GLYPHS[spec.glyph]
  const gx = Math.round(C - 5.5)
  const gy = Math.round(layout.centerY - 5.5)
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === '#') px[(gy + dy) * n + gx + dx] = ink
    }
  })
  return px
}

export function drawSeal(canvas: HTMLCanvasElement, spec: SealSpec): void {
  canvas.width = SEAL_SIZE
  canvas.height = SEAL_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, SEAL_SIZE, SEAL_SIZE)
  const px = sealPixels(spec)
  for (let i = 0; i < px.length; i++) {
    const color = px[i]
    if (!color) continue
    ctx.fillStyle = color
    ctx.fillRect(i % SEAL_SIZE, Math.floor(i / SEAL_SIZE), 1, 1)
  }
}

export function sealCanvas(spec: SealSpec, scale = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.className = 'pixel seal'
  drawSeal(canvas, spec)
  canvas.style.width = `${SEAL_SIZE * scale}px`
  canvas.style.height = `${SEAL_SIZE * scale}px`
  return canvas
}
