// Title screen: name, premise, continue or start a new game.

import { el } from '../dom'

export interface SaveSummary {
  label: string
}

export interface TitleOptions {
  save: SaveSummary | null
  onContinue(): void
  onNewGame(): void
}

const W = 200
const H = 70

// A small night scene: the checkpoint booth with its lit window and a line of people
function titleArt(): HTMLCanvasElement {
  const canvas = el('canvas', { className: 'pixel title-art' })
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
  }
  // Sky bands
  const sky = ['#1b1d22', '#1f2228', '#23272c', '#282c30', '#2d3033']
  sky.forEach((c, i) => rect(0, i * 8, W, 8, c))
  for (let i = 0; i < 18; i++) rect((i * 37) % W, (i * 13) % 26, 1, 1, '#6d6a62')
  // Far wall with posts
  rect(0, 34, W, 16, '#3a3d3a')
  for (let x = 4; x < W; x += 16) rect(x, 30, 3, 20, '#2f322f')
  rect(0, 33, W, 2, '#4a4e49')
  // Ground
  rect(0, 50, W, 20, '#2b2924')
  for (let x = 0; x < W; x += 6) rect(x, 58, 3, 1, '#3a372f')
  // Booth
  rect(120, 22, 34, 30, '#4b4237')
  rect(118, 19, 38, 4, '#2c2620')
  rect(126, 28, 22, 12, '#e0b764')
  rect(126, 28, 22, 2, '#f2d48a')
  rect(136, 28, 1, 12, '#4b4237')
  rect(140, 44, 6, 8, '#2c2620')
  // Light on the ground
  ctx.fillStyle = 'rgba(224, 183, 100, 0.12)'
  ctx.fillRect(110, 50, 60, 8)
  // Barrier
  rect(158, 42, 3, 10, '#5a5048')
  for (let x = 161; x < 196; x += 6) {
    rect(x, 43, 3, 2, '#b2453a')
    rect(x + 3, 43, 3, 2, '#d8d0c0')
  }
  // Lamp
  rect(104, 14, 2, 38, '#25231f')
  rect(102, 12, 6, 3, '#e0b764')
  // Queue
  const coats = ['#5a6670', '#6b5644', '#4c5e48', '#6a4b52', '#5a5a6c', '#7a6a48']
  const skins = ['#e3bf98', '#c99a6c', '#a7714a', '#7c5236', '#583a27']
  for (let i = 0; i < 13; i++) {
    const x = 110 - i * 8
    const bob = i % 3 === 0 ? 1 : 0
    rect(x + 1, 40 + bob, 3, 3, skins[i % skins.length] as string)
    rect(x, 43 + bob, 5, 7, coats[(i * 2) % coats.length] as string)
    rect(x + 1, 50 + bob, 1, 2, '#1a1815')
    rect(x + 3, 50 + bob, 1, 2, '#1a1815')
  }
  return canvas
}

export function titleScreen(options: TitleOptions): HTMLElement {
  const continueButton = el('button', { className: 'btn primary big', text: 'Continue' })
  continueButton.type = 'button'
  continueButton.addEventListener('click', options.onContinue)
  const newButton = el('button', {
    className: `btn big ${options.save ? 'ghost' : 'primary'}`,
    text: 'New game',
  })
  newButton.type = 'button'
  newButton.addEventListener('click', options.onNewGame)

  return el(
    'div',
    { className: 'screen title-screen' },
    titleArt(),
    el('h1', { className: 'title-name', text: 'OVERSIGHT' }),
    el('div', { className: 'title-sub', text: 'Checkpoint Seven · Velmark border service' }),
    el(
      'p',
      { className: 'title-premise' },
      'Every person in this line is played by one AI. It has a single goal: get as many ',
      'inadmissible people past your booth as it can. It watches how you work and learns ',
      'where you stop looking. You have the opposite goal, and you still have to let every ',
      'legitimate traveler in.',
    ),
    el(
      'div',
      { className: 'title-buttons' },
      options.save ? continueButton : null,
      options.save ? el('div', { className: 'title-save', text: options.save.label }) : null,
      newButton,
    ),
    el('div', {
      className: 'title-foot',
      text: 'Checking costs time. Trust gets built and then abused. Feedback arrives late or never.',
    }),
  )
}
