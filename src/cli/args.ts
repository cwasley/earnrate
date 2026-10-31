import { parseArgs } from 'node:util'
import {
  isValuationProfile,
  type ValuationProfile,
} from '../engine/profiles.ts'
import type { Channel } from '../engine/types.ts'

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

const LOOKS_LIKE_AMOUNT = /^\$?[\d,]*\.?\d+$/
const AMOUNT = /^\$?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/

function parseAmount(text: string): number | string {
  if (!AMOUNT.test(text)) {
    return `"${text}" isn't an amount. Use dollars, like 80 or 12.50.`
  }
  const amount = Number(text.replace(/[$,]/g, ''))
  return amount > 0 ? amount : 'The amount must be more than $0.'
}

function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
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

  // A trailing number is the amount only when something comes before it, so
  // a merchant named "76" still works on its own.
  const words = [...positionals]
  let amount: number | null = null
  const last = words.at(-1)
  if (words.length > 1 && last !== undefined && LOOKS_LIKE_AMOUNT.test(last)) {
    const result = parseAmount(last)
    if (typeof result === 'string') return { kind: 'error', message: result }
    amount = result
    words.pop()
  }
  const merchant = words.join(' ').trim()
  if (merchant === '') {
    return { kind: 'error', message: 'Name a merchant, like "whole foods".' }
  }

  if (values.online && values['in-store']) {
    return {
      kind: 'error',
      message: 'Pick one of --online and --in-store.',
    }
  }
  const channel: Channel | null = values.online
    ? 'online'
    : values['in-store']
      ? 'in_store'
      : null

  let valuation: ValuationProfile | null = null
  if (values.valuation !== undefined) {
    if (!isValuationProfile(values.valuation)) {
      return {
        kind: 'error',
        message: `Unknown valuation "${values.valuation}". Use flat or points-heavy.`,
      }
    }
    valuation = values.valuation
  }

  if (values.date !== undefined && !isValidDate(values.date)) {
    return {
      kind: 'error',
      message: `"${values.date}" isn't a date. Use YYYY-MM-DD.`,
    }
  }

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
      channel,
      valuation,
      date: values.date ?? null,
      country: country.toUpperCase(),
      json: values.json ?? false,
      all: values.all ?? false,
      category: values.category ?? null,
      llm: values.llm ?? null,
      cards:
        values.cards === undefined
          ? null
          : values.cards
              .split(',')
              .map((c) => c.trim())
              .filter((c) => c !== ''),
      members: values.member ?? [],
    },
  }
}
