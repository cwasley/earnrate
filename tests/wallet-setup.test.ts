import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import {
  addCardText,
  removeCardText,
  setMembershipsText,
  updateCardText,
} from '../src/data/wallet-edit.ts'
import {
  addCard,
  removeCard,
  setMemberships,
  updateCard,
  type SetupResult,
} from '../src/data/wallet-setup.ts'
import { searchCards, setupNotes } from '../src/engine/setup.ts'
import { WalletSchema } from '../src/schema/wallet.ts'

const catalog = await loadCatalog()
const TODAY = '2026-10-30'

function errorOf(result: SetupResult): string {
  if (result.ok) throw new Error('expected the change to be refused')
  return result.error
}

const COMMENTED = `# my cards
valuations:
  UR: 1.5 # transfer partners

memberships: [amazon-prime]

cards:
  - id: amex-gold
    checkout_label: Gold # the metal one
    cap_usage:
      dining: { period: "2026", spent: 120 }
  # paid off monthly
  - id: chase-sapphire-preferred
`

async function walletFile(contents?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-setup-'))
  const file = path.join(dir, 'wallet.yaml')
  if (contents !== undefined) await writeFile(file, contents)
  return file
}

describe('text edits keep everything else byte for byte', () => {
  test('adding a card appends it after the last one', () => {
    expect(
      addCardText(COMMENTED, {
        id: 'usbank-cash-plus',
        checkout_label: 'Cash+',
        chosen: {
          period: '2026-Q4',
          picks: { 'five-percent': ['tv-internet-streaming', 'fast-food'] },
        },
      }),
    ).toBe(
      `${COMMENTED}  - id: usbank-cash-plus
    checkout_label: Cash+
    chosen:
      period: 2026-Q4
      picks:
        five-percent: [tv-internet-streaming, fast-food]
`,
    )
  })

  test('adding to a missing file starts a new wallet', () => {
    const text = addCardText(null, { id: 'amex-gold' })
    expect(text).toMatch(/^# /)
    expect(text.endsWith('cards:\n  - id: amex-gold\n')).toBe(true)
  })

  test('follows a wallet indented with dashes at the margin', () => {
    expect(
      addCardText('cards:\n- id: amex-gold\n', { id: 'citi-double-cash' }),
    ).toBe('cards:\n- id: amex-gold\n- id: citi-double-cash\n')
  })

  test('removing a card takes its nested lines with it', () => {
    expect(removeCardText(COMMENTED, 'amex-gold')).toBe(`# my cards
valuations:
  UR: 1.5 # transfer partners

memberships: [amazon-prime]

cards:
  # paid off monthly
  - id: chase-sapphire-preferred
`)
  })

  test('updating replaces a field in place and adds missing ones', () => {
    expect(
      updateCardText(COMMENTED, 'amex-gold', {
        checkout_label: 'Amex Gold',
        anniversary: '03-15',
      }),
    ).toBe(
      COMMENTED.replace(
        'checkout_label: Gold # the metal one\n',
        'checkout_label: Amex Gold\n',
      ).replace(
        '      dining: { period: "2026", spent: 120 }\n',
        '      dining: { period: "2026", spent: 120 }\n    anniversary: 03-15\n',
      ),
    )
  })

  test('updating replaces a whole chosen block', () => {
    const before =
      'cards:\n  - id: usbank-cash-plus\n    chosen:\n      period: 2026-Q3\n      picks:\n        five-percent: [fast-food]\n    checkout_label: Cash+\n'
    expect(
      updateCardText(before, 'usbank-cash-plus', {
        chosen: {
          period: '2026-Q4',
          picks: { 'two-percent': ['gas-ev-charging'] },
        },
      }),
    ).toBe(
      'cards:\n  - id: usbank-cash-plus\n    chosen:\n      period: 2026-Q4\n      picks:\n        two-percent: [gas-ev-charging]\n    checkout_label: Cash+\n',
    )
  })

  test('memberships are replaced, or added above the cards', () => {
    expect(setMembershipsText(COMMENTED, [])).toBe(
      COMMENTED.replace('[amazon-prime]', '[]'),
    )
    expect(
      setMembershipsText('cards:\n  - id: amex-gold\n', ['amazon-prime']),
    ).toBe('memberships: [amazon-prime]\ncards:\n  - id: amex-gold\n')
  })

  test('a card written inline is left for a person to edit', () => {
    expect(() =>
      updateCardText('cards: [{ id: amex-gold }]\n', 'amex-gold', {
        checkout_label: 'Gold',
      }),
    ).toThrow(/by hand/)
  })
})

describe('searchCards', () => {
  const ids = (query: string) =>
    searchCards(catalog, query, null, TODAY).cards.map((c) => c.id)

  test('matches names, ids and issuer nicknames', () => {
    expect(ids('sapphire')).toEqual([
      'chase-sapphire-preferred',
      'chase-sapphire-reserve',
    ])
    expect(ids('amex gold')).toEqual(['amex-gold'])
    expect(ids('bofa customized')).toEqual([
      'bank-of-america-customized-cash-rewards',
    ])
    expect(ids('capital one venture')).toEqual([
      'capital-one-venture',
      'capital-one-venture-x',
    ])
    expect(ids('cash+')).toContain('usbank-cash-plus')
  })

  test('a typo still finds the card, marked as a close match', () => {
    const result = searchCards(catalog, 'saphire prefered', null, TODAY)
    expect(result.cards[0]?.id).toBe('chase-sapphire-preferred')
  })

  test('nothing close says so', () => {
    const result = searchCards(catalog, 'zzzz', null, TODAY)
    expect(result.cards).toEqual([])
  })

  test('says what a card needs set up', () => {
    const [cashPlus] = searchCards(
      catalog,
      'usbank-cash-plus',
      null,
      TODAY,
    ).cards
    expect(cashPlus?.choices.map((c) => [c.id, c.pick])).toEqual([
      ['five-percent', 2],
      ['two-percent', 1],
    ])
    const [prime] = searchCards(catalog, 'prime visa', null, TODAY).cards
    expect(prime?.memberships).toEqual(['amazon-prime'])
  })

  test('marks cards already in the wallet', () => {
    const wallet = WalletSchema.parse({ cards: [{ id: 'amex-gold' }] })
    expect(
      searchCards(catalog, 'amex gold', wallet, TODAY).cards[0]?.held,
    ).toBe(true)
  })
})

describe('setupNotes', () => {
  const notes = (yaml: object, id: string) => {
    const wallet = WalletSchema.parse(yaml)
    const held = wallet.cards.find((c) => c.id === id)
    if (!held) throw new Error(`no ${id}`)
    return setupNotes(catalog, wallet, held, TODAY)
  }

  test('a card with no picks says which to make', () => {
    const [note] = notes(
      { cards: [{ id: 'usbank-cash-plus' }] },
      'usbank-cash-plus',
    )
    expect(note?.kind).toBe('pick')
    expect(note?.text).toMatch(/five-percent.*2 of/)
  })

  test('a missing membership is named', () => {
    const missing = notes(
      { cards: [{ id: 'chase-prime-visa' }] },
      'chase-prime-visa',
    )
    expect(missing.map((n) => n.kind)).toEqual(['membership'])
    expect(missing[0]?.text).toMatch(/amazon-prime/)
    expect(
      notes(
        { memberships: ['amazon-prime'], cards: [{ id: 'chase-prime-visa' }] },
        'chase-prime-visa',
      ),
    ).toEqual([])
  })

  test('rotating categories that need activation are listed', () => {
    const [note] = notes(
      { cards: [{ id: 'chase-freedom-flex' }] },
      'chase-freedom-flex',
    )
    expect(note?.kind).toBe('activation')
    expect(note?.text).toMatch(/q4-2026-grocery/)
  })
})

describe('wallet operations', () => {
  test('the first card creates the wallet file', async () => {
    const file = path.join(await walletFile(), '..', 'new', 'wallet.yaml')
    const result = await addCard(file, catalog, { id: 'amex-gold' }, TODAY)
    expect(result).toMatchObject({ ok: true, created: true })
    expect((await loadWallet(file)).cards.map((c) => c.id)).toEqual([
      'amex-gold',
    ])
  })

  test('adds with picks for the current period and reports what is left', async () => {
    const file = await walletFile(COMMENTED)
    const result = await addCard(
      file,
      catalog,
      {
        id: 'usbank-cash-plus',
        picks: { 'five-percent': ['tv-internet-streaming', 'fast-food'] },
      },
      TODAY,
    )
    if (!result.ok) throw new Error(result.error)
    const held = result.wallet.cards.find((c) => c.id === 'usbank-cash-plus')
    expect(held?.chosen).toEqual({
      period: '2026-Q4',
      picks: { 'five-percent': ['tv-internet-streaming', 'fast-food'] },
    })
    expect(result.notes.map((n) => n.text).join('\n')).toMatch(/two-percent/)
    expect(await readFile(file, 'utf8')).toContain('# paid off monthly')
  })

  test('refuses a card it already has, an unknown card and a bad pick', async () => {
    const file = await walletFile(COMMENTED)
    expect(
      errorOf(await addCard(file, catalog, { id: 'amex-gold' }, TODAY)),
    ).toMatch(/already in the wallet/)
    expect(
      errorOf(
        await addCard(file, catalog, { id: 'chase-saphire-reserve' }, TODAY),
      ),
    ).toMatch(/chase-sapphire-reserve/)
    expect(
      errorOf(
        await addCard(
          file,
          catalog,
          { id: 'usbank-cash-plus', picks: { 'five-percent': ['groceries'] } },
          TODAY,
        ),
      ),
    ).toMatch(/'groceries'.*tv-internet-streaming/s)
    expect(
      errorOf(
        await addCard(
          file,
          catalog,
          { id: 'citi-double-cash', checkoutLabel: 'Citi 4111 1111 1111 1112' },
          TODAY,
        ),
      ),
    ).toMatch(/card number/)
    expect(await readFile(file, 'utf8')).toBe(COMMENTED)
  })

  test('picks for the same period merge; an old period is replaced', async () => {
    const file = await walletFile(
      'cards:\n  - id: usbank-cash-plus\n    chosen:\n      period: 2026-Q4\n      picks:\n        five-percent: [fast-food, movie-theaters]\n',
    )
    const merged = await updateCard(
      file,
      catalog,
      { id: 'usbank-cash-plus', picks: { 'two-percent': ['gas-ev-charging'] } },
      TODAY,
    )
    if (!merged.ok) throw new Error(merged.error)
    expect(merged.wallet.cards[0]?.chosen?.picks).toEqual({
      'five-percent': ['fast-food', 'movie-theaters'],
      'two-percent': ['gas-ev-charging'],
    })

    const nextQuarter = await updateCard(
      file,
      catalog,
      { id: 'usbank-cash-plus', picks: { 'five-percent': ['fast-food'] } },
      '2027-01-05',
    )
    if (!nextQuarter.ok) throw new Error(nextQuarter.error)
    expect(nextQuarter.wallet.cards[0]?.chosen).toEqual({
      period: '2027-Q1',
      picks: { 'five-percent': ['fast-food'] },
    })
  })

  test('activations must be rules that need one', async () => {
    const file = await walletFile('cards:\n  - id: chase-freedom-flex\n')
    const ok = await updateCard(
      file,
      catalog,
      { id: 'chase-freedom-flex', activated: ['q4-2026-grocery'] },
      TODAY,
    )
    expect(ok.ok).toBe(true)
    expect(
      errorOf(
        await updateCard(
          file,
          catalog,
          { id: 'chase-freedom-flex', activated: ['dining'] },
          TODAY,
        ),
      ),
    ).toMatch(/q4-2026-dining/)
  })

  test('removes a card but never the last one', async () => {
    const file = await walletFile(COMMENTED)
    const removed = await removeCard(file, catalog, 'amex-gold')
    if (!removed.ok) throw new Error(removed.error)
    expect(removed.wallet.cards.map((c) => c.id)).toEqual([
      'chase-sapphire-preferred',
    ])
    expect(
      errorOf(await removeCard(file, catalog, 'chase-sapphire-preferred')),
    ).toMatch(/last card/)
  })

  test('memberships must be ones a card rule uses', async () => {
    const file = await walletFile(COMMENTED)
    const set = await setMemberships(file, catalog, [
      'amazon-prime',
      'bofa-rewards-premier',
    ])
    if (!set.ok) throw new Error(set.error)
    expect(set.wallet.memberships).toEqual([
      'amazon-prime',
      'bofa-rewards-premier',
    ])
    expect(errorOf(await setMemberships(file, catalog, ['costco']))).toMatch(
      /'costco'.*amazon-prime/s,
    )
  })

  test('without a wallet, only adding works', async () => {
    const file = path.join(await walletFile(), '..', 'none.yaml')
    expect(errorOf(await removeCard(file, catalog, 'amex-gold'))).toMatch(
      /No wallet/,
    )
  })
})

test('a welcome bonus is written into the file and removed again, keeping comments', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-bonus-'))
  const file = path.join(dir, 'wallet.yaml')
  await writeFile(
    file,
    'cards:\n  - id: amex-gold # my favorite\n  - id: chase-prime-visa\n',
  )
  const set = await updateCard(
    file,
    catalog,
    { id: 'amex-gold', bonus: { opened: '2026-09-15', spent: 1200 } },
    TODAY,
  )
  expect(set.ok).toBe(true)
  const text = await readFile(file, 'utf8')
  expect(text).toContain('# my favorite')
  expect(text).toContain(
    'bonus:\n      opened: 2026-09-15\n      spent: 1200\n',
  )
  const removed = await updateCard(
    file,
    catalog,
    { id: 'amex-gold', bonus: null },
    TODAY,
  )
  expect(removed.ok).toBe(true)
  const after = await readFile(file, 'utf8')
  expect(after).not.toContain('bonus:')
  expect(after).toContain('# my favorite')
})
