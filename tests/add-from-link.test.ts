import { describe, expect, test } from 'vitest'
import {
  addsAtOnce,
  askAddText,
  followingOwnLink,
  loadedWith,
} from '../site/app/add-from-link.ts'

const ORIGIN = 'https://earnrate.dev'
const HASH = '#wallet&add=amex-gold&add=citi-double-cash'

const arrive = (referrer: string, hash = HASH) =>
  addsAtOnce({ hash, referrer, origin: ORIGIN })

describe('cards named in the address', () => {
  test('are added at once when an earnrate.dev page sent the visitor', () => {
    for (const referrer of [
      `${ORIGIN}/cards/amex-gold`,
      `${ORIGIN}/rate`,
      `${ORIGIN}/year-end/`,
    ]) {
      loadedWith(HASH)
      expect(arrive(referrer), referrer).toBe(true)
    }
  })

  test('are asked about first from another site, with no referrer, or from a lookalike address', () => {
    for (const referrer of [
      '',
      'https://example.com/earnrate.dev',
      'https://earnrate.dev.example.com/cards/amex-gold',
      'http://earnrate.dev/cards/amex-gold',
      'not a url',
    ]) {
      loadedWith(HASH)
      expect(arrive(referrer), referrer).toBe(false)
    }
  })

  test('the referrer speaks only for the address the page loaded with, once', () => {
    const referrer = `${ORIGIN}/cards/amex-gold`
    loadedWith('#wallet')
    expect(arrive(referrer)).toBe(false)
    loadedWith(HASH)
    expect(arrive(referrer)).toBe(true)
    expect(arrive(referrer)).toBe(false)
  })

  test("a later change to the address adds at once only when this page's own link made it", () => {
    followingOwnLink(HASH)
    expect(arrive('')).toBe(true)
    expect(arrive('')).toBe(false)
    followingOwnLink('#wallet&add=chase-sapphire-preferred')
    expect(arrive('')).toBe(false)
  })

  test('the question names how many cards', () => {
    expect(askAddText(1)).toBe('Add this card to your wallet?')
    expect(askAddText(3)).toBe('Add these 3 cards to your wallet?')
  })
})
