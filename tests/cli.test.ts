import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { parseCliArgs, type CliOptions } from '../src/cli/args.ts'
import { run } from '../src/cli/run.ts'
import type { Recommendation } from '../src/engine/types.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXAMPLE_WALLET = path.join(ROOT, 'wallet.example.yaml')

async function cli(argv: string[], wallet = EXAMPLE_WALLET) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { [WALLET_ENV_VAR]: wallet },
    today: '2026-10-24',
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  })
  return { code, stdout, stderr }
}

async function walletFile(yaml: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-cli-'))
  const file = path.join(dir, 'wallet.yaml')
  await writeFile(file, yaml)
  return file
}

function options(argv: string[]): CliOptions {
  const parsed = parseCliArgs(argv)
  if (parsed.kind !== 'run')
    throw new Error(`expected options, got ${parsed.kind}`)
  return parsed.options
}

function argError(argv: string[]): string {
  const parsed = parseCliArgs(argv)
  if (parsed.kind !== 'error')
    throw new Error(`expected an error, got ${parsed.kind}`)
  return parsed.message
}

describe('output', () => {
  test.each([
    [
      'whole foods 80, points-heavy',
      ['whole', 'foods', '80', '--valuation', 'points-heavy'],
    ],
    ['costco, channel inferred', ['costco']],
    ['dodger stadium, ambiguous venue', ['Dodger Stadium', '40']],
    ['comcast, chosen category', ['comcast', '--online']],
    ['unknown merchant', ["Joe's Hardware Santa Monica", '25']],
    ['shell, tie with every card listed', ['shell', '--all']],
  ])('%s', async (_name, argv) => {
    const { code, stdout, stderr } = await cli(argv)
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toMatchSnapshot()
  })

  test('--json prints the full recommendation', async () => {
    const { code, stdout } = await cli(['whole foods', '80', '--json'])
    expect(code).toBe(0)
    const rec = JSON.parse(stdout) as Recommendation
    expect(rec.decision?.cardId).toBe('amex-blue-cash-preferred')
    expect(rec.ranked[0]?.earned).toBeCloseTo(4.8)
    expect(rec.ranked).toHaveLength(9)
  })

  test('says so when no card works', async () => {
    const file = await walletFile('cards:\n  - id: amex-gold\n')
    const { code, stdout } = await cli(['costco'], file)
    expect(code).toBe(0)
    expect(stdout).toMatch(/None of your cards work at Costco\./)
    expect(stdout.match(/None of your cards/g)).toHaveLength(1)
    expect(stdout).toMatch(
      /Can't use here: American Express Gold Card\. Costco takes only Visa in-store\./,
    )
  })
})

describe('arguments', () => {
  test('a trailing number after the merchant is the amount', () => {
    expect(options(['whole', 'foods', '80'])).toMatchObject({
      merchant: 'whole foods',
      amount: 80,
    })
    expect(options(['best buy', '$1,200.50']).amount).toBe(1200.5)
  })

  test('a merchant that is only a number stays the merchant', () => {
    expect(options(['76'])).toMatchObject({ merchant: '76', amount: null })
    expect(options(['76', '40'])).toMatchObject({ merchant: '76', amount: 40 })
  })

  test('channel, valuation, date and country', () => {
    expect(
      options([
        'costco',
        '--online',
        '--valuation',
        'flat',
        '--date',
        '2026-12-01',
        '--country',
        'fr',
      ]),
    ).toMatchObject({
      channel: 'online',
      valuation: 'flat',
      date: '2026-12-01',
      country: 'FR',
    })
    expect(options(['costco', '--in-store']).channel).toBe('in_store')
  })

  test('rejects bad input', () => {
    expect(argError(['whole foods', '0'])).toMatch(/more than \$0/)
    expect(argError(['whole foods', '1,2'])).toMatch(/isn't an amount/)
    expect(argError(['costco', '--online', '--in-store'])).toMatch(/Pick one/)
    expect(argError(['costco', '--valuation', 'max'])).toMatch(
      /flat or points-heavy/,
    )
    expect(argError(['costco', '--date', '2026-02-30'])).toMatch(/isn't a date/)
    expect(argError(['costco', '--country', 'USA'])).toMatch(/country code/)
    expect(argError(['costco', '--fast'])).toMatch(/--fast/)
    expect(argError([])).toMatch(/Name a merchant/)
  })

  test('--category fills in for an unknown merchant only', async () => {
    const unknown = await cli([
      "Lucky's Market",
      '--category',
      'grocery.supermarket',
    ])
    expect(unknown.stdout).toMatch(
      /^Lucky's Market \(category given\)\n\nUse Blue Cash Preferred: 6% back/,
    )
    const known = await cli(['costco', '--category', 'dining'])
    expect(known.stdout).toMatch(/^Costco · in-store/)
    const bad = await cli(['costco', '--category', 'groceries'])
    expect(bad.code).toBe(2)
    expect(bad.stderr).toMatch(
      /Unknown category "groceries"\. Use one of: .*grocery\.supermarket/,
    )
  })

  test('a usage error exits 2 and points at --help', async () => {
    const { code, stderr } = await cli(['whole foods', '0'])
    expect(code).toBe(2)
    expect(stderr).toMatch(/--help/)
  })

  test('--help prints usage', async () => {
    const { code, stdout } = await cli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Usage: earnrate <merchant> \[amount\]/)
  })

  test.each([['--version'], ['-v']])('%s prints the version', async (flag) => {
    const { code, stdout } = await cli([flag])
    expect(code).toBe(0)
    expect(stdout).toMatch(/^earnrate \d+\.\d+\.\d+\n$/)
  })
})

describe('wallet errors', () => {
  test('a missing wallet says where it looked', async () => {
    const { code, stderr } = await cli(['costco'], '/nonexistent/wallet.yaml')
    expect(code).toBe(1)
    expect(stderr).toMatch(/No wallet at \/nonexistent\/wallet\.yaml/)
    expect(stderr).toMatch(/earnrate add chase-sapphire-preferred/)
    expect(stderr).toMatch(/wallet\.example\.yaml/)
  })

  test('a card id not in the catalog is reported', async () => {
    const file = await walletFile(
      'cards:\n  - id: amex-gold\n  - id: made-up-card\n',
    )
    const { code, stderr } = await cli(['costco'], file)
    expect(code).toBe(1)
    expect(stderr).toMatch(/made-up-card: not in the card catalog/)
  })

  test('a wallet that fails the schema is reported', async () => {
    const file = await walletFile(
      'cards:\n  - id: amex-gold\n    card_number: "4111"\n',
    )
    const { code, stderr } = await cli(['costco'], file)
    expect(code).toBe(1)
    expect(stderr).toMatch(/Couldn't read your wallet/)
    expect(stderr).toMatch(/card_number/)
  })
})

test('the bin runs under plain node', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [path.join(ROOT, 'src/cli/bin.ts'), 'netflix'],
    {
      env: { ...process.env, [WALLET_ENV_VAR]: EXAMPLE_WALLET, NO_COLOR: '1' },
    },
  )
  expect(stdout).toMatch(/^Netflix\n\nUse Blue Cash Preferred: 6% back\./)
})

describe('wallet setup commands', () => {
  async function newWalletPath(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-cli-'))
    return path.join(dir, 'wallet.yaml')
  }

  test('cards finds a card and what it needs', async () => {
    const { code, stdout } = await cli(['cards', 'cash+'])
    expect(code).toBe(0)
    expect(stdout).toMatch(/^usbank-cash-plus: U\.S\. Bank Cash\+/m)
    expect(stdout).toMatch(/five-percent: pick 2 of/)
    expect(stdout).toMatch(/\[in wallet\]/)
  })

  test('cards with no match exits 1', async () => {
    const { code, stderr } = await cli(['cards', 'zzzz'])
    expect(code).toBe(1)
    expect(stderr).toMatch(/No card matches "zzzz"/)
  })

  test('add starts a wallet, then update and memberships finish it', async () => {
    const file = await newWalletPath()
    const added = await cli(
      ['add', 'usbank-cash-plus', '--label', 'Cash+'],
      file,
    )
    expect(added.code).toBe(0)
    expect(added.stdout).toMatch(/Added U\.S\. Bank Cash\+.*\(a new wallet\)/)
    expect(added.stdout).toMatch(/earnrate update usbank-cash-plus --pick/)

    const updated = await cli(
      [
        'update',
        'usbank-cash-plus',
        '--pick',
        'five-percent=tv-internet-streaming,movie-theaters',
        '--pick',
        'two-percent=gas-ev-charging',
      ],
      file,
    )
    expect(updated.code).toBe(0)
    expect(updated.stdout).toMatch(/Nothing else to set up/)

    expect((await cli(['add', 'chase-prime-visa'], file)).code).toBe(0)
    expect((await cli(['memberships', 'amazon-prime'], file)).code).toBe(0)
    const shown = await cli(['memberships'], file)
    expect(shown.stdout).toMatch(/^Yours: amazon-prime$/m)

    const best = await cli(['comcast', '100'], file)
    expect(best.stdout).toMatch(/Use Cash\+: 5% back/)
    expect(await readFile(file, 'utf8')).toContain(
      'memberships: [amazon-prime]\ncards:\n  - id: usbank-cash-plus\n',
    )
  })

  test('remove takes a card out, and errors exit 1', async () => {
    const file = await walletFile(
      'cards:\n  - id: amex-gold\n  - id: citi-double-cash\n',
    )
    expect((await cli(['remove', 'amex-gold'], file)).code).toBe(0)
    const last = await cli(['remove', 'citi-double-cash'], file)
    expect(last.code).toBe(1)
    expect(last.stderr).toMatch(/last card/)
  })

  test('bad arguments are usage errors', async () => {
    expect((await cli(['add'])).code).toBe(2)
    expect((await cli(['add', 'amex-gold', '--pick', 'oops'])).code).toBe(2)
    expect((await cli(['remove', 'amex-gold', '--label', 'x'])).code).toBe(2)
  })

  test('a merchant named like an object property is still a merchant', async () => {
    const { code } = await cli(['constructor'])
    expect(code).toBe(0)
  })
})

describe('comparing every card', () => {
  const noWallet = path.join(tmpdir(), 'earnrate-no-wallet', 'wallet.yaml')

  test('best needs no wallet and reads plain words as a category', async () => {
    const { code, stdout } = await cli(['best', 'groceries'], noWallet)
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Best cards for supermarkets:/)
    expect(stdout).toMatch(
      /^ 1\. American Express Blue Cash Preferred Card +6% +\$95 annual fee \(waived the first year\)$/m,
    )
    expect(stdout).toMatch(/\+ \d+ more \(--all lists them\)/)
  })

  test('best with a merchant, an amount and a membership', async () => {
    const { stdout } = await cli(
      ['best', 'amazon', '120', '--member', 'amazon-prime', '--no-fee'],
      noWallet,
    )
    expect(stdout).toMatch(/^ 1\. Prime Visa +5% +\$6 +no annual fee$/m)
    expect(stdout).toMatch(/^ {4}Needs amazon-prime\.$/m)
  })

  test('simulate ranks single cards and pairs after fees', async () => {
    const { code, stdout } = await cli(
      ['simulate', 'groceries=700', 'dining=300', 'other=800'],
      noWallet,
    )
    expect(code).toBe(0)
    expect(stdout).toMatch(/^A year of this spending: \$21,600\.$/m)
    expect(stdout).toMatch(/^Best single cards/m)
    expect(stdout).toMatch(/^Best two-card pairs:$/m)
    expect(stdout).toMatch(
      /Supermarkets.* → American Express Blue Cash Preferred Card/,
    )
  })

  test('simulate --wallet ranks what a card would add', async () => {
    const { code, stdout } = await cli([
      'simulate',
      'dining=400',
      'other=1000',
      '--wallet',
    ])
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Your wallet earns about \$[\d,]+ a year/)
  })

  test('bad input is a usage error', async () => {
    expect((await cli(['best'], noWallet)).code).toBe(2)
    expect(
      (await cli(['best', 'gas', '--cash', '--points'], noWallet)).code,
    ).toBe(2)
    expect(
      (await cli(['best', 'gas', '--issuer', 'nope'], noWallet)).stderr,
    ).toMatch(/Unknown issuer "nope"/)
    expect((await cli(['simulate', 'groceries'], noWallet)).stderr).toMatch(
      /isn't <what>=<dollars a month>/,
    )
    expect((await cli(['simulate', 'zzzshop=50'], noWallet)).stderr).toMatch(
      /Not a category or a merchant earnrate knows: "zzzshop"/,
    )
  })
})

test('cheatsheet prints the best card per category', async () => {
  const { code, stdout } = await cli(['cheatsheet'])
  expect(code).toBe(0)
  expect(stdout).toMatch(/^Your cheat sheet for Q4 2026$/m)
  expect(stdout).toMatch(/^ {2}Groceries +Blue Cash Preferred +6%$/m)
  expect((await cli(['cheatsheet', '--date', 'soon'])).code).toBe(2)
})
