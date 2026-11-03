import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { CRONS, onSchedule, PROBES } from '../monitor/src/monitor.ts'

const NOW = new Date('2026-11-03T12:00:00Z')

function fakeFetch(options: { down?: string[]; lastDispatch?: string }) {
  const calls: { url: string; method: string; body?: string }[] = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : undefined
    calls.push({ url, method, ...(body === undefined ? {} : { body }) })
    if (url.endsWith('/dispatches'))
      return Promise.resolve(new Response(null, { status: 204 }))
    if (url.includes('/runs?'))
      return Promise.resolve(
        Response.json({
          workflow_runs: options.lastDispatch
            ? [{ created_at: options.lastDispatch }]
            : [],
        }),
      )
    const down = (options.down ?? []).some((d) => url.startsWith(d))
    return Promise.resolve(new Response('ok', { status: down ? 503 : 200 }))
  }) as typeof fetch
  const dispatches = () =>
    calls
      .filter((c) => c.url.endsWith('/dispatches'))
      .map((c) => JSON.parse(c.body ?? '{}') as { inputs: { quick: string } })
  return { fetcher, calls, dispatches }
}

describe('the uptime monitor', () => {
  test('all up: probes only, dispatches nothing', async () => {
    const f = fakeFetch({})
    expect(await onSchedule(CRONS.probe, 'token', f.fetcher, NOW)).toBe(
      'all up',
    )
    expect(f.calls.map((c) => c.url)).toEqual(PROBES.map((p) => p.url))
    expect(f.dispatches()).toEqual([])
  })

  test('a failed probe is retried, then dispatches a quick check', async () => {
    const f = fakeFetch({ down: ['https://earnrate.dev/'] })
    const result = await onSchedule(CRONS.probe, 'token', f.fetcher, NOW)
    expect(result).toMatch(/down \(earnrate\.dev\); dispatched/)
    expect(
      f.calls.filter((c) => c.url === 'https://earnrate.dev/'),
    ).toHaveLength(2)
    expect(f.dispatches()).toEqual([{ ref: 'main', inputs: { quick: 'true' } }])
  })

  test('a failed probe right after a check does not dispatch again', async () => {
    const f = fakeFetch({
      down: ['https://mcp.earnrate.dev/'],
      lastDispatch: '2026-11-03T11:45:00Z',
    })
    expect(await onSchedule(CRONS.probe, 'token', f.fetcher, NOW)).toMatch(
      /a check ran recently/,
    )
    expect(f.dispatches()).toEqual([])
  })

  test('the hourly and daily triggers dispatch the quick and full checks', async () => {
    const f = fakeFetch({})
    await onSchedule(CRONS.hourly, 'token', f.fetcher, NOW)
    await onSchedule(CRONS.daily, 'token', f.fetcher, NOW)
    expect(f.dispatches().map((d) => d.inputs.quick)).toEqual(['true', 'false'])
  })

  test('without a token it fails loudly', async () => {
    await expect(
      onSchedule(CRONS.probe, undefined, fakeFetch({}).fetcher, NOW),
    ).rejects.toThrow(/GH_DISPATCH_TOKEN/)
  })

  test('the cron triggers match wrangler.jsonc', async () => {
    const config = await readFile(
      new URL('../monitor/wrangler.jsonc', import.meta.url),
      'utf8',
    )
    const crons = /"crons": (\[[^\]]*\])/.exec(config)?.[1] ?? '[]'
    expect(JSON.parse(crons)).toEqual(Object.values(CRONS))
  })
})
