import { parseArgs } from 'node:util'
import {
  isValuationProfile,
  type ValuationProfile,
} from '../engine/profiles.ts'
import { knownMemberships } from '../engine/setup.ts'
import type { Channel } from '../engine/types.ts'
import { COUNTRY_CODE, countryProblem } from '../schema/common.ts'
import type { Catalog } from '../schema/catalog.ts'
import { PaymentMethod } from '../schema/card.ts'

export type CliOptions = {
  merchant: string
  amount: number | null
  channel: Channel | null
  valuation: ValuationProfile | null
  date: string | null
  country: string
  payment: PaymentMethod | null
  json: boolean
  all: boolean
  category: string | null // checked against the catalog once it's loaded
  llm: boolean | null // null: follow the environment
  cards: string[] | null // card ids named for this answer instead of the wallet
  members: string[]
  // For named cards: credits enrolled in and opening dates, by card id.
  enrolled: Record<string, string[]>
  opened: Record<string, string>
}

type ParsedArgs =
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

export const PAYING_HELP = `--paying <how>         card, apple-pay, google-pay or paypal. Rates that need
                         one (Apple Pay on Apple Card) count only when you say.`

export function paymentOf(
  text: string | undefined,
): { payment: PaymentMethod | null } | { problem: string } {
  if (text === undefined) return { payment: null }
  const parsed = PaymentMethod.safeParse(text.toLowerCase())
  return parsed.success
    ? { payment: parsed.data }
    : {
        problem: `Unknown way of paying "${text}". Use one of: ${PaymentMethod.options.join(', ')}.`,
      }
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
        paying: { type: 'string' },
        json: { type: 'boolean' },
        category: { type: 'string' },
        all: { type: 'boolean' },
        llm: { type: 'boolean' },
        cards: { type: 'string' },
        member: { type: 'string', multiple: true },
        enrolled: { type: 'string', multiple: true },
        opened: { type: 'string', multiple: true },
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
  if (!COUNTRY_CODE.test(country))
    return { kind: 'error', message: countryProblem(country) }

  const paying = paymentOf(values.paying)
  if ('problem' in paying) return { kind: 'error', message: paying.problem }

  const cards = cardList(values.cards)
  const perCard = (flag: 'enrolled' | 'opened', example: string) => {
    const out: Record<string, string> = {}
    for (const pair of values[flag] ?? []) {
      const [id = '', value = ''] = pair.split('=')
      if (id.trim() === '' || value.trim() === '')
        return `--${flag} takes <card>=<${flag === 'opened' ? 'date' : 'credits'}>, like ${example}.`
      if (!cards?.includes(id.trim()))
        return `--${flag} is for a card named with --cards; ${id.trim()} isn't one.`
      out[id.trim()] = value.trim()
    }
    return out
  }
  const enrolled = perCard('enrolled', 'amex-platinum=lululemon')
  if (typeof enrolled === 'string') return { kind: 'error', message: enrolled }
  const opened = perCard('opened', 'discover-it-cash-back=2026-03-04')
  if (typeof opened === 'string') return { kind: 'error', message: opened }

  return {
    kind: 'run',
    options: {
      merchant,
      amount,
      channel: channelOf(values),
      valuation,
      date: values.date ?? null,
      country: country.toUpperCase(),
      payment: paying.payment,
      json: values.json ?? false,
      all: values.all ?? false,
      category: values.category ?? null,
      llm: values.llm ?? null,
      cards,
      members: values.member ?? [],
      enrolled: Object.fromEntries(
        Object.entries(enrolled).map(([id, list]) => [
          id,
          list
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        ]),
      ),
      opened,
    },
  }
}
