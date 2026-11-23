import { expect, test } from 'vitest'
import { loadCatalog } from '../src/data/load.ts'
import { localToday } from '../src/engine/periods.ts'
import { changeDates, entryDates } from '../scripts/lastmod.ts'
import { ROOT } from './helpers.ts'

const catalog = await loadCatalog()
const today = localToday()
const fileDate = changeDates(ROOT, ['data'], today)

test("each store, category and currency entry is dated no later than its file's last change", () => {
  const files: [string, string[]][] = [
    ['data/categories.yaml', catalog.categories.map((c) => c.id)],
    ['data/currencies.yaml', catalog.currencies.map((c) => c.id)],
    ['data/issuers.yaml', catalog.issuers.map((i) => i.id)],
    ['data/merchants/seed.yaml', catalog.merchants.seed.map((m) => m.id)],
    [
      'data/merchants/overrides.yaml',
      catalog.merchants.overrides.map((m) => m.id),
    ],
  ]
  for (const [file, ids] of files) {
    const dated = entryDates(ROOT, file, today)
    for (const id of ids) {
      const date = dated(id)
      expect(date, `${file} ${id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(date && date <= fileDate(file), `${file} ${id}`).toBe(true)
    }
    expect(dated('no-such-entry')).toBeUndefined()
  }
})
