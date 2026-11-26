// The waiting line as a small pixel crowd, and the shift clock readout.

import { el, formatMinute } from '../dom'

const W = 62
const H = 14
const COATS = ['#5a6670', '#6b5644', '#4c5e48', '#6a4b52', '#5a5a6c', '#7a6a48', '#4a4a4a']
const SKINS = ['#e3bf98', '#c99a6c', '#a7714a', '#7c5236', '#583a27']

export interface QueueView {
  root: HTMLElement
  set(count: number): void
}

export function createQueue(): QueueView {
  const canvas = el('canvas', { className: 'pixel queue-canvas' })
  canvas.width = W
  canvas.height = H
  const label = el('span', { className: 'queue-count', text: '0' })
  const root = el('div', { className: 'queue', title: 'People waiting' }, canvas, label)
  const ctx = canvas.getContext('2d')

  const draw = (count: number) => {
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    const shown = Math.min(count, 10)
    for (let i = 0; i < shown; i++) {
      const x = 1 + i * 6
      const coat = COATS[(i * 5 + 3) % COATS.length] as string
      const skin = SKINS[(i * 3 + 1) % SKINS.length] as string
      const bob = i % 3 === 1 ? 1 : 0
      ctx.fillStyle = skin
      ctx.fillRect(x + 1, 1 + bob, 3, 3)
      ctx.fillStyle = coat
      ctx.fillRect(x, 4 + bob, 5, 7)
      ctx.fillStyle = '#2a2622'
      ctx.fillRect(x + 1, 11 + bob, 1, 2)
      ctx.fillRect(x + 3, 11 + bob, 1, 2)
    }
  }

  return {
    root,
    set(count: number) {
      label.textContent = String(count)
      draw(count)
    },
  }
}

export interface ClockView {
  root: HTMLElement
  set(minute: number, late: boolean): void
}

export function createClockView(): ClockView {
  const root = el('div', { className: 'clock', text: '06:00' })
  return {
    root,
    set(minute, late) {
      root.textContent = formatMinute(minute)
      root.classList.toggle('late', late)
    },
  }
}
