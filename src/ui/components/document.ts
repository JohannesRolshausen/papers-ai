// Documents on the desk. Every inspectable field carries its ref key in data-ref.

import { formatDocDate } from '../../core/dates'
import type { GameDocument } from '../../core/documents'
import { DOC_FIELDS, DOC_TITLES, fieldValue } from '../../core/documents'
import { AUTHORITY_NAMES } from '../../core/seals'
import type { CountryId } from '../../core/world'
import { COUNTRIES, isCountryId } from '../../core/world'
import { el } from '../dom'
import { portraitCanvas } from './portrait'
import { sealCanvas } from './seal'

const DATE_FIELDS = new Set(['dob', 'issued', 'expires', 'validUntil', 'vaccinatedOn'])

export function formatField(doc: GameDocument, field: string): string {
  const value = fieldValue(doc, field)
  if (value === null || value === undefined) return '-'
  if (DATE_FIELDS.has(field) && typeof value === 'string') return formatDocDate(value)
  if ((field === 'country' || field === 'issuingCountry') && typeof value === 'string') {
    return isCountryId(value) ? COUNTRIES[value].name.toUpperCase() : value.toUpperCase()
  }
  if (field === 'accessTo' && Array.isArray(value)) {
    return value
      .map((c) => (isCountryId(String(c)) ? COUNTRIES[c as CountryId].name : String(c)))
      .join(', ')
      .toUpperCase()
  }
  if (field === 'height') return `${String(value)} cm`
  if (field === 'weight') return `${String(value)} kg`
  if (field === 'durationDays') return `${String(value)} DAYS`
  if (field === 'purpose') return String(value).toUpperCase()
  if (field === 'surname') return String(value).toUpperCase()
  return String(value)
}

export function docKey(docId: string, field: string): string {
  return `doc:${docId}:${field}`
}

function fieldRow(doc: GameDocument, field: string, label: string): HTMLElement {
  return el(
    'div',
    { className: `doc-field f-${field}`, ref: docKey(doc.id, field) },
    el('span', { className: 'doc-label', text: label }),
    el('span', { className: 'doc-value', text: formatField(doc, field) }),
  )
}

function issuerLine(doc: GameDocument): string {
  switch (doc.type) {
    case 'passport':
      return COUNTRIES[doc.country].name.toUpperCase()
    case 'idCard':
      return 'REPUBLIC OF VELMARK'
    case 'diplomaticAuth':
      return `${COUNTRIES[doc.issuingCountry].name.toUpperCase()} FOREIGN OFFICE`
    case 'letter':
      return ''
    default:
      return AUTHORITY_NAMES[doc.seal.authority].toUpperCase()
  }
}

function sealBox(doc: GameDocument): HTMLElement | null {
  const seal = doc.seal
  if (!seal) return null
  return el('div', { className: 'doc-seal', ref: docKey(doc.id, 'seal') }, sealCanvas(seal, 2))
}

export function renderDocument(doc: GameDocument): HTMLElement {
  const root = el('div', { className: `doc doc-${doc.type}` })
  root.dataset.docId = doc.id

  if (doc.type === 'letter') {
    root.append(
      el('div', { className: 'letter-title', ref: docKey(doc.id, 'title'), text: doc.title }),
      el(
        'div',
        { className: 'doc-field letter-sender', ref: docKey(doc.id, 'sender') },
        el('span', { className: 'doc-label', text: 'From' }),
        el('span', { className: 'doc-value', text: doc.sender }),
      ),
      el('p', { className: 'letter-body', ref: docKey(doc.id, 'body'), text: doc.body }),
    )
    const seal = sealBox(doc)
    if (seal) root.append(seal)
    return root
  }

  const fields = DOC_FIELDS[doc.type].filter((f) => f.field !== 'photo' && f.field !== 'seal')
  const header = el(
    'div',
    { className: 'doc-head' },
    el('span', { className: 'doc-title', text: DOC_TITLES[doc.type].toUpperCase() }),
    el('span', { className: 'doc-issuer', text: issuerLine(doc) }),
  )
  const list = el(
    'div',
    { className: 'doc-fields' },
    ...fields.map((f) => fieldRow(doc, f.field, f.label)),
  )

  if (doc.type === 'passport' || doc.type === 'idCard') {
    const photo = el(
      'div',
      { className: 'doc-photo', ref: docKey(doc.id, 'photo') },
      portraitCanvas(doc.photo, 3, { sepia: true, background: '#efe9dc' }),
    )
    root.append(
      header,
      el(
        'div',
        { className: 'doc-columns' },
        el('div', { className: 'doc-side' }, photo, sealBox(doc)),
        list,
      ),
    )
  } else {
    root.append(header, el('div', { className: 'doc-columns' }, list, sealBox(doc)))
  }
  return root
}

// A printed slip from a deep check or the registry
export function renderReportSlip(
  title: string,
  lines: readonly string[],
  stamp: string,
): HTMLElement {
  return el(
    'div',
    { className: 'doc report-slip' },
    el('div', { className: 'slip-title', text: title }),
    el('div', { className: 'slip-stamp', text: stamp }),
    ...lines.map((line) => el('div', { className: 'slip-line', text: line })),
  )
}
