import { Document, parse, visit } from 'yaml'
import { walletProblems } from '../data/integrity.ts'
import type { Catalog } from '../schema/catalog.ts'
import {
  CARD_NUMBER_LABEL,
  CARD_NUMBER_REDEMPTION,
} from '../schema/card-number.ts'
import {
  WALLET_VERSION,
  WalletCardSchema,
  WalletSchema,
  type Wallet,
  type WalletCard,
} from '../schema/wallet.ts'

// A wallet as the YAML file the CLI reads, for moving it between the
// website, the remote server and the command line. Node-free.

// Every field the schema defines, in its order, so a new wallet field is
// exported without anyone remembering to add it here.
const CARD_FIELDS = Object.keys(WalletCardSchema.shape) as (keyof WalletCard)[]

const isEmpty = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value)
    ? value.length === 0
    : typeof value === 'object' &&
      value !== null &&
      Object.keys(value).length === 0)

function compact(wallet: Wallet) {
  return {
    version: wallet.version ?? WALLET_VERSION,
    ...(Object.keys(wallet.valuations).length > 0
      ? { valuations: wallet.valuations }
      : {}),
    ...(wallet.memberships.length > 0
      ? { memberships: wallet.memberships }
      : {}),
    ...(wallet.skipped_issuers && wallet.skipped_issuers.length > 0
      ? { skipped_issuers: wallet.skipped_issuers }
      : {}),
    cards: wallet.cards.map((c) =>
      Object.fromEntries(
        CARD_FIELDS.flatMap((k) => (isEmpty(c[k]) ? [] : [[k, c[k]]])),
      ),
    ),
  }
}

// Dates, periods and anniversaries are quoted: YAML 1.1 parsers read a bare
// 2026-10-15 as a date, not a string.
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
  if (!result.success)
    return (
      result.error.issues
        .map((i) => i.message)
        .find((m) => m === CARD_NUMBER_LABEL || m === CARD_NUMBER_REDEMPTION) ??
      "That isn't an earnrate wallet."
    )
  const problems = walletProblems(result.data, catalog)
  return problems.length > 0 ? problems.join(' ') : result.data
}
