// /changes and /changes.xml: what issuers changed on their cards, newest
// first, and earnrate's own changes apart from them, all from
// data/changes.yaml. Also a card page's "Recent changes" and the companies
// page's freshness facts.
import {
  changeHeadline,
  datedChanges,
  type DatedChange,
  freshness,
  HOLDER_NEWS_DAYS,
  issuerChanges,
  RECENT_CHANGES_ID,
} from '../../src/engine/changes.ts'
import { addDays } from '../../src/engine/periods.ts'
import {
  currencyName,
  hostname,
  listed,
  longDate,
  shortDate,
} from '../../src/engine/text.ts'
import { findMerchant } from '../../src/merchants/resolve.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import type { Change, ChangeCause, Release } from '../../src/schema/changes.ts'
import type { GeneratedPage, PageContext } from './context.ts'
import { esc, fitDescription, fitTitle, SITE } from './site.ts'

const RECENT_ON_CARD = 3
const RECENT_ON_COMPANIES = 5
const SHOWN_RELEASES = 8
const NAMED = 3 // subjects named before "12 cards"

const CAUSE_LABELS: Record<ChangeCause, string> = {
  issuer: 'Issuer change',
  correction: 'Correction',
  addition: 'Addition',
  wording: 'Wording',
  quote: 'Quote update',
  review: 'Review',
}

const sourceLink = (url: string) =>
  `<a href="${esc(url)}" rel="nofollow noopener">${esc(hostname(url))}</a>`

const cardOf = (d: DatedChange) => d.change.cards?.[0] ?? ''

// "Took effect Nov 4, 2026; seen Nov 5, 2026": only the dates the record has.
function whenText(change: Change): string {
  const parts = [
    change.effective && `took effect ${shortDate(change.effective)}`,
    change.detected && `seen ${shortDate(change.detected)}`,
  ].filter(Boolean)
  return parts.length === 0 ? '' : `; ${parts.join(', ')}`
}

function issuerItem(ctx: PageContext, d: DatedChange): string {
  const id = cardOf(d)
  return `<li>${ctx.art(id)}<div><p class="muted"><time datetime="${d.date}">${esc(shortDate(d.date))}</time>${esc(whenText(d.change))}</p><p><strong>${esc(changeHeadline(ctx.catalog, d.change))}</strong></p><p class="muted"><a href="/cards/${id}">${esc(ctx.shortName(id))}</a> · Source: ${sourceLink(d.change.source ?? '')}</p></div></li>`
}

function names(ctx: PageContext, change: Change): string {
  const { catalog } = ctx
  const some = (ids: string[], many: string, name: (id: string) => string) =>
    ids.length > NAMED ? `${String(ids.length)} ${many}` : listed(ids.map(name))
  if (change.cards)
    return some(change.cards, 'cards', (id) =>
      ctx.cards.has(id)
        ? `<a href="/cards/${id}">${esc(ctx.shortName(id))}</a>`
        : esc(id),
    )
  if (change.merchants)
    return some(change.merchants, 'stores', (id) =>
      esc(findMerchant(catalog, id)?.name ?? id),
    )
  if (change.categories)
    return some(change.categories, 'categories', (id) =>
      esc(catalog.categories.find((c) => c.id === id)?.name ?? id),
    )
  if (change.currencies)
    return some(change.currencies, 'currencies', (id) =>
      esc(currencyName(catalog, id)),
    )
  if (change.memberships)
    return some(change.memberships, 'memberships', (id) =>
      esc(catalog.memberships.find((m) => m.id === id)?.name ?? id),
    )
  return some(change.issuers ?? [], 'issuers', (id) => esc(ctx.issuerName(id)))
}

function ownItem(ctx: PageContext, change: Change): string {
  return `<li><b>${esc(CAUSE_LABELS[change.cause])}</b> · ${names(ctx, change)}: ${esc(change.summary ?? '')}</li>`
}

function releaseGroup(ctx: PageContext, r: Release): string {
  const own = r.changes.filter((c) => c.cause !== 'issuer')
  if (own.length === 0) return ''
  return `<details class="group"><summary><span>${esc(r.version)}</span><span class="group-meta">${esc(shortDate(r.date))} · ${String(own.length)} ${own.length === 1 ? 'change' : 'changes'}</span></summary><ul class="change-notes">${own.map((c) => ownItem(ctx, c)).join('')}</ul></details>`
}

export function changesPage(
  ctx: PageContext,
  releases: Release[],
): GeneratedPage {
  const facts = freshness(ctx.catalog, releases)
  const issuer = issuerChanges(releases)
  const count = `${String(facts.issuerChanges)} ${facts.issuerChanges === 1 ? 'change' : 'changes'}`
  const title = fitTitle([
    'Credit card term changes: rates, fees and offers',
    'Credit card term changes',
  ])
  const description = fitDescription([
    `${count} issuers made to card rates, fees and welcome offers since ${shortDate(facts.since)}, each with the old and new terms and the issuer's page.`,
    `Changes issuers made to card rates, fees and welcome offers, with the old and new terms.`,
  ])
  const groups = releases.map((r) => releaseGroup(ctx, r)).filter(Boolean)
  const rest = groups.slice(SHOWN_RELEASES)
  const body = `
      <h1>Credit card term changes</h1>
      <p class="updated">${esc(count)} by issuers since ${esc(shortDate(facts.since))} · Card data ${esc(facts.latestVersion)}, ${esc(shortDate(facts.latestRelease))}</p>
      <p>When an issuer changes a card's earning rate, fee, welcome offer or statement credit, earnrate records the old and new terms, the date and the issuer page they came from. Every rule's quote is re-checked against the issuer's pages each week. Follow along with the <a href="/changes.xml">RSS feed</a>.</p>
      <h2>Changes issuers made</h2>
      ${issuer.length === 0 ? '<p>None recorded yet.</p>' : `<ul class="compare-list change-list">${issuer.map((d) => issuerItem(ctx, d)).join('')}</ul>`}
      <h2>earnrate's own changes</h2>
      <p>Corrections, new cards and rules, wording, quote updates and reviews. None of these is a change an issuer made, so none of them is listed above.</p>
      <div class="groups">${groups.slice(0, SHOWN_RELEASES).join('')}</div>
      ${rest.length > 0 ? `<details class="more-groups"><summary>${String(rest.length)} earlier releases</summary><div class="groups">${rest.join('')}</div></details>` : ''}
      <p class="muted">Each release is also in the <a href="https://github.com/cwasley/earnrate/blob/main/data/CHANGELOG.md" rel="noopener">data changelog</a>; the structured record is <a href="https://github.com/cwasley/earnrate/blob/main/data/changes.yaml" rel="noopener">data/changes.yaml</a>.</p>`
  const path = '/changes'
  const lastmod = datedChanges(releases)[0]?.date ?? facts.latestRelease
  return {
    file: 'changes.html',
    path,
    lastmod,
    html: ctx.layout({
      title,
      description,
      path,
      body,
      crumbs: [{ name: 'Term changes', path }],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url: `${SITE}${path}`,
        dateModified: lastmod,
      },
    }),
  }
}

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const rfc822 = (date: string) => new Date(`${date}T12:00:00Z`).toUTCString()

// One item per issuer change, newest first.
export function changesFeed(catalog: Catalog, releases: Release[]): string {
  const items = issuerChanges(releases).map((d) => {
    const headline = changeHeadline(catalog, d.change)
    const id = cardOf(d)
    return `    <item>
      <title>${xml(headline)}</title>
      <link>${SITE}/cards/${id}</link>
      <guid isPermaLink="false">earnrate-${xml(`${d.version}-${id}-${d.change.field ?? ''}`)}</guid>
      <pubDate>${rfc822(d.date)}</pubDate>
      <description>${xml(`${headline}. Source: ${d.change.source ?? ''}`)}</description>
    </item>`
  })
  const facts = freshness(catalog, releases)
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>earnrate: credit card term changes</title>
    <link>${SITE}/changes</link>
    <description>Changes issuers made to card rates, fees, welcome offers and credits, with the old and new terms.</description>
    <language>en-us</language>
    <lastBuildDate>${rfc822(facts.latestRelease)}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`
}

export function recentChangesSection(
  ctx: PageContext,
  releases: Release[],
  cardId: string,
): string {
  const recent = issuerChanges(releases)
    .filter((d) => cardOf(d) === cardId)
    .slice(0, RECENT_ON_CARD)
  // Every correction a cardholder's to-do list can count links here.
  const since = addDays(releases[0]?.date ?? '', -HOLDER_NEWS_DAYS)
  const fixes = datedChanges(releases).filter(
    (d) =>
      d.change.cause === 'correction' &&
      d.change.cards?.includes(cardId) === true &&
      d.date >= since,
  )
  if (recent.length === 0 && fixes.length === 0) return ''
  const issuer =
    recent.length === 0
      ? ''
      : `<ul class="change-notes">${recent
          .map(
            (d) =>
              `<li><time datetime="${d.date}">${esc(shortDate(d.date))}</time>: ${esc(changeHeadline(ctx.catalog, d.change))}. Source: ${sourceLink(d.change.source ?? '')}</li>`,
          )
          .join('')}</ul>`
  const own =
    fixes.length === 0
      ? ''
      : `<p>Corrections earnrate made to its own data about this card; ${esc(ctx.issuerName(ctx.catalog.cards.find((c) => c.id === cardId)?.issuer ?? ''))} didn't change anything:</p><ul class="change-notes">${fixes
          .map(
            (d) =>
              `<li><time datetime="${d.date}">${esc(shortDate(d.date))}</time>: ${esc(d.change.summary ?? '')}</li>`,
          )
          .join('')}</ul>`
  return `<h2 id="${RECENT_CHANGES_ID}">Recent changes</h2>${issuer}${own}<p><a href="/changes">Every change issuers made to card terms</a></p>`
}

// The companies page's <!--earnrate:freshness--> and <!--earnrate:recent_changes-->.
export function companyParts(
  catalog: Catalog,
  releases: Release[],
): Record<string, string> {
  const f = freshness(catalog, releases)
  const recent = issuerChanges(releases).slice(0, RECENT_ON_COMPANIES)
  const reviews =
    f.reviewedFrom === f.reviewedTo
      ? `on ${longDate(f.reviewedTo)}`
      : `between ${longDate(f.reviewedFrom)} and ${longDate(f.reviewedTo)}`
  return {
    freshness: esc(
      `${String(f.issuerChanges)} issuer ${f.issuerChanges === 1 ? 'change' : 'changes'} recorded since ${longDate(f.since)}. Latest data release: ${longDate(f.latestRelease)} (${f.latestVersion}). Every card had its last full review ${reviews}, and every rule's quote is re-checked weekly.`,
    ),
    recent_changes: `<ul>${recent
      .map(
        (d) =>
          `<li>${esc(shortDate(d.date))}: ${esc(changeHeadline(catalog, d.change))}. Source: ${sourceLink(d.change.source ?? '')}</li>`,
      )
      .join('')}</ul>`,
  }
}
