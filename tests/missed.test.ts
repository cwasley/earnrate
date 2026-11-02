import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { WALLET_ENV_VAR } from '../src/brand.ts'
import { run } from '../src/cli/run.ts'
import { missLogAt, readMissed } from '../src/merchants/missed.ts'
import { EXAMPLE_WALLET } from './helpers.ts'

const TODAY = '2026-11-01'

async function logFile(): Promise<string> {
  return path.join(
    await mkdtemp(path.join(tmpdir(), 'earnrate-missed-')),
    'm.json',
  )
}

test('counts each unrecognized store and the categories it was given', async () => {
  const file = await logFile()
  const log = missLogAt(file)
  await Promise.all([
    log.note('Tacos El Gordo', null, TODAY),
    log.note('tacos el gordo', 'dining', TODAY),
    log.note("Joe's Diner", 'dining', TODAY),
  ])
  const missed = await readMissed(file)
  expect(
    missed.find((m) => m.name.toLowerCase() === 'tacos el gordo'),
  ).toMatchObject({
    count: 2,
    categories: ['dining'],
  })
  expect(missed).toHaveLength(2)
})

test('the command line logs unknown stores, not known ones, and lists them', async () => {
  const file = await logFile()
  let stdout = ''
  const io = {
    env: { [WALLET_ENV_VAR]: EXAMPLE_WALLET, EARNRATE_MISSED_MERCHANTS: file },
    today: TODAY,
    stdout: (t: string) => (stdout += t),
    stderr: () => undefined,
  }
  await run(['tacos', 'el', 'gordo'], io)
  await run(['costco'], io)
  await run(['restaurants'], io)
  await run(["joe's", 'diner', '--category', 'dining'], io)
  stdout = ''
  expect(await run(['missed'], io)).toBe(0)
  expect(stdout).toMatch(/^- tacos el gordo: 1 time/m)
  expect(stdout).toMatch(
    /^- joe's diner: 1 time, last Nov 1, 2026 \(taken as restaurants\)/m,
  )
  expect(stdout).not.toMatch(/costco|restaurants:/i)
})

test('off keeps no list', async () => {
  let stdout = ''
  await run(['missed'], {
    env: { EARNRATE_MISSED_MERCHANTS: 'off' },
    today: TODAY,
    stdout: (t) => (stdout += t),
    stderr: () => undefined,
  })
  expect(stdout).toMatch(/off/)
})
