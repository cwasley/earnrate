import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { parseCliArgs, type CliOptions } from '../src/cli/args.ts'
import { run } from '../src/cli/run.ts'
import type { Recommendation } from '../src/engine/types.ts'
import { TODAY } from './golden/fixtures.ts'
import { EXAMPLE_WALLET, ROOT } from './helpers.ts'

async function cli(argv: string[], wallet = EXAMPLE_WALLET) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, {
    env: { EARNRATE_MISSED_MERCHANTS: 'off', [WALLET_ENV_VAR]: wallet },
    today: TODAY,
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
    expect(argError(['costco', '--online', '--in-store'])).toMatch(/not both/)
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
  test('a missing wallet still answers, from every card', async () => {
    const { code, stdout } = await cli(['costco'], '/nonexistent/wallet.yaml')
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Best cards for Costco/)
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
      env: {
        ...process.env,
        EARNRATE_MISSED_MERCHANTS: 'off',
        [WALLET_ENV_VAR]: EXAMPLE_WALLET,
        NO_COLOR: '1',
      },
    },
  )
  expect(stdout).toMatch(
    /^Netflix · online\n\nUse Blue Cash Preferred: 6% back\./,
  )
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

  test('add and update take an opening date for first-year rates', async () => {
    const file = await newWalletPath()
    const added = await cli(['add', 'discover-it-cash-back'], file)
    expect(added.code).toBe(0)
    expect((await cli(['chipotle'], file)).stdout).toMatch(
      /A first-year rate may apply on Discover it/,
    )
    const updated = await cli(
      [
        'update',
        'discover-it-cash-back',
        '--opened',
        '2026-03-04',
        '--activated',
        'q4-2026-restaurants',
      ],
      file,
    )
    expect(updated.code).toBe(0)
    expect(await readFile(file, 'utf8')).toContain('    opened: 2026-03-04\n')
    const answer = await cli(['chipotle'], file)
    expect(answer.stdout).toMatch(
      /10% cash back in your first year, through Mar 3, 2027/,
    )
  })

  test('update sets and clears what a free night is worth', async () => {
    const file = await newWalletPath()
    await cli(['add', 'amex-hilton-honors-aspire'], file)
    const set = await cli(
      [
        'update',
        'amex-hilton-honors-aspire',
        '--night-value',
        'anniversary-night=$450',
      ],
      file,
    )
    expect(set.code).toBe(0)
    expect(await readFile(file, 'utf8')).toContain(
      '    enrolled: [anniversary-night]\n    night_values:\n      anniversary-night: 450\n',
    )
    const cleared = await cli(
      [
        'update',
        'amex-hilton-honors-aspire',
        '--night-value',
        'anniversary-night=none',
      ],
      file,
    )
    expect(cleared.code).toBe(0)
    expect(await readFile(file, 'utf8')).not.toContain('night_values')
    const bad = await cli(
      ['update', 'amex-hilton-honors-aspire', '--night-value', '450'],
      file,
    )
    expect(bad.code).toBe(2)
    expect(bad.stderr).toMatch(/--night-value takes <night>=<dollars>/)
  })

  test('update sets cap and spend-bonus spending; memberships refuses card options', async () => {
    const file = await newWalletPath()
    await cli(['add', 'amex-blue-cash-preferred'], file)
    await cli(['add', 'chase-ihg-one-rewards'], file)
    expect(
      (
        await cli(
          [
            'update',
            'amex-blue-cash-preferred',
            '--cap-spent',
            'us-supermarkets=1200',
          ],
          file,
        )
      ).code,
    ).toBe(0)
    expect(
      (
        await cli(
          [
            'update',
            'chase-ihg-one-rewards',
            '--milestone-spent',
            'spend-15k=9000',
          ],
          file,
        )
      ).code,
    ).toBe(0)
    const text = await readFile(file, 'utf8')
    expect(text).toMatch(/us-supermarkets: \{ period: "?2026"?, spent: 1200 \}/)
    expect(text).toMatch(/spend-15k: \{ period: "?2026"?, spent: 9000 \}/)
    const bad = await cli(
      ['update', 'amex-blue-cash-preferred', '--cap-spent', 'groceries'],
      file,
    )
    expect(bad.code).toBe(2)
    expect(bad.stderr).toMatch(/--cap-spent takes <id>=<dollars>/)
    const memberships = await cli(
      ['memberships', 'amazon-prime', '--bonus-opened', '2026-10-01'],
      file,
    )
    expect(memberships.code).toBe(2)
    expect(memberships.stderr).toMatch(/doesn't take card options/)
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
    expect(shown.stdout).toMatch(/^Yours: Amazon Prime \(amazon-prime\)$/m)

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
    expect((await cli(['remove', 'citi-double-cash'], file)).code).toBe(0)
    expect((await cli(['remove', 'citi-double-cash'], file)).code).toBe(1)
    expect((await cli(['costco'], file)).stdout).toMatch(/^Best cards for/)
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
    expect(stdout).toMatch(/^ 1\. Prime Visa +5% +\$6\.00 +no annual fee$/m)
    expect(stdout).toMatch(/^ {4}With your Amazon Prime\.$/m)
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

  test('best states the merchant code it assumes, like a recommendation', async () => {
    expect((await cli(['best', 'expedia'], noWallet)).stdout).toMatch(
      /Assumes Expedia counts as travel\.\n[^]*Usual merchant code: MCC 4722\./,
    )
  })

  test('flags are checked the same way in every subcommand', async () => {
    for (const argv of [
      ['cheatsheet', '--date', '2026-13-45'],
      ['best', 'groceries', '--date', 'soon'],
      ['simulate', 'groceries=600', '--start', '2026-02-30'],
    ])
      expect((await cli(argv, noWallet)).stderr).toMatch(/isn't a date/)
    for (const argv of [
      ['amazon', '--member', 'amazon-prme'],
      ['cheatsheet', '--member', 'amazon-prme'],
      ['best', 'amazon', '--member', 'amazon-prme'],
    ])
      expect((await cli(argv, noWallet)).stderr).toMatch(
        /Unknown membership "amazon-prme"/,
      )
    const best = await cli(['best', 'amazon', '1,200', '--json'], noWallet)
    const top = (JSON.parse(best.stdout) as { ranked: { earned: number }[] })
      .ranked[0]
    expect(top?.earned).toBeGreaterThan(12)
    expect(
      (await cli(['cheatsheet', '--cards', 'amex-gold,'], noWallet)).code,
    ).toBe(0)
  })
})

test('cheatsheet prints the best card per category', async () => {
  const { code, stdout } = await cli(['cheatsheet'])
  expect(code).toBe(0)
  expect(stdout).toMatch(/^Your cheat sheet for Q4 2026$/m)
  expect(stdout).toMatch(/^ {2}Groceries +Blue Cash Preferred +6%$/m)
  expect((await cli(['cheatsheet', '--date', 'soon'])).code).toBe(2)
})

describe('no wallet needed', () => {
  const noWallet = path.join(tmpdir(), 'earnrate-none', 'wallet.yaml')

  test('a store or category with no wallet ranks every card, with a hint', async () => {
    const { code, stdout, stderr } = await cli(['restaurants'], noWallet)
    expect(code).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toMatch(/^Best cards for restaurants:/)
    expect(stdout).toMatch(/name them with --cards/)
  })

  test('--cards answers for just the cards named', async () => {
    const { stdout } = await cli(
      [
        'whole',
        'foods',
        '80',
        '--cards',
        'amex-gold,chase-prime-visa',
        '--member',
        'amazon-prime',
      ],
      noWallet,
    )
    expect(stdout).toMatch(/Use Prime Visa: 5% back, about \$4\.00/)
    expect((await cli(['costco', '--cards', 'nope'], noWallet)).code).toBe(1)
  })

  test('--cards uses the saved memberships and point values unless --member is given', async () => {
    const saved = await walletFile(
      (await readFile(EXAMPLE_WALLET, 'utf8')).replace(
        'valuations:\n',
        'valuations:\n  UR: 2\n',
      ),
    )
    const cards = ['--cards', 'chase-prime-visa,chase-sapphire-preferred']
    expect((await cli(['amazon', '100', ...cards], saved)).stdout).toMatch(
      /Use Prime Visa: 5% back/,
    )
    expect(
      (await cli(['amazon', '100', ...cards, '--member', 'costco'], saved))
        .stdout,
    ).toMatch(/Use Prime Visa: 3% back/)
    expect((await cli(['dining', '100', ...cards], saved)).stdout).toMatch(
      /Use Chase Sapphire Preferred Card: 6% back/,
    )
  })

  test('a category word with a wallet reads as a category, not an unknown store', async () => {
    const { stdout } = await cli(['dining'])
    expect(stdout).toMatch(/^Restaurants/)
    expect(stdout).not.toMatch(/merchant list/)
  })

  test('todo lists what the cards need and can write a calendar file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-todo-'))
    const ics = path.join(dir, 'earnrate.ics')
    const { code, stdout } = await cli([
      'todo',
      '--ics',
      ics,
      '--date',
      '2026-11-01',
    ])
    expect(code).toBe(0)
    expect(stdout).toMatch(
      /^- Activate Freedom Flex's bonus at grocery stores, restaurants and American Red Cross by Dec 14, 2026\.$/m,
    )
    expect(await readFile(ics, 'utf8')).toMatch(/^BEGIN:VCALENDAR/)
  })

  test('cheatsheet --every-card picks from every card with the saved memberships', async () => {
    const { stdout } = await cli(['cheatsheet', '--every-card'])
    expect(stdout).toMatch(/^ {2}Amazon +Prime Visa +5%$/m)
    expect(stdout).toMatch(/With your Amazon Prime\./)
    expect(stdout).not.toMatch(/name them with --cards/)
    expect(
      (await cli(['cheatsheet', '--every-card', '--cards', 'amex-gold'])).code,
    ).toBe(2)
  })

  test('cheatsheet, offers and simulate work without a wallet', async () => {
    const sheet = await cli(['cheatsheet'], noWallet)
    expect(sheet.code).toBe(0)
    expect(sheet.stdout).toMatch(/^The best card for each kind of purchase/)
    expect((await cli(['offers'], noWallet)).code).toBe(0)
    const offers = await cli(
      ['offers', '--cards', 'amex-platinum', '--all'],
      noWallet,
    )
    expect(offers.stdout).not.toMatch(/^ ?\d+\. The Platinum Card/m)
    expect(offers.stdout).toMatch(/Likely not eligible: you hold The Platinum/)
    const named = await cli(
      ['offers', '--compare', 'chase-sapphire-preferred,capital-one-venture-x'],
      noWallet,
    )
    expect(named.stdout.match(/^ ?\d+\. /gm)).toHaveLength(2)
    expect(named.stdout).toMatch(/Compares only the cards you named/)
    const unknown = await cli(
      ['offers', '--compare', 'chase-sapphire'],
      noWallet,
    )
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toMatch(/Closest: chase-sapphire-preferred/)
    const sim = await cli(['simulate'], noWallet)
    expect(sim.code).toBe(0)
    expect(sim.stdout).toMatch(/^No spending was given/)
    expect((await cli(['simulate', '--wallet'], noWallet)).stderr).toMatch(
      /No saved wallet yet/,
    )
  })
})

describe('paying abroad', () => {
  test('--country ranks after foreign transaction fees and checks the code', async () => {
    const home = await cli(['etsy', '100', '--online'])
    const abroad = await cli(['etsy', '100', '--online', '--country', 'gb'])
    expect(abroad.code).toBe(0)
    expect(abroad.stdout).toMatch(
      /Double Cash \(3%\), Blue Cash Preferred \(2\.7%\) and Cash\+ \(3%\) charge foreign transaction fees here/,
    )
    expect(abroad.stdout).toMatch(/purchase outside the U\.S\./)
    expect(home.stdout).not.toMatch(/foreign transaction fee/)
    expect(abroad.stdout).not.toMatch(/\bGB\b/)
    const bad = await cli(['etsy', '--country', 'GBR'])
    expect(bad.code).not.toBe(0)
    expect(bad.stderr).toMatch(/"GBR" isn't a country code/)
  })

  test('earnrate best --country and earnrate cards show the fee', async () => {
    const best = await cli(['best', 'groceries', '--country', 'JP', '--all'])
    expect(best.code).toBe(0)
    expect(best.stdout).toMatch(
      /Charges a 3% foreign transaction fee here, so it nets/,
    )
    const cards = await cli(['cards', 'freedom unlimited'])
    expect(cards.stdout).toMatch(/3% foreign transaction fee/)
    const gold = await cli(['cards', 'amex gold'])
    expect(gold.stdout).toMatch(/no foreign transaction fee/)
  }, 20_000)
})

describe('named cards with credits and opening dates', () => {
  test('--skipped-credits leaves a credit out of the answer', async () => {
    const plain = await cli(['uber', '30', '--cards', 'amex-gold'])
    expect(plain.stdout).toMatch(/\$10 back from its Uber and Uber Eats credit/)
    const skipped = await cli([
      'uber',
      '30',
      '--cards',
      'amex-gold',
      '--skipped-credits',
      'amex-gold=uber-cash',
    ])
    expect(skipped.code).toBe(0)
    expect(skipped.stdout).not.toMatch(/credit/)
    const wrong = await cli([
      'uber',
      '--cards',
      'amex-gold',
      '--skipped-credits',
      'amex-gold=lululemon',
    ])
    expect(wrong.stderr).toMatch(/amex-gold has no credit 'lululemon'/)
  })

  test('--enrolled counts a credit and --opened a first-year rate', async () => {
    const plain = await cli(['lululemon', '100', '--cards', 'amex-platinum'])
    expect(plain.stdout).not.toMatch(/back from its Lululemon credit/)
    const enrolled = await cli([
      'lululemon',
      '100',
      '--cards',
      'amex-platinum',
      '--enrolled',
      'amex-platinum=lululemon',
    ])
    expect(enrolled.code).toBe(0)
    expect(enrolled.stdout).toMatch(/\$75 back from its Lululemon credit/)
    const opened = await cli([
      'chipotle',
      '--cards',
      'discover-it-cash-back',
      '--opened',
      'discover-it-cash-back=2026-03-04',
    ])
    expect(opened.stdout).toMatch(/in your first year/)
    const stray = await cli([
      'chipotle',
      '--cards',
      'amex-gold',
      '--opened',
      'discover-it-cash-back=2026-03-04',
    ])
    expect(stray.code).toBe(2)
    expect(stray.stderr).toMatch(/isn't one/)
  })
})

describe('issuers left out of next-card answers', () => {
  test('skip-issuers saves the list in the file, keeping comments, and offers leaves them out', async () => {
    const file = await walletFile(
      '# my cards\ncards:\n  - id: citi-double-cash # daily\n',
    )
    const set = await cli(['skip-issuers', 'chase'], file)
    expect(set.code).toBe(0)
    expect(set.stdout).toMatch(
      /Next-card answers now leave out Chase \(chase\)/,
    )
    const text = await readFile(file, 'utf8')
    expect(text).toContain('skipped_issuers: [chase]\n')
    expect(text).toContain('# my cards')
    expect(text).toContain('citi-double-cash # daily')
    const shown = await cli(['skip-issuers'], file)
    expect(shown.stdout).toMatch(/^Left out: Chase \(chase\)/)
    const offers = await cli(['offers', '--all'], file)
    expect(offers.stdout).not.toMatch(/Chase Sapphire/)
    expect(offers.stdout).toMatch(/Leaves out cards from Chase, as you asked\./)
    const cleared = await cli(['skip-issuers', '--none'], file)
    expect(cleared.code).toBe(0)
    expect(await readFile(file, 'utf8')).not.toContain('skipped_issuers')
    const wrong = await cli(['offers', '--skip-issuer', 'chse'], file)
    expect(wrong.code).not.toBe(0)
    expect(wrong.stderr).toMatch(/No card earnrate knows is from 'chse'/)
  })
})
