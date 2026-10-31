import { catalog } from 'virtual:catalog'
import type { Requirements } from '../../src/engine/explore.ts'
import { earnText } from '../../src/engine/recommend.ts'
import type { Card } from '../../src/schema/card.ts'

export const cards = new Map<string, Card>(catalog.cards.map((c) => [c.id, c]))

export const pct = (n: number) => `${String(Number(n.toFixed(2)))}%`

export const usd = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

export function shortName(id: string): string {
  const name = cards.get(id)?.name ?? id
  return name
    .replace(/^American Express /, 'Amex ')
    .replace(/^The Platinum Card from American Express$/, 'Amex Platinum')
    .replace(/ (Visa Signature |Visa Infinite )?(Credit )?Card$/, '')
    .replace(/ Card by /, ' by ')
}

const ISSUERS: Record<string, string> = {
  amex: 'American Express',
  'bank-of-america': 'Bank of America',
  'capital-one': 'Capital One',
  chase: 'Chase',
  citi: 'Citi',
  column: 'Bilt',
  sofi: 'SoFi',
  'td-bank': 'TD Bank',
  usbank: 'U.S. Bank',
  'wells-fargo': 'Wells Fargo',
}

export const issuerName = (id: string) => ISSUERS[id] ?? id

export const issuers = [...new Set(catalog.cards.map((c) => c.issuer))].sort(
  (a, b) => issuerName(a).localeCompare(issuerName(b)),
)

export const MEMBERSHIPS: Record<string, string> = {
  'amazon-prime': 'Amazon Prime',
  'bank-of-america-account': 'Bank of America checking or savings',
  'bofa-rewards-member': 'BofA Rewards Member',
  'bofa-rewards-preferred-plus': 'BofA Rewards Preferred Plus',
  'bofa-rewards-preferred-honors': 'BofA Rewards Preferred Honors',
  'bofa-rewards-premier': 'BofA Rewards Premier',
}

export const membershipName = (id: string) => MEMBERSHIPS[id] ?? words(id)

export const words = (id: string) => id.replace(/[-_.]/g, ' ')

export function feeText(id: string): string {
  const card = cards.get(id)
  const fee = card?.annual_fee
  if (fee === undefined) return 'Annual fee not on file'
  if (fee === 0) return 'No annual fee'
  const first = card?.first_year_fee
  if (first !== undefined && first !== fee)
    return `${usd(fee)} a year (${first === 0 ? 'waived' : usd(first)} the first year)`
  return `${usd(fee)} a year`
}

const PICK_PERIODS = {
  month: 'each month',
  quarter: 'each quarter',
  calendar_year: 'each year',
  until_changed: 'until you change it',
}

const CAP_PERIODS: Record<string, string> = {
  month: 'a month',
  quarter: 'a quarter',
  calendar_year: 'a year',
  cardmember_year: 'a card year',
}

export function requirementLines(cardId: string, r: Requirements): string[] {
  const lines: string[] = []
  if (r.pick) {
    lines.push(
      `Pick ${r.pick.options.map(words).join(' or ')} as a bonus category (${PICK_PERIODS[r.pick.period]})`,
    )
  }
  if (r.activation !== null)
    lines.push(
      `Activate the bonus with ${issuerName(cards.get(cardId)?.issuer ?? '')} (free)`,
    )
  if (r.membership !== null) lines.push(`With ${membershipName(r.membership)}`)
  if (r.cap)
    lines.push(
      `Up to ${usd(r.cap.amount)} of spending ${CAP_PERIODS[r.cap.period] ?? ''}, then ${earnText(catalog, r.cap.thenRate, r.cap.currency)}`,
    )
  return lines
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
