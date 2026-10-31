import { parseArgs } from 'node:util'
import {
  isValuationProfile,
  type ValuationProfile,
} from '../engine/profiles.ts'
import { knownMemberships } from '../engine/setup.ts'
import type { Channel } from '../engine/types.ts'
import type { Catalog } from '../schema/catalog.ts'

export type CliOptions = {
  merchant: string
  amount: number | null
  channel: Channel | null
  valuation: ValuationProfile | null
  date: string | null
  country: string
  json: boolean
  all: boolean
  category: string | null // checked against the catalog once it's loaded
  llm: boolean | null // null: follow the environment
  cards: string[] | null // card ids named for this answer instead of the wallet
  members: string[]
}

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'run'; options: CliOptions }
  | { kind: 'error'; message: string }

// Shared by every subcommand, so each flag means the same thing everywhere.
// A string result is the error to show.

const LOOKS_LIKE_AMOUNT = /^\$?[\d,]*\.?\d+$/
const AMOUNT = /^\$?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/

function parseAmount(text: string): number | string {
  if (!AMOUNT.test(text)) {
    return `"${text}" isn't an amount. Use dollars, like 80 or 12.50.`
  }
  const amount = Number(text.replace(/[$,]/g, ''))
  return amount > 0 ? amount : 'The amount must be more than $0.'
}

// A trailing number is the amount only when something comes before it, so
// a merchant named "76" still works on its own.
export function splitAmount(
  positionals: string[],
): { text: string; amount: number | null } | string {
  const words = [...positionals]
  const last = words.at(-1)
  let amount: number | null = null
  if (words.length > 1 && last !== undefined && LOOKS_LIKE_AMOUNT.test(last)) {
    const result = parseAmount(last)
    if (typeof result === 'string') return result
    amount = result
    words.pop()
  }
  return { text: words.join(' ').trim(), amount }
}

export function dateProblem(text: string | undefined): string | null {
  if (text === undefined) return null
  const date = new Date(`${text}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(text)
    ? null
    : `"${text}" isn't a date. Use YYYY-MM-DD.`
}

export function valuationProblem(text: string | undefined): string | null {
  return text === undefined || isValuationProfile(text)
    ? null
    : `Unknown valuation "${text}". Use flat or points-heavy.`
}

export function membershipProblem(
  catalog: Catalog,
  members: string[],
): string | null {
  const known = knownMemberships(catalog)
  const unknown = members.filter((m) => !known.includes(m))
  return unknown.length === 0
    ? null
    : `Unknown membership "${unknown.join('", "')}". Use one of: ${known.join(', ')}.`
}

export const BOTH_CHANNELS = 'Pick --online or --in-store, not both.'

export function channelOf(values: {
  online?: boolean | undefined
  'in-store'?: boolean | undefined
}): Channel | null {
  return values.online ? 'online' : values['in-store'] ? 'in_store' : null
}

export function cardList(text: string | undefined): string[] | null {
  return text === undefined
    ? null
    : text
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c !== '')
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        online: { type: 'boolean' },
        'in-store': { type: 'boolean' },
        valuation: { type: 'string' },
        date: { type: 'string' },
        country: { type: 'string' },
        json: { type: 'boolean' },
        category: { type: 'string' },
        all: { type: 'boolean' },
        llm: { type: 'boolean' },
        cards: { type: 'string' },
        member: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : String(e),
    }
  }
  const { values, positionals } = parsed
  if (values.help) return { kind: 'help' }

  const split = splitAmount(positionals)
  if (typeof split === 'string') return { kind: 'error', message: split }
  const { text: merchant, amount } = split
  if (merchant === '') {
    return { kind: 'error', message: 'Name a merchant, like "whole foods".' }
  }

  if (values.online && values['in-store'])
    return { kind: 'error', message: BOTH_CHANNELS }
  const problem = valuationProblem(values.valuation) ?? dateProblem(values.date)
  if (problem !== null) return { kind: 'error', message: problem }
  const valuation =
    values.valuation !== undefined && isValuationProfile(values.valuation)
      ? values.valuation
      : null

  const country = values.country ?? 'US'
  if (!/^[A-Za-z]{2}$/.test(country)) {
    return {
      kind: 'error',
      message: `"${country}" isn't a country code. Use two letters, like US or FR.`,
    }
  }

  return {
    kind: 'run',
    options: {
      merchant,
      amount,
      channel: channelOf(values),
      valuation,
      date: values.date ?? null,
      country: country.toUpperCase(),
      json: values.json ?? false,
      all: values.all ?? false,
      category: values.category ?? null,
      llm: values.llm ?? null,
      cards: cardList(values.cards),
      members: values.member ?? [],
    },
  }
}
