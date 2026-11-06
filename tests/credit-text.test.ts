import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { creditWhere } from '../src/engine/rule-text.ts'
import { cardInfo } from '../src/engine/setup.ts'
import { formatCardInfo } from '../src/format/cards.ts'

const catalog = await loadCatalog()
const card = (id: string) => {
  const found = catalog.cards.find((c) => c.id === id)
  if (!found) throw new Error(id)
  return found
}
const credit = (cardId: string, creditId: string) => {
  const found = card(cardId).credits.find((c) => c.id === creditId)
  if (!found) throw new Error(creditId)
  return found
}

describe('merchant credit wording', () => {
  test('a membership reads "on", a store "at"', () => {
    expect(creditWhere(catalog, credit('amex-platinum', 'walmart-plus'))).toBe(
      'on Walmart+ membership',
    )
    expect(creditWhere(catalog, credit('amex-platinum', 'lululemon'))).toBe(
      'at Lululemon',
    )
  })

  test('bookings through a travel site the credit names go without saying', () => {
    expect(
      creditWhere(
        catalog,
        credit('capital-one-venture-x', 'capital-one-travel'),
      ),
    ).toBe('at Capital One Travel')
  })

  test('card search lists credits and names memberships', () => {
    const platinum = formatCardInfo(
      catalog,
      cardInfo(catalog, card('amex-platinum'), null, '2026-11-05'),
    )
    expect(platinum).toMatch(/statement credit lululemon: .* at Lululemon/)
    const deltaGold = formatCardInfo(
      catalog,
      cardInfo(catalog, card('amex-delta-skymiles-gold'), null, '2026-11-05'),
    )
    expect(deltaGold).toMatch(/\$150 a year, waived the first year\)/)
    const penfed = formatCardInfo(
      catalog,
      cardInfo(catalog, card('penfed-power-cash-rewards'), null, '2026-11-05'),
    )
    expect(penfed).toMatch(
      /rates that need a membership: PenFed Honors Advantage \(membership id penfed-honors-advantage\)/,
    )
  })
})

describe('possessive', () => {
  test('a name ending in s takes only an apostrophe', async () => {
    const { possessive } = await import('../src/engine/text.ts')
    expect(possessive('Capital One Savor Rewards')).toBe(
      "Capital One Savor Rewards'",
    )
    expect(possessive('Amex Platinum')).toBe("Amex Platinum's")
  })
})

describe('withArticle', () => {
  test('goes by sound, not the first letter', async () => {
    const { withArticle } = await import('../src/engine/text.ts')
    const cases: [string, string][] = [
      ['Air Canada credit', 'an'],
      ['Instacart credit', 'an'],
      ['Uber and Uber Eats credit', 'a'],
      ['U.S. Bank card', 'a'],
      ['One Key membership', 'a'],
      ['IHG card', 'an'],
      ['REI Co-op membership', 'an'],
      ['CLEAR credit', 'a'],
      ['Costco membership', 'a'],
      ['Equinox credit', 'an'],
    ]
    for (const [name, article] of cases)
      expect(withArticle(name), name).toBe(`${article} ${name}`)
  })
})

describe('rule wording', () => {
  test('one rule picks "on" or "at" for every surface', async () => {
    const { rulePreposition } = await import('../src/engine/rule-text.ts')
    const rule = (cardId: string, ruleId: string) => {
      const found = card(cardId).rules.find((r) => r.id === ruleId)
      if (!found) throw new Error(ruleId)
      return found
    }
    expect(rulePreposition(catalog, [rule('amex-gold', 'restaurants')])).toBe(
      'at',
    )
    expect(
      rulePreposition(catalog, [
        rule('amex-blue-cash-preferred', 'us-streaming'),
      ]),
    ).toBe('on')
    expect(
      rulePreposition(catalog, [rule('usbank-cash-plus', 'five-percent')]),
    ).toBe('on')
  })

  test('pages name every store a rule covers; answers may shorten', async () => {
    const { ruleWhat } = await import('../src/engine/rule-text.ts')
    const bcp = card('amex-blue-cash-preferred')
    const streaming = bcp.rules.find((r) => r.id === 'us-streaming')
    if (!streaming) throw new Error('streaming')
    expect(ruleWhat(catalog, streaming, bcp)).toBe('select streaming services')
    expect(ruleWhat(catalog, streaming, bcp, { everyStore: true })).toMatch(
      /Netflix/,
    )
  })
})
