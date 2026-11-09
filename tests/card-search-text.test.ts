import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { cardDetails } from '../src/engine/card-details.ts'
import { cardInfo } from '../src/engine/setup.ts'
import { formatCardInfo } from '../src/format/cards.ts'
import { formatBooking, formatWalletSummary } from '../src/format/wallet.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
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
