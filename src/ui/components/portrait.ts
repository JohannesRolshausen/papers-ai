// Pixel portraits, 32x40, drawn from a FaceSpec.
// Every core part (skin, head, eyes, brows, nose, mouth, scar) has its own clearly different
// pattern, so look-alikes and borrowed identities can be spotted by comparing with the photo.
// Style parts never cover a core part: glasses are open frames, the mouth is drawn over beards
// and hats end above the brows.

import type { FaceSpec } from '../../core/faces'

// Photo backdrop: between light and dark skin tones, so every face stands out from it
export const PHOTO_BG = '#80888c'

export const PORTRAIT_W = 32
export const PORTRAIT_H = 40

const SKIN = ['#f0d2b2', '#dfb48b', '#c89366', '#a7714a', '#7c5236', '#583a27']
const SKIN_SHADE = ['#d4ab86', '#c08f66', '#a6734a', '#865637', '#5f3d27', '#40291b']
const HAIR = ['#1d1815', '#3b2a1e', '#6a4a2c', '#9c5f2e', '#c4a35c', '#8c8a86']
const HAIR_LIGHT = ['#3a312b', '#55402f', '#87633e', '#bb7a41', '#dcc07c', '#aeaca7']
const COATS = ['#4a5560', '#5b4a3a', '#3f4f3f', '#5a3f45', '#4a4a5a', '#6a5a3c']
const BROW = '#2a1d15'
const EYE = '#1a1410'
const LIP = '#8a4a40'
const LIP_DARK = '#5e2e28'
const FRAME = '#1f1f24'
const WHITE = '#f4efe6'

type Pixels = (string | null)[]

class Canvas {
  readonly px: Pixels = new Array(PORTRAIT_W * PORTRAIT_H).fill(null)
  set(x: number, y: number, color: string | null): void {
    if (x < 0 || y < 0 || x >= PORTRAIT_W || y >= PORTRAIT_H) return
    this.px[y * PORTRAIT_W + x] = color
  }
  get(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= PORTRAIT_W || y >= PORTRAIT_H) return null
    return this.px[y * PORTRAIT_W + x] ?? null
  }
  row(y: number, x0: number, x1: number, color: string): void {
    for (let x = x0; x <= x1; x++) this.set(x, y, color)
  }
  // Mirror a pixel around the vertical center line (between columns 15 and 16)
  pair(x: number, y: number, color: string): void {
    this.set(x, y, color)
    this.set(31 - x, y, color)
  }
}

// ---------- Head shapes ----------

interface HeadShape {
  top: number
  bottom: number
  // Half width per row: the head covers columns 16-hw .. 15+hw
  halfWidth(y: number): number
}

function ellipse(top: number, bottom: number, a: number): (y: number) => number {
  const cy = (top + bottom) / 2
  const b = (bottom - top) / 2 + 0.5
  return (y) => {
    const t = (y - cy) / b
    return Math.max(0, Math.round(a * Math.sqrt(Math.max(0, 1 - t * t)) + 0.2))
  }
}

const HEADS: HeadShape[] = [
  // 0 round
  { top: 7, bottom: 28, halfWidth: ellipse(7, 28, 8.4) },
  // 1 long and narrow
  { top: 5, bottom: 29, halfWidth: ellipse(5, 29, 7) },
  // 2 square with a wide jaw
  {
    top: 7,
    bottom: 28,
    halfWidth: (y) => {
      if (y === 7) return 6
      if (y === 8) return 8
      if (y === 27) return 7
      if (y === 28) return 5
      return 9
    },
  },
  // 3 broad forehead, pointed chin
  {
    top: 7,
    bottom: 29,
    halfWidth: (y) => {
      if (y < 18) return ellipse(7, 29, 8.6)(Math.min(y, 18))
      return Math.max(2, Math.round(8.6 - (y - 18) * 0.62))
    },
  },
]

function headMask(shape: HeadShape): boolean[] {
  const mask = new Array(PORTRAIT_W * PORTRAIT_H).fill(false)
  for (let y = shape.top; y <= shape.bottom; y++) {
    const hw = shape.halfWidth(y)
    for (let x = 16 - hw; x <= 15 + hw; x++) mask[y * PORTRAIT_W + x] = true
  }
  return mask
}

function inMask(mask: boolean[], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= PORTRAIT_W || y >= PORTRAIT_H) return false
  return mask[y * PORTRAIT_W + x] === true
}

// ---------- Parts ----------

function drawBody(c: Canvas, face: FaceSpec, skin: string, shade: string, coat: string): void {
  // Neck
  for (let y = 27; y <= 32; y++) c.row(y, 13, 18, y < 30 ? shade : skin)
  // Shoulders
  for (let y = 31; y < PORTRAIT_H; y++) {
    const hw = Math.min(15, 8 + (y - 31) * 2)
    c.row(y, 16 - hw, 15 + hw, coat)
  }
  // Collar: open shirt for M, round neckline for F
  if (face.sex === 'M') {
    for (let y = 31; y <= 35; y++) {
      const w = 35 - y
      c.row(y, 16 - Math.max(0, w - 1), 15 + Math.max(0, w - 1), y < 33 ? skin : WHITE)
    }
    c.pair(13, 31, WHITE)
    c.pair(14, 32, WHITE)
  } else {
    c.row(31, 12, 19, skin)
    c.row(32, 13, 18, skin)
    c.row(33, 14, 17, shade)
    c.pair(11, 31, WHITE)
    c.pair(12, 32, WHITE)
  }
}

function drawHead(c: Canvas, mask: boolean[], skin: string, shade: string): void {
  for (let y = 0; y < PORTRAIT_H; y++) {
    for (let x = 0; x < PORTRAIT_W; x++) {
      if (!inMask(mask, x, y)) continue
      const edge =
        !inMask(mask, x - 1, y) ||
        !inMask(mask, x + 1, y) ||
        !inMask(mask, x, y - 1) ||
        !inMask(mask, x, y + 1)
      c.set(x, y, edge ? shade : skin)
    }
  }
}

function drawEars(c: Canvas, shape: HeadShape, skin: string, shade: string): void {
  for (let y = 15; y <= 18; y++) {
    const hw = shape.halfWidth(y)
    c.set(16 - hw - 1, y, y === 15 || y === 18 ? shade : skin)
    c.set(15 + hw + 1, y, y === 15 || y === 18 ? shade : skin)
  }
}

// Rows 10 to 12, columns 10 to 14 on each side
function drawBrows(c: Canvas, type: number): void {
  switch (type) {
    case 0: // thin and straight
      for (const x of [10, 11, 12, 13]) c.pair(x, 12, BROW)
      break
    case 1: // thick block
      for (const x of [10, 11, 12, 13]) {
        c.pair(x, 11, BROW)
        c.pair(x, 12, BROW)
      }
      break
    case 2: // slanted down toward the nose
      c.pair(10, 10, BROW)
      c.pair(11, 11, BROW)
      c.pair(12, 11, BROW)
      c.pair(13, 12, BROW)
      c.pair(14, 12, BROW)
      break
    default: // high arch
      c.pair(10, 12, BROW)
      c.pair(11, 11, BROW)
      c.pair(12, 10, BROW)
      c.pair(13, 10, BROW)
      c.pair(14, 11, BROW)
      break
  }
}

// Rows 14 to 17, columns 10 to 13 on each side, inside any glasses frame
function drawEyes(c: Canvas, type: number, shade: string): void {
  switch (type) {
    case 0: // small dots
      c.pair(12, 15, EYE)
      break
    case 1: // white with pupil toward the nose
      c.pair(11, 15, WHITE)
      c.pair(12, 15, EYE)
      c.pair(13, 15, WHITE)
      break
    case 2: // narrow slits
      c.pair(10, 15, EYE)
      c.pair(11, 15, EYE)
      c.pair(12, 15, EYE)
      c.pair(13, 15, EYE)
      break
    case 3: // big round eyes
      c.pair(11, 14, EYE)
      c.pair(12, 14, EYE)
      c.pair(11, 15, EYE)
      c.pair(12, 15, WHITE)
      c.pair(11, 16, EYE)
      c.pair(12, 16, EYE)
      break
    case 4: // tired, with heavy lower lids
      c.pair(11, 15, EYE)
      c.pair(12, 15, EYE)
      c.pair(10, 16, shade)
      c.pair(11, 16, shade)
      c.pair(12, 16, shade)
      c.pair(13, 16, shade)
      break
    default: // low, looking sideways
      c.pair(10, 17, EYE)
      c.pair(11, 17, EYE)
      c.pair(12, 17, WHITE)
      break
  }
}

function drawNose(c: Canvas, type: number, shade: string): void {
  switch (type) {
    case 0: // small nostrils only
      c.set(15, 20, shade)
      c.set(16, 20, shade)
      break
    case 1: // long straight ridge
      for (let y = 16; y <= 20; y++) c.set(16, y, shade)
      c.set(15, 21, shade)
      c.set(16, 21, shade)
      break
    case 2: // wide
      c.set(16, 18, shade)
      c.set(16, 19, shade)
      c.row(20, 13, 18, shade)
      c.set(13, 19, shade)
      c.set(18, 19, shade)
      break
    case 3: // hooked, the bend below the glasses line
      c.set(15, 16, shade)
      c.set(16, 17, shade)
      c.set(16, 18, shade)
      c.set(17, 19, shade)
      c.set(17, 20, shade)
      c.set(16, 21, shade)
      c.set(15, 21, shade)
      break
    default: // round button
      c.set(15, 19, shade)
      c.set(16, 19, shade)
      c.set(14, 20, shade)
      c.set(17, 20, shade)
      c.set(15, 20, WHITE)
      break
  }
}

function drawMouth(c: Canvas, type: number): void {
  switch (type) {
    case 0: // straight line
      c.row(24, 13, 18, LIP_DARK)
      break
    case 1: // smile
      c.set(12, 23, LIP_DARK)
      c.set(19, 23, LIP_DARK)
      c.row(24, 13, 18, LIP_DARK)
      c.row(25, 14, 17, LIP)
      break
    case 2: // frown
      c.row(23, 14, 17, LIP_DARK)
      c.set(13, 24, LIP_DARK)
      c.set(18, 24, LIP_DARK)
      c.set(12, 25, LIP_DARK)
      c.set(19, 25, LIP_DARK)
      break
    case 3: // full lips
      c.row(23, 13, 18, LIP)
      c.row(24, 12, 19, LIP_DARK)
      c.row(25, 13, 18, LIP)
      break
    default: // small, open
      c.set(15, 23, LIP_DARK)
      c.set(16, 23, LIP_DARK)
      c.set(15, 24, EYE)
      c.set(16, 24, EYE)
      c.set(15, 25, LIP)
      c.set(16, 25, LIP)
      break
  }
}

// Below the glasses line (row 19 and lower). Dark on light skin, light on dark skin.
function drawScar(c: Canvas, type: number, skinIndex: number): void {
  const SCAR = skinIndex <= 2 ? '#9c4a40' : '#e4ab9a'
  if (type === 1) {
    // Diagonal across the left cheek
    c.set(9, 19, SCAR)
    c.set(10, 20, SCAR)
    c.set(11, 21, SCAR)
    c.set(12, 22, SCAR)
  } else if (type === 2) {
    // Vertical with a cross stitch on the right cheek
    for (let y = 19; y <= 22; y++) c.set(21, y, SCAR)
    c.set(20, 20, SCAR)
    c.set(22, 20, SCAR)
  }
}

// Every pixel any core part can use. Hair and beards leave these pixels bare, so a core
// feature always sits on skin and a difference between two faces is never hidden by style.
let keepOutCache: boolean[] | null = null

function coreKeepOut(): boolean[] {
  if (keepOutCache) return keepOutCache
  const c = new Canvas()
  for (let t = 0; t < 4; t++) drawBrows(c, t)
  for (let t = 0; t < 6; t++) drawEyes(c, t, '#000000')
  for (let t = 0; t < 5; t++) drawNose(c, t, '#000000')
  for (let y = 23; y <= 25; y++) c.row(y, 12, 19, '#000000')
  drawScar(c, 1, 0)
  drawScar(c, 2, 0)
  keepOutCache = c.px.map((p) => p !== null)
  return keepOutCache
}

function drawBeard(c: Canvas, type: number, mask: boolean[], color: string): void {
  if (type === 0) return
  if (type === 1) {
    // Stubble: dotted jaw
    for (let y = 21; y < PORTRAIT_H; y++) {
      for (let x = 0; x < PORTRAIT_W; x++) {
        if (!inMask(mask, x, y)) continue
        if ((x + y) % 2 === 0 && (y >= 25 || x <= 11 || x >= 20)) c.set(x, y, color)
      }
    }
    return
  }
  if (type === 2) {
    // Moustache
    c.row(22, 12, 19, color)
    c.set(11, 22, color)
    c.set(20, 22, color)
    return
  }
  // Full beard along the jaw, mouth stays visible because it is drawn afterwards
  for (let y = 20; y < PORTRAIT_H; y++) {
    for (let x = 0; x < PORTRAIT_W; x++) {
      if (!inMask(mask, x, y)) continue
      if (y >= 22 || x <= 10 || x >= 21) c.set(x, y, color)
    }
  }
  c.row(22, 12, 19, color)
}

function drawHair(
  c: Canvas,
  style: number,
  shape: HeadShape,
  mask: boolean[],
  color: string,
  light: string,
): void {
  const top = shape.top
  // Hair on the head never reaches the brows (row 10)
  const capTo = (rowEnd: number) => {
    for (let y = top; y <= Math.min(rowEnd, 9); y++) {
      for (let x = 0; x < PORTRAIT_W; x++) if (inMask(mask, x, y)) c.set(x, y, color)
    }
  }
  const sides = (from: number, to: number, width: number) => {
    for (let y = from; y <= to; y++) {
      const hw = shape.halfWidth(y)
      for (let i = 0; i < width; i++) {
        c.set(16 - hw + i, y, color)
        c.set(15 + hw - i, y, color)
      }
    }
  }
  switch (style) {
    case 0: // bald, with a shine
      c.set(12, top + 2, '#ffffff33')
      break
    case 1: // short crop
      capTo(top + 3)
      sides(top + 4, 13, 1)
      break
    case 2: // side part with a fringe
      capTo(top + 3)
      sides(top + 4, 14, 1)
      c.row(Math.min(top + 4, 9), 16, 24, color)
      c.set(12, top + 1, light)
      c.set(12, top + 2, light)
      break
    case 3: {
      // long, falling past the shoulders
      capTo(top + 3)
      for (let y = top + 2; y <= 33; y++) {
        const hw = y <= shape.bottom ? shape.halfWidth(Math.min(y, 18)) : 9
        for (let i = 0; i < 3; i++) {
          c.set(16 - hw - i, y, color)
          c.set(15 + hw + i, y, color)
        }
        c.set(16 - hw, y, color)
        c.set(15 + hw, y, color)
      }
      break
    }
    case 4: {
      // big curls
      for (let y = top - 3; y <= 13; y++) {
        const t = (y - (top + 3)) / 8
        const hw = Math.round(11 * Math.sqrt(Math.max(0, 1 - t * t)))
        for (let x = 16 - hw; x <= 15 + hw; x++) {
          if (y >= 10 && inMask(mask, x, y) && x > 8 && x < 23) continue
          c.set(x, y, (x * 3 + y * 5) % 7 === 0 ? light : color)
        }
      }
      break
    }
    case 5: // spikes
      capTo(top + 2)
      sides(top + 3, 12, 1)
      for (let x = 9; x <= 22; x += 2) {
        c.set(x, top - 1, color)
        c.set(x + (x % 4 === 1 ? 0 : 1), top - 2, color)
      }
      break
    case 6: // bun on top
      capTo(top + 3)
      sides(top + 4, 14, 1)
      for (let y = top - 4; y <= top - 1; y++) c.row(y, 13, 18, color)
      c.set(13, top - 4, null)
      c.set(18, top - 4, null)
      c.set(15, top - 3, light)
      break
    default: // receding, only the sides remain
      sides(top + 4, 16, 1)
      c.set(16 - shape.halfWidth(top + 4), top + 4, color)
      c.set(15 + shape.halfWidth(top + 4), top + 4, color)
      break
  }
}

// Open frames on rows 13 to 18, around the eye area and never over it
function drawGlassesFrames(c: Canvas, type: number): void {
  if (type === 0) return
  if (type === 1) {
    // Round wire frames
    for (const x of [10, 11, 12, 13]) {
      c.pair(x, 13, FRAME)
      c.pair(x, 18, FRAME)
    }
    for (const y of [14, 15, 16, 17]) {
      c.pair(9, y, FRAME)
      c.pair(14, y, FRAME)
    }
    c.row(14, 15, 16, FRAME)
    return
  }
  // Heavy square frames
  for (let x = 8; x <= 14; x++) {
    c.pair(x, 13, FRAME)
    c.pair(x, 18, FRAME)
  }
  for (let y = 13; y <= 18; y++) {
    c.pair(8, y, FRAME)
    c.pair(14, y, FRAME)
  }
  c.row(15, 15, 16, FRAME)
  c.pair(7, 14, FRAME)
}

function drawHat(c: Canvas, type: number, coat: string): void {
  if (type === 0) return
  const dark = '#2b2a2e'
  // Hats end on row 9, above the brows
  if (type === 1) {
    // Flat cap with a brim to the left
    for (let y = 4; y <= 8; y++) c.row(y, 8, 23, coat)
    c.row(3, 10, 21, coat)
    c.row(9, 3, 23, dark)
    return
  }
  if (type === 2) {
    // Brimmed hat with a band
    for (let y = 0; y <= 7; y++) c.row(y, 9, 22, dark)
    c.row(6, 9, 22, '#7a3b2b')
    c.row(8, 4, 27, dark)
    c.row(9, 6, 25, dark)
    return
  }
  // Knit beanie with a pompom
  for (let y = 3; y <= 7; y++) c.row(y, 8, 23, '#6b2f2f')
  c.row(2, 10, 21, '#6b2f2f')
  for (let x = 8; x <= 23; x += 2) c.set(x, 5, '#843b3b')
  c.row(8, 7, 24, '#4e2222')
  c.row(9, 7, 24, '#4e2222')
  c.row(0, 15, 16, '#d8cfc0')
  c.row(1, 14, 17, '#d8cfc0')
}

// ---------- Public API ----------

export interface PortraitOptions {
  sepia?: boolean
  coat?: number
  background?: string | null
}

export function portraitPixels(face: FaceSpec, options: PortraitOptions = {}): Pixels {
  const c = new Canvas()
  const shape = HEADS[face.head % HEADS.length] as HeadShape
  const mask = headMask(shape)
  const skin = SKIN[face.skin % SKIN.length] as string
  const shade = SKIN_SHADE[face.skin % SKIN_SHADE.length] as string
  const hair = HAIR[face.hairColor % HAIR.length] as string
  const hairLight = HAIR_LIGHT[face.hairColor % HAIR_LIGHT.length] as string
  const coat = COATS[(options.coat ?? 0) % COATS.length] as string

  // Long hair falls behind the head and shoulders
  if (face.hair === 3) drawHair(c, 3, shape, mask, hair, hairLight)
  drawBody(c, face, skin, shade, coat)
  drawEars(c, shape, skin, shade)
  drawHead(c, mask, skin, shade)
  // Style parts first, then the core area is cleared back to bare skin, then core features
  const bare = [...c.px]
  drawBeard(c, face.beard, mask, hair)
  drawHair(c, face.hair === 3 ? 1 : face.hair, shape, mask, hair, hairLight)
  const keepOut = coreKeepOut()
  for (let i = 0; i < keepOut.length; i++) if (keepOut[i]) c.px[i] = bare[i] ?? null
  drawBrows(c, face.brows)
  drawEyes(c, face.eyes, darken(shade, 0.85))
  drawNose(c, face.nose, darken(shade, 0.78))
  drawScar(c, face.scar, face.skin % SKIN.length)
  drawMouth(c, face.mouth)
  drawGlassesFrames(c, face.glasses)
  drawHat(c, face.hat, coat)

  let px = c.px
  if (options.background) {
    px = px.map((p) => p ?? (options.background as string))
  }
  if (options.sepia) px = px.map((p) => (p ? sepia(p) : p))
  return px
}

export function drawPortrait(
  canvas: HTMLCanvasElement,
  face: FaceSpec,
  options: PortraitOptions = {},
): void {
  canvas.width = PORTRAIT_W
  canvas.height = PORTRAIT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, PORTRAIT_W, PORTRAIT_H)
  const px = portraitPixels(face, options)
  for (let y = 0; y < PORTRAIT_H; y++) {
    for (let x = 0; x < PORTRAIT_W; x++) {
      const color = px[y * PORTRAIT_W + x]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  }
}

export function portraitCanvas(
  face: FaceSpec,
  scale: number,
  options: PortraitOptions = {},
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.className = 'pixel portrait'
  drawPortrait(canvas, face, options)
  canvas.style.width = `${PORTRAIT_W * scale}px`
  canvas.style.height = `${PORTRAIT_H * scale}px`
  return canvas
}

// ---------- Color helpers ----------

function parseColor(color: string): [number, number, number, number] {
  const hex = color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255
  return [r, g, b, a]
}

function toHex(r: number, g: number, b: number, a: number): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ''}`
}

// Brown photo print. Contrast is stretched so features stay comparable with the live face.
export function sepia(color: string): string {
  const [r, g, b, a] = parseColor(color)
  const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
  // Shadows are lifted so features on dark skin stay readable
  const t = Math.pow(Math.max(0, Math.min(1, (lum - 0.06) / 0.88)), 0.75)
  return toHex(34 + t * 208, 24 + t * 186, 16 + t * 140, a)
}

export function darken(color: string, factor: number): string {
  const [r, g, b, a] = parseColor(color)
  return toHex(r * factor, g * factor, b * factor, a)
}
