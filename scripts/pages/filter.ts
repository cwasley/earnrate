// The search box the list pages share (/best/, /cards/, /bonus-rules): the
// box itself, what each row can be found by, and the one script that
// narrows the list.
import type { Card } from '../../src/schema/card.ts'
import type { Catalog } from '../../src/schema/catalog.ts'
import { esc } from './site.ts'

// The box starts hidden, so with scripts off the page is the full list and
// no box that does nothing.
export const filterBox = (label: string, placeholder: string) =>
  `<div class="filter" hidden>
        <label for="filter">${esc(label)}</label>
        <input id="filter" type="search" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" />
      </div>`

// A row's words for the box, lowercased: the script lowercases the query
// and looks for each of its words in here.
export const searchText = (words: string[]) =>
  esc([...new Set(words.map((w) => w.toLowerCase()))].join(' '))

// The names people search for a card by: its full name and the short name
// earnrate uses (a store card's is its full name), plus the issuer's own
// abbreviation ("NFCU cashRewards") when it's neither.
export function cardNames(card: Card, shortName: (id: string) => string) {
  const name = card.only_at ? card.name : shortName(card.id)
  const spoken = [...new Set([card.name, name])]
  const abbreviated =
    card.short_name !== undefined && !spoken.includes(card.short_name)
      ? [card.short_name]
      : []
  return { name, spoken, abbreviated }
}

// A card's row is found by its names and its issuer's ("amex", "bofa").
export function cardSearchText(
  catalog: Catalog,
  card: Card,
  shortName: (id: string) => string,
): string {
  const { spoken, abbreviated } = cardNames(card, shortName)
  const issuer = catalog.issuers.find((i) => i.id === card.issuer)
  return searchText([
    ...spoken,
    ...abbreviated,
    issuer?.name ?? card.issuer,
    ...(issuer?.search ?? []),
  ])
}

// Shows the rows ([data-q]) holding every word typed and the groups
// ([data-section]) with one. It runs only in the page: nothing typed is sent
// or saved. Closing a category whose name was stuck to the top scrolls back
// to it, so the visitor isn't left far down the page.
export const FILTER_SCRIPT = `(() => {
  const input = document.getElementById('filter')
  const wrap = input.closest('.filter')
  const none = document.getElementById('no-match')
  const ask = none.querySelector('a[data-ask]')
  const list = document.querySelector('[data-filtered]')
  const all = list.parentElement.closest('details')
  const sections = [...list.querySelectorAll('[data-section]')]
  let wasOpen = null
  wrap.hidden = false
  new ResizeObserver(() => {
    list.style.setProperty('--stick', wrap.offsetHeight + 'px')
  }).observe(wrap)
  list.addEventListener('click', (e) => {
    const summary = e.target.closest('summary')
    const details = summary && summary.parentElement
    if (!details || !details.open) return
    if (details.getBoundingClientRect().top >= summary.getBoundingClientRect().top - 1) return
    details.addEventListener('toggle', () => summary.scrollIntoView({ block: 'start' }), { once: true })
  })
  let before = null
  input.addEventListener('input', () => {
    const typed = input.value.trim()
    const q = typed.toLowerCase()
    const words = q.split(/\\s+/).filter((w) => w !== '')
    if (all) {
      if (q !== '' && wasOpen === null) wasOpen = all.open
      if (q !== '') all.open = true
      else if (wasOpen !== null) {
        all.open = wasOpen
        wasOpen = null
      }
    }
    if (q !== '' && before === null) before = sections.filter((s) => s.open)
    let total = 0
    for (const s of sections) {
      let shown = 0
      let stores = 0
      for (const el of s.querySelectorAll('[data-q]')) {
        const hit = words.every((w) => el.dataset.q.includes(w))
        el.hidden = !hit
        if (hit) shown++
        if (hit && el.dataset.store !== undefined) stores++
      }
      s.hidden = shown === 0
      const count = s.querySelector('.cat-count')
      if (count) count.textContent = q === '' ? count.dataset.all : stores + ' of ' + count.dataset.all
      if (s.tagName === 'DETAILS') s.open = q === '' ? before !== null && before.includes(s) : shown > 0
      total += shown
    }
    if (q === '') before = null
    none.hidden = total > 0
    const first = none.hidden ? list : none
    const above = first.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom
    if (above < 0) window.scrollBy({ top: above, behavior: 'instant' })
    if (ask) {
      ask.href = '/#best=' + encodeURIComponent(typed)
      ask.textContent = 'Ask earnrate.dev about \\u201c' + typed + '\\u201d'
    }
  })
})()`

export const filterScript = () => `<script>${FILTER_SCRIPT}</script>`
