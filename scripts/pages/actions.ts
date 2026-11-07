// The buttons a card, store or comparison page leads with, chosen in the
// visitor's own browser from the wallet earnrate.dev saved there. The script
// only reads that storage: nothing is sent, and without it (or with no
// saved cards) the first set shows.
import { esc } from './site.ts'

// none: no saved cards; other: cards, not this one; holds: this card.
export type Visitor = 'none' | 'other' | 'holds'

export type ActionSet = { when: Visitor[]; html: string }

export function pageActions(sets: ActionSet[], cardId?: string): string {
  return `<div class="page-actions" data-actions${cardId ? ` data-card="${esc(cardId)}"` : ''}>${sets
    .map(
      (s, i) =>
        `<p class="actions" data-when="${s.when.join(' ')}"${i === 0 ? '' : ' hidden'}>${s.html}</p>`,
    )
    .join('')}</div><script>${ACTIONS_SCRIPT}</script>`
}

// Runs where it sits, before the page paints, so the right buttons show
// from the start. A synced wallet is cached in the same place.
const ACTIONS_SCRIPT = `(() => {
  let held = []
  try {
    const w = JSON.parse(localStorage.getItem('earnrate:wallet'))
    if (w && Array.isArray(w.cards)) held = w.cards.map((c) => c.id)
  } catch {}
  for (const box of document.querySelectorAll('[data-actions]')) {
    const card = box.dataset.card
    const who = held.length === 0 ? 'none' : card && held.includes(card) ? 'holds' : 'other'
    for (const p of box.querySelectorAll('[data-when]'))
      p.hidden = !p.dataset.when.split(' ').includes(who)
  }
})()`

export const button = (href: string, label: string) =>
  `<a class="button" href="${esc(href)}">${esc(label)}</a>`

export const textLink = (href: string, label: string) =>
  `<a href="${esc(href)}">${esc(label)}</a>`
