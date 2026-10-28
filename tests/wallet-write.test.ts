import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { writeCapBooking } from '../src/data/wallet-write.ts'
import type { CapBooking } from '../src/engine/record.ts'

const booking: CapBooking = {
  cardId: 'amex-blue-cash-preferred',
  capKey: 'us-supermarkets',
  ruleId: 'us-supermarkets',
  period: '2026',
  capAmount: 6000,
  before: 0,
  after: 80,
}

async function write(yaml: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'earnrate-write-'))
  const file = path.join(dir, 'wallet.yaml')
  await writeFile(file, yaml)
  await writeCapBooking(file, booking)
  return readFile(file, 'utf8')
}

test('inserts into the last card of a file with no trailing newline', async () => {
  expect(
    await write('cards:\n  - id: amex-gold\n  - id: amex-blue-cash-preferred'),
  ).toBe(
    'cards:\n  - id: amex-gold\n  - id: amex-blue-cash-preferred\n    cap_usage:\n      us-supermarkets: { period: "2026", spent: 80 }\n',
  )
})

test('keeps a comment line that follows the card', async () => {
  expect(
    await write(
      'cards:\n  - id: amex-blue-cash-preferred\n    checkout_label: BCP\n# more cards later\n  - id: amex-gold\n',
    ),
  ).toBe(
    'cards:\n  - id: amex-blue-cash-preferred\n    checkout_label: BCP\n    cap_usage:\n      us-supermarkets: { period: "2026", spent: 80 }\n# more cards later\n  - id: amex-gold\n',
  )
})

test('refuses a cap_usage written inline, rather than reformatting it', async () => {
  await expect(
    write('cards:\n  - id: amex-blue-cash-preferred\n    cap_usage: {}\n'),
  ).rejects.toThrow(/edit it by hand/)
})
