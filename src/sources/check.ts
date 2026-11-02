import { z } from 'zod'
import type { Catalog } from '../schema/catalog.ts'
import { containsQuote, earningLines, lineKey, pageKey } from './text.ts'

export type PageLoad = { innerText: string; textContent: string }
export type PageSnapshot =
  | { url: string; ok: true; loads: PageLoad[] }
  | { url: string; ok: false; reason: string }

export const SourcesLockSchema = z.strictObject({
  version: z.literal(1),
  // Hashes of each page's earning lines, never the issuer's text itself.
  pages: z.record(
    z.string(),
    z.strictObject({ checked: z.string(), lines: z.array(z.string()) }),
  ),
})
export type SourcesLock = z.infer<typeof SourcesLockSchema>

export type SourcesReport = {
  missingEvidence: {
    cardId: string
    rule: string
    url: string
    quote: string
  }[]
  newLines: { url: string; lines: string[] }[]
  removedLines: { url: string; keys: string[] }[]
  unreachable: { url: string; reason: string; cards: string[] }[]
  newPages: string[]
  // Offer text on some loads of a page but not others: an A/B test or a
  // targeted offer. Cards already marked `varies` aren't listed.
  varyingOffers: { cardId: string; url: string; quote: string }[]
}

export function sourceUrls(catalog: Catalog): Map<string, string[]> {
  const pages = new Map<string, string[]>()
  for (const card of catalog.cards) {
    for (const url of card.source_urls) {
      const key = pageKey(url)
      pages.set(key, [...new Set([...(pages.get(key) ?? []), card.id])])
    }
  }
  return pages
}

// Each page is loaded more than once: a line counts as new only if every load
// shows it, and as removed only if no load does, so copy that varies between
// visits (A/B tests, rotating promos) isn't reported.
export function compareSources(
  catalog: Catalog,
  snapshots: Map<string, PageSnapshot>,
  lock: SourcesLock,
  today: string,
): { report: SourcesReport; nextLock: SourcesLock } {
  const report: SourcesReport = {
    missingEvidence: [],
    newLines: [],
    removedLines: [],
    unreachable: [],
    newPages: [],
    varyingOffers: [],
  }
  const nextLock: SourcesLock = { version: 1, pages: {} }

  for (const [url, cards] of sourceUrls(catalog)) {
    const snap = snapshots.get(url)
    if (!snap || !snap.ok) {
      const kept = lock.pages[url]
      if (kept) nextLock.pages[url] = kept
      report.unreachable.push({
        url,
        reason: snap?.ok === false ? snap.reason : 'not fetched',
        cards,
      })
      continue
    }
    const perLoad = snap.loads.map((l) => earningLines(l.innerText))
    const seen = new Set(perLoad.flat().map(lineKey))
    const everyLoad = (perLoad[0] ?? []).filter((line) =>
      perLoad.every((lines) => lines.some((l) => lineKey(l) === lineKey(line))),
    )
    const previous = lock.pages[url]
    if (!previous) {
      report.newPages.push(url)
    } else {
      const before = new Set(previous.lines)
      const added = everyLoad.filter((l) => !before.has(lineKey(l)))
      if (added.length > 0) report.newLines.push({ url, lines: added })
      const removed = previous.lines.filter((k) => !seen.has(k))
      if (removed.length > 0) report.removedLines.push({ url, keys: removed })
    }
    nextLock.pages[url] = { checked: today, lines: [...seen].sort() }
  }

  for (const card of catalog.cards) {
    for (const e of card.evidence) {
      const snap = snapshots.get(pageKey(e.url))
      if (!snap?.ok) continue
      const texts = snap.loads.flatMap((l) => [l.innerText, l.textContent])
      const found = containsQuote(texts, e.quote)
      if (
        found &&
        e.rule === 'welcome_offer' &&
        card.welcome_offer?.varies !== true &&
        !snap.loads.every((l) =>
          containsQuote([l.innerText, l.textContent], e.quote),
        )
      )
        report.varyingOffers.push({
          cardId: card.id,
          url: e.url,
          quote: e.quote,
        })
      if (!found) {
        report.missingEvidence.push({
          cardId: card.id,
          rule: e.rule,
          url: e.url,
          quote: e.quote,
        })
      }
    }
  }
  return { report, nextLock }
}

// Removed lines alone don't count: a rule that loses its backing text is
// already caught by its evidence, and the rest is mostly rotating copy.
export function hasChanges(report: SourcesReport): boolean {
  return (
    report.missingEvidence.length > 0 ||
    report.newLines.length > 0 ||
    report.varyingOffers.length > 0
  )
}

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s

// The earning lines each page had at the last `--update`, kept only on the
// machine that ran it (never committed), so a local report can show the
// wording that disappeared instead of just a count.
export type LineCache = Record<string, string[]>

export function formatReport(
  report: SourcesReport,
  today: string,
  previous: LineCache = {},
): string {
  const out = [`# Card source check, ${today}`, '']
  if (!hasChanges(report) && report.unreachable.length === 0) {
    out.push(
      'Every rule is still backed by its issuer page. No new earning lines.',
    )
  }
  if (report.missingEvidence.length > 0) {
    out.push(
      '## Rules whose backing text is gone',
      '',
      'The rule may have changed. Re-read the page and update the card file.',
      '',
    )
    for (const m of report.missingEvidence) {
      out.push(`- **${m.cardId}** \`${m.rule}\`: "${m.quote}" (${m.url})`)
    }
    out.push('')
  }
  if (report.newLines.length > 0) {
    out.push(
      '## New earning lines',
      '',
      'Could be a new perk, a changed rate, or a promo. Worth a look.',
      '',
    )
    for (const p of report.newLines) {
      out.push(`- ${p.url}`)
      for (const l of p.lines.slice(0, 15)) out.push(`  - ${truncate(l, 220)}`)
      if (p.lines.length > 15)
        out.push(`  - …and ${String(p.lines.length - 15)} more`)
    }
    out.push('')
  }
  if (report.varyingOffers.length > 0) {
    out.push(
      '## Offers that differed between visits',
      '',
      "Some loads of the page showed this offer and some didn't: likely an issuer test or a targeted offer. Record the public one and add `varies: true` to the card's welcome_offer.",
      '',
    )
    for (const v of report.varyingOffers) {
      out.push(`- **${v.cardId}**: "${v.quote}" (${v.url})`)
    }
    out.push('')
  }
  if (report.removedLines.length > 0) {
    out.push('## Earning lines that disappeared', '')
    for (const r of report.removedLines) {
      const gone = (previous[r.url] ?? []).filter((l) =>
        r.keys.includes(lineKey(l)),
      )
      if (gone.length === 0) {
        out.push(`- ${r.url}: ${String(r.keys.length)} line(s)`)
        continue
      }
      out.push(`- ${r.url}`)
      for (const l of gone) out.push(`  - ${truncate(l, 220)}`)
      if (gone.length < r.keys.length)
        out.push(`  - …and ${String(r.keys.length - gone.length)} more`)
    }
    out.push('')
  }
  if (report.unreachable.length > 0) {
    out.push(
      "## Pages that couldn't be checked",
      '',
      'Often bot protection on shared servers. Run `yarn check-sources` on your own machine to check these.',
      '',
    )
    for (const u of report.unreachable) {
      out.push(`- ${u.url} (${u.cards.join(', ')}): ${u.reason}`)
    }
    out.push('')
  }
  if (report.newPages.length > 0) {
    out.push('## Pages checked for the first time', '')
    for (const u of report.newPages) out.push(`- ${u}`)
    out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}
