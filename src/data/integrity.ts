import type { Card } from '../schema/card.ts'
import type { Merchant } from '../schema/merchant.ts'
import type { Wallet } from '../schema/wallet.ts'
import type { Catalog } from './load.ts'

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
  ] as const) {
    for (const id of duplicates(ids))
      problems.push(`${where}: duplicate ${kind} id '${id}'`)
  }
  const ruleIds = new Set([
    'base_rate',
    ...(card.pools_into ? ['pools_into'] : []),
    ...(card.annual_fee !== undefined ? ['annual_fee'] : []),
    ...(card.first_year_fee !== undefined ? ['first_year_fee'] : []),
    ...(card.welcome_offer ? ['welcome_offer'] : []),
    ...card.rules.map((r) => r.id),
  ])
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

  const { seed, overrides } = catalog.merchants
  problems.push(...merchantProblems('seed', seed, categories))
  problems.push(...merchantProblems('overrides', overrides, categories))

  const merchantIds = new Set([...seed, ...overrides].map((m) => m.id))
  for (const m of [...seed, ...overrides]) {
    for (const via of m.booked_via) {
      if (!merchantIds.has(via))
        problems.push(`merchant ${m.id}: booked_via '${via}' is not a merchant`)
    }
  }
  for (const card of catalog.cards) {
    problems.push(...cardProblems(card, catalog, merchantIds))
  }
  return problems
}

export function walletProblems(wallet: Wallet, catalog: Catalog): string[] {
  const problems: string[] = []
  const cards = new Map(catalog.cards.map((c) => [c.id, c]))
  const currencies = new Map(catalog.currencies.map((c) => [c.id, c]))

  for (const id of duplicates(wallet.cards.map((c) => c.id))) {
    problems.push(`wallet: card '${id}' is listed twice`)
  }
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
