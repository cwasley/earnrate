import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { resolveMerchant } from '../src/merchants/resolve.ts'
import { recommend } from '../src/engine/recommend.ts'
import { formatRecommendation } from '../src/format/recommendation.ts'
import { walletYaml } from '../src/format/wallet-yaml.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()

const wallet = WalletSchema.parse({
  cards: [
    { id: 'citi-double-cash' },
    { id: 'sofi-unlimited-2' },
    {
      id: 'capital-one-savor',
      anniversary: '03-14',
      bonus: { opened: '2026-10-15', spent: 50, spend: 500, by: '2027-01-15' },
    },
  ],
})

test('a welcome-bonus pick is marked in the ranking, with no tie note', () => {
  const purchase = {
    merchant: 'Home Depot',
    amount: 50,
    channel: null,
    date: '2026-11-01',
    country: 'US',
  }
  const merchant = resolveMerchant(catalog, 'Home Depot', null)
  const rec = recommend(catalog, wallet, purchase, merchant)
  expect(rec.decision?.cardId).toBe('capital-one-savor')
  const text = formatRecommendation(rec, purchase)
  expect(text).toMatch(/Use .*Savor.* for its welcome bonus/)
  expect(text).toMatch(/3\. .*Savor.*← the pick, for its welcome bonus/)
  expect(text).not.toMatch(/wins the tie/)
})

test('an exported wallet quotes dates, periods and anniversaries', () => {
  const yaml = walletYaml(wallet)
  expect(yaml).toContain('anniversary: "03-14"')
  expect(yaml).toContain('opened: "2026-10-15"')
  expect(yaml).toContain('by: "2027-01-15"')
})
