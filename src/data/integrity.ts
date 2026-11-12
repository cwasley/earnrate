import type { Card, Rule } from '../schema/card.ts'
import type { Catalog } from '../schema/catalog.ts'
import {
  findMerchant,
  resolveMerchant,
  resolveMerchantById,
} from '../merchants/resolve.ts'
import type { Merchant } from '../schema/merchant.ts'
import { evaluateCard, purchaseContext } from '../engine/evaluate.ts'
import { idealHolding } from '../engine/explore.ts'
import { NAMED_LISTS, namedKey } from '../engine/named.ts'
import { isAnniversary } from '../engine/periods.ts'
import { MONTH_NAMES } from '../engine/text.ts'
import { WALLET_VERSION, type Wallet } from '../schema/wallet.ts'

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id)
    seen.add(id)
  }
  return [...dupes]
}

const normalizeName = (s: string) => s.trim().toLowerCase()

function merchantProblems(
  file: string,
  merchants: Merchant[],
  categories: Set<string>,
): string[] {
  const problems: string[] = []
  for (const id of duplicates(merchants.map((m) => m.id))) {
    problems.push(`${file}: duplicate merchant id '${id}'`)
  }
  const owner = new Map<string, string>()
  for (const m of merchants) {
    const cats = [
      m.category,
      m.in_store?.category,
      m.online?.category,
      ...(m.ambiguity?.may_code_as ?? []),
    ]
    for (const c of cats) {
      if (c !== undefined && !categories.has(c)) {
        problems.push(`${file} ${m.id}: unknown category '${c}'`)
      }
    }
    for (const name of [m.name, ...m.aliases, ...m.domains].map(
      normalizeName,
    )) {
      const other = owner.get(name)
      if (other !== undefined && other !== m.id) {
        problems.push(`${file}: '${name}' names both ${other} and ${m.id}`)
      }
      owner.set(name, m.id)
    }
  }
  return problems
}

// Overrides are searched before seed, and a known name followed by more words
// still matches it, so a name can be taken by another merchant without ever
// being listed twice.
function lookupProblems(catalog: Catalog): string[] {
  const problems: string[] = []
  const { seed, overrides } = catalog.merchants
  for (const m of [...overrides, ...seed]) {
    for (const key of [m.name, ...m.aliases, ...m.domains]) {
      const found = resolveMerchant(catalog, key, null).merchantId
      if (found !== m.id)
        problems.push(
          `merchant ${m.id}: '${key}' resolves to ${found ?? 'no merchant'}`,
        )
    }
  }
  for (const c of catalog.categories)
    for (const word of new Set([
      c.name,
      ...c.aliases,
      c.id.replace(/[._]/g, ' '),
    ])) {
      const found = resolveMerchant(catalog, word, null).merchantId
      if (found !== null)
        problems.push(`category ${c.id}: '${word}' resolves to ${found}`)
    }
  return problems
}

// Issuers spell names their own way ("BJ's Club", "7Eleven"), so a quote
// names a store when any of its names appears, letters and digits only.
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]/g, '')

const quoteNames = (quote: string, merchant: Merchant) =>
  [merchant.name, ...merchant.aliases].some((n) =>
    compact(quote).includes(compact(n)),
  )

// Whether the engine pays a rule at a store, with the card set up at its
// best: every option picked, activated, any membership or payment it asks.
function rulePaysAt(
  catalog: Catalog,
  card: Card,
  rule: Rule,
  merchantId: string,
): boolean {
  const date = rule.valid_from ?? rule.valid_to ?? '2026-01-01'
  const choice = card.choices.find((c) => c.id === rule.match.choice)
  const only = { ...card, rules: [rule] }
  const held = idealHolding(
    only,
    date,
    choice ? { [choice.id]: Object.keys(choice.options) } : {},
  )
  const wallet = {
    valuations: {},
    memberships: rule.requires?.membership ? [rule.requires.membership] : [],
    cards: [held],
  }
  return (['in_store', 'online'] as const).some((channel) => {
    const m = resolveMerchantById(catalog, merchantId, channel)
    if (!m) return false
    const p = purchaseContext(catalog, wallet, m, m.category, {
      amount: rule.min_amount ?? null,
      date,
      country: rule.geography === 'foreign_only' ? 'ZZ' : 'US',
      payment: rule.requires?.payment ?? null,
    })
    return evaluateCard(only, held, p).best.rule?.id === rule.id
  })
}

function cardProblems(
  card: Card,
  catalog: Catalog,
  merchantIds: Set<string>,
): string[] {
  const where = `card ${card.id}`
  const problems: string[] = []
  const categories = new Set(catalog.categories.map((c) => c.id))
  const currencies = new Set(catalog.currencies.map((c) => c.id))
  const cardIds = new Set(catalog.cards.map((c) => c.id))
  const capIds = new Set(card.caps.map((c) => c.id))
  const choiceIds = new Set(card.choices.map((c) => c.id))

  const checkCategory = (c: string, context: string) => {
    if (!categories.has(c))
      problems.push(`${where} ${context}: unknown category '${c}'`)
  }
  const checkMerchant = (m: string, context: string) => {
    if (!merchantIds.has(m))
      problems.push(`${where} ${context}: unknown merchant '${m}'`)
  }

  if (!currencies.has(card.currency)) {
    problems.push(`${where}: unknown currency '${card.currency}'`)
  }
  for (const id of card.welcome_offer?.not_with ?? [])
    if (!cardIds.has(id))
      problems.push(`${where} welcome_offer.not_with: unknown card '${id}'`)
  const memberships = new Set(catalog.memberships.map((m) => m.id))
  for (const id of [
    ...(card.requires_membership === undefined
      ? []
      : [card.requires_membership]),
    ...card.rules.flatMap((r) => r.requires?.membership ?? []),
  ])
    if (!memberships.has(id))
      problems.push(
        `${where}: unknown membership '${id}' (data/memberships.yaml)`,
      )
  if (
    card.requires_membership !== undefined &&
    catalog.memberships.find((m) => m.id === card.requires_membership)
      ?.annual_fee === undefined
  )
    problems.push(
      `${where}: requires_membership '${card.requires_membership}' has no annual_fee`,
    )
  if (card.pools_into) {
    if (!currencies.has(card.pools_into.currency)) {
      problems.push(
        `${where} pools_into: unknown currency '${card.pools_into.currency}'`,
      )
    }
    for (const id of card.pools_into.when_wallet_has) {
      if (!cardIds.has(id))
        problems.push(`${where} pools_into: unknown card '${id}'`)
    }
  }
  for (const [kind, ids] of [
    ['rule', card.rules.map((r) => r.id)],
    ['cap', card.caps.map((c) => c.id)],
    ['choice', card.choices.map((c) => c.id)],
    ['milestone', card.milestones.map((m) => m.id)],
    ['intro rate', card.intro_rates.map((i) => i.id)],
    ['credit', card.credits.map((c) => c.id)],
  ] as const) {
    for (const id of duplicates(ids))
      problems.push(`${where}: duplicate ${kind} id '${id}'`)
  }
  // Evidence names rules and milestones alike, so their ids can't overlap.
  for (const m of card.milestones)
    if (card.rules.some((r) => r.id === m.id))
      problems.push(`${where}: milestone '${m.id}' has a rule's id`)
  for (const intro of card.intro_rates) {
    if (
      card.rules.some((r) => r.id === intro.id) ||
      card.milestones.some((m) => m.id === intro.id)
    )
      problems.push(`${where}: intro rate '${intro.id}' has a rule's id`)
    for (const id of intro.rules ?? [])
      if (!card.rules.some((r) => r.id === id))
        problems.push(`${where} intro rate ${intro.id}: unknown rule '${id}'`)
  }
  for (const credit of card.credits) {
    if (
      card.rules.some((r) => r.id === credit.id) ||
      card.milestones.some((m) => m.id === credit.id) ||
      card.intro_rates.some((i) => i.id === credit.id)
    )
      problems.push(`${where}: credit '${credit.id}' has a rule's id`)
    for (const c of credit.match.categories ?? [])
      checkCategory(c, `credit ${credit.id}`)
    for (const m of credit.match.merchants ?? [])
      checkMerchant(m, `credit ${credit.id}`)
    // A month that pays differently is the issuer's word too: a quote names
    // the month and its amount, or the extra on top of the usual one.
    for (const [month, amount] of Object.entries(credit.month_amounts ?? {})) {
      const name = MONTH_NAMES[Number(month) - 1] ?? month
      if (credit.period !== 'month')
        problems.push(
          `${where} ${credit.id}: month_amounts on a ${credit.period} credit`,
        )
      if (amount === credit.amount)
        problems.push(
          `${where} ${credit.id}: ${name}'s amount is its usual one`,
        )
      const said = [amount, amount - credit.amount].map((n) => `$${String(n)}`)
      if (
        !card.evidence.some(
          (e) =>
            e.rule === credit.id &&
            e.quote.includes(name) &&
            said.some((d) => new RegExp(`\\${d}(\\D|$)`).test(e.quote)),
        )
      )
        problems.push(
          `${where} ${credit.id}: no evidence quote states ${name}'s amount`,
        )
    }
  }
  if (
    card.foreign_transaction_fee === null &&
    !card.todo.some((t) => /foreign transaction fee/i.test(t))
  )
    problems.push(
      `${where}: foreign_transaction_fee is null without a todo saying why`,
    )
  const ruleIds = new Set([
    'base_rate',
    ...(card.foreign_transaction_fee !== null
      ? ['foreign_transaction_fee']
      : []),
    ...(card.pools_into ? ['pools_into'] : []),
    ...(card.annual_fee !== undefined ? ['annual_fee'] : []),
    ...(card.first_year_fee !== undefined ? ['first_year_fee'] : []),
    ...(card.welcome_offer ? ['welcome_offer'] : []),
    ...(card.welcome_offer?.not_with ? ['not_with'] : []),
    ...(card.requires_membership ? ['requires_membership'] : []),
    ...card.rules.map((r) => r.id),
    ...card.milestones.map((m) => m.id),
    ...card.intro_rates.map((i) => i.id),
    ...card.credits.map((c) => c.id),
    ...card.free_nights.map((n) => n.id),
    ...card.rules.flatMap((r) =>
      NAMED_LISTS.filter((list) => r.named?.[list]).map((list) =>
        namedKey(r.id, list),
      ),
    ),
  ])
  // A free night is valued at its cap, so a quote has to state it ("50,000
  // points", "up to 85K points"). One with no cap still needs its own quote.
  for (const night of card.free_nights) {
    if (night.points === undefined) continue
    const caps = [
      night.points.toLocaleString('en-US'),
      `${String(night.points / 1000)}k`,
    ]
    if (
      !card.evidence.some(
        (e) =>
          e.rule === night.id &&
          caps.some((c) => e.quote.toLowerCase().includes(c)),
      )
    )
      problems.push(`${where} ${night.id}: no evidence quote states its cap`)
  }
  // An end or start date has to come from the issuer, so a quote names its
  // year ("through 12/31/2027", "Starting in 2027").
  for (const [id, date] of [
    ...card.credits.map((c) => [c.id, c.valid_to] as const),
    ...card.milestones.map((m) => [m.id, m.valid_from] as const),
    ...card.rules.map((r) => [r.id, r.activate_from] as const),
  ]) {
    if (date === undefined) continue
    const year = date.slice(0, 4)
    const named = new RegExp(
      `(^|\\D)(${year}|\\d{1,2}/\\d{1,2}/${year.slice(2)})(\\D|$)`,
    )
    if (!card.evidence.some((e) => e.rule === id && named.test(e.quote)))
      problems.push(`${where} ${id}: no evidence quote names its date's year`)
  }
  const sourcePages = new Set(card.source_urls.map((u) => u.split('#')[0]))
  const backed = new Set(card.evidence.map((e) => e.rule))
  for (const e of card.evidence) {
    if (!ruleIds.has(e.rule))
      problems.push(`${where} evidence: unknown rule '${e.rule}'`)
    if (!sourcePages.has(e.url.split('#')[0]))
      problems.push(
        `${where} evidence for ${e.rule}: ${e.url} isn't in source_urls`,
      )
    const words = e.quote.trim().split(/\s+/).length
    if (words < 3 || words > 20)
      problems.push(
        `${where} evidence for ${e.rule}: quote should be 3-20 words, not ${String(words)}`,
      )
  }
  for (const id of ruleIds) {
    if (!backed.has(id)) problems.push(`${where}: no evidence for ${id}`)
  }
  for (const choice of card.choices) {
    const options = Object.entries(choice.options)
    if (choice.pick > options.length) {
      problems.push(
        `${where} choice ${choice.id}: pick ${String(choice.pick)} but only ${String(options.length)} options`,
      )
    }
    for (const d of choice.default ?? []) {
      if (!(d in choice.options))
        problems.push(
          `${where} choice ${choice.id}: default '${d}' is not an option`,
        )
    }
    for (const [option, covered] of options) {
      for (const c of [
        ...covered.categories,
        ...(covered.online?.exclude ?? []),
      ])
        checkCategory(c, `choice ${choice.id}.${option}`)
      for (const m of covered.merchants)
        checkMerchant(m, `choice ${choice.id}.${option}`)
    }
  }
  for (const rule of card.rules) {
    const context = `rule ${rule.id}`
    for (const c of [
      ...(rule.match.categories ?? []),
      ...(rule.exclude?.categories ?? []),
    ]) {
      checkCategory(c, context)
    }
    for (const m of [
      ...(rule.match.merchants ?? []),
      ...(rule.exclude?.merchants ?? []),
    ]) {
      checkMerchant(m, context)
    }
    if (rule.match.choice !== undefined && !choiceIds.has(rule.match.choice)) {
      problems.push(
        `${where} ${context}: unknown choice '${rule.match.choice}'`,
      )
    }
    if (typeof rule.cap === 'string' && !capIds.has(rule.cap)) {
      problems.push(`${where} ${context}: unknown cap '${rule.cap}'`)
    }
    for (const list of NAMED_LISTS)
      for (const id of rule.named?.[list] ?? []) {
        const merchant = findMerchant(catalog, id)
        if (!merchant) {
          checkMerchant(id, `${context} named.${list}`)
          continue
        }
        const key = namedKey(rule.id, list)
        const quotes = card.evidence.filter((e) => e.rule === key)
        if (
          quotes.length > 0 &&
          !quotes.some((e) => quoteNames(e.quote, merchant))
        )
          problems.push(
            `${where} ${context}: no ${key} quote names ${merchant.name}`,
          )
        if (rulePaysAt(catalog, card, rule, id) !== (list === 'earning'))
          problems.push(
            `${where} ${context}: the issuer names ${merchant.name} as ${list === 'earning' ? 'earning' : 'not earning'} it, but earnrate's data ${list === 'earning' ? "doesn't pay it there" : 'pays it there'}`,
          )
      }
  }
  for (const cap of card.caps.filter((c) => c.rotating)) {
    const rules = card.rules.filter((r) => r.cap === cap.id)
    if (rules.length === 0) {
      problems.push(`${where} cap ${cap.id}: rotating, but no rule uses it`)
    }
    for (const r of rules) {
      if (r.valid_from === undefined || r.valid_to === undefined) {
        problems.push(
          `${where} rule ${r.id}: rules on rotating cap '${cap.id}' need valid_from and valid_to`,
        )
      }
    }
    if (cap.period === 'cardmember_year') {
      problems.push(
        `${where} cap ${cap.id}: a rotating cap can't use cardmember years`,
      )
    }
  }
  return problems
}

export function catalogProblems(catalog: Catalog): string[] {
  const problems: string[] = []
  const categories = new Set(catalog.categories.map((c) => c.id))

  for (const [kind, ids] of [
    ['category', catalog.categories.map((c) => c.id)],
    ['currency', catalog.currencies.map((c) => c.id)],
    ['card', catalog.cards.map((c) => c.id)],
    ['membership', catalog.memberships.map((m) => m.id)],
    ['issuer', catalog.issuers.map((i) => i.id)],
  ] as const) {
    for (const id of duplicates(ids))
      problems.push(`duplicate ${kind} id '${id}'`)
  }
  for (const { id } of catalog.categories) {
    const dot = id.lastIndexOf('.')
    if (dot !== -1 && !categories.has(id.slice(0, dot))) {
      problems.push(`category ${id}: parent '${id.slice(0, dot)}' is missing`)
    }
  }
  const cardIds = new Set(catalog.cards.map((c) => c.id))
  for (const { id, cards = [] } of catalog.categories)
    for (const card of cards)
      if (!cardIds.has(card))
        problems.push(`category ${id}: card '${card}' is not in the catalog`)
  for (const { id, page } of catalog.categories) {
    if (page === undefined) continue
    const target = catalog.categories.find((c) => c.id === page)
    if (!target || page === id)
      problems.push(`category ${id}: page '${page}' is not another category`)
    else if (target.page !== undefined)
      problems.push(
        `category ${id}: page '${page}' has no page of its own either`,
      )
  }

  const { seed, overrides } = catalog.merchants
  problems.push(...merchantProblems('seed', seed, categories))
  problems.push(...merchantProblems('overrides', overrides, categories))

  problems.push(...lookupProblems(catalog))

  const merchantIds = new Set([...seed, ...overrides].map((m) => m.id))
  for (const m of [...seed, ...overrides]) {
    for (const via of m.booked_via) {
      if (!merchantIds.has(via))
        problems.push(`merchant ${m.id}: booked_via '${via}' is not a merchant`)
    }
  }
  const all = new Map([...seed, ...overrides].map((m) => [m.id, m]))
  for (const m of all.values()) {
    if (m.brand_of === undefined) continue
    const parent = all.get(m.brand_of)
    if (!parent)
      problems.push(
        `merchant ${m.id}: brand_of '${m.brand_of}' is not a merchant`,
      )
    else if (parent.brand_of !== undefined)
      problems.push(
        `merchant ${m.id}: brand_of '${m.brand_of}' is itself a brand of '${parent.brand_of}'`,
      )
  }
  for (const m of catalog.memberships)
    for (const id of m.members_shop_at)
      if (!merchantIds.has(id))
        problems.push(
          `membership ${m.id}: members_shop_at '${id}' is not a merchant`,
        )
  const issuers = new Set(catalog.issuers.map((i) => i.id))
  for (const card of catalog.cards) {
    problems.push(...cardProblems(card, catalog, merchantIds))
    if (!issuers.has(card.issuer))
      problems.push(
        `${card.id}: unknown issuer '${card.issuer}' (data/issuers.yaml)`,
      )
  }
  return problems
}

export function walletProblems(wallet: Wallet, catalog: Catalog): string[] {
  const problems: string[] = []
  const cards = new Map(catalog.cards.map((c) => [c.id, c]))
  const currencies = new Map(catalog.currencies.map((c) => [c.id, c]))

  if ((wallet.version ?? 1) > WALLET_VERSION)
    problems.push(
      `wallet: saved by a newer earnrate (format ${String(wallet.version)}); update earnrate to read it`,
    )

  for (const id of duplicates(wallet.cards.map((c) => c.id))) {
    problems.push(`wallet: card '${id}' is listed twice`)
  }
  const issuers = new Set(catalog.cards.map((c) => c.issuer))
  for (const id of wallet.skipped_issuers ?? [])
    if (!issuers.has(id))
      problems.push(`wallet skipped_issuers: no card is from '${id}'`)
  for (const [id, valuation] of Object.entries(wallet.valuations)) {
    const currency = currencies.get(id)
    if (!currency) {
      problems.push(`wallet valuations: unknown currency '${id}'`)
      continue
    }
    if (typeof valuation === 'object' && valuation.redemption !== undefined) {
      if (currency.redemptions?.[valuation.redemption] === undefined) {
        problems.push(
          `wallet valuations ${id}: unknown redemption '${valuation.redemption}'`,
        )
      }
    }
  }

  for (const held of wallet.cards) {
    const where = `wallet card ${held.id}`
    if (held.anniversary !== undefined && !isAnniversary(held.anniversary))
      problems.push(`${where}: anniversary '${held.anniversary}' isn't a date`)
    const card = cards.get(held.id)
    if (!card) {
      problems.push(`${where}: not in the card catalog`)
      continue
    }
    const capKeys = new Set([
      ...card.caps.map((c) => c.id),
      ...card.rules.filter((r) => typeof r.cap === 'object').map((r) => r.id),
    ])
    for (const key of Object.keys(held.cap_usage)) {
      if (!capKeys.has(key))
        problems.push(`${where} cap_usage: '${key}' is not a cap on this card`)
    }
    const milestoneIds = new Set(card.milestones.map((m) => m.id))
    for (const key of Object.keys(held.milestone_usage ?? {})) {
      if (!milestoneIds.has(key))
        problems.push(
          `${where} milestone_usage: '${key}' is not a spend milestone on this card`,
        )
    }
    for (const key of Object.keys(held.night_values ?? {})) {
      if (!card.free_nights.some((n) => n.id === key))
        problems.push(
          `${where} night_values: '${key}' is not a free night on this card`,
        )
    }
    if (held.chosen) {
      for (const [choiceId, picks] of Object.entries(held.chosen.picks)) {
        const choice = card.choices.find((c) => c.id === choiceId)
        if (!choice) {
          problems.push(`${where} chosen: card has no choice '${choiceId}'`)
          continue
        }
        if (picks.length > choice.pick) {
          problems.push(
            `${where} chosen ${choiceId}: picked ${String(picks.length)}, card allows ${String(choice.pick)}`,
          )
        }
        for (const p of picks) {
          if (!(p in choice.options)) {
            problems.push(
              `${where} chosen ${choiceId}: '${p}' is not an option`,
            )
          }
        }
      }
    }
    for (const ruleId of held.activated) {
      const rule = card.rules.find((r) => r.id === ruleId)
      if (!rule?.requires?.activation) {
        problems.push(
          `${where} activated: '${ruleId}' is not a rule that needs activation`,
        )
      }
    }
  }
  return problems
}
