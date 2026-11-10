import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { cardDetails } from '../src/engine/card-details.ts'
import { cardInfo } from '../src/engine/setup.ts'
import { formatCardInfo } from '../src/format/cards.ts'
import { formatBooking, formatWalletSummary } from '../src/format/wallet.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { capNamed } from '../src/engine/text.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
const TODAY = '2026-11-09'

const search = (id: string) => {
  const card = catalog.cards.find((c) => c.id === id)
  if (!card) throw new Error(id)
  const [details] = cardDetails(catalog, [id], null, TODAY) ?? []
  return formatCardInfo(catalog, cardInfo(catalog, card, null, TODAY), details)
}

test('a card with no annual fee on file says so', () => {
  expect(search('citi-custom-cash')).toMatch(
    /^citi-custom-cash: .+\(Mastercard, annual fee not on file\)/,
  )
})

test('a category the issuer applies itself is described as such', () => {
  expect(search('citi-custom-cash')).toMatch(
    /top-category: the issuer applies it to the one with the most spending; the wallet can set the expected one of restaurants, gas-stations,/,
  )
})

test("search shows a card's recent issuer changes and earnrate's corrections", () => {
  const text = search('chase-prime-visa')
  expect(text).toMatch(
    /recent change: Nov 7, 2026, the issuer changed it: Prime Visa's welcome offer: \$150 → \$200/,
  )
  expect(text).toMatch(
    /recent change: Nov 2, 2026, earnrate corrected its own data \(the issuer didn't change anything\): 5% at Whole Foods applies in the U\.S\. only/,
  )
})

test('a cap named by a phrase reads after "its cap on"', () => {
  const booking = {
    cardId: 'citi-custom-cash',
    capKey: 'top-category',
    ruleId: 'top-category-restaurants',
    period: '2026-11',
    periodKind: 'month' as const,
    capAmount: 500,
    before: 0,
    after: 40,
  }
  expect(
    formatBooking(
      40,
      'Citi Custom Cash',
      booking,
      null,
      [],
      null,
      'the category you spend the most in each month',
    ),
  ).toMatch(
    /^Recorded \$40 on Citi Custom Cash toward its cap on the category you spend the most in each month: \$0 → \$40 of \$500 for November 2026, \$460 left\./,
  )
  expect(
    formatBooking(
      40,
      'Amex Blue Cash Preferred',
      booking,
      null,
      [],
      null,
      'supermarkets',
    ),
  ).toMatch(/toward its supermarkets cap:/)
})

test('picks the issuer applies itself read as expected, by month name', () => {
  const wallet = WalletSchema.parse({
    cards: [
      {
        id: 'citi-custom-cash',
        chosen: {
          period: '2026-11',
          picks: { 'top-category': ['restaurants'] },
        },
      },
    ],
  })
  expect(formatWalletSummary(walletSummary(catalog, wallet, TODAY))).toMatch(
    /Expected for November 2026, through Nov 30, 2026: top category: restaurants\. The issuer applies the bonus where the most is spent; set the expected category again after that\./,
  )
})

test('search shows the published welcome offer with its fine print', () => {
  expect(search('td-bank-nordstrom-visa')).toMatch(
    /welcome offer \(published\): \$60 with no spending required; the offer ends Dec 1, 2026\. A \$60 Nordstrom Note, not a statement credit/,
  )
})

test('rules matched only by store codes are named, not read out as codes', () => {
  const text = search('td-bank-nordstrom-visa')
  expect(text).not.toMatch(/MCC/)
  expect(text).toMatch(
    /at .*caterers, meat markets, candy and nut stores, dairy stores, bakeries and liquor stores/,
  )
})

test("the credits verdict says why a fee card's lead ends", () => {
  expect(search('chase-sapphire-preferred')).toMatch(
    /past that, the best no-fee card earns more, since each extra dollar earns less on this card than on that one\./,
  )
  expect(search('amex-blue-cash-preferred')).toMatch(
    /past that, the best no-fee card earns more, since a spending cap ends its lead\./,
  )
})

test("a card's note on how its rates count comes with them", () => {
  expect(search('td-bank-nordstrom-visa')).toMatch(
    /about these rates: At Nordstrom, these rates are what the card adds on top of the 1 point per dollar every Nordy Club member earns paying any way/,
  )
  expect(search('amex-gold')).not.toMatch(/about these rates/)
})

test('a cap past its limit says so, and cap names read in a sentence', () => {
  const booking = {
    cardId: 'usbank-cash-plus',
    capKey: 'five-percent',
    ruleId: 'five-percent',
    period: '2026-Q4',
    periodKind: 'quarter' as const,
    capAmount: 2000,
    before: 1950,
    after: 2050,
  }
  expect(
    formatBooking(
      100,
      'Cash+',
      booking,
      null,
      [],
      null,
      'the 2 categories you pick each quarter',
    ),
  ).toMatch(
    /^Recorded \$100 on Cash\+ toward its cap on the 2 categories you pick each quarter: \$1,950 → \$2,000 of \$2,000 for Q4 2026, \$0 left; the \$50 past the cap earns the card's rate after it\./,
  )
  expect(capNamed("Cash+'s", 'the 2 categories you pick each quarter')).toBe(
    "Cash+'s cap on the 2 categories you pick each quarter",
  )
  expect(capNamed("Blue Cash Preferred's", 'supermarkets')).toBe(
    "Blue Cash Preferred's supermarkets cap",
  )
  const platinum = walletSummary(
    catalog,
    WalletSchema.parse({ cards: [{ id: 'amex-platinum' }] }),
    TODAY,
  ).cards[0]
  expect(platinum?.caps.map((c) => c.label)).toContain(
    'flights booked directly or through Amex Travel',
  )
})

test('"cash+" finds only the card with a + in its name', async () => {
  const { searchCards } = await import('../src/engine/setup.ts')
  expect(
    searchCards(catalog, 'cash+', null, TODAY).cards.map((c) => c.id),
  ).toEqual(['usbank-cash-plus'])
  expect(
    searchCards(catalog, 'cash plus', null, TODAY).cards.length,
  ).toBeGreaterThan(1)
})

test("a members-only card's rates share one line on the cheat sheet", async () => {
  const { catalogCheatSheet } = await import('../src/engine/cheat-sheet.ts')
  const { ALL_PERSONAL_CARDS } = await import('../src/engine/explore.ts')
  const sheet = catalogCheatSheet(catalog, TODAY, {
    filters: { ...ALL_PERSONAL_CARDS, kind: 'cash' },
    memberships: [],
    valuations: {},
  })
  const costco = sheet.membersOnly.filter((l) => l.includes('Costco Anywhere'))
  expect(costco).toHaveLength(1)
  expect(costco[0]).toMatch(
    /Costco Anywhere Visa Card by Citi, 4% for gas and 3% for travel\./,
  )
})

test('a credit the user says they use gets its use-by reminder', async () => {
  const { checklist } = await import('../src/engine/checklist.ts')
  const items = (enrolled: string[]) =>
    checklist(
      catalog,
      WalletSchema.parse({ cards: [{ id: 'amex-gold', enrolled }] }),
      TODAY,
    ).filter((i) => i.kind === 'credit')
  expect(items([]).map((i) => i.ref)).not.toContain('uber-cash')
  expect(items(['uber-cash']).map((i) => i.ref)).toContain('uber-cash')
})
