import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { walletProblems } from '../src/data/integrity.ts'
import { addCardText } from '../src/data/wallet-edit.ts'
import { catalogCheatSheet } from '../src/engine/cheat-sheet.ts'
import { ALL_PERSONAL_CARDS, exploreCards } from '../src/engine/explore.ts'
import { membershipCosts } from '../src/engine/memberships.ts'
import {
  resolveSpendLines,
  simulateAdditions,
  simulateCatalog,
  spendLineFor,
  TYPICAL_MONTHLY_SPEND,
} from '../src/engine/simulate.ts'
import { cardText } from '../src/format/card-text.ts'
import { walletYaml } from '../src/format/wallet-yaml.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
const COSTCO = 'citi-costco-anywhere-visa'
const START = '2026-11-01'

const typical = TYPICAL_MONTHLY_SPEND.map((t) =>
  spendLineFor(catalog, t.what, t.monthly),
)
const lines = resolveSpendLines(catalog, typical)
const withCostco = resolveSpendLines(catalog, [
  ...typical,
  spendLineFor(catalog, 'Costco', 300),
])
const options = (memberships: string[]) => ({
  filters: ALL_PERSONAL_CARDS,
  memberships,
  valuations: {},
  start: START,
})
const single = (sim: ReturnType<typeof simulateCatalog>) =>
  sim.singles.find((s) => s.cards[0]?.cardId === COSTCO)

test("a non-member's spending ranks the Costco card apart, as for a member", () => {
  const sim = simulateCatalog(catalog, lines, options([]))
  expect(single(sim)).toBeUndefined()
  expect(sim.pairs.some((p) => p.cards.some((c) => c.cardId === COSTCO))).toBe(
    false,
  )
  const member = sim.membersOnly.find((s) => s.cards[0]?.cardId === COSTCO)
  expect(member?.membership).toBe('costco')
  expect(member?.membershipFees).toBe(0)
})

test('members, and anyone who shops at Costco, pay nothing more', () => {
  expect(
    single(simulateCatalog(catalog, lines, options(['costco'])))
      ?.membershipFees,
  ).toBe(0)
  expect(
    single(simulateCatalog(catalog, withCostco, options([])))?.membershipFees,
  ).toBe(0)
})

test('two cards that need one membership pay for it once', () => {
  const both = catalog.cards.filter((c) =>
    c.id.startsWith('citi-costco-anywhere'),
  )
  expect(membershipCosts(catalog, both, new Set())).toEqual([
    {
      id: 'costco',
      name: 'Costco membership',
      annualFee: 65,
      cardIds: both.map((c) => c.id),
    },
  ])
})

test('adding the card ranks it apart unless the wallet has the membership', () => {
  const gold = WalletSchema.parse({ cards: [{ id: 'amex-gold' }] })
  const what = (wallet: typeof gold, l = lines) =>
    simulateAdditions(catalog, wallet, l, options([]))
  const plain = what(gold)
  expect(plain.additions.some((a) => a.cardId === COSTCO)).toBe(false)
  const member = plain.membersOnly.find((a) => a.cardId === COSTCO)
  expect(member?.membership).toBe('costco')
  expect(member?.membershipFee).toBe(0)
  const add = (wallet: typeof gold, l = lines) =>
    what(wallet, l).additions.find((a) => a.cardId === COSTCO)
  expect(add(gold, withCostco)?.membershipFee).toBe(0)
  expect(
    add(
      WalletSchema.parse({
        memberships: ['costco'],
        cards: [{ id: 'amex-gold' }],
      }),
    )?.membershipFee,
  ).toBe(0)
  const holder = WalletSchema.parse({ cards: [{ id: COSTCO }] })
  expect(
    simulateAdditions(catalog, holder, lines, options([])).current
      .membershipFees,
  ).toBe(0)
})

test('every-card answers say so, except at Costco itself', () => {
  const explored = (
    merchant: string | null,
    category: string | null,
    m: string[],
  ) =>
    exploreCards(
      catalog,
      { merchant, category, amount: null, channel: null, date: START },
      { filters: ALL_PERSONAL_CARDS, memberships: m, valuations: {} },
    )
  const at = (merchant: string | null, category: string | null, m: string[]) =>
    explored(merchant, category, m).ranked.find((e) => e.cardId === COSTCO)
      ?.conditions ?? []
  expect(at(null, 'gas', [])).toEqual([])
  expect(
    explored(null, 'gas', []).membersOnly.find((e) => e.cardId === COSTCO)
      ?.conditions,
  ).toContain('Needs a Costco membership ($65 a year).')
  expect(at(null, 'gas', ['costco']).join(' ')).not.toMatch(/membership/)
  expect(at('Costco', null, []).join(' ')).not.toMatch(/membership/)
  const sheet = catalogCheatSheet(catalog, START, {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
  })
  const costcoRow = sheet.rows.find((r) => r.label === 'Costco')
  expect(costcoRow?.note ?? '').not.toMatch(/membership/)
  expect(cardText(catalog).feeLabel(COSTCO)).toBe(
    'No annual fee; needs a Costco membership ($65 a year)',
  )
})

test('wallets carry a format version, and a newer one is refused', () => {
  expect(addCardText(null, { id: 'amex-gold' })).toMatch(/\nversion: 1\ncards:/)
  const wallet = WalletSchema.parse({ cards: [{ id: 'amex-gold' }] })
  expect(walletYaml(wallet)).toMatch(/\nversion: 1\ncards:/)
  expect(walletProblems({ ...wallet, version: 2 }, catalog).join(' ')).toMatch(
    /newer earnrate/,
  )
  expect(walletProblems(wallet, catalog)).toEqual([])
})
