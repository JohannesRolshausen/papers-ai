// The API key lives in sessionStorage, in localStorage only on request, and blocked storage
// never breaks the game.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_KEY_ITEM, forgetApiKey, loadApiKey, saveApiKey } from '../src/ui/keyStore'

class MemoryStorage {
  private items = new Map<string, string>()
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
}

class BlockedStorage {
  getItem(): string | null {
    throw new Error('blocked')
  }
  setItem(): void {
    throw new Error('blocked')
  }
  removeItem(): void {
    throw new Error('blocked')
  }
}

function stubWindow(session: unknown, local: unknown): void {
  vi.stubGlobal('window', { sessionStorage: session, localStorage: local })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API key storage', () => {
  it('keeps the key for the tab only unless asked to remember it', () => {
    const session = new MemoryStorage()
    const local = new MemoryStorage()
    stubWindow(session, local)
    expect(loadApiKey()).toBeNull()
    expect(saveApiKey('  sk-ant-one ', false)).toBe(true)
    expect(session.getItem(API_KEY_ITEM)).toBe('sk-ant-one')
    expect(local.getItem(API_KEY_ITEM)).toBeNull()
    expect(loadApiKey()).toEqual({ key: 'sk-ant-one', remembered: false })

    saveApiKey('sk-ant-two', true)
    expect(local.getItem(API_KEY_ITEM)).toBe('sk-ant-two')
    expect(loadApiKey()).toEqual({ key: 'sk-ant-two', remembered: true })

    // Unticking remember removes the copy on the device
    saveApiKey('sk-ant-two', false)
    expect(local.getItem(API_KEY_ITEM)).toBeNull()

    forgetApiKey()
    expect(loadApiKey()).toBeNull()
  })

  it('finds a remembered key in a new tab', () => {
    const local = new MemoryStorage()
    local.setItem(API_KEY_ITEM, 'sk-ant-saved')
    stubWindow(new MemoryStorage(), local)
    expect(loadApiKey()).toEqual({ key: 'sk-ant-saved', remembered: true })
  })

  it('survives blocked or missing storage', () => {
    stubWindow(new BlockedStorage(), new BlockedStorage())
    expect(loadApiKey()).toBeNull()
    expect(saveApiKey('sk-ant-x', true)).toBe(false)
    expect(() => forgetApiKey()).not.toThrow()

    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('denied')
      },
      get localStorage(): Storage {
        throw new Error('denied')
      },
    })
    expect(loadApiKey()).toBeNull()
    expect(saveApiKey('sk-ant-x', false)).toBe(false)
  })
})
