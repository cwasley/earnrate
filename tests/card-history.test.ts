import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { run } from '../src/cli/run.ts'
import { FileWalletStore } from '../src/data/file-store.ts'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import { setPastCardsText } from '../src/data/wallet-edit.ts'
import { checklistRows } from '../src/engine/checklist.ts'
import { compareOffers, historyOf } from '../src/engine/offers.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import { steps, type Job } from '../site/app/find/steps.ts'
import {
  bonusEligibility,
  repeatMonthFields,
  repeatRuleParts,
} from '../src/engine/repeat-bonus.ts'
import { formatOffers } from '../src/format/offers.ts'
import {
  heldInHistoryLine,
  removeFromWallet,
  updateInWallet,
  withPastCards,
} from '../src/engine/wallet-change.ts'
import { resolveMerchant } from '../src/merchants/resolve.ts'
import { WalletSchema, type Wallet } from '../src/schema/wallet.ts'
import { pastCardNote } from '../site/app/card-history.ts'
import {
  futureMonth,
  monthOf,
  partsOf,
  yearsFor,
  YEARS_BACK,
} from '../site/app/month-pick.ts'
import { tabFor } from '../site/tabs.ts'
import { bonusRulesPage } from '../scripts/pages/bonus-rules.ts'
import { pageContext } from '../scripts/pages/context.ts'
import {
  applyLocally,
  combineOps,
  historyOp,
  monthAskOp,
  pastCardOpInput,
  removalOps,
} from '../site/app/sync.ts'

const catalog = await loadCatalog()
const TODAY = '2026-11-17'

const COMMENTED = `# my cards
memberships: [amazon-prime]

cards:
  - id: amex-gold # the metal one
  - id: capital-one-savor
    opened: '2024-01-05'
    bonus: { opened: '2024-01-05', spent: 500, met: '2024-02' }
`

async function walletFile(text: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-history-'))
  const file = path.join(dir, 'wallet.yaml')
  await writeFile(file, text)
  return file
}

describe('card history', () => {
  test('removing a card can keep it, closed this month, with its months', () => {
    const wallet = WalletSchema.parse({
      cards: [
        {
          id: 'capital-one-savor',
          opened: '2024-01-05',
          bonus: { opened: '2024-01-05', spent: 500, met: '2024-02' },
          bonus_received: '2024-03',
        },
      ],
    })
    const kept = removeFromWallet(wallet, 'capital-one-savor', {
      today: TODAY,
    })
    if (!kept.ok) throw new Error(kept.error)
    expect(kept.wallet.cards).toEqual([])
    expect(kept.wallet.past_cards).toEqual([
      {
        id: 'capital-one-savor',
        opened: '2024-01',
        closed: '2026-11',
        bonus_received: '2024-03',
        bonus_met: '2024-02',
      },
    ])
    const gone = removeFromWallet(wallet, 'capital-one-savor')
    expect(gone.ok && gone.wallet.past_cards).toBeUndefined()
  })

  test('the history refuses unknown cards, odd months and dates out of order', () => {
    const wallet = WalletSchema.parse({})
    const result = withPastCards(
      catalog,
      wallet,
      [
        { id: 'not-a-card' },
        { id: 'chase-sapphire-preferred', opened: '2019-4' },
        { id: 'capital-one-venture', opened: '2022-05', closed: '2021-01' },
        { id: 'citi-double-cash', bonusReceived: '2027-01' },
      ],
      TODAY,
    )
    expect(result.ok).toBe(false)
    const error = result.ok ? '' : result.error
    expect(error).toMatch(/No card 'not-a-card'/)
    expect(error).toMatch(/"2019-4" isn't a month/)
    expect(error).toMatch(/closed \(2021-01\) is before opened \(2022-05\)/)
    expect(error).toMatch(/2027-01 is in the future/)
    const cleared = withPastCards(catalog, wallet, [], TODAY)
    expect(cleared.ok && cleared.wallet.past_cards).toBeUndefined()
  })

  test("'none' saves a card that never paid a bonus", () => {
    const set = withPastCards(
      catalog,
      WalletSchema.parse({}),
      [{ id: 'capital-one-venture', bonusReceived: 'none' }],
      TODAY,
    )
    expect(set.ok && set.wallet.past_cards).toEqual([
      { id: 'capital-one-venture', bonus_received: false },
    ])
    const held = updateInWallet(
      catalog,
      WalletSchema.parse({ cards: [{ id: 'amex-gold' }] }),
      { id: 'amex-gold', bonusReceived: '2025-06' },
      TODAY,
    )
    expect(held.ok && held.wallet.cards[0]?.bonus_received).toBe('2025-06')
  })

  test('a recorded purchase that reaches the spend saves the month, in the file too', async () => {
    const file = await walletFile(`cards:
  - id: chase-freedom-unlimited
    bonus: { opened: '2026-10-01', spent: 400, spend: 500 }
`)
    const store = new FileWalletStore(catalog, file)
    const merchant = resolveMerchant(catalog, 'Target', null)
    const under = await store.record(
      {
        cardId: 'chase-freedom-unlimited',
        merchant: 'Target',
        amount: 50,
        channel: null,
        date: '2026-10-20',
      },
      merchant,
    )
    expect(under.ok && under.bonus?.met).toBeNull()
    await store.record(
      {
        cardId: 'chase-freedom-unlimited',
        merchant: 'Target',
        amount: 80,
        channel: null,
        date: '2026-11-02',
      },
      merchant,
    )
    const wallet = await loadWallet(file)
    expect(wallet.cards[0]?.bonus).toMatchObject({ spent: 530, met: '2026-11' })
  })

  test('the file keeps its comments, and the history goes at the end', async () => {
    const file = await walletFile(COMMENTED)
    const store = new FileWalletStore(catalog, file)
    const removed = await store.removeCard('capital-one-savor', {
      today: TODAY,
    })
    expect(removed.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(`# my cards
memberships: [amazon-prime]

cards:
  - id: amex-gold # the metal one
past_cards:
  - { id: capital-one-savor, opened: 2024-01, closed: 2026-11, bonus_met: 2024-02 }
`)
    const set = await store.setPastCards(
      [{ id: 'chase-sapphire-preferred', bonusReceived: 'none' }],
      TODAY,
    )
    expect(set.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toMatch(
      /past_cards:\n {2}- \{ id: chase-sapphire-preferred, bonus_received: false \}\n$/,
    )
    expect(setPastCardsText(await readFile(file, 'utf8'), [])).not.toMatch(
      /past_cards/,
    )
  })
})

describe('repeat-bonus review fixes', () => {
  const PAST_CFU = WalletSchema.parse({
    past_cards: [{ id: 'chase-freedom-unlimited' }],
  })
  const filters = {
    kind: 'any',
    business: false,
    noAnnualFee: false,
    includeHeld: false,
  } as const

  test('an offer whose rule needs a month stays ranked, with a note that asks for it', () => {
    const plain = compareOffers(catalog, WalletSchema.parse({}), filters, TODAY)
    const asked = compareOffers(catalog, PAST_CFU, filters, TODAY)
    const at = (c: typeof plain) =>
      c.offers.findIndex((o) => o.cardId === 'chase-freedom-unlimited')
    expect(at(asked)).toBe(at(plain))
    const cfu = asked.offers[at(asked)]
    expect(cfu?.ineligible).toBeNull()
    expect(cfu?.eligibilityNote).toBe(
      'Chase counts 24 months from your last bonus on this card. Tell earnrate when yours posted to get a date.',
    )
    expect(cfu?.monthAsk).toEqual({
      cardId: 'chase-freedom-unlimited',
      held: false,
      pastIndex: 0,
      field: 'bonus_received',
    })
    const text = formatOffers(asked, (id) => id, true, catalog)
    expect(text).toContain(cfu?.eligibilityNote)
    expect(text).not.toMatch(/likely not eligible for you: .*Freedom Unlimited/)
  })

  test("a card counted only by another card's rule still gets that rule's month", () => {
    expect(
      repeatMonthFields(catalog, 'amex-marriott-bonvoy-brilliant'),
    ).toEqual(['bonus_received'])
    expect(repeatMonthFields(catalog, 'capital-one-venture-x')).toEqual([
      'bonus_received',
    ])
    expect(repeatMonthFields(catalog, 'wells-fargo-active-cash')).toEqual([
      'opened',
    ])
    expect(repeatMonthFields(catalog, 'amex-gold')).toEqual([])
  })

  test('the month asked for goes to the card it names, held or had', () => {
    const wallet = WalletSchema.parse({
      cards: [{ id: 'capital-one-venture-x' }],
      past_cards: [{ id: 'capital-one-venture' }, { id: 'capital-one-savor' }],
    })
    const held = bonusEligibility(catalog, wallet, 'capital-one-venture', TODAY)
    expect(held?.state).toBe('needs-date')
    expect(held?.ask).toEqual({
      cardId: 'capital-one-venture-x',
      held: true,
      pastIndex: null,
      field: 'bonus_received',
    })
    expect(monthAskOp(wallet, held?.ask ?? never(), '2025-02')).toEqual({
      tool: 'update_card',
      input: { cardId: 'capital-one-venture-x', bonusReceived: '2025-02' },
    })
    expect(
      monthAskOp(
        wallet,
        {
          cardId: 'capital-one-savor',
          held: false,
          pastIndex: 1,
          field: 'bonus_received',
        },
        '2023-04',
      ),
    ).toEqual({
      tool: 'set_card_history',
      input: {
        pastCards: [
          { cardId: 'capital-one-venture' },
          { cardId: 'capital-one-savor', bonusReceived: '2023-04' },
        ],
      },
    })
  })

  test('removing a card on the site keeps no history unless the person taps to', () => {
    const wallet = WalletSchema.parse({
      cards: [
        {
          id: 'capital-one-savor',
          opened: '2024-01-05',
          bonus: { opened: '2024-01-05', spent: 500, met: '2024-02' },
        },
      ],
    })
    const { remove, keep } = removalOps(
      catalog,
      wallet,
      'capital-one-savor',
      TODAY,
    )
    expect(remove).toEqual({
      tool: 'remove_card',
      input: { cardId: 'capital-one-savor' },
    })
    expect(keep).toEqual({
      tool: 'set_card_history',
      input: {
        pastCards: [
          {
            cardId: 'capital-one-savor',
            opened: '2024-01',
            closed: '2026-11',
            bonusMet: '2024-02',
          },
        ],
      },
    })
  })

  test('a past card with no offer gets no line, not "you can earn it again"', () => {
    const noOffer = catalog.cards.find(
      (c) => c.welcome_offer === undefined && c.network !== 'store',
    )
    if (!noOffer) throw new Error('every card has an offer')
    const wallet = WalletSchema.parse({ past_cards: [{ id: noOffer.id }] })
    expect(pastCardNote(catalog, wallet, noOffer.id, TODAY)).toEqual({
      text: null,
      ask: null,
    })
  })

  test('the hosted wallet gets the bonus-met month of a card only this browser had', () => {
    const browser = WalletSchema.parse({
      past_cards: [
        { id: 'capital-one-savor', opened: '2024-01', bonus_met: '2024-02' },
      ],
    })
    const claude = WalletSchema.parse({ cards: [{ id: 'amex-gold' }] })
    const ops = combineOps(catalog, claude, browser, TODAY)
    expect(ops).toContainEqual({
      tool: 'set_card_history',
      input: {
        pastCards: [
          {
            cardId: 'capital-one-savor',
            opened: '2024-01',
            bonusMet: '2024-02',
          },
        ],
      },
    })
    const edited = applyLocally(
      catalog,
      browser,
      historyOp(
        (browser.past_cards ?? []).map((p) =>
          pastCardOpInput({ ...p, opened: '2023-12' }),
        ),
      ),
      TODAY,
    )
    expect(edited.ok && edited.wallet.past_cards).toEqual([
      { id: 'capital-one-savor', opened: '2023-12', bonus_met: '2024-02' },
    ])
  })

  test('a card kept twice gets one "Its bonus again" to-do', () => {
    const wallet = WalletSchema.parse({
      past_cards: [
        { id: 'capital-one-savor', bonus_received: '2022-12' },
        { id: 'capital-one-savor', bonus_received: '2022-12' },
      ],
    })
    const items = checklistRows(catalog, wallet, TODAY).filter(
      (i) => i.kind === 'bonus-again',
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe(
      "Capital One Savor Rewards Credit Card's welcome bonus: Capital One's wait for it ends in December 2026, by the card history you gave.",
    )
  })

  test('the CLI sets the months given on the latest entry and keeps the rest', async () => {
    const file = await walletFile(`cards: []
past_cards:
  - { id: capital-one-venture, opened: 2018-01, closed: 2019-06, bonus_received: 2018-03 }
  - { id: capital-one-venture, opened: 2022-01, closed: 2026-11, bonus_met: 2022-03 }
`)
    let stdout = ''
    const code = await run(
      ['history', 'capital-one-venture', '--bonus-received', '2022-04'],
      {
        env: { EARNRATE_MISSED_MERCHANTS: 'off', [WALLET_ENV_VAR]: file },
        today: TODAY,
        stdout: (t) => (stdout += t),
        stderr: () => undefined,
      },
    )
    expect(code, stdout).toBe(0)
    expect((await loadWallet(file)).past_cards).toEqual([
      {
        id: 'capital-one-venture',
        opened: '2018-01',
        closed: '2019-06',
        bonus_received: '2018-03',
      },
      {
        id: 'capital-one-venture',
        opened: '2022-01',
        closed: '2026-11',
        bonus_received: '2022-04',
        bonus_met: '2022-03',
      },
    ])
  })

  test('the CLI keeps a card held now in the history and says offers treat it as held', async () => {
    const file = await walletFile(`cards:
  - id: amex-gold
`)
    let stdout = ''
    const code = await run(['history', 'amex-gold', '--opened', '2019-04'], {
      env: { EARNRATE_MISSED_MERCHANTS: 'off', [WALLET_ENV_VAR]: file },
      today: TODAY,
      stdout: (t) => (stdout += t),
      stderr: () => undefined,
    })
    expect(code, stdout).toBe(0)
    expect((await loadWallet(file)).past_cards).toEqual([
      { id: 'amex-gold', opened: '2019-04' },
    ])
    expect(stdout.split('\n')[1]).toBe(
      'American Express Gold Card is in your wallet now, so offer answers treat it as held.',
    )
    expect(
      heldInHistoryLine(catalog, await loadWallet(file), ['amex-gold']),
    ).toBe(stdout.split('\n')[1])
  })

  test('the best cards from scratch rule out bonuses by card history, not earnings', () => {
    const saved = WalletSchema.parse({
      cards: [{ id: 'amex-gold' }],
      past_cards: [
        { id: 'amex-blue-cash-preferred' },
        { id: 'citi-double-cash', bonus_received: '2024-05' },
      ],
    })
    const job = (history?: Wallet): Job => ({
      rows: [{ what: 'Groceries', monthly: 800 }],
      typical: false,
      options: {
        filters: ALL_PERSONAL_CARDS,
        memberships: [],
        valuations: {},
      },
      offerFilters: {
        kind: 'any',
        business: false,
        noAnnualFee: false,
        includeHeld: true,
      },
      today: TODAY,
      ...(history ? { history } : {}),
    })
    const offers = (history?: Wallet) => {
      const [first] = steps(catalog, job(history))
      const part = first?.()
      if (part?.part !== 'answer') throw new Error('no answer')
      return {
        result: part.result,
        of: (id: string) => part.offers.find((o) => o.cardId === id),
      }
    }
    const before = offers()
    const after = offers(historyOf(saved) ?? undefined)
    for (const id of ['amex-blue-cash-preferred', 'citi-double-cash'])
      expect(before.of(id)?.ineligible, id).toBeNull()
    expect(after.of('amex-blue-cash-preferred')?.ineligible).toBe(
      "American Express says you may not get this bonus again, since you've had this card before.",
    )
    expect(after.of('citi-double-cash')?.ineligible).toMatch(
      /^Not before May 2028: Citi counts 48 months/,
    )
    // The same words compare_welcome_offers gives for this history.
    const named = compareOffers(
      catalog,
      { ...saved, cards: [] },
      { kind: 'any', business: false, noAnnualFee: false, includeHeld: true },
      TODAY,
    )
    expect(
      named.offers.find((o) => o.cardId === 'citi-double-cash')?.ineligible,
    ).toBe(after.of('citi-double-cash')?.ineligible)
    // A held card counts as had: its bonus isn't offered again.
    expect(after.of('amex-gold')?.ineligible).not.toBeNull()
    // Earnings still start from no cards.
    expect(after.result).toEqual(before.result)
    expect(after.of('citi-double-cash')?.plan).toEqual(
      before.of('citi-double-cash')?.plan,
    )
    expect(historyOf(WalletSchema.parse({}))).toBeNull()
  })

  test('a month is picked as a month and a year, never in the future', () => {
    expect(monthOf({ month: 3, year: 2025 }, TODAY)).toBe('2025-03')
    expect(monthOf({ month: 3, year: 0 }, TODAY)).toBe('')
    expect(monthOf({ month: 0, year: 2025 }, TODAY)).toBe('')
    expect(monthOf({ month: 11, year: 2026 }, TODAY)).toBe('2026-11')
    expect(monthOf({ month: 12, year: 2026 }, TODAY)).toBe('')
    expect(futureMonth(12, 2026, TODAY)).toBe(true)
    expect(futureMonth(12, 0, TODAY)).toBe(false)
    expect(partsOf('2019-04')).toEqual({ month: 4, year: 2019 })
    expect(partsOf('')).toEqual({ month: 0, year: 0 })
    const years = yearsFor('', TODAY)
    expect(years[0]).toBe(2026)
    expect(years.at(-1)).toBe(2026 - YEARS_BACK)
    expect(yearsFor('1990-01', TODAY).at(-1)).toBe(1990)
  })

  test("/bonus-rules links to My wallet's Cards you've had, opened", () => {
    const page = bonusRulesPage(
      pageContext(catalog, { today: TODAY, dataVersion: 'test' }),
      TODAY,
    )
    expect(page.html).toContain('<a href="/#wallet&amp;had">')
    expect(tabFor('#wallet&had', false)).toBe('wallet')
  })

  test('rule labels state the restriction, keep "may not", and name the family', () => {
    const label = (id: string) => {
      const card = catalog.cards.find((c) => c.id === id)
      if (!card) throw new Error(id)
      return repeatRuleParts(catalog, card).label
    }
    expect(label('chase-freedom-unlimited')).toBe('Not within 24 months')
    expect(label('bank-of-america-travel-rewards')).toBe(
      'Maybe not within 24 months',
    )
    expect(label('amex-platinum')).toBe('Once per card')
    expect(label('amex-gold')).toMatch(/^Once per card, counting .*Platinum/)
  })

  test('changing one history entry keeps the comments around the others', () => {
    const text = `cards: []
past_cards:
  # closed after the fee went up
  - { id: chase-sapphire-preferred } # 2019
  - { id: capital-one-venture, opened: 2022-01 }
  - { id: citi-double-cash } # never used it
`
    const next = setPastCardsText(text, [
      { id: 'chase-sapphire-preferred' },
      { id: 'capital-one-venture', opened: '2022-01', closed: '2026-11' },
      { id: 'citi-double-cash' },
      { id: 'amex-gold' },
    ])
    expect(next).toBe(`cards: []
past_cards:
  # closed after the fee went up
  - { id: chase-sapphire-preferred } # 2019
  - { id: capital-one-venture, opened: 2022-01, closed: 2026-11 }
  - { id: citi-double-cash } # never used it
  - { id: amex-gold }
`)
    expect(
      setPastCardsText(next, [
        { id: 'chase-sapphire-preferred' },
        { id: 'citi-double-cash' },
        { id: 'amex-gold' },
      ]),
    ).toBe(`cards: []
past_cards:
  # closed after the fee went up
  - { id: chase-sapphire-preferred } # 2019
  - { id: citi-double-cash } # never used it
  - { id: amex-gold }
`)
  })
})

const never = (): never => {
  throw new Error('expected a value')
}
