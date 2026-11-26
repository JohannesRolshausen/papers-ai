import { describe, expect, it } from 'vitest'
import {
  DOC_LINE_STAGES,
  buildDocLine,
  charsPerMinute,
  compareTyping,
  plainUpper,
  reasonFromCode,
  subjectName,
} from '../src/core/docLines'

const input = {
  kind: 'fingerprints' as const,
  day: 7,
  serial: 142,
  subject: subjectName({ surname: 'Volk', given: 'Andrei' }),
  reason: reasonFromCode('PHOTO_MISMATCH'),
  minute: 9 * 60 + 42,
  documentNumber: 'OS-38211',
}

describe('documentation lines', () => {
  it('starts with the short form on the first days', () => {
    expect(buildDocLine({ ...input, day: 1 })).toBe(
      'BIOMETRIC REQUEST 01-142 | SUBJECT: VOLK, ANDREI | REASON: PHOTO MISMATCH | OFFICER 4471',
    )
  })

  it('grows longer with the days', () => {
    const lengths = [1, 4, 8, 12, 17, 22].map((day) => buildDocLine({ ...input, day }).length)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]).toBeGreaterThan(lengths[i - 1] as number)
    }
    const late = buildDocLine({ ...input, day: 25 })
    expect(late).toBe(
      'BIOMETRIC REQUEST 25-142 | FORM B-7 | BOOTH 7 | TIME 09:42 | SUBJECT: VOLK, ANDREI | DOC: OS-38211 | REASON: PHOTO MISMATCH | OFFICER 4471 | COPY: BIOMETRICS BUREAU',
    )
    expect(DOC_LINE_STAGES.form).toBeLessThan(DOC_LINE_STAGES.copy)
  })

  it('names incidents and reviews differently', () => {
    expect(buildDocLine({ ...input, kind: 'incident', day: 2, reason: 'BRIBERY ATTEMPT' })).toMatch(
      /^INCIDENT REPORT 02-142 \| SUBJECT: VOLK, ANDREI \| TYPE: BRIBERY ATTEMPT/,
    )
    expect(buildDocLine({ ...input, kind: 'review', day: 2, reason: 'DENIAL OF DAY 1' })).toMatch(
      /^SUPERVISOR REVIEW 02-142 \| COMPLAINT BY: VOLK, ANDREI \| CASE: DENIAL OF DAY 1/,
    )
    expect(buildDocLine({ ...input, kind: 'registry', day: 1 })).toContain('DOC: OS-38211')
  })

  it('only uses characters every keyboard has', () => {
    expect(plainUpper('Mîrkö  Dresnik|<b>')).toBe('MIRKO DRESNIKB')
    expect(subjectName(null)).toBe('UNIDENTIFIED')
    expect(reasonFromCode('DOC_UNREGISTERED')).toBe('UNREGISTERED DOCUMENT')
    expect(reasonFromCode('HEIGHT_MISMATCH')).toBe('HEIGHT MISMATCH')
  })
})

describe('typing comparison', () => {
  const line = 'REGISTRY QUERY 01-142'

  it('accepts an exact copy, ignoring case by default', () => {
    const result = compareTyping(line, 'registry query 01-142')
    expect(result.complete).toBe(true)
    expect(result.typos).toBe(0)
    expect(result.accuracy).toBe(1)
    expect(compareTyping(line, 'registry query 01-142', { ignoreCase: false }).typos).toBe(13)
  })

  it('counts wrong, missing and extra characters', () => {
    const wrong = compareTyping(line, 'REGISTRX QUERY 01-142')
    expect(wrong.typos).toBe(1)
    expect(wrong.states[7]).toBe('wrong')
    expect(wrong.correctPrefix).toBe(7)
    expect(wrong.complete).toBe(false)
    const partial = compareTyping(line, 'REGISTRY')
    expect(partial.missing).toBe(line.length - 8)
    expect(partial.typos).toBe(0)
    expect(partial.correctPrefix).toBe(8)
    expect(partial.complete).toBe(false)
    const extra = compareTyping(line, `${line}!!`)
    expect(extra.typos).toBe(2)
    expect(extra.states.slice(-2)).toEqual(['extra', 'extra'])
  })

  it('measures typing speed', () => {
    expect(charsPerMinute(100, 30_000)).toBe(200)
    expect(charsPerMinute(100, 0)).toBe(0)
  })
})
