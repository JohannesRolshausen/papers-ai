// Where the player's API key lives: in sessionStorage for this tab, and in localStorage only
// when the player asks for it. The key never goes into the save game. Storage can be blocked
// or full, so every access is guarded.

export const API_KEY_ITEM = 'oversight-claude-key'

export interface StoredKey {
  key: string
  remembered: boolean
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function localStore(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function read(store: Storage | null): string | null {
  if (!store) return null
  try {
    const value = store.getItem(API_KEY_ITEM)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function write(store: Storage | null, value: string | null): boolean {
  if (!store) return false
  try {
    if (value === null) store.removeItem(API_KEY_ITEM)
    else store.setItem(API_KEY_ITEM, value)
    return true
  } catch {
    return false
  }
}

export function loadApiKey(): StoredKey | null {
  const session = read(sessionStore())
  const local = read(localStore())
  if (session) return { key: session, remembered: local === session }
  if (local) return { key: local, remembered: true }
  return null
}

// Returns false if the browser refused to store the key anywhere
export function saveApiKey(key: string, remember: boolean): boolean {
  const value = key.trim()
  if (!value) {
    forgetApiKey()
    return true
  }
  const inSession = write(sessionStore(), value)
  let inLocal = false
  if (remember) inLocal = write(localStore(), value)
  else write(localStore(), null)
  return inSession || inLocal
}

export function forgetApiKey(): void {
  write(sessionStore(), null)
  write(localStore(), null)
}
