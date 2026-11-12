// Audits the typical month (TYPICAL_MONTHLY_SPEND) against the shapes of the
// cards' rules: what each line resolves to and earns on every card, the
// rules meant for a line that it can't reach and why, the rules the month
// never uses, how picks and memberships resolve, and the headline yearly
// figures.
//
// node scripts/typical-audit.ts [--section lines|unused|picks|memberships|headline]
//   [--json before.json] [--compare before.json] [--date YYYY-MM-DD]
//
// --json saves the headline figures; --compare prints them beside a saved run.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadCatalog } from '../src/data/load.ts'
import {
  evaluateCard,
  purchaseContext,
  singleMcc,
} from '../src/engine/evaluate.ts'
import {
  ALL_PERSONAL_CARDS,
  idealHolding,
  type Picks,
} from '../src/engine/explore.ts'
import { feeWorthKit } from '../src/engine/fee-worth.ts'
import { localToday } from '../src/engine/periods.ts'
import {
  simulateCatalog,
  simulateSingles,
  TYPICAL_MONTHLY_SPEND,
  typicalSpendLines,
  type ResolvedLine,
  type Simulation,
} from '../src/engine/simulate.ts'
import { cardValuation } from '../src/engine/valuation.ts'
import type { Card } from '../src/schema/card.ts'
import {
  COVERAGE_MISSES,
  family,
  lineGaps,
  meantFor,
  membershipsFor,
  SHAPE_MISSES,
  variants,
  whyNotThisYear,
  type LineGap,
  type Miss,
} from './typical-shape.ts'

const { values } = parseArgs({
  options: {
    section: { type: 'string' },
    json: { type: 'string' },
    compare: { type: 'string' },
    date: { type: 'string' },
  },
})

const catalog = await loadCatalog()
const today = values.date ?? localToday()
const lines = typicalSpendLines(catalog)
const dates = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(`${today.slice(0, 7)}-15T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + i)
  return d.toISOString().slice(0, 10)
})
const want = (s: string) => values.section === undefined || values.section === s
const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pct = (n: number) => `${(Math.round(n * 100) / 100).toString()}%`
const kindOf = (miss: Miss) =>
  SHAPE_MISSES.has(miss)
    ? 'SHAPE'
    : COVERAGE_MISSES.has(miss)
      ? 'coverage'
      : 'by design'

const options = (card: Card) => ({
  filters: {
    ...ALL_PERSONAL_CARDS,
    business: card.business,
    includeClosed: true,
  },
  memberships: membershipsFor(card),
  valuations: {},
  start: today,
})

// Each card alone on the typical month with its best picks, a member of
// anything it needs.
const alone = new Map<string, Simulation>()
for (const card of catalog.cards) {
  const [sim] = simulateSingles(catalog, [card], lines, options(card))
  if (sim) alone.set(card.id, sim)
}
const picksOf = (id: string): Picks => alone.get(id)?.cards[0]?.picks ?? {}

function bestRuleOn(card: Card, line: ResolvedLine, picks: Picks) {
  const holding = idealHolding(card, today, picks)
  const ctx = purchaseContext(
    catalog,
    { valuations: {}, memberships: membershipsFor(card), cards: [holding] },
    line.merchant,
    line.merchant.category,
    { amount: null, date: today, country: 'US' },
  )
  const best = evaluateCard(card, holding, ctx).best
  return { ruleId: best.rule?.id ?? 'base', rate: best.nominalRate }
}

const gaps = lineGaps(catalog, lines, dates)
const channelOf = (g: LineGap) => {
  const rule = catalog.cards
    .find((c) => c.id === g.cardId)
    ?.rules.find((r) => g.variant === r.id || g.variant.startsWith(`${r.id}[`))
  return rule === undefined || rule.channel === 'any' ? '' : `, ${rule.channel}`
}

const out: string[] = []
const say = (s = '') => out.push(s)

say(`# Typical month audit, ${today}`)
say()
say(
  `${String(catalog.cards.length)} cards. Monthly total ${money(TYPICAL_MONTHLY_SPEND.reduce((s, t) => s + t.monthly, 0))}.`,
)

if (want('lines')) {
  say()
  say('## Lines')
  for (const line of lines) {
    const m = line.merchant
    const mcc = m.likelyMcc ?? singleMcc(catalog, m.category)
    say(
      `- ${line.label} ${money(line.monthly)} -> ${m.merchantId === null ? `category ${m.category}` : `store ${m.merchantId} (${m.category})`}, channel ${m.channel ?? 'unstated'}, assumed MCC ${mcc === null ? 'none' : String(mcc)}`,
    )
  }
  for (const line of lines) {
    say()
    say(`### ${line.label} (${line.merchant.category})`)
    say()
    say('Cards earning more than their base rate here, best return first:')
    const earning = catalog.cards
      .map((card) => {
        const sim = alone.get(card.id)
        const result = sim?.lines.find((l) => l.label === line.label)
        const { ruleId, rate } = bestRuleOn(card, line, picksOf(card.id))
        return { card, ruleId, rate, returnPct: result?.returnPct ?? 0 }
      })
      .filter((e) => e.ruleId !== 'base')
      .sort((a, b) => b.returnPct - a.returnPct)
    for (const e of earning) {
      const cents = cardValuation(
        catalog,
        { valuations: {}, memberships: [], cards: [] },
        e.card,
      ).centsPerUnit
      const nominal = e.rate * cents
      const capped =
        e.returnPct + 0.005 < nominal ? `, capped from ${pct(nominal)}` : ''
      say(
        `- ${e.card.id}: ${e.ruleId} ${String(e.rate)}x -> ${pct(e.returnPct)} a year${capped}`,
      )
    }
    say()
    say(
      'Bonus rules (one per option for a pick) meant for this kind of spending that no line of the month reaches:',
    )
    const here = gaps.filter((g) => g.line === line.label)
    const listedOut = here.filter((g) => kindOf(g.miss) !== 'by design')
    for (const g of listedOut)
      say(
        `- [${kindOf(g.miss)}] ${g.cardId}/${g.variant} ${String(g.rate)}x: ${g.miss} (rule: ${g.kinds.join(', ')}${channelOf(g)})`,
      )
    const designed = new Map<Miss, string[]>()
    for (const g of here.filter((g) => kindOf(g.miss) === 'by design'))
      designed.set(g.miss, [
        ...(designed.get(g.miss) ?? []),
        `${g.cardId}/${g.variant}`,
      ])
    for (const [miss, ids] of designed)
      say(
        `- [by design] ${miss}, ${String(ids.length)}: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', ...' : ''}`,
      )
    if (here.length === 0) say('- none')
  }
}

if (want('unused')) {
  say()
  say('## Bonus rules the typical month never uses, by card')
  say()
  say(
    'Used means the best rule for some line in some month with the picks the simulation makes. A pick option is its own entry.',
  )
  const tally = new Map<string, number>()
  for (const card of catalog.cards) {
    const picks = picksOf(card.id)
    const used = new Set<string>()
    for (const line of lines)
      for (const date of dates) {
        const holding = idealHolding(card, date, picks)
        const ctx = purchaseContext(
          catalog,
          {
            valuations: {},
            memberships: membershipsFor(card),
            cards: [holding],
          },
          line.merchant,
          line.merchant.category,
          { amount: null, date, country: 'US' },
        )
        const { best, nominal } = evaluateCard(card, holding, ctx)
        for (const e of [best, nominal]) {
          if (!e.rule) continue
          const choice = e.rule.match.choice
          if (choice === undefined) used.add(e.rule.id)
          else
            for (const o of picks[choice] ??
              card.choices.find((c) => c.id === choice)?.default ??
              [])
              used.add(`${e.rule.id}[${o}]`)
        }
      }
    const groups = new Map<string, string[]>()
    for (const v of variants(catalog, card)) {
      if (used.has(v.id) || v.rule.rate <= card.base_rate) continue
      const gap = gaps.filter((g) => g.cardId === card.id && g.variant === v.id)
      const reached = lines.some(
        (l) =>
          whyNotThisYear(catalog, v, l, dates, membershipsFor(card)) === null,
      )
      let reason: string
      if (reached)
        reason =
          v.option !== null
            ? 'by design: not picked'
            : 'by design: outranked by another rule on the card'
      else if (gap.length === 0)
        reason = `coverage: ${[...new Set(v.kinds.map(family))].join('/') || 'its MCCs'} not in the month`
      else {
        const miss =
          gap.find((g) => kindOf(g.miss) === 'SHAPE')?.miss ??
          gap.find((g) => g.miss !== 'other-kind')?.miss ??
          gap[0]?.miss ??
          'unexplained'
        reason = `${kindOf(miss)}: ${miss}`
      }
      const kind = reason.split(':')[0] ?? reason
      tally.set(kind, (tally.get(kind) ?? 0) + 1)
      groups.set(reason, [
        ...(groups.get(reason) ?? []),
        `${v.id} ${String(v.rule.rate)}x`,
      ])
    }
    if (groups.size === 0) continue
    say()
    say(`### ${card.id}`)
    for (const [reason, ids] of [...groups].sort((a, b) =>
      a[0].localeCompare(b[0]),
    ))
      say(`- ${reason}: ${ids.join(', ')}`)
  }
  say()
  say('Unused bonus rules by kind of reason:')
  for (const [reason, n] of [...tally].sort((a, b) => b[1] - a[1]))
    say(`- ${reason}: ${String(n)}`)
  const families = new Map<string, Set<string>>()
  for (const card of catalog.cards)
    for (const v of variants(catalog, card)) {
      if (v.rule.rate <= card.base_rate) continue
      if (lines.some((l) => meantFor(v, l))) continue
      for (const f of new Set(v.kinds.map(family)))
        families.set(f, (families.get(f) ?? new Set()).add(card.id))
    }
  say()
  say(
    'Kinds of spending the month has no line for, by cards with a bonus there:',
  )
  for (const [f, ids] of [...families].sort((a, b) => b[1].size - a[1].size))
    say(`- ${f}: ${String(ids.size)} cards`)
}

if (want('picks')) {
  say()
  say('## Picks')
  const kit = feeWorthKit(catalog, today)
  for (const card of catalog.cards.filter((c) => c.choices.length > 0)) {
    say()
    say(`### ${card.id}`)
    const picks = picksOf(card.id)
    for (const choice of card.choices) {
      const spendOn = (option: string) =>
        lines
          .filter((line) =>
            variants(catalog, card).some(
              (v) =>
                v.option === option &&
                v.rule.match.choice === choice.id &&
                v.rule.requires?.membership === undefined &&
                whyNotThisYear(
                  catalog,
                  v,
                  line,
                  dates,
                  membershipsFor(card),
                ) === null,
            ),
          )
          .reduce((s, l) => s + l.monthly, 0)
      const ranked = Object.keys(choice.options)
        .map((o) => ({ o, spend: spendOn(o) }))
        .sort((a, b) => b.spend - a.spend)
      const top = ranked
        .slice(0, choice.pick)
        .filter((r) => r.spend > 0)
        .map((r) => r.o)
      const chosen = picks[choice.id] ?? choice.default ?? []
      say(
        `- ${choice.id} (pick ${String(choice.pick)}, ${choice.period}${choice.automatic ? ', automatic' : ''}${choice.default ? `, default ${choice.default.join('+')}` : ''}): simulation picks ${chosen.join(' + ') || 'nothing'}`,
      )
      say(
        `  typical spend each option covers: ${ranked.map((r) => `${r.o} ${money(r.spend)}`).join(', ')}`,
      )
      if (
        choice.automatic &&
        top.join() !==
          [...chosen].sort((a, b) => top.indexOf(a) - top.indexOf(b)).join()
      )
        say(
          `  NOTE: automatic, so the issuer would apply ${top.join(' + ') || 'none'} (most spending), not the simulation's pick`,
        )
      const unreachable = ranked.filter((r) => r.spend === 0).map((r) => r.o)
      if (unreachable.length > 0)
        say(`  options no typical line reaches: ${unreachable.join(', ')}`)
    }
    const worth = card.annual_fee ? kit.feeWorth(card) : null
    if (worth) {
      const at = worth.at(worth.breakEven ?? 1000)
      say(
        `- fee-worth (card page, search_cards) mix ${worth.lines.map((l) => l.label).join(' + ')}; picks there ${JSON.stringify(at.card.cards[0]?.picks ?? {})}`,
      )
    }
  }
}

if (want('memberships')) {
  say()
  say('## Memberships')
  say()
  say(
    'The typical month gives no memberships (Find a card, the home page, fee-worth, search_cards). Cards that need one are simulated for a member and listed apart. Spending at a store only members shop at implies that membership.',
  )
  const implied = catalog.memberships.filter((m) =>
    m.members_shop_at.some((id) =>
      lines.some((l) => l.merchant.merchantId === id),
    ),
  )
  say(
    `- Implied by the typical lines: ${implied.map((m) => m.id).join(', ') || 'none'}`,
  )
  for (const m of catalog.memberships) {
    const needs = catalog.cards.filter((c) => c.requires_membership === m.id)
    const raises = catalog.cards.filter((c) =>
      c.rules.some((r) => r.requires?.membership === m.id),
    )
    if (needs.length === 0 && raises.length === 0) continue
    const gains = raises.map((card) => {
      const without = simulateSingles(catalog, [card], lines, {
        ...options(card),
        memberships: membershipsFor(card),
      })[0]
      const withIt = simulateSingles(catalog, [card], lines, {
        ...options(card),
        memberships: [...membershipsFor(card), m.id],
      })[0]
      return `${card.id} ${money((withIt?.net ?? 0) - (without?.net ?? 0))}`
    })
    say(
      `- ${m.id}${m.annual_fee === undefined ? '' : ` (fee ${money(m.annual_fee)})`}: needed by ${needs.map((c) => c.id).join(', ') || 'none'}; raises rates on ${gains.join(', ') || 'none'} a year on the typical month`,
    )
  }
}

type Headline = {
  date: string
  singles: Record<string, number>
  bestSingle: { cards: string[]; net: number }
  bestPair: { cards: string[]; net: number }
  pairs: { cards: string[]; net: number }[]
}

if (want('headline') || values.json || values.compare) {
  const started = performance.now()
  const sim = simulateCatalog(catalog, lines, {
    filters: ALL_PERSONAL_CARDS,
    memberships: [],
    valuations: {},
    start: today,
  })
  const ms = performance.now() - started
  const ids = (s: Simulation) => s.cards.map((c) => c.cardId)
  const [single] = sim.singles
  const [pair] = sim.pairs
  const headline: Headline = {
    date: today,
    singles: Object.fromEntries(
      [...alone].map(([id, s]) => [id, Math.round(s.net * 100) / 100]),
    ),
    bestSingle: { cards: single ? ids(single) : [], net: single?.net ?? 0 },
    bestPair: { cards: pair ? ids(pair) : [], net: pair?.net ?? 0 },
    pairs: sim.pairs.slice(0, 5).map((p) => ({ cards: ids(p), net: p.net })),
  }
  if (values.json) writeFileSync(values.json, JSON.stringify(headline, null, 2))
  const before: Headline | null = values.compare
    ? (JSON.parse(readFileSync(values.compare, 'utf8')) as Headline)
    : null
  say()
  say('## Headline')
  say()
  say(
    `Find a card (every personal card, no memberships) took ${String(Math.round(ms))} ms.`,
  )
  const fmt = (w: { cards: string[]; net: number }) =>
    `${w.cards.join(' + ')} ${money(w.net)}`
  say(
    `- Best single card: ${fmt(headline.bestSingle)}${before ? ` (was ${fmt(before.bestSingle)})` : ''}`,
  )
  say(
    `- Best pair: ${fmt(headline.bestPair)}${before ? ` (was ${fmt(before.bestPair)})` : ''}`,
  )
  say(`- Next pairs: ${headline.pairs.slice(1).map(fmt).join('; ')}`)
  const rows = Object.entries(headline.singles).sort((a, b) => b[1] - a[1])
  const rank = new Map(rows.map(([id], i) => [id, i + 1]))
  const movers = before
    ? rows.filter(
        ([id, net]) => Math.abs(net - (before.singles[id] ?? net)) >= 1,
      )
    : []
  say()
  say(
    'Each card alone, a year net of its fee (and of a membership it needs), best picks:',
  )
  say()
  say(`| # | card | net${before ? ' | before | change' : ''} |`)
  say(`|---|---|---${before ? '|---|---' : ''}|`)
  const shown = new Set([
    ...rows.slice(0, 25).map(([id]) => id),
    ...movers.map(([id]) => id),
  ])
  for (const [id, net] of rows) {
    if (!shown.has(id)) continue
    const was = before?.singles[id]
    say(
      `| ${String(rank.get(id))} | ${id} | ${money(net)}${before ? ` | ${was === undefined ? '-' : money(was)} | ${was === undefined ? '-' : money(net - was)}` : ''} |`,
    )
  }
  if (before)
    say(
      `\n${String(movers.length)} cards moved by $1 or more; rows 1-25 plus every mover are shown.`,
    )
}

console.log(out.join('\n'))
