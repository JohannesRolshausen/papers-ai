import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../src/core/state'
import { MUTE_STORAGE_KEY, SoundEngine, loadMuted, saveMuted } from '../src/ui/audio'

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

describe('audio mute persistence and headless safety', () => {
  it('defaults to unmuted and remembers mute state per device', () => {
    const store = memoryStorage()
    expect(loadMuted(store)).toBe(false)

    const engine = new SoundEngine(store)
    expect(engine.muted).toBe(false)

    const events: boolean[] = []
    const unsub = engine.onMuteChange((m) => events.push(m))

    expect(engine.toggleMuted()).toBe(true)
    expect(store.getItem(MUTE_STORAGE_KEY)).toBe('1')
    expect(events).toEqual([true])

    // A fresh engine reads the saved preference
    const reloaded = new SoundEngine(store)
    expect(reloaded.muted).toBe(true)

    reloaded.setMuted(false)
    expect(store.getItem(MUTE_STORAGE_KEY)).toBeNull()
    unsub()
  })

  it('survives blocked storage and absent AudioContext without throwing', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadMuted(broken)).toBe(false)
    expect(saveMuted(true, broken)).toBe(false)

    const engine = new SoundEngine(broken)
    expect(() => engine.playStamp('approve')).not.toThrow()
    expect(() => engine.playStamp('deny')).not.toThrow()
    expect(() => engine.playKey(false)).not.toThrow()
    expect(() => engine.playKey(true)).not.toThrow()
    expect(() => engine.playPrinter()).not.toThrow()
    expect(() => engine.playSpeaker()).not.toThrow()
    expect(() => engine.playClockTick(true)).not.toThrow()
  })
})
