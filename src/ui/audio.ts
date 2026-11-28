// Short synthesized WebAudio sounds for the booth: stamp, typing, printer, speaker, and late clock.
// No external audio files. Mute preference is stored per device in localStorage (guarded with try/catch).

import type { StorageLike } from '../core/state'
import type { Decision } from '../core/types'

export const MUTE_STORAGE_KEY = 'oversight-muted'

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadMuted(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(MUTE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMuted(muted: boolean, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    if (muted) storage.setItem(MUTE_STORAGE_KEY, '1')
    else storage.removeItem(MUTE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

type AudioCtor = typeof AudioContext

function audioContextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: AudioCtor
    webkitAudioContext?: AudioCtor
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export type MuteListener = (muted: boolean) => void

export class SoundEngine {
  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null
  private mutedState: boolean
  private readonly listeners = new Set<MuteListener>()
  private readonly store: StorageLike | null
  private keyToggle = false
  private lastSpeakerAt = 0

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.store = storage
    this.mutedState = loadMuted(storage)
  }

  get muted(): boolean {
    return this.mutedState
  }

  setMuted(muted: boolean): void {
    if (this.mutedState === muted) return
    this.mutedState = muted
    saveMuted(muted, this.store)
    for (const listener of this.listeners) listener(muted)
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedState)
    return this.mutedState
  }

  onMuteChange(listener: MuteListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private context(): AudioContext | null {
    if (this.mutedState) return null
    try {
      if (!this.ctx) {
        const Ctor = audioContextCtor()
        if (!Ctor) return null
        this.ctx = new Ctor()
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined)
      }
      return this.ctx
    } catch {
      return null
    }
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer
    }
    const len = Math.floor(ctx.sampleRate * 0.25)
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Deterministic PRNG so sound texture is consistent and clean
    let seed = 0x51a7f319
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      data[i] = (seed / 0xffffffff) * 2 - 1
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private noiseBurst(
    ctx: AudioContext,
    start: number,
    duration: number,
    gainLevel: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 1,
  ): void {
    const src = ctx.createBufferSource()
    src.buffer = this.noise(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency.setValueAtTime(freq, start)
    filter.Q.setValueAtTime(q, start)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(gainLevel, start + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(start)
    src.stop(start + duration + 0.01)
  }

  private tone(
    ctx: AudioContext,
    start: number,
    duration: number,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    gainLevel: number,
    filterFreq?: number,
  ): void {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freqStart, start)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.linearRampToValueAtTime(gainLevel, start + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    if (filterFreq) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(filterFreq, start)
      osc.connect(filter)
      filter.connect(gain)
    } else {
      osc.connect(gain)
    }
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + duration + 0.01)
  }

  // Heavy rubber stamp onto paper
  playStamp(decision: Decision): void {
    const ctx = this.context()
    if (!ctx) return
    try {
      const t = ctx.currentTime
      const f0 = decision === 'approve' ? 150 : 118
      const f1 = decision === 'approve' ? 52 : 38
      this.tone(ctx, t, 0.095, 'triangle', f0, f1, 0.22, 420)
      this.noiseBurst(ctx, t, 0.045, 0.14, 'lowpass', 900)
    } catch {
      // Ignore audio failures in restricted browsers
    }
  }

  // Mechanical typewriter click, or a low clack on a wrong keystroke
  playKey(wrong = false): void {
    const ctx = this.context()
    if (!ctx) return
    try {
      const t = ctx.currentTime
      if (wrong) {
        this.tone(ctx, t, 0.07, 'sawtooth', 165, 115, 0.09, 550)
        return
      }
      this.keyToggle = !this.keyToggle
      const pitch = this.keyToggle ? 980 : 1120
      this.noiseBurst(ctx, t, 0.022, 0.065, 'bandpass', 2300, 1.4)
      this.tone(ctx, t, 0.02, 'triangle', pitch, pitch * 0.72, 0.035)
    } catch {
      // Ignore audio failures
    }
  }

  // Short dot-matrix / slip printer chatter when a deep check report lands on the desk
  playPrinter(): void {
    const ctx = this.context()
    if (!ctx) return
    try {
      const t = ctx.currentTime
      for (let i = 0; i < 5; i++) {
        const at = t + i * 0.045
        this.noiseBurst(ctx, at, 0.024, 0.065, 'bandpass', 1800 + (i % 2) * 350, 2.2)
      }
      this.tone(ctx, t, 0.24, 'sawtooth', 220, 200, 0.022, 600)
    } catch {
      // Ignore audio failures
    }
  }

  // Booth intercom chirp when an applicant starts speaking (scripted or streamed)
  playSpeaker(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - this.lastSpeakerAt < 120) return
    this.lastSpeakerAt = now
    const ctx = this.context()
    if (!ctx) return
    try {
      const t = ctx.currentTime
      this.noiseBurst(ctx, t, 0.028, 0.032, 'bandpass', 1200, 2)
      this.tone(ctx, t + 0.008, 0.055, 'triangle', 410, 320, 0.055, 1400)
    } catch {
      // Ignore audio failures
    }
  }

  // Subtle wall-clock tick during the final hour before 18:00
  playClockTick(urgent = false): void {
    const ctx = this.context()
    if (!ctx) return
    try {
      const t = ctx.currentTime
      const freq = urgent ? 1900 : 1450
      this.noiseBurst(ctx, t, 0.02, urgent ? 0.075 : 0.05, 'bandpass', freq, 3)
      this.tone(ctx, t, 0.025, 'sine', urgent ? 880 : 660, urgent ? 520 : 440, 0.035)
    } catch {
      // Ignore audio failures
    }
  }
}

export const sound = new SoundEngine()

export function isMuted(): boolean {
  return sound.muted
}

export function setMuted(muted: boolean): void {
  sound.setMuted(muted)
}

export function toggleMuted(): boolean {
  return sound.toggleMuted()
}

export function onMuteChange(listener: MuteListener): () => void {
  return sound.onMuteChange(listener)
}

export function playStamp(decision: Decision): void {
  sound.playStamp(decision)
}

export function playKey(wrong = false): void {
  sound.playKey(wrong)
}

export function playPrinter(): void {
  sound.playPrinter()
}

export function playSpeaker(): void {
  sound.playSpeaker()
}

export function playClockTick(urgent = false): void {
  sound.playClockTick(urgent)
}
