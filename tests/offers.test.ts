import { expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { run } from '../src/cli/run.ts'
import { loadCatalog, type Catalog } from '../src/data/load.ts'
import { compareOffers, type OfferFilters } from '../src/engine/offers.ts'
import { CardSchema } from '../src/schema/card.ts'
import { WalletSchema } from '../src/schema/wallet.ts'
import { TODAY } from './golden/fixtures.ts'

const realCatalog = await loadCatalog()

const card = (id: string, extra: object) =>
  CardSchema.parse({
    id,
    name: `Test ${id}`,
    issuer: 'test',
    network: 'visa',
    currency: 'cash',
    last_verified: '2026-10-01',
    verified_by: 'test',
    source_urls: ['https://example.com/terms'],
    base_rate: 1,
    annual_fee: 0,
    ...extra,
  })

const cards = [
  card('cash-200', { welcome_offer: { dollars: 200, spend: 500, months: 3 } }),
  card('pooling-cash', {
    pools_into: {
      currency: 'UR',
      when_wallet_has: ['chase-sapphire-preferred'],
    },
    welcome_offer: { dollars: 200, spend: 500, months: 3 },
  }),
  card('points-fee', {
    currency: 'UR',
    annual_fee: 95,
    welcome_offer: { points: 60000, spend: 4000, months: 3 },
  }),
  card('points-waived', {
    currency: 'UR',
    annual_fee: 95,
    first_year_fee: 0,
    welcome_offer: { points: 50000, spend: 3000, months: 3 },
  }),
  card('business-cash', {
    business: true,
    welcome_offer: { dollars: 750, spend: 6000, months: 3 },
  }),
  card('expired', {
    welcome_offer: {
      dollars: 300,
      spend: 500,
      months: 3,
      valid_to: '2026-10-01',
    },
  }),
  card('no-offer', {}),
  card('store', {
    network: 'store',
    only_at: ['target'],
    welcome_offer: { dollars: 50, spend: 0, months: 1 },
  }),
]
const catalog: Catalog = { ...realCatalog, cards }

const wallet = WalletSchema.parse({
  valuations: { UR: 2 },
  cards: [{ id: 'chase-sapphire-preferred' }, { id: 'cash-200' }],
})
const filters = (f: Partial<OfferFilters> = {}): OfferFilters => ({
  kind: 'any',
  business: false,
  noAnnualFee: false,
  includeHeld: false,
  ...f,
})

test('ranks offers by bonus value minus the first-year fee', () => {
  const { offers } = compareOffers(catalog, wallet, filters(), TODAY)
  expect(offers.map((o) => [o.cardId, o.bonusValue, o.firstYearValue])).toEqual(
    [
      ['points-fee', 1200, 1105],
      ['points-waived', 1000, 1000],
      ['pooling-cash', 400, 400],
    ],
  )
})

test('skips held, business, store and expired cards, and lists those with no offer', () => {
  const c = compareOffers(catalog, wallet, filters(), TODAY)
  const ids = c.offers.map((o) => o.cardId)
  for (const id of ['cash-200', 'business-cash', 'store', 'expired'])
    expect(ids).not.toContain(id)
  expect(c.withoutOffer.sort()).toEqual(['expired', 'no-offer'])
})

test.each([
  [{ kind: 'cash' as const }, ['pooling-cash']],
  [{ kind: 'points' as const }, ['points-fee', 'points-waived']],
  [{ noAnnualFee: true }, ['pooling-cash']],
  [{ business: true }, ['business-cash']],
  [{ includeHeld: true, kind: 'cash' as const }, ['pooling-cash', 'cash-200']],
])('filters %j', (f, expected) => {
  expect(
    compareOffers(catalog, wallet, filters(f), TODAY).offers.map(
      (o) => o.cardId,
    ),
  ).toEqual(expected)
})

test('earnrate offers explains its usage errors', async () => {
  let stderr = ''
  const code = await run(['offers', '--cash', '--points'], {
    env: { [WALLET_ENV_VAR]: 'wallet.example.yaml' },
    today: TODAY,
    stdout: () => undefined,
    stderr: (t) => (stderr += t),
  })
  expect(code).toBe(2)
  expect(stderr).toMatch(/Pick --cash or --points/)
})
