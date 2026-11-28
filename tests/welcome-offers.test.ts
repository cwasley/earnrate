import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { TRANSFER_VALUES } from '../src/engine/fee-worth.ts'
import { localToday } from '../src/engine/periods.ts'
import { findCategory } from '../src/merchants/resolve.ts'
import {
  openFirst,
  PICKER_AMOUNTS,
  PICKER_MONTHS,
  pickerKey,
  rankedOffers,
  reachesMinimum,
  unlockedAt,
} from '../src/engine/welcome-offers.ts'
import { pageContext } from '../scripts/pages/context.ts'
import {
  eventGroups,
  LIFE_EVENTS,
  resolveLine,
  termsNotes,
} from '../scripts/pages/life-events.ts'
import { PICKER_SCRIPT } from '../scripts/pages/welcome-offers.ts'

const catalog = await loadCatalog()
const today = localToday()
const ctx = pageContext(catalog, { today, dataVersion: 'test' })
const offers = rankedOffers(catalog, today)
const card = (id: string) => catalog.cards.find((c) => c.id === id)

describe('welcome offers ranked from no cards', () => {
  test('rank on the bonus less the first-year fee, highest first', () => {
    for (const list of [offers.personal, offers.business]) {
      expect(list.length).toBeGreaterThan(0)
      for (const o of list)
        expect(o.firstYearValue).toBeCloseTo(
          o.bonusValue - (o.firstYearFee ?? 0),
          2,
        )
      for (let i = 1; i < list.length; i++)
        expect(list[i - 1]?.firstYearValue).toBeGreaterThanOrEqual(
          list[i]?.firstYearValue ?? 0,
        )
    }
  })

  test('keep personal and business cards apart, and leave out cards closed to applicants', () => {
    expect(offers.personal.every((o) => !o.business)).toBe(true)
    expect(offers.business.every((o) => o.business)).toBe(true)
    for (const o of [...offers.personal, ...offers.business])
      expect(card(o.cardId)?.applications_closed, o.cardId).toBeUndefined()
  })

  test('value Amex and Chase points at transfer value too, and nothing else', () => {
    for (const o of [...offers.personal, ...offers.business]) {
      const cents = TRANSFER_VALUES[o.currency]
      if (cents === undefined || o.points === null) {
        expect(o.transfer, o.cardId).toBeNull()
        continue
      }
      expect(o.transfer?.value, o.cardId).toBeCloseTo((o.points * cents) / 100)
      expect(o.transfer?.firstYearValue, o.cardId).toBeCloseTo(
        (o.points * cents) / 100 - (o.firstYearFee ?? 0),
      )
    }
  })
})

describe('what a planned amount unlocks', () => {
  const offer = { spend: 4000, months: 3 }

  test('even spending reaches the minimum only inside the offer’s window', () => {
    // $4,000 over 3 months: all of it by the deadline.
    expect(reachesMinimum(offer, 4000, 3)).toBe(true)
    // Over 6 months only half is spent in the first 3.
    expect(reachesMinimum(offer, 4000, 6)).toBe(false)
    expect(reachesMinimum(offer, 8000, 6)).toBe(true)
    // Spent in one month, the whole amount is in by the deadline.
    expect(reachesMinimum(offer, 4000, 1)).toBe(true)
    expect(reachesMinimum(offer, 3999, 1)).toBe(false)
    expect(reachesMinimum({ spend: 3000, months: 6 }, 3000, 12)).toBe(false)
    expect(reachesMinimum({ spend: 3000, months: 6 }, 6000, 12)).toBe(true)
  })

  test('an offer with no minimum is unlocked by any spending', () => {
    expect(reachesMinimum({ spend: 0, months: 3 }, 1000, 12)).toBe(true)
    expect(reachesMinimum({ spend: 0, months: 3 }, 0, 12)).toBe(false)
  })

  test("each offer's picker keys are exactly the taps it's unlocked at", () => {
    for (const o of offers.personal) {
      const keys = new Set(unlockedAt(o))
      for (const total of PICKER_AMOUNTS)
        for (const months of PICKER_MONTHS)
          expect(keys.has(pickerKey(total, months)), o.cardId).toBe(
            reachesMinimum(o, total, months),
          )
    }
  })

  test("the page's script sends, saves and addresses nothing, and marks rows with data-*", () => {
    expect(PICKER_SCRIPT).not.toMatch(
      /fetch|sendBeacon|XMLHttpRequest|Storage|cookie|history|location|classList|className|\.id\s*=/,
    )
  })
})

describe('which card to open first', () => {
  const pairs = openFirst(catalog, today)
  const names = (id: string) =>
    new Set([
      ...(card(id)?.welcome_offer?.not_with ?? []),
      ...(card(id)?.welcome_offer?.repeat?.also ?? []),
    ])

  test('the Amex Gold comes before the Platinum, from the Gold’s offer naming it', () => {
    const gold = pairs.find((p) => p.first === 'amex-gold')
    expect(gold?.then).toEqual(['amex-platinum'])
    expect(pairs.some((p) => p.first === 'amex-platinum')).toBe(false)
  })

  test('every pair is one card naming another that does not name it back', () => {
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs)
      for (const then of p.then) {
        expect(names(p.first).has(then), `${p.first} → ${then}`).toBe(true)
        expect(names(then).has(p.first), `${then} → ${p.first}`).toBe(false)
      }
  })

  test('every one-way pair among open offers is found, and cards that name each other get none', () => {
    const open = catalog.cards.filter(
      (c) =>
        c.welcome_offer !== undefined && c.applications_closed === undefined,
    )
    const ids = new Set(open.map((c) => c.id))
    for (const c of open)
      for (const other of names(c.id)) {
        if (!ids.has(other)) continue
        const found = pairs.some(
          (p) => p.first === c.id && p.then.includes(other),
        )
        expect(found, `${c.id} → ${other}`).toBe(!names(other).has(c.id))
      }
  })
})

describe('life events', () => {
  test('every purchase line resolves to a real store or category, or to none earnrate has', () => {
    for (const event of LIFE_EVENTS)
      for (const line of event.lines) {
        const r = resolveLine(ctx, line)
        expect(
          catalog.categories.some((c) => c.id === r.category),
          line.label,
        ).toBe(true)
        if (line.kind !== undefined) {
          expect(r.category, line.label).toBe('other')
          const found = findCategory(catalog, line.kind)
          expect(found === null || found === 'other', line.kind).toBe(true)
        }
        // A store line's stores all code the same way in store.
        expect(
          new Set(r.merchants.map((m) => m.category)).size,
          line.label,
        ).toBeLessThanOrEqual(1)
      }
  })

  test('the wedding page ranks rings and venue as everything else, the dress as clothing, the caterer as caterers, and the honeymoon as travel', () => {
    const wedding = LIFE_EVENTS.find((e) => e.slug === 'wedding')
    if (!wedding) throw new Error('no wedding')
    const category = (label: string) =>
      resolveLine(
        ctx,
        wedding.lines.find((l) => l.label === label) ?? { label },
      ).category
    expect(category('Engagement and wedding rings')).toBe('other')
    expect(category('Wedding dress')).toBe('clothing')
    expect(category('Tux or suit')).toBe('clothing')
    expect(category('Caterer')).toBe('caterers')
    expect(category('Venue')).toBe('other')
    expect(category('Honeymoon flights')).toBe('travel.flights')
    expect(category('Honeymoon hotels')).toBe('travel.hotels')
  })

  test("each event's rankings differ from every other event's", () => {
    const keys = LIFE_EVENTS.map((e) =>
      eventGroups(ctx, e)
        .groups.map((g) => g.key)
        .sort()
        .join(' / '),
    )
    expect(new Set(keys).size).toBe(LIFE_EVENTS.length)
  })

  test("the caterer note quotes the cards whose terms leave caterers out of dining, Chase's Southwest cards among them", () => {
    const notes = termsNotes(ctx, 'caterer')
    const ids = notes.map((n) => n.cardId)
    expect(ids).toContain('chase-southwest-premier')
    expect(ids).toContain('amex-gold')
    for (const n of notes)
      for (const s of n.sentences) expect(s.toLowerCase()).toContain('caterer')
  })

  test('the insurance note cites the Customized Cash online-shopping exclusion', () => {
    const notes = termsNotes(ctx, 'insurance')
    const cash = notes.find(
      (n) => n.cardId === 'bank-of-america-customized-cash-rewards',
    )
    expect(cash?.sentences.join(' ')).toMatch(/insurance/)
    expect(cash?.quotes.join(' ')).toMatch(/insurances/)
  })
})
