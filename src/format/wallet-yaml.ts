import { parse, stringify } from 'yaml'
import type { Catalog } from '../schema/catalog.ts'
import { walletProblems } from '../data/integrity.ts'
import { WalletSchema, type Wallet } from '../schema/wallet.ts'

// A wallet as the YAML file the CLI reads, for moving it between the
// website, the remote server and the command line. Node-free.

function compact(wallet: Wallet) {
  return {
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

export function walletYaml(wallet: Wallet): string {
  return `# Your earnrate wallet: the cards you hold, by id. Never card numbers.\n# For the command line, save it as ~/.earnrate/wallet.yaml\n\n${stringify(compact(wallet))}`
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
