import { LLM_MAX_CALLS_ENV_VAR } from '../brand.ts'
import type { Catalog } from '../data/load.ts'
import type { Channel, MerchantResolution } from '../engine/types.ts'
import { describeClassifierError } from './anthropic.ts'
import type { CachedClassification, MerchantCache } from './cache.ts'
import type { Classifier } from './classifier.ts'
import { normalizeMerchantName, resolveMerchant } from './resolve.ts'

export const DEFAULT_MAX_CALLS = 20

export type LlmSession = {
  resolve: (
    catalog: Catalog,
    input: string,
    channel: Channel | null,
  ) => Promise<{ merchant: MerchantResolution; notices: string[] }>
  callsMade: () => number
}

function usable(catalog: Catalog, c: CachedClassification): boolean {
  const ids = new Set(catalog.categories.map((k) => k.id))
  return ids.has(c.category) && c.mayCodeAs.every((id) => ids.has(id))
}

function fromClassification(
  input: string,
  channel: Channel | null,
  c: CachedClassification,
  cached: boolean,
): MerchantResolution {
  return {
    input,
    merchantId: null,
    resolvedName: input.trim(),
    category: c.category,
    likelyMcc: c.likelyMcc,
    accepts: null,
    ambiguity:
      c.mayCodeAs.length > 0
        ? {
            mayCodeAs: c.mayCodeAs,
            note: 'Claude thinks it could code either way.',
          }
        : null,
    channel,
    confidence: c.category === 'other' ? 'low' : c.confidence,
    source: 'llm',
    bookedVia: [],
    inference: {
      model: c.model,
      rationale: c.rationale,
      classifiedOn: c.classifiedOn,
      cached,
    },
  }
}

// Only merchants that the overrides and seed table don't know reach the
// classifier, so a curated entry always wins.
export function createLlmSession(options: {
  classifier: Classifier
  cache: MerchantCache
  maxCalls: number
  today: () => string
}): LlmSession {
  let calls = 0
  return {
    callsMade: () => calls,
    resolve: async (catalog, input, channel) => {
      const known = resolveMerchant(catalog, input, channel)
      if (known.source !== 'none') return { merchant: known, notices: [] }

      const key = normalizeMerchantName(input)
      const saved = options.cache.get(key)
      if (saved && usable(catalog, saved)) {
        return {
          merchant: fromClassification(input, channel, saved, true),
          notices: [],
        }
      }

      if (calls >= options.maxCalls) {
        return {
          merchant: known,
          notices: [
            `Skipped the Claude lookup: this session already made ${String(options.maxCalls)} calls, the limit set by ${LLM_MAX_CALLS_ENV_VAR}.`,
          ],
        }
      }
      calls += 1

      let classified: CachedClassification
      try {
        classified = {
          ...(await options.classifier(input, catalog.categories)),
          classifiedOn: options.today(),
        }
      } catch (e) {
        return {
          merchant: known,
          notices: [`The Claude lookup failed: ${describeClassifierError(e)}.`],
        }
      }
      if (!usable(catalog, classified)) {
        return {
          merchant: known,
          notices: [
            `The Claude lookup returned a category earnrate doesn't have ("${classified.category}"), so it was ignored.`,
          ],
        }
      }

      const notices: string[] = []
      try {
        await options.cache.set(key, classified)
      } catch (e) {
        notices.push(
          `Couldn't save the classification to the merchant cache: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      return {
        merchant: fromClassification(input, channel, classified, false),
        notices,
      }
    },
  }
}
