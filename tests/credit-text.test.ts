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
    expect(platinum).toMatch(/merchant credit lululemon: .* at Lululemon/)
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
