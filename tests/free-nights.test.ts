import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { catalogProblems } from '../src/data/integrity.ts'
import { loadCatalog } from '../src/data/load.ts'
import { checklist } from '../src/engine/checklist.ts'
import { allCreditsYear } from '../src/engine/credits.ts'
import { cardInfo } from '../src/engine/setup.ts'
import {
  askCreditText,
  creditsCountedText,
  creditsYearText,
  ifCreditsUsedText,
  offerPerksText,
} from '../src/engine/text.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { addToWallet, updateInWallet } from '../src/engine/wallet-change.ts'
import { formatCardInfo } from '../src/format/cards.ts'
import { CardSchema, type Card } from '../src/schema/card.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { feeWorthKit } from '../scripts/pages/fee-worth.ts'
import { heldToInput } from '../site/app/sync.ts'

const catalog = await loadCatalog()
const TODAY = '2026-10-24'
const IHG = 'chase-ihg-one-rewards-premier'

const cardOf = (id: string): Card => {
  const card = catalog.cards.find((c) => c.id === id)
  if (!card) throw new Error(`no ${id}`)
  return card
}
const asks = (cards: object[]) =>
  checklist(catalog, WalletSchema.parse({ cards }), TODAY).filter((i) =>
    i.text.startsWith('Do you use'),
  )

describe('a free night in the data', () => {
  test('every catalog night has a cap a quote states', () => {
    const withNights = catalog.cards.filter((c) => c.free_nights.length > 0)
    expect(withNights.map((c) => c.id).sort()).toEqual([
      'amex-marriott-bonvoy-brilliant',
      'amex-marriott-bonvoy-business',
      'chase-ihg-one-rewards-business',
      IHG,
      'chase-ihg-one-rewards-premier-select',
      'chase-marriott-bonvoy-boundless',
    ])
  })

  test('a night without a quote stating its cap is a problem', () => {
    const card = cardOf(IHG)
    const unquoted = CardSchema.parse({
      ...card,
      evidence: card.evidence.filter((e) => e.rule !== 'anniversary-night'),
    })
    expect(
      catalogProblems({
        ...catalog,
        cards: [...catalog.cards.filter((c) => c.id !== IHG), unquoted],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/anniversary-night: no evidence quote states/),
      ]),
    )
  }, 30_000)

  test("a night can't share an id with a credit", () => {
    const card = cardOf(IHG)
    const clash = parse(
      'free_nights: [{ id: instacart, points: 50000 }]',
    ) as object
    expect(CardSchema.safeParse({ ...card, ...clash }).success).toBe(false)
  })
})

describe('a free night over a year', () => {
  test("is its cap at the point value, once a year, and said as 'up to'", () => {
    const year = allCreditsYear(catalog, cardOf(IHG), TODAY, {})
    expect(year).toMatchObject({
      yearly: 370,
      nights: 250,
      nightIds: ['anniversary-night'],
      names: ['Instacart', 'anniversary free night'],
    })
    expect(creditsYearText(year)).toBe(
      'up to $370 a year: Instacart and anniversary free night',
    )
    expect(ifCreditsUsedText(year, 120)).toBe(
      "If you'd use all its statement credits and free night (up to $370 a year: Instacart and anniversary free night), it nets up to $120 a year.",
    )
    expect(
      allCreditsYear(catalog, cardOf(IHG), TODAY, { 'ihg-points': 0.6 }).nights,
    ).toBe(300)
  })

  test('a held card counts it only once said in use', () => {
    const summary = (fields: object) =>
      walletSummary(
        catalog,
        WalletSchema.parse({ cards: [{ id: IHG, ...fields }] }),
        TODAY,
      ).cards[0]
    expect(summary({})?.usedCredits).toBe(0)
    expect(summary({})?.freeNights[0]?.text).toBe(
      'An anniversary free night each year, up to 50,000 IHG One Rewards points (up to $250 at 0.5¢ a point): not counted against the annual fee until you say you use it.',
    )
    const used = summary({ enrolled: ['anniversary-night'] })
    expect(used?.usedCredits).toBe(250)
    expect(used?.usedCreditsText).toBe(
      "IHG One Rewards Premier's anniversary free night, which you use, counts against its fee: up to $250 a year.",
    )
    expect(
      summary({
        enrolled: ['anniversary-night'],
        skipped_credits: ['anniversary-night'],
      })?.usedCredits,
    ).toBe(0)
  })

  test('wording with credits and a night together', () => {
    expect(
      creditsCountedText('Amex Brilliant', 650, {
        yearly: 725,
        names: ['restaurants', 'anniversary free night'],
        nights: 425,
        nightIds: ['anniversary-night'],
      }),
    ).toBe(
      "Amex Brilliant's credits and free night you use (restaurants and anniversary free night) count against its fee: up to $725 a year.",
    )
    expect(offerPerksText(120, 250)).toEqual([
      "its credits are $120 a year more if you'd use them all",
      "its anniversary free night is up to $250 a year more from the first anniversary, if you'd use it",
    ])
  })
})

describe('asking about a free night', () => {
  test('asks once per card, folded into its credits question', () => {
    expect(asks([{ id: IHG }]).map((i) => i.text)).toEqual([
      "Do you use IHG One Rewards Premier Credit Card's anniversary free night? Say you use it and it counts against the annual fee.",
    ])
    const brilliant = asks([{ id: 'amex-marriott-bonvoy-brilliant' }])
    expect(brilliant).toHaveLength(1)
    expect(brilliant[0]?.text).toBe(
      "Do you use Marriott Bonvoy Brilliant American Express Card's restaurants credit and anniversary free night? Say which you use and they count against the annual fee.",
    )
    expect(brilliant[0]?.ref).toBe('dining,anniversary-night')
    expect(asks([{ id: IHG, enrolled: ['anniversary-night'] }])).toEqual([])
    expect(asks([{ id: IHG, skipped_credits: ['anniversary-night'] }])).toEqual(
      [],
    )
  })

  test('the plain question text', () => {
    expect(askCreditText('IHG Premier', [], 1)).toBe(
      "Do you use IHG Premier's anniversary free night? Say you use it and it counts against the annual fee.",
    )
    expect(askCreditText('Amex Gold', ['Uber'])).toBe(
      "Do you use Amex Gold's Uber credit? Say you use it and it counts against the annual fee.",
    )
  })
})

describe('marking a free night used or not', () => {
  test('goes in enrolled and skipped_credits beside the credits', () => {
    const added = addToWallet(
      catalog,
      null,
      { id: IHG, enrolled: ['anniversary-night'] },
      TODAY,
    )
    if (!added.ok) throw new Error(added.error)
    expect(added.wallet.cards[0]?.enrolled).toEqual(['anniversary-night'])
    const skipped = updateInWallet(
      catalog,
      added.wallet,
      { id: IHG, skippedCredits: ['anniversary-night'] },
      TODAY,
    )
    if (!skipped.ok) throw new Error(skipped.error)
    expect(skipped.wallet.cards[0]?.skipped_credits).toEqual([
      'anniversary-night',
    ])
    const [held] = skipped.wallet.cards
    if (!held) throw new Error('no card')
    expect(heldToInput(catalog, held, TODAY)).toMatchObject({
      enrolled: ['anniversary-night'],
      skippedCredits: ['anniversary-night'],
    })
  })

  test('refuses an unknown id, listing credits and free nights, and usage on a night', () => {
    const wrong = addToWallet(
      catalog,
      null,
      { id: IHG, enrolled: ['nope'] },
      TODAY,
    )
    expect(wrong.ok || wrong.error).toMatch(
      /has no credit 'nope'\. Its credits and free nights are: instacart, anniversary-night\./,
    )
    const used = addToWallet(
      catalog,
      null,
      { id: IHG, creditUsed: { 'anniversary-night': 1 } },
      TODAY,
    )
    expect(used.ok).toBe(false)
  })
})

describe('where a free night is listed', () => {
  test('card search gives its id, cap and value', () => {
    const info = cardInfo(catalog, cardOf(IHG), null, TODAY)
    expect(info.freeNights).toEqual([
      {
        id: 'anniversary-night',
        points: 50000,
        value: 250,
        text: 'an anniversary free night each year, up to 50,000 IHG One Rewards points (up to $250 at 0.5¢ a point)',
      },
    ])
    expect(formatCardInfo(catalog, info)).toMatch(
      /free night anniversary-night: an anniversary free night each year/,
    )
  })

  test("the card page's fee math counts it with the credits, apart", () => {
    const { feeWorth } = feeWorthKit(catalog, TODAY)
    const worth = feeWorth(cardOf(IHG))
    expect(worth?.credits).toMatchObject({ yearly: 370, nights: 250 })
    expect(worth?.creditsBreakEven).not.toBeNull()
  })
})
