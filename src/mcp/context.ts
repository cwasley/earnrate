import { walletProblems } from '../data/integrity.ts'
import type { SetupResult } from '../data/store.ts'
import { effectiveMemberships } from '../engine/memberships.ts'
import { EMPTY_WALLET, walletFromCards } from '../engine/transient.ts'
import type { Channel, MerchantResolution } from '../engine/types.ts'
import { capitalize } from '../engine/text.ts'
import { formatNotes } from '../format/cards.ts'
import { resolvePlace, withCallerCategory } from '../merchants/resolve.ts'
import type { Wallet } from '../schema/wallet.ts'
import { defined, type NamedCard } from './inputs.ts'
import type { ServerDeps } from './server.ts'

export const fail = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true,
})

export const ALL_CARDS_NOTE =
  "No cards are saved or named, so this covers every card earnrate knows. That's a complete answer. If the user wants the best of their own cards, they can name them (pass them as `cards`); saving them is optional."

export type Context = ReturnType<typeof makeContext>

// What every tool shares: the saved wallet, merchant resolution, and which
// cards an answer is about.
export function makeContext(deps: ServerDeps) {
  const { catalog } = deps
  const theWallet =
    deps.savedWallets === 'file'
      ? `the wallet at ${deps.store.where}`
      : 'the saved wallet'
  // Which wallet this server keeps, for replies and tool descriptions. The
  // local extension and the hosted connector can both be connected at once,
  // each with its own wallet, and their tools are otherwise identical.
  const walletName =
    deps.savedWallets === 'file'
      ? `the wallet file on this computer (${deps.store.where})`
      : 'your hosted earnrate wallet'
  const walletUse =
    deps.savedWallets === 'file'
      ? "It uses the wallet file on this computer, not the hosted earnrate connector's wallet."
      : "It uses the user's hosted earnrate wallet, not a wallet file on their computer."
  const startHint =
    'Answers cover every card, or the cards the user names. If the user wants their cards remembered, find each with search_cards and save it with add_card.'
  const noCards =
    deps.savedWallets === 'file'
      ? `The wallet at ${deps.store.where} has no cards yet. ${startHint}`
      : `The user's saved wallet has no cards yet. ${startHint}`
  const noWallet =
    deps.savedWallets === 'file'
      ? `There's no saved wallet yet (${deps.store.where}). Answers don't need one: they cover every card, or the cards the user names. If the user wants their cards remembered, find each with search_cards and save it with add_card.`
      : noCards

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
      ? `${capitalize(theWallet)} has problems:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : loaded
  }

  // No saved wallet, or one with no cards, is the normal state, not a
  // failure: it reads as an empty one, with a note on how to add cards.
  async function readableWallet(): Promise<
    { wallet: Wallet; start: string | null } | string
  > {
    const w = await wallet()
    if (typeof w !== 'string')
      return { wallet: w, start: w.cards.length === 0 ? noCards : null }
    return w === noWallet ? { wallet: EMPTY_WALLET, start: w } : w
  }

  // The caller's category is free and comes before the paid Claude fallback;
  // neither ever overrides a merchant earnrate already knows.
  async function resolve(
    merchant: string,
    channel: Channel | null,
    category: string | null,
  ): Promise<{ merchant: MerchantResolution; notices: string[] }> {
    const known = resolvePlace(catalog, merchant, channel)
    const resolved =
      known.source !== 'none' || category !== null || !deps.llm
        ? { merchant: withCallerCategory(known, category), notices: [] }
        : await deps.llm.resolve(catalog, merchant, channel)
    const source = resolved.merchant.source
    if (
      deps.missed &&
      (source === 'none' || source === 'caller' || source === 'llm')
    )
      await deps.missed.note(
        merchant,
        source === 'none' ? null : resolved.merchant.category,
        deps.today(),
      )
    return resolved
  }

  // Cards named in the conversation come first, then the saved wallet; with
  // neither (null), answers cover every card earnrate knows.
  // Saved point values and memberships apply to every answer, not just ones
  // from saved cards. A wallet that can't be read has none.
  async function saved(): Promise<
    Pick<Wallet, 'valuations' | 'memberships' | 'skipped_issuers'>
  > {
    try {
      const wallet = await deps.store.load()
      return {
        valuations: wallet?.valuations ?? {},
        // A saved card's own membership counts: its holder has it.
        memberships: effectiveMemberships(
          catalog,
          wallet?.memberships ?? [],
          wallet?.cards.map((c) => c.id) ?? [],
        ),
        ...(wallet?.skipped_issuers
          ? { skipped_issuers: wallet.skipped_issuers }
          : {}),
      }
    } catch {
      return { valuations: {}, memberships: [] }
    }
  }

  async function cardsFor(
    cards: NamedCard[] | undefined,
    memberships: string[] | undefined,
  ): Promise<Wallet | null | string> {
    if (cards && cards.length > 0) {
      const named = walletFromCards(
        catalog,
        {
          cards: cards.map(({ cardId, ...rest }) => ({
            id: cardId,
            ...defined(rest),
          })),
          memberships: memberships ?? (await saved()).memberships,
        },
        deps.today(),
      )
      if (typeof named === 'string') return named
      const { valuations, skipped_issuers } = await saved()
      return {
        ...named,
        valuations,
        ...(skipped_issuers ? { skipped_issuers } : {}),
      }
    }
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
      output.cardIds.length > 0
        ? `Saved in ${walletName}, which has ${String(output.cardIds.length)} ${output.cardIds.length === 1 ? 'card' : 'cards'}.`
        : `Saved in ${walletName}, which has no cards now; answers cover every card.`,
      ...(notes ? [formatNotes(result.notes)] : []),
    ].join('\n')
    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: output,
    }
  }

  const cardName = (id: string) =>
    catalog.cards.find((c) => c.id === id)?.name ?? id

  // The first line of an answer from the user's own cards: which ones.
  const fromCards = (named: unknown[] | undefined) =>
    named !== undefined && named.length > 0
      ? 'For the cards named in this conversation.\n'
      : `From ${walletName}.\n`

  return {
    walletName,
    fromCards,
    walletUse,
    wallet,
    readableWallet,
    resolve,
    cardsFor,
    saved,
    changed,
    cardName,
  }
}
