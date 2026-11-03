import type { Card, Milestone } from '../schema/card.ts'
import type { WalletCard } from '../schema/wallet.ts'
import { periodKey } from './periods.ts'
import {
  listed,
  MILESTONE_PERIODS,
  money,
  roundCents,
  wholeDollars,
} from './text.ts'

// Spend milestones: a bonus paid once a period after a spending total. Only
// spending the wallet tracks counts; earnrate never assumes the rest.

export type MilestoneProgress = {
  milestone: Milestone
  period: string | null // null for a cardmember year without an anniversary
  spent: number // tracked dollars this period
  tracked: boolean // the wallet has any spending recorded toward it
}

export function milestoneProgress(
  card: Card,
  held: WalletCard,
  date: string,
): MilestoneProgress[] {
  return card.milestones.map((milestone) => {
    const period = periodKey(milestone.period, date, held.anniversary ?? null)
    const usage = held.milestone_usage?.[milestone.id]
    return {
      milestone,
      period,
      spent: usage !== undefined && usage.period === period ? usage.spent : 0,
      tracked: usage !== undefined,
    }
  })
}

export type MilestoneHit = {
  id: string
  spend: number
  period: string // the period key, like "2026"
  before: number // tracked dollars this period before the purchase
  points: number | null
  rewards: string[]
}

// The milestones this purchase reaches: tracked spending before it is under
// the total, and with it the total is met.
export function milestonesReached(
  card: Card,
  held: WalletCard,
  date: string,
  amount: number | null,
): MilestoneHit[] {
  if (amount === null || amount <= 0) return []
  return milestoneProgress(card, held, date).flatMap(
    ({ milestone: m, period, spent, tracked }) =>
      tracked &&
      period !== null &&
      spent < m.spend &&
      m.spend <= roundCents(spent + amount)
        ? [
            {
              id: m.id,
              spend: m.spend,
              period,
              before: spent,
              points: m.points ?? null,
              rewards: m.rewards ?? [],
            },
          ]
        : [],
  )
}

export const milestonePoints = (hits: MilestoneHit[]) =>
  hits.reduce((sum, h) => sum + (h.points ?? 0), 0)

// "10,000 bonus points and Gold Elite status"
export function milestonePays(m: {
  points?: number | null | undefined
  rewards?: string[] | undefined
}): string {
  return listed([
    ...(m.points === undefined || m.points === null
      ? []
      : [`${m.points.toLocaleString('en-US')} bonus points`]),
    ...(m.rewards ?? []),
  ])
}

// "the $15,000 calendar-year spend for 10,000 bonus points"
export const milestoneWhat = (
  m: Pick<Milestone, 'spend' | 'period' | 'points' | 'rewards'>,
) =>
  `the ${wholeDollars(m.spend)} ${MILESTONE_PERIODS[m.period]} spend for ${milestonePays(m)}`

export function reachedText(card: Card, hit: MilestoneHit): string {
  const m = card.milestones.find((x) => x.id === hit.id)
  if (!m) return ''
  return `This purchase reaches ${milestoneWhat(m)} (${money(hit.before)} tracked on this card in ${hit.period} before it).`
}

// The last day of a milestone's current period: December 31, or the day
// before the next card anniversary.
export function milestonePeriodEnd(
  period: Milestone['period'],
  key: string,
  anniversary: string | null,
): string | null {
  if (period === 'calendar_year') return `${key}-12-31`
  if (anniversary === null) return null
  const next = new Date(`${String(Number(key) + 1)}-${anniversary}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() - 1)
  return next.toISOString().slice(0, 10)
}

const THIS_PERIOD: Record<Milestone['period'], string> = {
  calendar_year: 'this year',
  cardmember_year: 'this cardmember year',
}

export type MilestoneSummary = {
  id: string
  spend: number
  period: Milestone['period']
  currentPeriod: string | null // null for a cardmember year without an anniversary
  until: string | null // the period's last day, YYYY-MM-DD
  spent: number
  tracked: boolean
  points: number | null
  rewards: string[]
  text: string // progress, in words
}

export function milestoneSummaries(
  card: Card,
  held: WalletCard,
  today: string,
): MilestoneSummary[] {
  return milestoneProgress(card, held, today).map(
    ({ milestone: m, period, spent, tracked }) => {
      const pays = milestonePays(m)
      const text =
        period === null
          ? `${wholeDollars(m.spend)} a cardmember year for ${pays}: give the card's anniversary to track it.`
          : !tracked
            ? `${wholeDollars(m.spend)} ${THIS_PERIOD[m.period]} for ${pays}; spending toward it isn't tracked yet.`
            : spent >= m.spend
              ? `${wholeDollars(m.spend)} reached ${THIS_PERIOD[m.period]}: ${pays}.`
              : `${money(spent)} of ${wholeDollars(m.spend)} ${THIS_PERIOD[m.period]} for ${pays}.`
      return {
        id: m.id,
        spend: m.spend,
        period: m.period,
        currentPeriod: period,
        until:
          period === null
            ? null
            : milestonePeriodEnd(m.period, period, held.anniversary ?? null),
        spent,
        tracked,
        points: m.points ?? null,
        rewards: m.rewards ?? [],
        text,
      }
    },
  )
}
