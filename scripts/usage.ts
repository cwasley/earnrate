// Daily request counts for the hosted server, from its Analytics Engine
// tally (method and tool names only; nothing about what was asked).
// Needs a Cloudflare API token with "Account Analytics: Read", from
// CLOUDFLARE_API_TOKEN or the macOS Keychain item earnrate-cloudflare-analytics,
// and the account ID from CLOUDFLARE_ACCOUNT_ID.
// Usage: yarn usage [days]   (default 7)
import { execFileSync } from 'node:child_process'

const DATASET = 'earnrate_mcp_usage'

function keychain(service: string): string | undefined {
  if (process.platform !== 'darwin') return undefined
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return undefined
  }
}

const token =
  process.env.CLOUDFLARE_API_TOKEN ?? keychain('earnrate-cloudflare-analytics')
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (!token || !account) {
  console.error(
    'Set CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN (or the Keychain item earnrate-cloudflare-analytics) to a token with Account Analytics: Read.',
  )
  process.exit(2)
}

const days = Number(process.argv[2] ?? 7)
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error('Give a number of days from 1 to 90.')
  process.exit(2)
}

// Rows are sampled at high volume, so counts sum the sample interval.
const sql = `
  SELECT toStartOfDay(timestamp) AS day, blob1 AS label, SUM(_sample_interval) AS count
  FROM ${DATASET}
  WHERE timestamp > NOW() - INTERVAL '${String(days)}' DAY
  GROUP BY day, label
  ORDER BY day DESC, count DESC
  FORMAT JSON`

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
  { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: sql },
)
if (!response.ok) {
  console.error(
    `Cloudflare answered ${String(response.status)}: ${await response.text()}`,
  )
  process.exit(1)
}
const { data } = (await response.json()) as {
  data: { day: string; label: string; count: string | number }[]
}

if (data.length === 0) {
  console.log(`No requests in the last ${String(days)} days.`)
  process.exit(0)
}
const byDay = new Map<string, { label: string; count: number }[]>()
for (const row of data) {
  const day = row.day.slice(0, 10)
  byDay.set(day, [
    ...(byDay.get(day) ?? []),
    { label: row.label, count: Number(row.count) },
  ])
}
for (const [day, rows] of byDay) {
  const tools = rows.filter((r) => r.label.startsWith('tool:'))
  const total = (list: typeof rows) => list.reduce((n, r) => n + r.count, 0)
  console.log(
    `${day}  ${String(total(rows))} requests, ${String(total(tools))} tool calls`,
  )
  for (const r of rows)
    console.log(`  ${r.label.padEnd(32)} ${String(r.count).padStart(6)}`)
}
