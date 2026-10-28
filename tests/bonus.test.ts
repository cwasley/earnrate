import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadCatalog, type Catalog } from '../src/data/load.ts'
import { writeBonusSpent } from '../src/data/wallet-write.ts'
import { addMonths, bonusStatus } from '../src/engine/bonus.ts'
import { recommend } from '../src/engine/recommend.ts'
import { CardSchema } from '../src/schema/card.ts'
import { WalletSchema, type Wallet } from '../src/schema/wallet.ts'
import { purchase, TODAY } from './golden/fixtures.ts'

const realCatalog = await loadCatalog()

const offerCard = CardSchema.parse({
  id: 'test-offer',
  name: 'Test Offer Card',
  issuer: 'test',
  network: 'visa',
  currency: 'UR',
  last_verified: '2026-10-01',
  verified_by: 'test',
  source_urls: ['https://example.com/terms'],
  base_rate: 1,
  welcome_offer: { points: 60000, spend: 4000, months: 3 },
})

const cashCard = CardSchema.parse({
  ...offerCard,
  id: 'test-cash-offer',
  currency: 'cash',
  pools_into: { currency: 'UR', when_wallet_has: ['chase-sapphire-preferred'] },
  welcome_offer: { dollars: 200, spend: 500, months: 3 },
})

const catalog: Catalog = {
  ...realCatalog,
  cards: [...realCatalog.cards, offerCard, cashCard],
}

function wallet(bonus: object, extra: object[] = []): Wallet {
  return WalletSchema.parse({
    cards: [
      { id: 'amex-blue-cash-preferred' },
      { id: 'test-offer', bonus },
      ...extra,
    ],
  })
}

const status = (w: Wallet, id = 'test-offer', today = TODAY) => {
  const held = w.cards.find((c) => c.id === id)
  if (!held) throw new Error('missing card')
  return bonusStatus(catalog, w, held, today)
}

test.each([
  ['2026-10-01', 3, '2027-01-01'],
  ['2026-11-30', 3, '2027-02-28'],
  ['2027-11-30', 3, '2028-02-29'],
  ['2026-01-31', 1, '2026-02-28'],
])('addMonths(%s, %i) is %s', (date, months, expected) => {
  expect(addMonths(date, months)).toBe(expected)
})

describe('bonusStatus', () => {
  test('fills the terms in from the published offer', () => {
    expect(status(wallet({ opened: '2026-10-01', spent: 1000 }))).toEqual({
      cardId: 'test-offer',
      opened: '2026-10-01',
      spent: 1000,
      spend: 4000,
      deadline: '2027-01-01',
      remaining: 3000,
      daysLeft: 69,
      value: 600,
      state: 'open',
    })
  })

  test("the wallet's terms win over the published offer", () => {
    expect(
      status(
        wallet({
          opened: '2026-10-01',
          spend: 3000,
          by: '2026-12-15',
          points: 80000,
        }),
      ),
    ).toMatchObject({ spend: 3000, deadline: '2026-12-15', value: 800 })
  })

  test('is met once the spend is reached, and expired after the deadline', () => {
    expect(status(wallet({ opened: '2026-10-01', spent: 4000 }))?.state).toBe(
      'met',
    )
    expect(status(wallet({ opened: '2026-06-01', spent: 100 }))?.state).toBe(
      'expired',
    )
  })

  test('is incomplete when no offer or wallet terms say what it takes', () => {
    const w = WalletSchema.parse({
      cards: [{ id: 'sofi-unlimited-2', bonus: { opened: '2026-10-01' } }],
    })
    expect(status(w, 'sofi-unlimited-2')?.state).toBe('incomplete')
  })

  test("a cash back card's bonus pools when its rewards do", () => {
    const w = WalletSchema.parse({
      valuations: { UR: 2 },
      cards: [
        { id: 'test-cash-offer', bonus: { opened: '2026-10-01' } },
        { id: 'chase-sapphire-preferred' },
      ],
    })
    expect(status(w, 'test-cash-offer')?.value).toBe(400)
  })
})

describe('recommendations', () => {
  test('an open bonus wins over a better earner, and says what it costs', () => {
    const rec = recommend(
      catalog,
      wallet({ opened: '2026-10-01', spent: 1000 }),
      purchase('Whole Foods', { amount: 100 }),
    )
    expect(rec.ranked[0]?.cardId).toBe('amex-blue-cash-preferred')
    expect(rec.decision?.cardId).toBe('test-offer')
    expect(rec.bonus).toEqual({
      cardId: 'test-offer',
      checkoutLabel: null,
      remaining: 3000,
      deadline: '2027-01-01',
      daysLeft: 69,
      value: 600,
      costHere: 5,
    })
    expect(rec.notes[0]).toMatch(
      /\$3,000 more to spend by 2027-01-01 \(about \$304 a week\), worth about \$600\. Using it here earns \$5 less than American Express Blue Cash Preferred Card/,
    )
  })

  test.each([
    ['met', { opened: '2026-10-01', spent: 4000 }],
    ['expired', { opened: '2026-06-01' }],
    ['not opened yet', { opened: '2026-11-01' }],
  ])('a bonus that is %s changes nothing', (_name, bonus) => {
    const rec = recommend(catalog, wallet(bonus), purchase('Whole Foods'))
    expect(rec.decision?.cardId).toBe('amex-blue-cash-preferred')
    expect(rec.bonus).toBeNull()
  })

  test('with two open bonuses, the one needing more spend per day wins', () => {
    const w = wallet({ opened: '2026-10-01', spent: 1000 }, [
      { id: 'test-cash-offer', bonus: { opened: '2026-10-20' } },
    ])
    expect(recommend(catalog, w, purchase('Etsy')).bonus?.cardId).toBe(
      'test-offer',
    )
    const later = wallet({ opened: '2026-10-01', spent: 3990 }, [
      { id: 'test-cash-offer', bonus: { opened: '2026-10-24' } },
    ])
    expect(recommend(catalog, later, purchase('Etsy')).bonus?.cardId).toBe(
      'test-cash-offer',
    )
  })

  test("a bonus card isn't picked where it isn't accepted", () => {
    const w = WalletSchema.parse({
      cards: [
        { id: 'chase-freedom-unlimited' },
        {
          id: 'amex-gold',
          bonus: {
            opened: '2026-10-01',
            spend: 6000,
            by: '2026-12-31',
            points: 60000,
          },
        },
      ],
    })
    const rec = recommend(
      catalog,
      w,
      purchase('Costco', { channel: 'in_store' }),
    )
    expect(rec.decision?.cardId).toBe('chase-freedom-unlimited')
    expect(rec.bonus).toBeNull()
  })
})

describe('writeBonusSpent', () => {
  async function write(yaml: string, spent = 1250.5): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-bonus-'))
    const file = path.join(dir, 'wallet.yaml')
    await writeFile(file, yaml)
    await writeBonusSpent(file, 'amex-gold', spent)
    return readFile(file, 'utf8')
  }

  test('updates spent in a one-line bonus, keeping comments', async () => {
    expect(
      await write(
        'cards:\n  - id: amex-gold # mine\n    bonus: { opened: 2026-10-01, spent: 100 }\n',
      ),
    ).toBe(
      'cards:\n  - id: amex-gold # mine\n    bonus: { opened: 2026-10-01, spent: 1250.5 }\n',
    )
  })

  test('adds spent to a one-line bonus that has none', async () => {
    expect(
      await write(
        'cards:\n  - id: amex-gold\n    bonus: { opened: 2026-10-01 }\n',
      ),
    ).toBe(
      'cards:\n  - id: amex-gold\n    bonus: { opened: 2026-10-01, spent: 1250.5 }\n',
    )
  })

  test('adds spent to a block bonus', async () => {
    expect(
      await write(
        'cards:\n  - id: amex-gold\n    bonus:\n      opened: 2026-10-01\n      spend: 6000\n  - id: amex-platinum\n',
      ),
    ).toBe(
      'cards:\n  - id: amex-gold\n    bonus:\n      opened: 2026-10-01\n      spend: 6000\n      spent: 1250.5\n  - id: amex-platinum\n',
    )
  })

  test('refuses a card without a bonus', async () => {
    await expect(write('cards:\n  - id: amex-gold\n')).rejects.toThrow(
      /has no bonus/,
    )
  })
})
