import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { cardDetails, DETAILED_UP_TO } from '../src/engine/card-details.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import {
  feeWorthCredits,
  feeWorthKit,
  feeWorthMix,
  feeWorthTransfer,
  feeWorthVerdict,
  TRANSFER_VALUES,
  wholeShares,
  type FeeWorth,
} from '../src/engine/fee-worth.ts'
import {
  resolveSpendLines,
  simulateSingles,
  spendLineFor,
  typicalSpendLines,
} from '../src/engine/simulate.ts'
import { shortCardName } from '../src/engine/text.ts'
import { pageContext } from '../scripts/pages/context.ts'
import { feeWorthSection } from '../scripts/pages/fee-worth.ts'
import { TODAY } from './golden/fixtures.ts'

const catalog = await loadCatalog()
const cardOf = (id: string) => {
  const card = catalog.cards.find((c) => c.id === id)
  if (!card) throw new Error(id)
  return card
}
const plain = (html: string) => html.replace(/<[^>]+>/g, '')

describe('is the annual fee worth it', () => {
  test('the card page and the answers say the same sentences', () => {
    const ctx = pageContext(catalog, { today: TODAY, dataVersion: 'test' })
    const { feeWorth } = feeWorthKit(catalog, TODAY)
    const transferred = feeWorthKit(catalog, TODAY, TRANSFER_VALUES)
    for (const id of ['amex-gold', 'chase-sapphire-preferred']) {
      const worth = feeWorth(cardOf(id))
      if (!worth) throw new Error(id)
      const transfer = {
        worth: transferred.feeWorth(cardOf(id)),
        cents: TRANSFER_VALUES[worth.card.currency] ?? 0,
      }
      const page = plain(feeWorthSection(ctx, worth, transfer))
      expect(page).toContain(
        feeWorthVerdict(worth, shortCardName(worth.card.name)),
      )
      expect(page).toContain(feeWorthTransfer(catalog, worth.card, transfer))
      expect(page).toContain(feeWorthCredits(catalog, worth))
    }
  }, 30_000)

  test('one credit reads in the singular, several in the plural', () => {
    const { feeWorth } = feeWorthKit(catalog, TODAY)
    const one = feeWorth(cardOf('chase-sapphire-preferred'))
    const several = feeWorth(cardOf('amex-gold'))
    if (!one || !several) throw new Error('no fee math')
    expect(feeWorthCredits(catalog, one)).toMatch(
      /^If you'd use its statement credit \(\$100 a year at Chase Travel\), it's worth more .* It's worth that only if you'd spend there anyway\.$/,
    )
    expect(feeWorthCredits(catalog, several)).toMatch(
      /^If you'd use all its statement credits \(\$424 a year: .*\), they're worth more .* They're worth that only if/,
    )
  }, 30_000)

  test('point values change the amounts, not which categories are its bonus', () => {
    const gold = cardOf('amex-gold')
    const usual = feeWorthKit(catalog, TODAY).feeWorth(gold)
    const higher = feeWorthKit(catalog, TODAY, { MR: 2 }).feeWorth(gold)
    expect(higher?.lines.map((l) => l.label)).toEqual(
      usual?.lines.map((l) => l.label),
    )
    expect(higher?.breakEven ?? Infinity).toBeLessThan(
      usual?.breakEven ?? Infinity,
    )
  }, 30_000)

  test('card details: rates for every card, fee math only with a fee', () => {
    const details = cardDetails(
      catalog,
      ['amex-gold', 'citi-double-cash'],
      null,
      TODAY,
    )
    expect(details?.[0]?.feeWorth?.text).toMatch(/^On earning alone/)
    expect(details?.[1]?.feeWorth).toBeNull()
    expect(details?.[1]?.earning).toContain('2% cash back on everything else')
    const many = catalog.cards.slice(0, DETAILED_UP_TO + 1).map((c) => c.id)
    expect(cardDetails(catalog, many, null, TODAY)).toBeNull()
  }, 30_000)

  test('a rate only on big purchases still leaves the base rate listed', () => {
    const [details] =
      cardDetails(catalog, ['amex-business-platinum'], null, TODAY) ?? []
    expect(details?.earning.at(-1)).toMatch(/on everything else$/)
  }, 30_000)
})

describe("the annual-fee section's numbers", () => {
  test('a card that picks its bonus category counts only the category it picks', () => {
    const { feeWorth } = feeWorthKit(catalog, TODAY)
    const obsidian = feeWorth(cardOf('bilt-obsidian'))
    expect(obsidian?.lines.map((l) => l.label)).toEqual([
      'Supermarkets',
      'Flights',
      'Hotels',
    ])
  })

  test('a flat 2% card on the typical mix earns round figures at every amount in the table', () => {
    const lines = typicalSpendLines(catalog)
    const total = lines.reduce((s, l) => s + l.monthly, 0)
    for (const monthly of [500, 1000, 2000, 4000]) {
      const [sim] = simulateSingles(
        catalog,
        [cardOf('citi-double-cash')],
        lines.map((l) => ({ ...l, monthly: (l.monthly / total) * monthly })),
        {
          filters: ALL_PERSONAL_CARDS,
          memberships: [],
          valuations: {},
          start: TODAY,
        },
      )
      expect(sim?.rewards).toBe(monthly * 12 * 0.02)
      expect(sim?.spend).toBe(monthly * 12)
    }
  })

  test('mix shares add up to 100, everything else comes last, and a part with its own "and" keeps the final "and"', () => {
    expect(
      wholeShares(typicalSpendLines(catalog)).reduce((s, n) => s + n, 0),
    ).toBe(100)
    const { feeWorth } = feeWorthKit(catalog, TODAY)
    for (const id of ['amex-gold', 'chase-sapphire-reserve', 'bilt-obsidian']) {
      const w = feeWorth(cardOf(id))
      if (!w) throw new Error(id)
      expect(wholeShares(w.lines).reduce((s, n) => s + n, 0)).toBe(100)
      const other = w.lines.findIndex((l) => l.merchant.category === 'other')
      if (other !== -1) expect(other).toBe(w.lines.length - 1)
    }
    const preferred = feeWorth(cardOf('amex-blue-cash-preferred'))
    if (!preferred) throw new Error('amex-blue-cash-preferred')
    expect(feeWorthMix(preferred)).toMatch(/\d+% streaming services/)
    const thirds = resolveSpendLines(catalog, [
      spendLineFor(catalog, 'Transit', 100),
      spendLineFor(catalog, 'Drugstores', 100),
      spendLineFor(catalog, 'Everything else', 100),
    ])
    expect(wholeShares(thirds)).toEqual([34, 33, 33])
    const mix = feeWorthMix({ lines: thirds } as FeeWorth)
    expect(mix).toBe(
      '34% transit, 33% drugstores and pharmacies, and 33% everything else',
    )
  })
})
