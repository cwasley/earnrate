import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { changeProblems, matches } from '../src/data/change-integrity.ts'
import { loadCatalog, loadChanges } from '../src/data/load.ts'
import {
  changeHeadline,
  fieldValue,
  freshness,
  issuerChanges,
} from '../src/engine/changes.ts'
import {
  ChangeSchema,
  ChangesFileSchema,
  type Release,
} from '../src/schema/changes.ts'
import { ROOT } from './helpers.ts'

const read = (file: string) => readFile(path.join(ROOT, 'data', file), 'utf8')
const [catalog, releases] = await Promise.all([loadCatalog(), loadChanges()])

test('the change record matches the data, the changelog and data/VERSION', async () => {
  const [changelog, version] = await Promise.all([
    read('CHANGELOG.md'),
    read('VERSION'),
  ])
  expect(changeProblems(releases, catalog, changelog, version.trim())).toEqual(
    [],
  )
})

describe('change schema', () => {
  const issuer = {
    cause: 'issuer',
    card: 'chase-prime-visa',
    field: 'welcome_offer',
    was: { dollars: 150, spend: 0, months: 1 },
    now: { dollars: 200, spend: 0, months: 1 },
    source:
      'https://creditcards.chase.com/cash-back-credit-cards/amazon-prime-rewards',
  }

  test('causes come from a fixed list', () => {
    expect(ChangeSchema.safeParse({ ...issuer, cause: 'oops' }).success).toBe(
      false,
    )
  })

  test('an issuer change needs a source, a field and both values', () => {
    expect(ChangeSchema.safeParse(issuer).success).toBe(true)
    for (const key of ['source', 'field', 'was', 'now']) {
      const { [key as keyof typeof issuer]: _, ...rest } = issuer
      expect(ChangeSchema.safeParse(rest).success).toBe(false)
    }
  })

  test("earnrate's own changes need a summary and no detected date", () => {
    const own = { cause: 'wording', cards: ['amex-gold'], summary: 'Notes.' }
    expect(ChangeSchema.safeParse(own).success).toBe(true)
    expect(ChangeSchema.safeParse({ ...own, summary: undefined }).success).toBe(
      false,
    )
    expect(
      ChangeSchema.safeParse({ ...own, detected: '2026-11-07' }).success,
    ).toBe(false)
  })

  test('a change names one kind of subject', () => {
    expect(
      ChangeSchema.safeParse({
        cause: 'addition',
        cards: ['amex-gold'],
        merchants: ['amazon'],
        summary: 'Both.',
      }).success,
    ).toBe(false)
  })

  test("a release's date is its version's", () => {
    const release = (version: string) =>
      ChangesFileSchema.safeParse([
        { version, date: '2026-11-07', changes: [issuer] },
      ]).success
    expect(release('2026.11.07.2')).toBe(true)
    expect(release('2026.11.06')).toBe(false)
  })
})

describe('change integrity', () => {
  const release = (changes: unknown[]): Release[] =>
    ChangesFileSchema.parse([
      { version: '2026.11.07', date: '2026-11-07', changes },
    ])

  test('flags unknown cards and fields, and values that drifted', () => {
    const problems = changeProblems(
      release([
        { cause: 'addition', card: 'no-such-card', summary: 'New.' },
        {
          cause: 'correction',
          card: 'amex-gold',
          field: 'rules.no-such-rule',
          summary: 'Fixed.',
        },
        {
          cause: 'correction',
          card: 'amex-gold',
          field: 'annual_fee',
          now: 1,
          summary: 'Fixed.',
        },
      ]),
      catalog,
      '## 2026.11.07\n',
      '2026.11.07',
    )
    expect(problems).toEqual([
      "2026.11.07 no-such-card: no cards 'no-such-card' in the data",
      '2026.11.07 amex-gold rules.no-such-rule: no such field',
      "2026.11.07 amex-gold annual_fee: 'now' doesn't match the data",
    ])
  })

  test('a removed field may be named by older changes', () => {
    const releases = ChangesFileSchema.parse([
      {
        version: '2026.11.07',
        date: '2026-11-07',
        changes: [
          {
            cause: 'correction',
            card: 'amex-gold',
            field: 'rules.gone',
            now: null,
            summary: 'Removed.',
          },
        ],
      },
      {
        version: '2026.11.06',
        date: '2026-11-06',
        changes: [
          {
            cause: 'addition',
            card: 'amex-gold',
            field: 'rules.gone',
            summary: 'Added.',
          },
        ],
      },
    ])
    expect(
      changeProblems(
        releases,
        catalog,
        '## 2026.11.07\n## 2026.11.06\n',
        '2026.11.07',
      ),
    ).toEqual([])
  })

  test('releases follow the changelog', () => {
    const releases = release([
      { cause: 'wording', card: 'amex-gold', summary: 'Notes.' },
    ])
    expect(
      changeProblems(releases, catalog, '## 2026.11.08\n', '2026.11.08'),
    ).toEqual([
      'data/changes.yaml releases must match data/CHANGELOG.md sections, newest first',
      'data/changes.yaml must start with 2026.11.08',
    ])
  })

  test("'was' must be what the previous change left", () => {
    const card = catalog.cards.find((c) => c.id === 'chase-prime-visa')
    const { note: _, ...offer } = card?.welcome_offer ?? {
      spend: 0,
      months: 1,
    }
    const step = (version: string, was: number, now: number) => ({
      version,
      date: version.replaceAll('.', '-'),
      changes: [
        {
          cause: 'issuer',
          card: 'chase-prime-visa',
          field: 'welcome_offer',
          was: { ...offer, dollars: was },
          now: { ...offer, dollars: now },
          source: 'https://creditcards.chase.com/',
        },
      ],
    })
    const releases = ChangesFileSchema.parse([
      step('2026.11.07', 175, offer.dollars ?? 0),
      step('2026.11.06', 150, 160),
    ])
    expect(
      changeProblems(
        releases,
        catalog,
        '## 2026.11.07\n## 2026.11.06\n',
        '2026.11.07',
      ),
    ).toEqual([
      "2026.11.07 chase-prime-visa welcome_offer: 'was' doesn't match the previous change's 'now'",
    ])
  })
})

test('values match by the keys the record gives', () => {
  expect(matches({ rate: 2 }, { rate: 2, note: 'x' })).toBe(true)
  expect(matches({ rate: 2 }, { rate: 3 })).toBe(false)
  expect(matches(null, undefined)).toBe(true)
  expect(matches([1, 2], [1, 2, 3])).toBe(false)
})

test('field paths find list items by id', () => {
  const card = { rules: [{ id: 'dining', rate: 3 }], annual_fee: 95 }
  expect(fieldValue(card, 'rules.dining.rate')).toBe(3)
  expect(fieldValue(card, 'annual_fee')).toBe(95)
  expect(fieldValue(card, 'rules.travel')).toBeUndefined()
})

describe('headlines', () => {
  test('an issuer change reads as one line from its values', () => {
    const prime = issuerChanges(releases).find(
      (d) => d.change.cards?.[0] === 'chase-prime-visa',
    )
    expect(prime && changeHeadline(catalog, prime.change)).toBe(
      "Prime Visa's welcome offer: $150 → $200 with no spending required",
    )
  })

  test('fees and rates', () => {
    const line = (field: string, was: unknown, now: unknown) =>
      changeHeadline(
        catalog,
        ChangeSchema.parse({
          cause: 'issuer',
          card: 'amex-gold',
          field,
          was,
          now,
          source: 'https://www.americanexpress.com/',
        }),
      )
    expect(line('annual_fee', 250, 325)).toBe(
      "Amex Gold's annual fee: $250 → $325",
    )
    expect(line('foreign_transaction_fee', 2.7, 0)).toBe(
      "Amex Gold's foreign transaction fee: 2.7% → none",
    )
    expect(() => line('todo', [], [])).toThrow()
  })
})

test('freshness facts come from the record and the cards', () => {
  const facts = freshness(catalog, releases)
  expect(facts.since).toBe('2026-10-24')
  expect(facts.latestVersion).toBe(releases[0]?.version)
  expect(facts.issuerChanges).toBe(issuerChanges(releases).length)
  expect(facts.reviewedFrom <= facts.reviewedTo).toBe(true)
})
