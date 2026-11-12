import { describe, expect, test } from 'vitest'
import { loadCatalog } from '../../src/data/load.ts'
import { isClose } from '../../src/engine/compare.ts'
import { ALL_PERSONAL_CARDS } from '../../src/engine/explore.ts'
import {
  keepOrReplace,
  keepOrReplaceUnsaid,
  keepOrReplaceVerdict,
  OTHER_PERKS,
} from '../../src/engine/keep-or-replace.ts'
import type { Spending } from '../../src/engine/renewal.ts'
import {
  resolveSpendLines,
  simulateCatalog,
  spendLineFor,
  typicalSpendLines,
} from '../../src/engine/simulate.ts'
import { usedCreditsYear } from '../../src/engine/credits.ts'
import { roundCents, wholeDollars } from '../../src/engine/text.ts'
import {
  feeCardLead,
  flatRateCard,
  type FeeVerdict,
  reportWallet,
  walletReport,
  walletReportText,
  type ReportInput,
} from '../../src/engine/wallet-report.ts'
import { TODAY } from './fixtures.ts'

const goldenTest = test

const catalog = await loadCatalog()

const spending = (...rows: [string, number][]): Spending => ({
  lines: resolveSpendLines(
    catalog,
    rows.map(([what, monthly]) => spendLineFor(catalog, what, monthly)),
  ),
  typical: false,
})

const typical = (): Spending => ({
  lines: typicalSpendLines(catalog),
  typical: true,
})

const input = (
  cards: (string | ReportInput['cards'][number])[],
  more: Partial<ReportInput> = {},
): ReportInput => ({
  cards: cards.map((c) => (typeof c === 'string' ? { id: c, picks: {} } : c)),
  memberships: [],
  valuations: {},
  ...more,
})

const report = (i: ReportInput, s: Spending) =>
  walletReport(catalog, i, TODAY, s, '2026.11.11')

const EVERYDAY = spending(
  ['groceries', 500],
  ['dining', 300],
  ['gas', 150],
  ['everything else', 800],
)

describe('#41 rate my wallet', () => {
  goldenTest(
    '#41a four cards that split the spending beat the best two cards earnrate can find',
    () => {
      const r = report(
        input([
          'amex-blue-cash-preferred',
          'capital-one-savor',
          'citi-double-cash',
          'chase-freedom-unlimited',
        ]),
        EVERYDAY,
      )
      const best = simulateCatalog(catalog, EVERYDAY.lines, {
        filters: ALL_PERSONAL_CARDS,
        memberships: [],
        valuations: {},
        start: TODAY,
      }).pairs[0]
      expect(r.best.pair?.cards.map((c) => c.cardId)).toEqual(
        best?.cards.map((c) => c.cardId),
      )
      expect(r.net).toBeGreaterThan(r.best.pair?.net ?? Infinity)
      expect(r.net).toBe(
        roundCents(r.simulation.rewards - r.simulation.annualFees),
      )
      const text = walletReportText(catalog, r)
      expect(text).toMatch(
        /^Your 4 cards net about \$[\d,]+ a year: \$[\d,]+ in rewards, less \$95 in annual fees, on your spending of \$1,750 a month\./,
      )
      expect(text).toMatch(
        /The best two cards for this spending, the .+, would net about \$[\d,]+ a year; your cards earn about \$[\d,]+ more\./,
      )
    },
  )

  goldenTest(
    "#41b a fee card the others already cover doesn't pay for itself, and its credits are shown apart",
    () => {
      const i = input(['amex-platinum', 'citi-double-cash'])
      const s = spending(['everything else', 1000])
      const r = report(i, s)
      const [platinum] = r.feeCards
      expect(r.feeCards).toHaveLength(1)
      expect(platinum?.cardId).toBe('amex-platinum')
      expect(platinum?.paysForItself).toBe(false)
      expect(platinum?.outcome).toBe('not-needed')
      const k = keepOrReplace(
        catalog,
        reportWallet(catalog, i, TODAY, s).wallet,
        'amex-platinum',
        TODAY,
        s,
      )
      expect(k).not.toBeNull()
      if (!k) return
      expect(platinum?.verdict).toBe(keepOrReplaceVerdict(catalog, k))
      expect(platinum?.verdict).toMatch(
        /^Your other cards already cover what the Amex Platinum earns/,
      )
      expect(platinum?.credits).toBe(keepOrReplaceUnsaid(k))
      expect(platinum?.credits).toMatch(
        /^The Amex Platinum's credits you haven't marked as used \(.+\) aren't counted; with them all, it would add about/,
      )
      const text = walletReportText(catalog, r)
      expect(platinum?.creditsCover).toBe(true)
      expect(text).toContain(
        "On rewards alone, the Amex Platinum doesn't pay for itself on this spending; its statement credits would cover the rest if you'd use them.",
      )
      const credits = r.credits.reduce((sum, c) => sum + c.yearly, 0)
      expect(credits).toBe(k.unsaid.yearly)
      expect(text).toContain(
        `a month. This figure leaves out the statement credits on the Amex Platinum. If you'd use every one (${wholeDollars(credits)} a year), these cards would net about ${wholeDollars(r.net + credits)} a year. They're worth that only if you'd spend at those places anyway.`,
      )
      expect(text).toContain(OTHER_PERKS)
    },
  )

  goldenTest(
    '#41c one no-fee card held alone, against the best no-fee card with one rate for everything',
    () => {
      const r = report(
        input(['chase-freedom-unlimited']),
        spending(['everything else', 1000]),
      )
      expect(r.net).toBe(180)
      expect(r.flat?.net).toBe(240)
      expect(r.flat?.returnPct).toBeCloseTo(2)
      expect(r.feeCards).toEqual([])
      expect(r.credits).toEqual([])
      expect(walletReportText(catalog, r)).not.toContain('leaves out')
      const flat = catalog.cards.find((c) => c.id === r.flat?.cardId)
      expect(flat?.annual_fee).toBe(0)
      expect(flat && flatRateCard(catalog, flat, TODAY)).toBe(true)
      const text = walletReportText(catalog, r)
      expect(text).toMatch(
        /^Your Chase Freedom Unlimited nets about \$180 a year in rewards, with no annual fee, on your spending of \$1,000 a month\./,
      )
      expect(text).toMatch(
        /That's about \$60 a year less than the .+ alone, the best no-fee card with one rate for everything \(2%(; \d+ others? earns? the same)?\)\. No pair of cards nets more on this spending than the .+ alone, at about \$240 a year, about \$60 more than yours\./,
      )
    },
  )

  goldenTest(
    '#41d an empty wallet has nothing to rate, and says what one and two cards would do',
    () => {
      const r = report(input([]), EVERYDAY)
      expect(r.empty).toBe(true)
      expect(r.net).toBe(0)
      expect(r.feeCards).toEqual([])
      expect(r.gaps).toEqual([])
      expect(r.next).not.toBeNull()
      expect(r.flat).not.toBeNull()
      const text = walletReportText(catalog, r)
      expect(text).toMatch(/^There are no cards to rate yet\./)
      expect(text).toContain(wholeDollars(r.flat?.net ?? 0))
    },
  )

  goldenTest(
    '#41e spending that was entered is said to be yours; typical spending is labeled as such',
    () => {
      const i = input(['citi-double-cash', 'amex-gold'])
      const own = report(i, EVERYDAY)
      const usual = report(i, typical())
      expect(own.typical).toBe(false)
      expect(own.monthly).toBe(1750)
      expect(usual.typical).toBe(true)
      expect(usual.monthly).toBe(
        typical().lines.reduce((sum, l) => sum + l.monthly, 0),
      )
      expect(walletReportText(catalog, own)).toContain(
        'on your spending of $1,750 a month',
      )
      expect(walletReportText(catalog, own)).toContain(
        'Uses the monthly amounts you entered.',
      )
      expect(walletReportText(catalog, usual)).toMatch(
        /on typical U\.S\. spending of about \$[\d,]+ a month/,
      )
      expect(walletReportText(catalog, usual)).toContain(
        'No spending was given, so this uses rough typical monthly amounts',
      )
    },
  )

  goldenTest(
    '#41f a line where the best card held earns clearly less than the best card earnrate knows is a gap, with that card',
    () => {
      const r = report(
        input(['citi-double-cash']),
        spending(['gas', 300], ['everything else', 500]),
      )
      expect(r.gaps.map((g) => g.label)).toEqual(['Gas stations'])
      const [gas] = r.gaps
      if (!gas) return
      expect(gas.heldPct).toBeCloseTo(2)
      expect(isClose(gas.heldPct, gas.bestPct)).toBe(false)
      expect(gas.bestCardId).not.toBe('citi-double-cash')
      expect(gas.dollars).toBe(
        roundCents(((gas.bestPct - gas.heldPct) / 100) * 3600),
      )
      expect(walletReportText(catalog, r)).toMatch(
        /On gas stations, your cards earn 2%; the .+ earns [\d.]+%( \(its annual fee is \$[\d,]+\))?, about \$[\d,]+ a year more on \$3,600\./,
      )
    },
  )

  goldenTest(
    '#41g a card without its picks gets the best ones for the spending, said as assumed; picks given are kept',
    () => {
      const dining = spending(['dining', 400], ['everything else', 400])
      const assumed = report(
        input(['bank-of-america-customized-cash-rewards']),
        dining,
      )
      expect(assumed.cards).toEqual([
        {
          cardId: 'bank-of-america-customized-cash-rewards',
          picks: { 'three-percent': ['dining'] },
          assumed: true,
        },
      ])
      expect(walletReportText(catalog, assumed)).toMatch(
        /Assumes the best picks for this spending: Bank of America Customized Cash Rewards, restaurants\./,
      )
      const given = report(
        input([
          {
            id: 'bank-of-america-customized-cash-rewards',
            picks: { 'three-percent': ['gas-ev-charging'] },
          },
        ]),
        dining,
      )
      expect(given.cards[0]?.assumed).toBe(false)
      expect(given.cards[0]?.picks).toEqual({
        'three-percent': ['gas-ev-charging'],
      })
      expect(given.net).toBeLessThan(assumed.net)
    },
  )

  goldenTest(
    "#41i a gap names a card only when the line alone pays its fee, or when it's the card to add, so the two agree",
    () => {
      const r = report(
        input(['citi-double-cash']),
        spending(['groceries', 150], ['everything else', 500]),
      )
      expect(r.next?.cardId).not.toBe('amex-blue-cash-preferred')
      expect(r.gaps.map((g) => g.bestCardId)).not.toContain(
        'amex-blue-cash-preferred',
      )
      for (const g of r.gaps) {
        expect(g.fee).toBe(
          catalog.cards.find((c) => c.id === g.bestCardId)?.annual_fee ?? 0,
        )
        if (g.bestCardId !== r.next?.cardId)
          expect(Math.round(g.dollars - g.fee)).toBeGreaterThan(0)
      }
      const text = walletReportText(catalog, r)
      expect(r.next).not.toBeNull()
      expect(r.best.pair?.net ?? 0).toBeGreaterThanOrEqual(
        r.net + (r.next?.gain ?? 0) - 0.01,
      )
      expect(text).not.toContain('No pair of cards nets more')
      for (const g of r.gaps.filter((x) => x.fee > 0))
        expect(text).toContain(`(its annual fee is $${String(g.fee)})`)
      expect(r.gaps.find((g) => g.label === 'Supermarkets')?.fee ?? 0).toBe(0)
    },
  )

  goldenTest(
    '#41j credits marked as used count against the fees, credits marked as not used count nowhere, and the rest are said apart',
    () => {
      const s = spending(['everything else', 1000])
      const i = input([
        {
          id: 'amex-platinum',
          picks: {},
          used: ['uber-cash', 'resy', 'digital-entertainment'],
          skipped: ['equinox'],
        },
        'citi-double-cash',
      ])
      const r = report(i, s)
      const { wallet } = reportWallet(catalog, i, TODAY, s)
      const platinum = catalog.cards.find((c) => c.id === 'amex-platinum')
      const held = wallet.cards.find((c) => c.id === 'amex-platinum')
      if (!platinum || !held) throw new Error('no Platinum')
      const used = usedCreditsYear(catalog, platinum, held, TODAY, {})
      expect(used.creditIds.sort()).toEqual(
        ['digital-entertainment', 'resy', 'uber-cash'].sort(),
      )
      expect(r.counted.map((c) => c.yearly)).toEqual([used.yearly])
      expect(r.net).toBe(
        roundCents(
          r.simulation.rewards + used.yearly - r.simulation.annualFees,
        ),
      )
      const [unsaid] = r.credits
      expect(unsaid?.creditIds).not.toContain('uber-cash')
      expect(unsaid?.creditIds).not.toContain('equinox')
      expect(unsaid?.creditIds).toContain('clear-plus')
      const text = walletReportText(catalog, r)
      expect(text).toContain(
        `: ${wholeDollars(r.simulation.rewards)} in rewards, plus ${wholeDollars(used.yearly)} in credits you use on the Amex Platinum, less $895 in annual fees`,
      )
      expect(text).toContain(
        `This figure counts the credits marked as used. The other statement credits on the Amex Platinum (${wholeDollars(unsaid?.yearly ?? 0)} a year) would make it about ${wholeDollars(r.net + (unsaid?.yearly ?? 0))} a year if you'd use every one.`,
      )
      const [verdict] = r.feeCards
      expect(verdict?.counted).toBe(used.yearly)
    },
  )

  goldenTest(
    "#41k marking a fee card's credits as used flips it from not covering its fee to covering it, and its tag and the headline agree",
    () => {
      const s = spending(
        ['dining', 300],
        ['groceries', 400],
        ['everything else', 500],
      )
      const plain = report(input(['amex-gold', 'citi-double-cash']), s)
      const marked = report(
        input([
          {
            id: 'amex-gold',
            picks: {},
            used: ['dunkin', 'uber-cash', 'dining', 'resy'],
            skipped: [],
          },
          'citi-double-cash',
        ]),
        s,
      )
      const [before] = plain.feeCards
      const [after] = marked.feeCards
      expect(before?.paysForItself).toBe(false)
      expect(before?.creditsCover).toBe(true)
      expect(after?.paysForItself).toBe(true)
      expect(after?.creditsCover).toBe(false)
      expect(marked.net - plain.net).toBeCloseTo(after?.counted ?? 0, 2)
      expect(feeCardLead(catalog, after as FeeVerdict)).toBe('')
      expect(feeCardLead(catalog, before as FeeVerdict)).toBe(
        "On rewards alone, the Amex Gold doesn't pay for itself on this spending; its statement credits would cover the rest if you'd use them.",
      )
      expect(walletReportText(catalog, marked)).not.toContain('leaves out')
    },
  )

  goldenTest('#41h point values in the input change the figures', () => {
    const i = input(['chase-sapphire-preferred'])
    const flat = report(i, EVERYDAY)
    const valued = report({ ...i, valuations: { UR: 2 } }, EVERYDAY)
    expect(valued.simulation.rewards).toBeCloseTo(
      flat.simulation.rewards * 2,
      0,
    )
  })
})
