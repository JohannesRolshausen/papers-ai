// Helpers for inspect-mode references.

import type { RuleId } from './rules'
import type { BulletinSection, PersonField, Ref, RulebookSection } from './types'

export function refKey(ref: Ref): string {
  switch (ref.kind) {
    case 'doc':
      return `doc:${ref.docId}:${ref.field}`
    case 'person':
      return `person:${ref.field}`
    case 'calendar':
      return 'calendar'
    case 'rule':
      return `rule:${ref.ruleId}`
    case 'rulebook':
      return `rulebook:${ref.section}:${ref.key}`
    case 'bulletin':
      return ref.key === null ? `bulletin:${ref.section}` : `bulletin:${ref.section}:${ref.key}`
  }
}

export const docRef = (docId: string, field: string): Ref => ({ kind: 'doc', docId, field })
export const personRef = (field: PersonField): Ref => ({ kind: 'person', field })
export const calendarRef = (): Ref => ({ kind: 'calendar' })
export const ruleRef = (ruleId: RuleId): Ref => ({ kind: 'rule', ruleId })
export const rulebookRef = (section: RulebookSection, key: string): Ref => ({
  kind: 'rulebook',
  section,
  key,
})
export const bulletinRef = (section: BulletinSection, key: string | null = null): Ref => ({
  kind: 'bulletin',
  section,
  key,
})

export function sameRefSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((key) => set.has(key))
}
