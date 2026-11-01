import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { resolveMerchant } from '../src/merchants/resolve.ts'
import { cheatSheet } from '../src/engine/cheat-sheet.ts'
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

const onPace = WalletSchema.parse({
  cards: [
    { id: 'chase-sapphire-preferred' },
    { id: 'citi-double-cash' },
    {
      id: 'capital-one-savor',
      bonus: { opened: '2026-10-15', spent: 200, spend: 500, by: '2027-01-15' },
    },
  ],
})
const at = (merchant: string) =>
  recommend(
    catalog,
    onPace,
    { merchant, amount: 50, channel: null, date: '2026-11-01', country: 'US' },
    resolveMerchant(catalog, merchant, null),
  )

test('on pace, a bonus card that ties the best card takes the pick', () => {
  const rec = at('Chipotle')
  expect(rec.decision?.cardId).toBe('capital-one-savor')
  expect(rec.notes[0]).toMatch(/earns as much here as any of your cards/)
})

test('on pace, a bonus card within a point is mentioned, not picked', () => {
  const rec = at('Home Depot')
  expect(rec.decision?.cardId).toBe('citi-double-cash')
  expect(rec.notes.join(' ')).toMatch(/Savor.* close to 2%.*You're on pace/)
})

test("a cheat sheet keeps each row's best card and names where the bonus card fits", () => {
  const sheet = cheatSheet(catalog, onPace, '2026-11-01')
  expect(sheet.rows.find((r) => r.label === 'Gas')?.cardId).toBe(
    'chase-sapphire-preferred',
  )
  expect(sheet.notes[0]).toMatch(
    /Savor.*welcome bonus: \$300 more by Jan 15, 2027\. It earns about as much as the cards listed on .*dining/,
  )
})
