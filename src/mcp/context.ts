import { walletProblems } from '../data/integrity.ts'
import type { SetupResult } from '../data/store.ts'
import { EMPTY_WALLET, walletFromCards } from '../engine/transient.ts'
import type { Channel, MerchantResolution } from '../engine/types.ts'
import { formatNotes } from '../format/cards.ts'
import { resolveMerchant, withCallerCategory } from '../merchants/resolve.ts'
import type { Wallet } from '../schema/wallet.ts'
import { defined, type NamedCard } from './inputs.ts'
import type { ServerDeps } from './server.ts'

export const fail = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true,
})

export const ALL_CARDS_NOTE =
  "The user hasn't named their cards, so this covers every card earnrate knows. That's a complete answer. If they want the best of their own cards, they can name them (pass them as `cards`); saving a wallet is optional."

export type Context = ReturnType<typeof makeContext>

// What every tool shares: the saved wallet, merchant resolution, and which
// cards an answer is about.
export function makeContext(deps: ServerDeps) {
  const { catalog } = deps
  const theWallet =
    deps.savedWallets === 'file'
      ? `the wallet at ${deps.store.where}`
      : 'the saved wallet'
  const noWallet = `There's no saved wallet yet${deps.savedWallets === 'file' ? ` (${deps.store.where})` : ''}. Answers don't need one: they cover every card, or the cards the user names. If the user wants their cards remembered, find each with search_cards and save it with add_card.`

  // Read on every call, so edits to the wallet apply without a restart.
  async function wallet(): Promise<Wallet | string> {
    let loaded: Wallet
    try {
      const found = await deps.store.load()
      if (found === null) return noWallet
      loaded = found
    } catch (e) {
      return `Couldn't read ${theWallet}: ${e instanceof Error ? e.message : String(e)}`
    }
    const problems = walletProblems(loaded, catalog)
    return problems.length > 0
      ? `${theWallet[0]?.toUpperCase() ?? ''}${theWallet.slice(1)} has problems:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : loaded
  }

  // No saved wallet is the normal state, not a failure: it reads as an
  // empty one, with a note on how to start one.
  async function readableWallet(): Promise<
    { wallet: Wallet; start: string | null } | string
  > {
    const w = await wallet()
    if (typeof w !== 'string') return { wallet: w, start: null }
    return w === noWallet ? { wallet: EMPTY_WALLET, start: w } : w
  }

  // The caller's category is free and comes before the paid Claude fallback;
  // neither ever overrides a merchant earnrate already knows.
  async function resolve(
    merchant: string,
    channel: Channel | null,
    category: string | null,
  ): Promise<{ merchant: MerchantResolution; notices: string[] }> {
    const known = resolveMerchant(catalog, merchant, channel)
    if (known.source !== 'none' || category !== null || !deps.llm) {
      return { merchant: withCallerCategory(known, category), notices: [] }
    }
    return deps.llm.resolve(catalog, merchant, channel)
  }

  // Cards named in the conversation come first, then the saved wallet; with
  // neither (null), answers cover every card earnrate knows.
  async function cardsFor(
    cards: NamedCard[] | undefined,
    memberships: string[] | undefined,
  ): Promise<Wallet | null | string> {
    if (cards && cards.length > 0)
      return walletFromCards(
        catalog,
        {
          cards: cards.map(({ cardId, ...rest }) => ({
            id: cardId,
            ...defined(rest),
          })),
          ...(memberships ? { memberships } : {}),
        },
        deps.today(),
      )
    const read = await readableWallet()
    if (typeof read === 'string') return read
    return read.start === null ? read.wallet : null
  }

  // A card change reports what that card still needs; other changes don't.
  function changed(
    result: SetupResult,
    message: string,
    { notes = true }: { notes?: boolean } = {},
  ) {
    if (!result.ok) return fail(result.error)
    const output = {
      message,
      created: result.created,
      cardIds: result.wallet.cards.map((c) => c.id),
      memberships: result.wallet.memberships,
      notes: result.notes,
    }
    const text = [
      message,
      `Wallet: ${output.cardIds.join(', ')}.`,
      ...(notes ? [formatNotes(result.notes)] : []),
    ].join('\n')
    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: output,
    }
  }

  const cardName = (id: string) =>
    catalog.cards.find((c) => c.id === id)?.name ?? id

  return { wallet, readableWallet, resolve, cardsFor, changed, cardName }
}
