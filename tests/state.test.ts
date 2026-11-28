import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../src/core/state'
import {
  SAVE_KEY,
  clearSave,
  createNewGame,
  inspectSave,
  loadGame,
  saveGame,
} from '../src/core/state'

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

describe('save and load', () => {
  it('reports empty when nothing is saved', () => {
    const store = memoryStorage()
    expect(inspectSave(store)).toEqual({ status: 'empty' })
    expect(loadGame(store)).toBeNull()
  })

  it('round-trips a valid game state including adversary memory', () => {
    const store = memoryStorage()
    const state = createNewGame({
      seed: 42,
      difficulty: 'easy',
      settings: { aiMode: 'claude', model: 'claude-sonnet-5-5' },
    })
    state.adversaryMemory = {
      version: 1,
      kind: 'claude',
      messages: [
        { role: 'user', content: 'briefing' },
        { role: 'assistant', content: 'plan' },
      ],
      reported: [],
      notes: [],
      log: [{ day: 1, source: 'claude', model: 'claude-sonnet-5-5', reason: null }],
      offline: null,
    }
    expect(saveGame(state, store)).toBe(true)
    const checked = inspectSave(store)
    expect(checked.status).toBe('ok')
    if (checked.status === 'ok') {
      expect(checked.state.seed).toBe(42)
      expect(checked.state.adversaryMemory).toEqual(state.adversaryMemory)
    }
    clearSave(store)
    expect(inspectSave(store)).toEqual({ status: 'empty' })
  })

  it('flags invalid JSON, unsupported versions, and incomplete saves as corrupted', () => {
    expect(inspectSave(memoryStorage({ [SAVE_KEY]: '{broken json' })).status).toBe('corrupted')
    expect(inspectSave(memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 99 }) })).status).toBe(
      'corrupted',
    )
    expect(
      inspectSave(
        memoryStorage({
          [SAVE_KEY]: JSON.stringify({ version: 1, seed: 1, world: {}, schedule: {} }),
        }),
      ).status,
    ).toBe('corrupted')
    expect(loadGame(memoryStorage({ [SAVE_KEY]: '{broken json' }))).toBeNull()
  })

  it('reports unavailable storage and returns false when quota is exceeded', () => {
    expect(inspectSave(null).status).toBe('unavailable')
    const throwingStore: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(inspectSave(throwingStore).status).toBe('unavailable')
    const state = createNewGame({ seed: 1, difficulty: 'easy' })
    expect(saveGame(state, throwingStore)).toBe(false)
    expect(() => clearSave(throwingStore)).not.toThrow()
  })
})
