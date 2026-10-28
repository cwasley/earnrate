import { z } from 'zod'
import type { Catalog } from '../data/load.ts'
import { containsQuote, earningLines, lineKey, pageKey } from './text.ts'

// Each page is loaded more than once: a line counts as new only if every load
// shows it, and as removed only if no load does, so copy that varies between
// visits (A/B tests, rotating promos) isn't reported.
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
  removedLines: { url: string; count: number }[]
  unreachable: { url: string; reason: string; cards: string[] }[]
  newPages: string[]
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
      const removed = previous.lines.filter((k) => !seen.has(k)).length
      if (removed > 0) report.removedLines.push({ url, count: removed })
    }
    nextLock.pages[url] = { checked: today, lines: [...seen].sort() }
  }

  for (const card of catalog.cards) {
    for (const e of card.evidence) {
      const snap = snapshots.get(pageKey(e.url))
      if (!snap?.ok) continue
      const texts = snap.loads.flatMap((l) => [l.innerText, l.textContent])
      if (!containsQuote(texts, e.quote)) {
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
  return report.missingEvidence.length > 0 || report.newLines.length > 0
}

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s

export function formatReport(report: SourcesReport, today: string): string {
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
  if (report.removedLines.length > 0) {
    out.push('## Earning lines that disappeared', '')
    for (const r of report.removedLines) {
      out.push(`- ${r.url}: ${String(r.count)} line(s)`)
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
