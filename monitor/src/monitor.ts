export const REPO = 'cwasley/earnrate'
export const WORKFLOW = 'live-check.yml'

// Keep in step with `triggers.crons` in monitor/wrangler.jsonc.
export const CRONS = {
  probe: '*/5 * * * *',
  hourly: '7 * * * *',
  daily: '30 14 * * *',
} as const

// Public pages only. Neither request is an MCP call, so neither shows up in
// the hosted server's usage tally.
export const PROBES = [
  { name: 'earnrate.dev', url: 'https://earnrate.dev/' },
  {
    name: 'mcp.earnrate.dev sign-in metadata',
    url: 'https://mcp.earnrate.dev/.well-known/oauth-authorization-server',
  },
]

// A failed probe dispatches a quick check at most this often; the check
// opens the uptime issue, which emails Collin.
export const DISPATCH_GAP_MINUTES = 30

type Fetch = typeof fetch

export async function failedProbes(fetcher: Fetch): Promise<string[]> {
  const failed: string[] = []
  for (const p of PROBES) {
    let ok = false
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const res = await fetcher(p.url, {
          signal: AbortSignal.timeout(10_000),
        })
        ok = res.status === 200
      } catch {
        ok = false
      }
    }
    if (!ok) failed.push(p.name)
  }
  return failed
}

const github = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'earnrate-monitor',
  'x-github-api-version': '2022-11-28',
})

const workflowUrl = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`

// Marks the runs a failed probe starts, so only those hold back the next one.
export const PROBE_FAILED = 'probe failed'

export async function dispatch(
  fetcher: Fetch,
  token: string,
  quick: boolean,
  reason = '',
): Promise<void> {
  const res = await fetcher(`${workflowUrl}/dispatches`, {
    method: 'POST',
    headers: github(token),
    body: JSON.stringify({
      ref: 'main',
      inputs: { quick: String(quick), ...(reason ? { reason } : {}) },
    }),
  })
  if (res.status !== 204)
    throw new Error(`GitHub refused the dispatch: ${String(res.status)}`)
}

async function probeDispatchedSince(
  fetcher: Fetch,
  token: string,
  since: Date,
): Promise<boolean> {
  const res = await fetcher(
    `${workflowUrl}/runs?event=workflow_dispatch&per_page=20`,
    { headers: github(token) },
  )
  if (!res.ok) return false
  const body: unknown = await res.json()
  const runs =
    typeof body === 'object' && body !== null && 'workflow_runs' in body
      ? body.workflow_runs
      : undefined
  if (!Array.isArray(runs)) return false
  return runs.some((run: unknown) => {
    if (typeof run !== 'object' || run === null) return false
    const title = 'display_title' in run ? run.display_title : undefined
    const created = 'created_at' in run ? run.created_at : undefined
    return (
      typeof title === 'string' &&
      title.includes(PROBE_FAILED) &&
      typeof created === 'string' &&
      new Date(created) >= since
    )
  })
}

export async function onSchedule(
  cron: string,
  token: string | undefined,
  fetcher: Fetch,
  now: Date,
): Promise<string> {
  if (!token) throw new Error('GH_DISPATCH_TOKEN is not set')
  if (cron === CRONS.daily) {
    await dispatch(fetcher, token, false)
    return 'dispatched the full check'
  }
  if (cron === CRONS.hourly) {
    await dispatch(fetcher, token, true)
    return 'dispatched the quick check'
  }
  const failed = await failedProbes(fetcher)
  if (failed.length === 0) return 'all up'
  const since = new Date(now.getTime() - DISPATCH_GAP_MINUTES * 60_000)
  if (await probeDispatchedSince(fetcher, token, since))
    return `down (${failed.join(', ')}); a check ran recently`
  await dispatch(fetcher, token, true, PROBE_FAILED)
  return `down (${failed.join(', ')}); dispatched the quick check`
}
