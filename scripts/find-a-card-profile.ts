// Times what Best setups works out for one answer, part by part, on the
// typical month or the rows given:
// node scripts/find-a-card-profile.ts [YYYY-MM-DD] ["Cell phone=115" ...]
import { loadCatalog } from '../src/data/load.ts'
import { ALL_PERSONAL_CARDS } from '../src/engine/explore.ts'
import { compareOffers } from '../src/engine/offers.ts'
import { localToday } from '../src/engine/periods.ts'
import {
  resolveSpendLines,
  simulateCatalog,
  simulateSingles,
  spendLineFor,
  typicalSpendLines,
} from '../src/engine/simulate.ts'
import {
  missingMembership,
  paidMemberships,
} from '../src/engine/memberships.ts'
import { matchesFilters } from '../src/engine/explore.ts'

const catalog = await loadCatalog()
const [date, ...rows] = process.argv.slice(2)
const today = date ?? localToday()
const lines =
  rows.length === 0
    ? typicalSpendLines(catalog)
    : resolveSpendLines(
        catalog,
        rows.map((r) => {
          const at = r.lastIndexOf('=')
          return spendLineFor(catalog, r.slice(0, at), Number(r.slice(at + 1)))
        }),
      )
const options = {
  filters: ALL_PERSONAL_CARDS,
  memberships: [],
  valuations: {},
  start: today,
}

function time<T>(label: string, fn: () => T, runs = 5): T {
  let out: T = fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    out = fn()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  console.log(
    `${label.padEnd(44)} ${String(Math.round(times[Math.floor(runs / 2)] ?? 0)).padStart(5)} ms`,
  )
  return out
}

console.log(`${String(lines.length)} lines, ${today}`)
const has = paidMemberships(catalog, { memberships: [] })
const eligible = catalog.cards.filter(
  (c) =>
    matchesFilters(c, options.filters) && missingMembership(c, has) === null,
)
time('singles (every eligible card alone)', () =>
  simulateSingles(catalog, eligible, lines, options),
)
time('simulateCatalog (singles, members-only, pairs)', () =>
  simulateCatalog(catalog, lines, options),
)
time('compareOffers (welcome-offer ranking)', () =>
  compareOffers(
    catalog,
    { valuations: {}, memberships: [], cards: [] },
    { kind: 'any', business: false, noAnnualFee: false, includeHeld: true },
    today,
    { lines, typical: true },
  ),
)
