import { Document, parse, visit } from 'yaml'
import { walletProblems } from '../data/integrity.ts'
import type { Catalog } from '../schema/catalog.ts'
import { WALLET_VERSION, WalletSchema, type Wallet } from '../schema/wallet.ts'

// A wallet as the YAML file the CLI reads, for moving it between the
// website, the remote server and the command line. Node-free.

function compact(wallet: Wallet) {
  return {
    version: wallet.version ?? WALLET_VERSION,
    ...(Object.keys(wallet.valuations).length > 0
      ? { valuations: wallet.valuations }
      : {}),
    ...(wallet.memberships.length > 0
      ? { memberships: wallet.memberships }
      : {}),
    cards: wallet.cards.map((c) => ({
      id: c.id,
      ...(c.checkout_label === undefined
        ? {}
        : { checkout_label: c.checkout_label }),
      ...(c.anniversary === undefined ? {} : { anniversary: c.anniversary }),
      ...(Object.keys(c.cap_usage).length > 0
        ? { cap_usage: c.cap_usage }
        : {}),
      ...(c.chosen === undefined ? {} : { chosen: c.chosen }),
      ...(c.activated.length > 0 ? { activated: c.activated } : {}),
      ...(c.bonus === undefined ? {} : { bonus: c.bonus }),
    })),
  }
}

// Dates, periods and anniversaries are quoted: YAML 1.1 parsers read a bare 2026-10-15 as a
// date, not a string.
function quotedYaml(value: unknown): string {
  const doc = new Document(value)
  visit(doc, {
    Scalar(key, node) {
      if (
        key === 'value' &&
        typeof node.value === 'string' &&
        /^(\d{4}(-|$)|\d{2}-\d{2}$)/.test(node.value)
      )
        node.type = 'QUOTE_DOUBLE'
    },
  })
  return doc.toString()
}

export function walletYaml(wallet: Wallet): string {
  return `# Your earnrate wallet: the cards you hold, by id. Never card numbers.\n# For the command line, save it as ~/.earnrate/wallet.yaml\n\n${quotedYaml(compact(wallet))}`
}

export function parseWalletYaml(
  text: string,
  catalog: Catalog,
): Wallet | string {
  let raw: unknown
  try {
    raw = parse(text)
  } catch {
    return "That isn't a wallet: it isn't valid YAML."
  }
  const result = WalletSchema.safeParse(raw)
  if (!result.success) return "That isn't an earnrate wallet."
  const problems = walletProblems(result.data, catalog)
  return problems.length > 0 ? problems.join(' ') : result.data
}
