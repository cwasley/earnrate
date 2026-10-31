import {
  addToWallet,
  removeFromWallet,
  updateInWallet,
  withMemberships,
  type CardInput,
  type WalletChange,
} from '../engine/wallet-change.ts'
import type { SetupNote } from '../engine/setup.ts'
import type { Wallet } from '../schema/wallet.ts'
import type { Catalog } from './load.ts'
import {
  addCardText,
  commitWalletText,
  readWalletText,
  removeCardText,
  setMembershipsText,
  updateCardText,
} from './wallet-edit.ts'

export type { CardInput }

export type SetupResult =
  | {
      ok: true
      wallet: Wallet
      created: boolean // the wallet file didn't exist before
      notes: SetupNote[] // what the changed card still needs
    }
  | { ok: false; error: string }

const failed = (error: string) => ({ ok: false as const, error })

async function attempt(task: () => Promise<SetupResult>): Promise<SetupResult> {
  try {
    return await task()
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e))
  }
}

const noWallet = (file: string) =>
  `No wallet at ${file} yet. Add a card first to create it.`

// The change is worked out on the parsed wallet, then spliced into the file
// text, which must re-parse to exactly that wallet before it's written.
async function commit(
  file: string,
  edited: string,
  change: Extract<WalletChange, { ok: true }>,
  created: boolean,
): Promise<SetupResult> {
  await commitWalletText(file, edited, change.wallet)
  return { ok: true, wallet: change.wallet, created, notes: change.notes }
}

export function addCard(
  file: string,
  catalog: Catalog,
  input: CardInput,
  today: string,
): Promise<SetupResult> {
  return attempt(async () => {
    const { text, wallet } = await readWalletText(file)
    const change = addToWallet(catalog, wallet, input, today)
    if (!change.ok) return change
    return commit(
      file,
      addCardText(text, { id: input.id, ...change.fields }),
      change,
      text === null,
    )
  })
}

export function updateCard(
  file: string,
  catalog: Catalog,
  input: CardInput,
  today: string,
): Promise<SetupResult> {
  return attempt(async () => {
    const { text, wallet } = await readWalletText(file)
    if (text === null || wallet === null) return failed(noWallet(file))
    const change = updateInWallet(catalog, wallet, input, today)
    if (!change.ok) return change
    return commit(
      file,
      updateCardText(text, input.id, change.fields),
      change,
      false,
    )
  })
}

export function removeCard(
  file: string,
  _catalog: Catalog,
  id: string,
): Promise<SetupResult> {
  return attempt(async () => {
    const { text, wallet } = await readWalletText(file)
    if (text === null || wallet === null) return failed(noWallet(file))
    const change = removeFromWallet(wallet, id)
    if (!change.ok) return change
    return commit(file, removeCardText(text, id), change, false)
  })
}

export function setMemberships(
  file: string,
  catalog: Catalog,
  memberships: string[],
): Promise<SetupResult> {
  return attempt(async () => {
    const { text, wallet } = await readWalletText(file)
    if (text === null || wallet === null) return failed(noWallet(file))
    const change = withMemberships(catalog, wallet, memberships)
    if (!change.ok) return change
    return commit(
      file,
      setMembershipsText(text, change.wallet.memberships),
      change,
      false,
    )
  })
}
