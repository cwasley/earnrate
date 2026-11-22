// How a list of cards is narrowed as someone types, the same on the site's
// list pages (/cards/, /bonus-rules) and in the iPhone app's Cards tab: a
// card stays when every typed word is somewhere in its names or its
// issuer's. Node-free.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'

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

// A card's words, lowercased and once each: its names and its issuer's
// ("amex", "bofa").
export function cardSearchWords(
  catalog: Catalog,
  card: Card,
  shortName: (id: string) => string,
): string[] {
  const { spoken, abbreviated } = cardNames(card, shortName)
  const issuer = catalog.issuers.find((i) => i.id === card.issuer)
  return searchWords([
    ...spoken,
    ...abbreviated,
    issuer?.name ?? card.issuer,
    ...(issuer?.search ?? []),
  ])
}

export const searchWords = (words: string[]) => [
  ...new Set(words.map((w) => w.toLowerCase())),
]

// Every word typed, found anywhere in the row's words joined by spaces;
// nothing typed matches everything.
export function matchesTyped(words: string[], typed: string): boolean {
  const text = words.join(' ')
  return typed
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .every((w) => text.includes(w))
}

// How closely one of a card's names fits what was typed, for putting the
// closest first in a narrowed list: the fewest words a name has that no
// typed word starts. "amex gold": Amex Gold 0, Amex Business Gold 1.
export function typedCloseness(names: string[], typed: string): number {
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      .filter((w) => w !== '')
  const asked = words(typed)
  return Math.min(
    ...names.map(
      (name) =>
        words(name).filter((w) => !asked.some((a) => w.startsWith(a))).length,
    ),
  )
}

// The list of every card: earnrate.dev's /cards/ and the app's Cards tab.
export const CARDS_INDEX = {
  title: 'Credit cards earnrate tracks',
  filterLabel: 'Find a card',
  placeholder: 'Sapphire, Amex Gold, Southwest…',
  none: 'No cards match.',
  art: "The card pictures are earnrate's drawings in each card's color, not the issuers' designs.",
}

export const cardsIndexLead = (count: number) =>
  `Every earning rule for ${String(count)} U.S. cards, quoted from the issuer's own terms`

// A card's name in the list: the issuer's own short name when it has one.
export const cardIndexName = (
  card: Card,
  shortName: (id: string) => string,
): string => card.short_name ?? shortName(card.id)
