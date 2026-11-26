// The rulebook on the desk: today's rules and the reference pages for seals, cities,
// districts and vaccines. Every entry is a ref target for inspect mode.

import { ruleTitle } from '../../core/rules'
import { ALL_AUTHORITIES, AUTHORITY_NAMES } from '../../core/seals'
import type { DayContext } from '../../core/types'
import {
  COUNTRIES,
  COUNTRY_IDS,
  REQUIRED_VACCINE,
  VACCINES,
  VELMARK_DISTRICTS,
  countryName,
} from '../../core/world'
import { el } from '../dom'
import { sealCanvas } from './seal'

export type RulebookTab = 'rules' | 'seals' | 'cities' | 'districts' | 'vaccines'

const TABS: { id: RulebookTab; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'seals', label: 'Seals' },
  { id: 'cities', label: 'Cities' },
  { id: 'districts', label: 'Districts' },
  { id: 'vaccines', label: 'Vaccines' },
]

function rulesPage(ctx: DayContext): HTMLElement {
  return el(
    'div',
    { className: 'rb-page' },
    el('div', { className: 'rb-heading', text: `Regulations in force, day ${ctx.dayIndex}` }),
    ...ctx.bulletin.rules.map((rule, i) =>
      el(
        'div',
        { className: 'rb-rule', ref: `rule:${rule.id}` },
        el('div', { className: 'rb-rule-title', text: `${i + 1}. ${ruleTitle(rule.id)}` }),
        el('div', { className: 'rb-rule-text', text: rule.text }),
      ),
    ),
  )
}

function sealsPage(ctx: DayContext): HTMLElement {
  return el(
    'div',
    { className: 'rb-page' },
    el('div', { className: 'rb-heading', text: 'Valid seals today' }),
    el(
      'div',
      { className: 'rb-seal-grid' },
      ...ALL_AUTHORITIES.map((authority) => {
        const seals = ctx.validSeals[authority] ?? []
        return el(
          'div',
          { className: 'rb-seal', ref: `rulebook:seals:${authority}` },
          el('div', { className: 'rb-seal-name', text: AUTHORITY_NAMES[authority] }),
          el('div', { className: 'rb-seal-row' }, ...seals.map((s) => sealCanvas(s, 2))),
          seals.length > 1 ? el('div', { className: 'rb-note', text: 'old and new design' }) : null,
        )
      }),
    ),
  )
}

function citiesPage(): HTMLElement {
  return el(
    'div',
    { className: 'rb-page' },
    el('div', { className: 'rb-heading', text: 'Passport issuing cities' }),
    ...COUNTRY_IDS.map((country) =>
      el(
        'div',
        { className: 'rb-entry', ref: `rulebook:cities:${country}` },
        el('div', { className: 'rb-entry-title', text: COUNTRIES[country].name }),
        el('div', { className: 'rb-entry-text', text: COUNTRIES[country].cities.join(' · ') }),
      ),
    ),
  )
}

function districtsPage(): HTMLElement {
  return el(
    'div',
    { className: 'rb-page' },
    el('div', { className: 'rb-heading', text: 'Velmark districts' }),
    el(
      'div',
      { className: 'rb-entry', ref: 'rulebook:districts:velmark' },
      el('div', { className: 'rb-entry-title', text: 'Districts printed on identity cards' }),
      ...VELMARK_DISTRICTS.map((d) => el('div', { className: 'rb-entry-text', text: `- ${d}` })),
    ),
  )
}

function vaccinesPage(ctx: DayContext): HTMLElement {
  const health = ctx.rules.find((r) => r.id === 'health_cert_required')
  const countries = health ? health.countries.map(countryName).join(', ') : 'none today'
  return el(
    'div',
    { className: 'rb-page' },
    el('div', { className: 'rb-heading', text: 'Vaccines' }),
    el('div', { className: 'rb-entry-text', text: `Certificate required for: ${countries}` }),
    ...VACCINES.map((v) =>
      el(
        'div',
        { className: 'rb-entry', ref: `rulebook:vaccines:${v}` },
        el('div', { className: 'rb-entry-title', text: v }),
        el('div', {
          className: 'rb-entry-text',
          text:
            v === REQUIRED_VACCINE
              ? 'Accepted against marsh fever.'
              : 'Not accepted for entry. Other illnesses only.',
        }),
      ),
    ),
  )
}

export interface Rulebook {
  root: HTMLElement
  show(tab: RulebookTab): void
}

export function createRulebook(ctx: DayContext): Rulebook {
  const body = el('div', { className: 'rb-body' })
  const tabButtons = new Map<RulebookTab, HTMLButtonElement>()
  const show = (tab: RulebookTab) => {
    for (const [id, b] of tabButtons) b.classList.toggle('active', id === tab)
    switch (tab) {
      case 'rules':
        body.replaceChildren(rulesPage(ctx))
        break
      case 'seals':
        body.replaceChildren(sealsPage(ctx))
        break
      case 'cities':
        body.replaceChildren(citiesPage())
        break
      case 'districts':
        body.replaceChildren(districtsPage())
        break
      case 'vaccines':
        body.replaceChildren(vaccinesPage(ctx))
        break
    }
    body.scrollTop = 0
  }
  const tabs = el(
    'div',
    { className: 'rb-tabs' },
    ...TABS.map((t) => {
      const b = el('button', { className: 'rb-tab', text: t.label })
      b.type = 'button'
      b.dataset.tab = t.id
      b.addEventListener('click', () => show(t.id))
      tabButtons.set(t.id, b)
      return b
    }),
  )
  const root = el(
    'div',
    { className: 'doc rulebook' },
    el('div', { className: 'rb-cover', text: 'CHECKPOINT SEVEN · REGULATIONS' }),
    tabs,
    body,
  )
  show('rules')
  return { root, show }
}
