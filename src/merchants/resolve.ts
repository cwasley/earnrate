import type { Catalog } from '../data/load.ts'
import type { Channel, MerchantResolution } from '../engine/types.ts'
import type { Merchant } from '../schema/merchant.ts'

const ALL_NETWORKS = ['visa', 'mastercard', 'amex', 'discover'] as const

export function normalizeMerchantName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9.&+]+/g, ' ')
    .trim()
}

function buildIndex(merchants: Merchant[]): Map<string, Merchant> {
  const index = new Map<string, Merchant>()
  for (const m of merchants) {
    for (const key of [m.name, ...m.aliases, ...m.domains]) {
      index.set(normalizeMerchantName(key), m)
    }
  }
  return index
}

type Found = { key: string; merchant: Merchant }

// Exact match first, then the longest known name the input starts with, so
// "whole foods market santa monica" still finds Whole Foods.
function lookup(index: Map<string, Merchant>, query: string): Found | null {
  const exact = index.get(query)
  if (exact) return { key: query, merchant: exact }
  let best: Found | null = null
  for (const [key, merchant] of index) {
    if (
      query.startsWith(`${key} `) &&
      (!best || key.length > best.key.length)
    ) {
      best = { key, merchant }
    }
  }
  return best
}

// Gas stations run by stores code differently from regular gas stations, and
// issuers treat them differently, so "kroger gas" must not resolve to Kroger.
const STORE_GAS_WORDS = /^(gas|fuel|gas station|fuel center|fuel station)$/
const STORE_GAS_CATEGORY: Record<string, string> = {
  grocery: 'gas.grocery_store',
  'grocery.supermarket': 'gas.grocery_store',
  superstore: 'gas.superstore',
  warehouse_club: 'gas.superstore',
}

export function resolveMerchant(
  catalog: Catalog,
  input: string,
  channel: Channel | null,
): MerchantResolution {
  const query = normalizeMerchantName(input)
  const override = lookup(buildIndex(catalog.merchants.overrides), query)
  const match = override ?? lookup(buildIndex(catalog.merchants.seed), query)
  const found = match?.merchant

  if (!found) {
    return {
      input,
      merchantId: null,
      resolvedName: input.trim(),
      category: 'other',
      likelyMcc: null,
      accepts: null,
      ambiguity: null,
      channel,
      confidence: 'low',
      source: 'none',
      bookedVia: [],
      inference: null,
    }
  }

  const source = override ? 'override' : 'seed'
  const storeGas = STORE_GAS_CATEGORY[found.category]
  const rest = query.slice(match.key.length).trim()
  if (storeGas && STORE_GAS_WORDS.test(rest)) {
    return {
      input,
      merchantId: null,
      resolvedName: `${found.name} gas`,
      category: storeGas,
      likelyMcc: null,
      accepts: found.in_store?.accepts ?? found.accepts ?? [...ALL_NETWORKS],
      ambiguity:
        storeGas === 'gas.grocery_store'
          ? {
              mayCodeAs: [found.category],
              note: 'Gas at a grocery store can post as gas or as a grocery purchase, depending on the location.',
            }
          : null,
      channel: 'in_store',
      confidence: 'medium',
      source,
      bookedVia: [],
      inference: null,
    }
  }

  const typedDomain = found.domains.some(
    (d) => normalizeMerchantName(d) === query,
  )
  return fromMerchant(found, source, input, channel, typedDomain)
}

function fromMerchant(
  found: Merchant,
  source: 'override' | 'seed',
  input: string,
  channel: Channel | null,
  typedDomain: boolean,
): MerchantResolution {
  const hasChannelRules =
    found.in_store !== undefined || found.online !== undefined
  const effectiveChannel =
    channel ?? (typedDomain ? 'online' : hasChannelRules ? 'in_store' : null)
  const view =
    effectiveChannel === 'in_store'
      ? found.in_store
      : effectiveChannel === 'online'
        ? found.online
        : undefined

  return {
    input,
    merchantId: found.id,
    resolvedName: found.name,
    category: view?.category ?? found.category,
    likelyMcc: view?.likely_mcc ?? found.likely_mcc ?? null,
    accepts: view?.accepts ?? found.accepts ?? [...ALL_NETWORKS],
    ambiguity: found.ambiguity
      ? { mayCodeAs: found.ambiguity.may_code_as, note: found.ambiguity.note }
      : null,
    channel: effectiveChannel,
    confidence: found.ambiguity ? 'medium' : 'high',
    source,
    bookedVia: found.booked_via,
    inference: null,
  }
}

export function resolveMerchantById(
  catalog: Catalog,
  id: string,
  channel: Channel | null,
): MerchantResolution | null {
  const override = catalog.merchants.overrides.find((m) => m.id === id)
  const found = override ?? catalog.merchants.seed.find((m) => m.id === id)
  if (!found) return null
  return fromMerchant(
    found,
    override ? 'override' : 'seed',
    found.name,
    channel,
    false,
  )
}

// Used only when the merchant is unknown: curated data always wins over a
// category supplied with the request.
export function withCallerCategory(
  merchant: MerchantResolution,
  category: string | null,
): MerchantResolution {
  if (merchant.source !== 'none' || category === null) return merchant
  return { ...merchant, category, confidence: 'medium', source: 'caller' }
}
