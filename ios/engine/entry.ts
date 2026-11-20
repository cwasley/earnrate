// The engine as the iPhone app runs it, in JavaScriptCore. The app loads the
// catalog once, then calls these with JSON strings and reads JSON back, so
// the Swift side never depends on the engine's internal types.
import { recommend } from '../../src/engine/recommend.ts'
import type { Purchase } from '../../src/engine/types.ts'
import { formatRecommendation } from '../../src/format/recommendation.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { WalletSchema } from '../../src/schema/wallet.ts'

let catalog: Catalog | null = null

function loaded(): Catalog {
  if (catalog === null) throw new Error('Load the catalog first.')
  return catalog
}

const engine = {
  load(json: string): number {
    catalog = JSON.parse(json) as Catalog
    return catalog.cards.length
  },
  // A purchase answer: the recommendation and the same text the CLI prints.
  best(request: string): string {
    const r = JSON.parse(request) as {
      merchant: string
      amount?: number | null
      wallet?: unknown
      today: string
    }
    const purchase: Purchase = {
      merchant: r.merchant,
      amount: r.amount ?? null,
      channel: null,
      date: r.today,
      country: 'US',
    }
    const wallet = WalletSchema.parse(r.wallet ?? {})
    const rec = recommend(loaded(), wallet, purchase, undefined, {
      today: r.today,
    })
    return JSON.stringify({
      text: formatRecommendation(rec, purchase, { all: false }),
      card: rec.ranked[0]?.cardName ?? null,
    })
  },
}

;(globalThis as { earnrate?: typeof engine }).earnrate = engine
