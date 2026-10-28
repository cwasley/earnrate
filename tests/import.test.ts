import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { run } from '../src/cli/run.ts'
import { loadCatalog, loadWallet } from '../src/data/load.ts'
import { mapAmexCategory } from '../src/import/amex.ts'
import { analyzeStatement } from '../src/import/analyze.ts'
import { mapChaseCategory } from '../src/import/chase.ts'
import { parseCsv } from '../src/import/csv.ts'
import { cleanDescriptor, parseStatement } from '../src/import/statement.ts'

const TODAY = '2026-10-24'
const HEADER =
  'Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category'

const row = (
  date: string,
  description: string,
  amount: string,
  category: string,
  details = '',
) =>
  `${date},${description},${amount},"${details}",${description},"100 MAIN ST","SANTA MONICA\nCA",90401,UNITED STATES,'320260150000000001',${category}`

const STATEMENT = [
  HEADER,
  row(
    '01/15/2026',
    'WHOLEFDS SMO 10',
    '100.00',
    'Merchandise & Supplies-Groceries',
    'WHOLEFDS SMO 10, ""SANTA MONICA""\nGROCERY STORE',
  ),
  row('01/20/2026', 'ONLINE PAYMENT - THANK YOU', '-500.00', ''),
  row(
    '02/01/2026',
    'Annual Membership Fee',
    '325.00',
    'Fees & Adjustments-Fees & Adjustments',
  ),
  row('03/01/2026', 'AplPay TST* SLIPPERY', '40.00', 'Restaurant-Restaurant'),
  row(
    '03/05/2026',
    'WHOLEFDS SMO 10',
    '-20.00',
    'Merchandise & Supplies-Groceries',
  ),
  row(
    '12/10/2025',
    'WHOLEFDS SMO 10',
    '50.00',
    'Merchandise & Supplies-Groceries',
  ),
  row(
    '04/01/2026',
    'APPLE STORE R050',
    '200.00',
    'Merchandise & Supplies-Internet Purchase',
  ),
].join('\r\n')

const CHASE_STATEMENT = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '01/10/2026,01/11/2026,DD *DOORDASH TACOSHOP 855-431-0459 CA,Food & Drink,Sale,-30.00,',
  '01/12/2026,01/12/2026,AUTOMATIC PAYMENT - THANK YOU,,Payment,500.00,',
  '01/13/2026,01/13/2026,ANNUAL MEMBERSHIP FEE,Fees & Adjustments,Fee,-95.00,',
  '01/14/2026,01/15/2026,CORNER MARKET #123,Groceries,Sale,-50.00,',
  '01/15/2026,01/16/2026,AMZN Mktp US*AB12CD34,Shopping,Sale,-20.00,',
  '01/16/2026,01/17/2026,DD *DOORDASH TACOSHOP 855-431-0459 CA,Food & Drink,Return,10.00,',
  '01/17/2026,01/17/2026,REDEMPTION CREDIT,,Adjustment,25.00,',
].join('\n')

const WALLET = `cards:
  - id: amex-gold
    checkout_label: Gold
  - id: amex-blue-cash-preferred
    checkout_label: BCP
  - id: chase-sapphire-preferred
    checkout_label: Sapphire Preferred
`

async function setup(statement = STATEMENT) {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-import-'))
  const wallet = path.join(dir, 'wallet.yaml')
  const csv = path.join(dir, 'activity.csv')
  const chase = path.join(dir, 'Chase_Activity.CSV')
  await writeFile(wallet, WALLET)
  await writeFile(csv, statement)
  await writeFile(chase, CHASE_STATEMENT)
  return { dir, wallet, csv, chase }
}

const amexLines = () => parseStatement(STATEMENT).lines
const chaseLines = () => parseStatement(CHASE_STATEMENT).lines

async function cli(argv: string[], wallet: string) {
  let stdout = ''
  let stderr = ''
  const code = await run(['import', ...argv], {
    env: { [WALLET_ENV_VAR]: wallet },
    today: TODAY,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  })
  return { code, stdout, stderr }
}

describe('parseCsv', () => {
  test('handles quoted commas, doubled quotes and line breaks', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ])
  })

  test('skips blank lines and keeps a last row with no newline', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parseStatement', () => {
  test('reads an Amex CSV, dropping payments and fees', () => {
    const { issuer, lines } = parseStatement(STATEMENT)
    expect(issuer).toBe('amex')
    expect(lines).toEqual([
      {
        date: '2026-01-15',
        description: 'WHOLEFDS SMO 10',
        amount: 100,
        issuerCategory: 'Merchandise & Supplies-Groceries',
        category: 'grocery.supermarket',
      },
      {
        date: '2026-03-01',
        description: 'AplPay TST* SLIPPERY',
        amount: 40,
        issuerCategory: 'Restaurant-Restaurant',
        category: 'dining',
      },
      {
        date: '2026-03-05',
        description: 'WHOLEFDS SMO 10',
        amount: -20,
        issuerCategory: 'Merchandise & Supplies-Groceries',
        category: 'grocery.supermarket',
      },
      {
        date: '2025-12-10',
        description: 'WHOLEFDS SMO 10',
        amount: 50,
        issuerCategory: 'Merchandise & Supplies-Groceries',
        category: 'grocery.supermarket',
      },
      {
        date: '2026-04-01',
        description: 'APPLE STORE R050',
        amount: 200,
        issuerCategory: 'Merchandise & Supplies-Internet Purchase',
        category: 'online_retail',
      },
    ])
  })

  test('reads a Chase CSV, flipping its signs and keeping only sales and returns', () => {
    const { issuer, lines } = parseStatement(CHASE_STATEMENT)
    expect(issuer).toBe('chase')
    expect(lines.map((l) => [l.date, l.amount, l.category])).toEqual([
      ['2026-01-10', 30, 'dining'],
      ['2026-01-14', 50, 'grocery.supermarket'],
      ['2026-01-15', 20, 'other'],
      ['2026-01-16', -10, 'dining'],
    ])
  })

  test('rejects a file it does not recognize', () => {
    expect(() => parseStatement('Posted Date,Payee,Amount\n')).toThrow(
      /reads Amex and Chase activity CSVs/,
    )
  })
})

test.each([
  ['AplPay TACO BELL 728LOS ANGELES CA', 'TACO BELL 728LOS ANGELES CA'],
  ['AplPay TST* SLIPPERY', 'SLIPPERY'],
  ['SQ *BLUE BOTTLE', 'BLUE BOTTLE'],
  ['BT*WAYMO', 'WAYMO'],
  ['SP LEGO BRAND', 'LEGO BRAND'],
  ['GOOGLE *YouTube', 'YouTube'],
  ['WHOLEFDS SMO 10', 'WHOLEFDS SMO 10'],
  ['DD *DOORDASH TACOSHOP 855-431-0459 CA', 'DOORDASH TACOSHOP'],
  ['DD *DOORDASH ROCK &amp; ROLL', 'DOORDASH ROCK & ROLL'],
])('cleanDescriptor(%j)', (input, expected) => {
  expect(cleanDescriptor(input)).toBe(expected)
})

test.each([
  ['Merchandise & Supplies-Groceries', 'grocery.supermarket'],
  ['Restaurant-Bar & Café', 'dining'],
  ['Transportation-Taxis & Coach', 'transit'],
  ['Merchandise & Supplies-Wholesale Stores', 'warehouse_club'],
  ['Business Services-Other Services', 'other'],
  [null, null],
])('mapAmexCategory(%j)', (input, expected) => {
  expect(mapAmexCategory(input)).toBe(expected)
})

test.each([
  ['Food & Drink', 'dining'],
  ['Groceries', 'grocery.supermarket'],
  ['Shopping', 'other'],
  [null, null],
])('mapChaseCategory(%j)', (input, expected) => {
  expect(mapChaseCategory(input)).toBe(expected)
})

describe('analyzeStatement', () => {
  async function analyze() {
    const { wallet } = await setup()
    return analyzeStatement(
      await loadCatalog(),
      await loadWallet(wallet),
      amexLines().map((line) => ({ cardId: 'amex-gold', line })),
      TODAY,
    )
  }

  test('totals purchases and refunds over the whole statement', async () => {
    const a = await analyze()
    expect(a).toMatchObject({
      from: '2025-12-10',
      to: '2026-04-01',
      purchases: 4,
      spend: 390,
      refunds: 20,
    })
    expect(a.best).toBeGreaterThan(a.earned)
  })

  test('reports where another card would have earned more', async () => {
    const { missed } = await analyze()
    expect(missed.find((m) => m.merchant === 'Whole Foods Market')).toEqual({
      merchant: 'Whole Foods Market',
      usedCardId: 'amex-gold',
      categoryFromStatement: false,
      count: 2,
      spend: 150,
      earned: 6,
      best: 9,
      bestCardId: 'amex-blue-cash-preferred',
      bestCard: 'BCP',
    })
  })

  test('flags a merchant the issuer codes differently', async () => {
    const { coding } = await analyze()
    expect(coding).toEqual([
      {
        merchant: 'Apple Store',
        earnrateCategory: 'electronics',
        issuerCategory: 'Merchandise & Supplies-Internet Purchase',
        count: 1,
      },
    ])
  })

  test('books only the current period, and refunds lower the total', async () => {
    const a = await analyze()
    expect(
      a.bookings.map(({ booking }) => [
        booking.capKey,
        booking.period,
        booking.after,
      ]),
    ).toEqual([
      ['us-supermarkets', '2026', 100],
      ['restaurants', '2026', 40],
      ['us-supermarkets', '2026', 80],
    ])
    expect(a.outsideCurrentPeriod).toBe(1)
  })

  test('replays several cards together and marks guessed categories', async () => {
    const { wallet } = await setup()
    const a = analyzeStatement(
      await loadCatalog(),
      await loadWallet(wallet),
      [
        ...amexLines().map((line) => ({ cardId: 'amex-gold', line })),
        ...chaseLines().map((line) => ({
          cardId: 'chase-sapphire-preferred',
          line,
        })),
      ],
      TODAY,
    )
    expect(a.byCard.map((t) => [t.cardId, t.purchases, t.spend])).toEqual([
      ['amex-gold', 4, 390],
      ['chase-sapphire-preferred', 3, 100],
    ])
    expect(
      a.missed
        .filter((m) => m.usedCardId === 'chase-sapphire-preferred')
        .map((m) => [m.merchant, m.bestCardId, m.categoryFromStatement]),
    ).toEqual([
      ['CORNER MARKET', 'amex-blue-cash-preferred', true],
      ['DoorDash', 'amex-gold', false],
    ])
  })
})

describe('earnrate import', () => {
  test('is a dry run by default', async () => {
    const { wallet, csv } = await setup()
    const { code, stdout, stderr } = await cli(
      [csv, '--card', 'amex-gold'],
      wallet,
    )
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Gold statement · 2025-12-10 to 2026-04-01\n/)
    expect(stdout).toMatch(
      /Apple Store: earnrate assumes electronics stores; the statement says Merchandise & Supplies-Internet Purchase \(1×\)/,
    )
    expect(stdout).toMatch(/Run again with --apply to record 3 purchase\(s\)/)
    expect(await readFile(wallet, 'utf8')).toBe(WALLET)
  })

  test('--apply records cap usage once, however often it runs', async () => {
    const { wallet, csv } = await setup()
    expect(
      (await cli([csv, '--card', 'amex-gold', '--apply'], wallet)).code,
    ).toBe(0)
    const after = await readFile(wallet, 'utf8')
    expect(after).toMatch(/us-supermarkets: \{ period: "2026", spent: 80 \}/)
    expect(after).toMatch(/restaurants: \{ period: "2026", spent: 40 \}/)

    const again = await cli([csv, '--card', 'amex-gold', '--apply'], wallet)
    expect(again.stdout).toMatch(
      /Caps: nothing new to record\. 3 purchase\(s\) were recorded by an earlier import\.\nNothing was written\.\n$/,
    )
    expect(await readFile(wallet, 'utf8')).toBe(after)
  })

  test('writes nothing from the statement but cap totals and hashes', async () => {
    const { dir, wallet, csv } = await setup()
    await cli([csv, '--card', 'amex-gold', '--apply'], wallet)
    const written = (await readdir(dir)).filter((f) => !/\.csv$/i.test(f))
    expect(written.sort()).toEqual(['imported.json', 'wallet.yaml'])
    const ledger = JSON.parse(
      await readFile(path.join(dir, 'imported.json'), 'utf8'),
    ) as { recorded: string[] }
    expect(ledger.recorded).toHaveLength(3)
    for (const h of ledger.recorded) expect(h).toMatch(/^[0-9a-f]{64}$/)
    for (const f of written) {
      const text = await readFile(path.join(dir, f), 'utf8')
      for (const secret of [
        '320260150000000001',
        '100 MAIN ST',
        'WHOLEFDS',
        'SLIPPERY',
        '90401',
      ])
        expect(text).not.toContain(secret)
    }
  })

  test.each([
    [
      'a card from another issuer',
      ['--card', 'chase-sapphire-preferred'],
      /looks like an Amex statement, but you named Chase Sapphire Preferred/,
    ],
    [
      'a card not in the wallet',
      ['--card', 'amex-platinum'],
      /"amex-platinum" isn't in your wallet/,
    ],
    ['no --card', [], /Name a statement file and its card/],
    [
      'an unknown valuation',
      ['--card', 'amex-gold', '--valuation', 'max'],
      /Unknown valuation "max"/,
    ],
  ])('refuses %s', async (_name, args, message) => {
    const { wallet, csv } = await setup()
    const { code, stderr } = await cli([csv, ...args], wallet)
    expect(code).toBe(2)
    expect(stderr).toMatch(message)
  })

  test('reports several statements together', async () => {
    const { wallet, csv, chase } = await setup()
    const { code, stdout, stderr } = await cli(
      [`${csv}:amex-gold`, `${chase}:chase-sapphire-preferred`],
      wallet,
    )
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toMatch(
      /^2 statements \(Gold, Sapphire Preferred\) · 2025-12-10 to 2026-04-01\n/,
    )
    expect(stdout).toMatch(
      /DoorDash\s+Sapphire Preferred\s+1 ×\s+\$30\.00\s+\$0\.90 → Gold \$1\.20/,
    )
    expect(stdout).toMatch(/CORNER MARKET\*/)
    expect(stdout).toMatch(/\* earnrate doesn't know this merchant/)
  })

  test('counts purchases toward an open welcome bonus once', async () => {
    const { wallet, csv } = await setup()
    await cli([csv, '--card', 'amex-gold', '--apply'], wallet)
    await writeFile(
      wallet,
      (await readFile(wallet, 'utf8')).replace(
        '    checkout_label: Gold\n',
        '    checkout_label: Gold\n    bonus: { opened: 2026-01-01, spend: 6000, by: 2026-06-30, points: 60000 }\n',
      ),
    )
    const dry = await cli([csv, '--card', 'amex-gold'], wallet)
    expect(dry.stdout).toMatch(
      /Welcome bonus on Gold: \$0\.00 → \$320\.00 of \$6,000\.00 by 2026-06-30\./,
    )
    expect(dry.stdout).toMatch(/record 4 toward welcome bonuses/)

    await cli([csv, '--card', 'amex-gold', '--apply'], wallet)
    expect(await readFile(wallet, 'utf8')).toMatch(/spent: 320 \}/)
    const again = await cli([csv, '--card', 'amex-gold', '--apply'], wallet)
    expect(again.stdout).not.toMatch(/Welcome bonus on Gold/)
    expect(again.stdout).toMatch(/Nothing was written/)
  })

  test('says so when the file is missing', async () => {
    const { dir, wallet } = await setup()
    const { code, stderr } = await cli(
      [path.join(dir, 'nope.csv'), '--card', 'amex-gold'],
      wallet,
    )
    expect(code).toBe(1)
    expect(stderr).toMatch(/Couldn't read .*nope\.csv: ENOENT/)
  })

  test('refuses to run on a ledger it cannot read', async () => {
    const { dir, wallet, csv } = await setup()
    await writeFile(path.join(dir, 'imported.json'), '{ not json')
    const { code, stderr } = await cli(
      [csv, '--card', 'amex-gold', '--apply'],
      wallet,
    )
    expect(code).toBe(1)
    expect(stderr).toMatch(/not importing so nothing gets counted twice/)
    expect(await readFile(wallet, 'utf8')).toBe(WALLET)
  })
})
