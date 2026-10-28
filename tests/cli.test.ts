import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
