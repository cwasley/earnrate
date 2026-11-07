import type { Channel, MerchantResolution } from '../engine/types.ts'
import type { Catalog } from '../schema/catalog.ts'
import { Network } from '../schema/common.ts'
import type { Merchant } from '../schema/merchant.ts'

// "Café" finds "cafe" and "Häagen-Dazs" "haagen dazs": accents are dropped.
const unaccented = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function normalizeMerchantName(input: string): string {
  return unaccented(input)
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
      accepts: found.in_store?.accepts ?? found.accepts ?? [...Network.options],
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
    accepts: view?.accepts ?? found.accepts ?? [...Network.options],
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

// A merchant's record by id; an override replaces the seed entry.
export function findMerchant(
  catalog: Catalog,
  id: string,
): Merchant | undefined {
  return (
    catalog.merchants.overrides.find((m) => m.id === id) ??
    catalog.merchants.seed.find((m) => m.id === id)
  )
}

// The ids a card rule can name to match this merchant: its own and, for a
// brand, its parent's.
export function merchantFamily(catalog: Catalog, id: string | null): string[] {
  if (id === null) return []
  const parent = findMerchant(catalog, id)?.brand_of
  return parent === undefined ? [id] : [id, parent]
}

export function resolveMerchantById(
  catalog: Catalog,
  id: string,
  channel: Channel | null,
): MerchantResolution | null {
  const override = catalog.merchants.overrides.find((m) => m.id === id)
  const found = findMerchant(catalog, id)
  if (!found) return null
  return fromMerchant(
    found,
    override ? 'override' : 'seed',
    found.name,
    channel,
    false,
  )
}

// Curated merchant data always wins over a category supplied with the
// request; the caller's category wins over an unknown name or a different
// category word.
export function withCallerCategory(
  merchant: MerchantResolution,
  category: string | null,
): MerchantResolution {
  if (category === null) return merchant
  const otherWord =
    merchant.source === 'category' && merchant.category !== category
  if (merchant.source !== 'none' && !otherWord) return merchant
  return { ...merchant, category, confidence: 'medium', source: 'caller' }
}

const plainWords = (s: string) =>
  unaccented(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// A category from everyday words: an alias ("groceries") first, then the
// name, then the id, so "grocery" means supermarkets rather than the parent.
export function findCategory(catalog: Catalog, text: string): string | null {
  const wanted = plainWords(text)
  if (wanted === '') return null
  // "grocery store" finds "grocery stores", and "drugstore" "drugstores".
  const forms = [
    wanted,
    wanted.endsWith('s') ? wanted.slice(0, -1) : `${wanted}s`,
  ]
  for (const form of forms) {
    const by = (key: (c: Catalog['categories'][number]) => string[]) =>
      catalog.categories.find((c) => key(c).map(plainWords).includes(form))?.id
    const found =
      by((c) => c.aliases) ?? by((c) => [c.name]) ?? by((c) => [c.id])
    if (found !== undefined) return found
  }
  return null
}

export function categoryResolution(
  catalog: Catalog,
  category: string,
  channel: Channel | null,
): MerchantResolution {
  const found = catalog.categories.find((c) => c.id === category)
  if (!found) throw new Error(`unknown category '${category}'`)
  return {
    input: found.name,
    merchantId: null,
    resolvedName: found.name,
    category,
    likelyMcc: null,
    accepts: null,
    ambiguity: null,
    channel,
    confidence: 'high',
    source: 'category',
    bookedVia: [],
    inference: null,
  }
}

// Words around a place that don't name it: "a restaurant", "the grocery
// store", "a gas station near me".
const LEADING =
  /^(?:(?:a|an|the|my|any|some|our|your|this|that|local|nearby|nearest)\s+)+/i
const TRAILING = /\s+(?:near me|nearby|around here|close by)$/i

// What someone typed: a store earnrate knows, else a category word
// ("restaurants", "gas"), else unrecognized. Names are tried as given first,
// so a store like The Home Depot keeps its "The".
export function resolvePlace(
  catalog: Catalog,
  text: string,
  channel: Channel | null,
): MerchantResolution {
  const attempt = (t: string) => {
    const known = resolveMerchant(catalog, t, channel)
    if (known.source !== 'none') return known
    const category = findCategory(catalog, t)
    return category === null
      ? known
      : categoryResolution(catalog, category, channel)
  }
  const asGiven = attempt(text)
  if (asGiven.source !== 'none') return asGiven
  const bare = text.trim().replace(TRAILING, '').replace(LEADING, '')
  if (bare === '' || bare === text.trim()) return asGiven
  const found = attempt(bare)
  return found.source === 'none' ? asGiven : found
}

const AMOUNT_WORDS =
  /^\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s+(?:(?:at|on|for|in)\s+)?/i
const TRAILING_AMOUNT = /\s+\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/
const LEADING_WORD = /^(?:at|on|for)\s+/i

// What someone types in one box: "$50 at Starbucks", "starbucks $50", "at
// Costco". A trailing bare number counts only after other words, so a store
// named "76" still works.
export function splitPurchaseText(text: string): {
  merchant: string
  amount: number | null
} {
  let rest = text.trim()
  let amount: number | null = null
  const lead = AMOUNT_WORDS.exec(rest)
  if (lead) {
    amount = Number(`${(lead[1] ?? '').replace(/,/g, '')}${lead[2] ?? ''}`)
    rest = rest.slice(lead[0].length)
  } else {
    const trail = TRAILING_AMOUNT.exec(rest)
    if (trail && trail.index > 0) {
      amount = Number(`${(trail[1] ?? '').replace(/,/g, '')}${trail[2] ?? ''}`)
      rest = rest.slice(0, trail.index)
    }
  }
  rest = rest.replace(LEADING_WORD, '').trim()
  return rest === ''
    ? { merchant: text.trim(), amount: null }
    : { merchant: rest, amount: amount !== null && amount > 0 ? amount : null }
}
