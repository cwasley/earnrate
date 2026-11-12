import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { debouncer } from '../site/app/debounce.ts'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('debouncer', () => {
  test('typing three digits runs once, with the last value, after the pause', () => {
    const seen: string[] = []
    const d = debouncer(250)
    for (const value of ['6', '60', '600']) {
      d.run(() => seen.push(value))
      vi.advanceTimersByTime(100)
    }
    expect(seen).toEqual([])
    vi.advanceTimersByTime(250)
    expect(seen).toEqual(['600'])
  })

  test('flush runs the waiting call at once, and only once', () => {
    const seen: string[] = []
    const d = debouncer(250)
    d.run(() => seen.push('60'))
    d.flush()
    expect(seen).toEqual(['60'])
    vi.advanceTimersByTime(1000)
    d.flush()
    expect(seen).toEqual(['60'])
  })

  test('cancel drops the waiting call', () => {
    const seen: string[] = []
    const d = debouncer(250)
    d.run(() => seen.push('60'))
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([])
  })
})
