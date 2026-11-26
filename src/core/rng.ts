// Seeded randomness. Every random choice in the engine goes through here so that
// the same seed always produces the same game.

export function hashString(input: string): number {
  // FNV-1a, 32 bit
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9
  }

  // mulberry32
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // Inclusive on both ends
  int(min: number, max: number): number {
    if (max < min) return min
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty list')
    return items[Math.floor(this.next() * items.length)] as T
  }

  pickWeighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0)
    if (total <= 0) return this.pick(items).value
    let roll = this.next() * total
    for (const item of items) {
      roll -= Math.max(0, item.weight)
      if (roll < 0) return item.value
    }
    return (items[items.length - 1] as { value: T }).value
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = copy[i] as T
      copy[i] = copy[j] as T
      copy[j] = tmp
    }
    return copy
  }

  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, count))
  }

  // Independent child stream, so adding a draw in one place never shifts another
  fork(label: string): Rng {
    return new Rng(hashString(`${this.state}:${label}`))
  }
}

export function rngFor(seed: number, ...labels: (string | number)[]): Rng {
  return new Rng(hashString(`${seed}|${labels.join('|')}`))
}
