import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import { FileWalletStore } from '../src/data/file-store.ts'
import { catalogProblems, walletProblems } from '../src/data/integrity.ts'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import { JsonWalletStore } from '../src/data/store.ts'
import { checklist } from '../src/engine/checklist.ts'
import { allCreditsYear, usedCreditsYear } from '../src/engine/credits.ts'
import { renewalCheck } from '../src/engine/renewal.ts'
import { cardInfo } from '../src/engine/setup.ts'
import {
  askCreditText,
  creditsCountedText,
  creditsOnlyIf,
  creditsYearText,
  ifCreditsUsedText,
  offerPerksText,
  renewalText,
} from '../src/engine/text.ts'
import { walletSummary } from '../src/engine/wallet-summary.ts'
import { addToWallet, updateInWallet } from '../src/engine/wallet-change.ts'
import { formatCardInfo } from '../src/format/cards.ts'
import { CardSchema, type Card } from '../src/schema/card.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { feeWorthCredits, feeWorthKit } from '../src/engine/fee-worth.ts'
import { heldToInput } from '../site/app/sync.ts'
import { memoryBackend } from './helpers.ts'

const catalog = await loadCatalog()
const TODAY = '2026-10-24'
const IHG = 'chase-ihg-one-rewards-premier'
const ASPIRE = 'amex-hilton-honors-aspire'

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
  test('every catalog night but Aspire has a cap a quote states', () => {
    const withNights = catalog.cards.filter((c) => c.free_nights.length > 0)
    expect(withNights.map((c) => c.id).sort()).toEqual([
      ASPIRE,
      'amex-marriott-bonvoy-brilliant',
      'amex-marriott-bonvoy-business',
      'chase-ihg-one-rewards-business',
      IHG,
      'chase-ihg-one-rewards-premier-select',
      'chase-marriott-bonvoy-boundless',
    ])
    expect(
      withNights
        .filter((c) => c.free_nights.some((n) => n.points === undefined))
        .map((c) => c.id),
    ).toEqual([ASPIRE])
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
        ownValue: null,
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

const held = (cards: object[]) => WalletSchema.parse({ cards })
const changed = (result: ReturnType<typeof updateInWallet>) => {
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('what a free night is worth to you', () => {
  test('replaces the cap value, said as theirs rather than "up to"', () => {
    const wallet = held([
      {
        id: IHG,
        enrolled: ['anniversary-night'],
        night_values: { 'anniversary-night': 300 },
      },
    ])
    const [own] = wallet.cards
    if (!own) throw new Error('no card')
    const year = usedCreditsYear(catalog, cardOf(IHG), own, TODAY, {})
    expect(year).toMatchObject({
      yearly: 300,
      nights: 0,
      ownNights: 300,
      nightIds: ['anniversary-night'],
      ownNightIds: ['anniversary-night'],
      names: ['anniversary free night worth $300 to you'],
    })
    const summary = walletSummary(catalog, wallet, TODAY).cards[0]
    expect(summary?.freeNights[0]).toMatchObject({
      value: 250,
      ownValue: 300,
      text: 'An anniversary free night each year, up to 50,000 IHG One Rewards points (worth $300 to you): you use it, so it counts against the annual fee.',
    })
    expect(summary?.usedCreditsText).toBe(
      "IHG One Rewards Premier's anniversary free night worth $300 to you counts against its fee: $300 a year.",
    )
    expect(creditsOnlyIf(year)).toBe('')
    expect(cardInfo(catalog, cardOf(IHG), wallet, TODAY).freeNights).toEqual([
      {
        id: 'anniversary-night',
        points: 50000,
        value: 250,
        ownValue: 300,
        text: 'an anniversary free night each year, up to 50,000 IHG One Rewards points (worth $300 to you)',
      },
    ])
  })

  test("Aspire's night has no cap: listed, not valued, not asked about, until the user says", () => {
    const card = cardOf(ASPIRE)
    const year = allCreditsYear(catalog, card, TODAY, {})
    expect(year.nightIds).toEqual([])
    expect(year.unvaluedNightIds).toEqual(['anniversary-night'])
    expect(year.yearly).toBe(819)
    const before = held([{ id: ASPIRE, enrolled: ['anniversary-night'] }])
    expect(walletSummary(catalog, before, TODAY).cards[0]?.freeNights).toEqual([
      expect.objectContaining({
        points: null,
        value: null,
        ownValue: null,
        text: "An anniversary free night each year, with no point cap: not counted against the annual fee until you say what it's worth to you.",
      }),
    ])
    expect(
      walletSummary(catalog, before, TODAY).cards[0]?.usedCreditsText,
    ).toBeNull()
    expect(asks([{ id: ASPIRE }]).map((i) => i.ref)).toEqual([
      'flight-credit,clear-plus,resort-credit',
    ])
    expect(cardInfo(catalog, card, null, TODAY).freeNights[0]?.text).toBe(
      "an anniversary free night each year, with no point cap (not valued: what it's worth depends on the hotel)",
    )
    expect(cardInfo(catalog, card, before, TODAY).freeNights[0]?.text).toBe(
      "an anniversary free night each year, with no point cap (not counted until you say what it's worth to you)",
    )
    const after = held([
      {
        id: ASPIRE,
        enrolled: ['anniversary-night'],
        night_values: { 'anniversary-night': 500 },
      },
    ])
    expect(walletSummary(catalog, after, TODAY).cards[0]).toMatchObject({
      usedCredits: 500,
      usedCreditsText:
        "Hilton Honors American Express Aspire's anniversary free night worth $500 to you counts against its fee: $500 a year.",
    })
  })

  test('the renewal check counts it at their value, or says the uncapped night needs one', () => {
    const due = '2026-11-20'
    const renewal = (fields: object) =>
      renewalCheck(
        catalog,
        held([{ id: ASPIRE, anniversary: '11-20', ...fields }]),
        cardOf(ASPIRE),
        due,
      )
    const without = renewal({ enrolled: ['anniversary-night'] })
    expect(without).toMatchObject({
      credits: 0,
      ownNights: 0,
      nightsUnvalued: 1,
    })
    expect(renewalText('Aspire', 'American Express', without)).toMatch(
      /short of the fee\. Its anniversary free night isn't counted until you say what it's worth to you\. Check with American Express/,
    )
    const valued = renewal({
      enrolled: ['anniversary-night'],
      night_values: { 'anniversary-night': 500 },
    })
    expect(valued).toMatchObject({
      credits: 500,
      ownNights: 500,
      freeNights: 0,
      nightsUnvalued: 0,
    })
    expect(renewalText('Aspire', 'American Express', valued)).toMatch(
      /plus the \$500 its anniversary free night is worth to you: /,
    )
    const ihg = renewalCheck(
      catalog,
      held([
        {
          id: IHG,
          anniversary: '11-20',
          night_values: { 'anniversary-night': 400 },
        },
      ]),
      cardOf(IHG),
      due,
    )
    expect(ihg).toMatchObject({
      nightsNotCounted: 400,
      nightsNotCountedOwn: true,
    })
  })

  test("the fee math uses a held card's value, and names an uncapped night it leaves out", () => {
    const own = held([
      { id: IHG, night_values: { 'anniversary-night': 300 } },
      { id: ASPIRE },
    ]).cards
    const { feeWorth } = feeWorthKit(catalog, TODAY, {}, own)
    const ihg = feeWorth(cardOf(IHG))
    expect(ihg?.credits).toMatchObject({
      yearly: 420,
      nights: 0,
      ownNights: 300,
    })
    if (!ihg) throw new Error('no fee math')
    expect(feeWorthCredits(catalog, ihg)).toMatch(
      /\(\$420 a year: Instacart and anniversary free night worth \$300 to you\)/,
    )
    const aspire = feeWorth(cardOf(ASPIRE))
    if (!aspire) throw new Error('no fee math')
    expect(feeWorthCredits(catalog, aspire)).toMatch(
      /Its anniversary free night isn't counted until you say what it's worth to you\.$/,
    )
    const unheld = feeWorthKit(catalog, TODAY).feeWorth(cardOf(ASPIRE))
    if (!unheld) throw new Error('no fee math')
    expect(feeWorthCredits(catalog, unheld)).toMatch(
      /Its anniversary free night isn't counted: with no point cap, what it's worth depends on the hotel\.$/,
    )
  })
})

describe('setting what a free night is worth', () => {
  const start = held([{ id: IHG }])

  test('saves it, marks the night used and takes it off the skipped list', () => {
    const set = changed(
      updateInWallet(
        catalog,
        held([{ id: IHG, skipped_credits: ['anniversary-night'] }]),
        { id: IHG, nightValues: { 'anniversary-night': 300 } },
        TODAY,
      ),
    )
    expect(set.fields).toEqual({
      enrolled: ['anniversary-night'],
      skipped_credits: [],
      night_values: { 'anniversary-night': 300 },
    })
    expect(set.wallet.cards[0]).toMatchObject({
      enrolled: ['anniversary-night'],
      night_values: { 'anniversary-night': 300 },
    })
  })

  test('a skipped list that names it wins', () => {
    const set = changed(
      updateInWallet(
        catalog,
        start,
        {
          id: IHG,
          enrolled: [],
          skippedCredits: ['anniversary-night'],
          nightValues: { 'anniversary-night': 300 },
        },
        TODAY,
      ),
    )
    expect(set.fields).toMatchObject({
      enrolled: [],
      skipped_credits: ['anniversary-night'],
    })
  })

  test('given beside an enrolled list that leaves it out, the night still counts as used', () => {
    const set = changed(
      updateInWallet(
        catalog,
        held([{ id: ASPIRE }]),
        {
          id: ASPIRE,
          enrolled: ['resort-credit', 'flight-credit'],
          nightValues: { 'anniversary-night': 400 },
        },
        TODAY,
      ),
    )
    expect(set.fields).toMatchObject({
      enrolled: ['resort-credit', 'flight-credit', 'anniversary-night'],
      night_values: { 'anniversary-night': 400 },
    })
  })

  test('null clears it, dropping the field when none are left', () => {
    const set = changed(
      updateInWallet(
        catalog,
        start,
        { id: IHG, nightValues: { 'anniversary-night': 300 } },
        TODAY,
      ),
    )
    const cleared = changed(
      updateInWallet(
        catalog,
        set.wallet,
        { id: IHG, nightValues: { 'anniversary-night': null } },
        TODAY,
      ),
    )
    expect(cleared.fields.night_values).toEqual({})
    expect(cleared.wallet.cards[0]).not.toHaveProperty('night_values')
    expect(cleared.wallet.cards[0]?.enrolled).toEqual(['anniversary-night'])
  })

  test('refuses an unknown night, a card without one, and values out of range', () => {
    const refused = (
      input: Parameters<typeof updateInWallet>[2],
      wallet = start,
    ) => {
      const result = updateInWallet(catalog, wallet, input, TODAY)
      return result.ok ? null : result.error
    }
    expect(refused({ id: IHG, nightValues: { instacart: 100 } })).toBe(
      "chase-ihg-one-rewards-premier has no free night 'instacart'. Its free nights are: anniversary-night.",
    )
    expect(
      refused(
        { id: 'amex-gold', nightValues: { 'anniversary-night': 100 } },
        held([{ id: 'amex-gold' }]),
      ),
    ).toBe('amex-gold has no yearly free night.')
    const range =
      'What a free night is worth to you must be more than $0 and at most $5,000.'
    for (const dollars of [0, -50, 5001, Number.NaN])
      expect(
        refused({ id: IHG, nightValues: { 'anniversary-night': dollars } }),
      ).toBe(range)
    expect(
      refused({ id: IHG, nightValues: { 'anniversary-night': 5000 } }),
    ).toBeNull()
  })

  test('syncs as part of the card, for nights the card still has', () => {
    const [card] = held([
      {
        id: IHG,
        enrolled: ['anniversary-night'],
        night_values: { 'anniversary-night': 300, gone: 1 },
      },
    ]).cards
    if (!card) throw new Error('no card')
    expect(heldToInput(catalog, card, TODAY)).toMatchObject({
      enrolled: ['anniversary-night'],
      nightValues: { 'anniversary-night': 300 },
    })
  })
})

describe('the wallet file keeps a night value as lines of its own', () => {
  const COMMENTED = `# my cards
cards:
  - id: chase-ihg-one-rewards-premier # the hotel one
    enrolled: [anniversary-night]
  # paid yearly
  - id: amex-gold
`

  test('set, changed and cleared, keeping comments', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-night-'))
    const file = path.join(dir, 'wallet.yaml')
    await writeFile(file, COMMENTED)
    const store = new FileWalletStore(catalog, file)
    const set = await store.updateCard(
      { id: IHG, nightValues: { 'anniversary-night': 300 } },
      TODAY,
    )
    if (!set.ok) throw new Error(set.error)
    expect(await readFile(file, 'utf8')).toBe(
      COMMENTED.replace(
        '    enrolled: [anniversary-night]\n',
        '    enrolled: [anniversary-night]\n    night_values:\n      anniversary-night: 300\n',
      ),
    )
    const moved = await store.updateCard(
      { id: IHG, nightValues: { 'anniversary-night': 425.5 } },
      TODAY,
    )
    if (!moved.ok) throw new Error(moved.error)
    expect(await readFile(file, 'utf8')).toContain(
      '    night_values:\n      anniversary-night: 425.5\n  # paid yearly\n',
    )
    expect((await loadWallet(file)).cards[0]?.night_values).toEqual({
      'anniversary-night': 425.5,
    })
    const cleared = await store.updateCard(
      { id: IHG, nightValues: { 'anniversary-night': null } },
      TODAY,
    )
    if (!cleared.ok) throw new Error(cleared.error)
    expect(await readFile(file, 'utf8')).toBe(COMMENTED)
  })

  test('the JSON store keeps it the same way', async () => {
    const store = new JsonWalletStore(
      catalog,
      memoryBackend(),
      'your saved wallet',
    )
    const added = await store.addCard(
      { id: ASPIRE, nightValues: { 'anniversary-night': 500 } },
      TODAY,
    )
    if (!added.ok) throw new Error(added.error)
    expect((await store.load())?.cards[0]).toMatchObject({
      enrolled: ['anniversary-night'],
      night_values: { 'anniversary-night': 500 },
    })
  })

  test('a value for a night the card lacks is a wallet problem', () => {
    expect(
      walletProblems(
        held([{ id: 'amex-gold', night_values: { 'anniversary-night': 1 } }]),
        catalog,
      ),
    ).toEqual([
      "wallet card amex-gold night_values: 'anniversary-night' is not a free night on this card",
    ])
  })
})
