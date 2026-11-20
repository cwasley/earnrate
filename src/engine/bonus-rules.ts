// Whether each card's sign-up bonus can be earned again, from the repeat
// rule its issuer publishes (`welcome_offer.repeat`), quoted: earnrate.dev's
// /bonus-rules and the iPhone app's Bonus rules. Node-free.
import type { Card } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import { repeatRuleParts } from './repeat-bonus.ts'

export const BONUS_RULES_TITLE = "Can you get a card's sign-up bonus again?"
export const BONUS_RULES_SHORT = 'Bonus rules'
export const BONUS_RULES_COLUMN = 'Can you get it again?'
export const BONUS_RULE_NOT_STATED = 'Not stated'

export const bonusRulesLead = (offered: number, stated: number, once: number) =>
  `Each issuer's terms say who can earn a card's welcome bonus. Of the ${String(offered)} cards here with a public offer, ${String(stated)} have a stated rule, and ${String(once)} of those pay it once per card. Each rule below is quoted from the issuer's own page.`

export const BONUS_RULES_UNPUBLISHED =
  "Issuers can also turn down a bonus for reasons they don't spell out, like how many cards you've opened lately. Rules they don't publish aren't here."

// "Add cards you've had under My wallet, and next-card answers say…", the
// first words a link to them.
export const BONUS_RULES_HAD = {
  link: "Add cards you've had",
  rest: ' under My wallet, and next-card answers say when you can earn each bonus again.',
}

export type BonusRule = {
  card: Card
  label: string // "Once per card", "Not within 24 months", "Not stated"
  detail: string
  quote: string | null // the issuer's words, from the card's evidence
}

// Shortest wait first; once per card last, then cards with no stated rule.
function waitOrder(card: Card): number {
  const r = card.welcome_offer?.repeat
  if (!r) return Infinity
  return r.after_months ?? 1000
}

// Every card with a public offer, by issuer (in name order), each issuer's
// cards by wait and then name.
export function bonusRules(
  catalog: Catalog,
  issuerName: (id: string) => string,
  shortName: (id: string) => string,
): {
  offered: number
  stated: number
  once: number
  groups: { issuer: string; rules: BonusRule[] }[]
} {
  const offered = catalog.cards.filter(
    (c) => c.welcome_offer !== undefined && c.applications_closed === undefined,
  )
  const byIssuer = new Map<string, Card[]>()
  for (const card of offered)
    byIssuer.set(card.issuer, [...(byIssuer.get(card.issuer) ?? []), card])
  const issuers = [...byIssuer.keys()].sort((a, b) =>
    issuerName(a).localeCompare(issuerName(b)),
  )
  return {
    offered: offered.length,
    stated: offered.filter((c) => c.welcome_offer?.repeat).length,
    once: offered.filter(
      (c) =>
        c.welcome_offer?.repeat &&
        c.welcome_offer.repeat.after_months === undefined,
    ).length,
    groups: issuers.map((issuer) => ({
      issuer,
      rules: (byIssuer.get(issuer) ?? [])
        .toSorted(
          (a, b) =>
            waitOrder(a) - waitOrder(b) ||
            shortName(a.id).localeCompare(shortName(b.id)),
        )
        .map((card) => {
          const { label, detail } = repeatRuleParts(catalog, card)
          return {
            card,
            label: label ?? BONUS_RULE_NOT_STATED,
            detail,
            quote:
              card.evidence.find((e) => e.rule === 'repeat')?.quote ?? null,
          }
        }),
    })),
  }
}
