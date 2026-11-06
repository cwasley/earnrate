// Needs a Cloudflare API token with "Account Analytics: Read", from
// CLOUDFLARE_API_TOKEN or the macOS Keychain item earnrate-cloudflare-analytics,
// and the account ID from CLOUDFLARE_ACCOUNT_ID (or the token's only account).
// Usage: yarn usage [days]   (default 7)
import { execFileSync } from 'node:child_process'

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
if (!token) {
  console.error(
    'Set CLOUDFLARE_API_TOKEN (or the Keychain item earnrate-cloudflare-analytics) to a token with Account Analytics: Read.',
  )
  process.exit(2)
}
const auth = { authorization: `Bearer ${token}` }

const days = Number(process.argv[2] ?? 7)
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error('Give a number of days from 1 to 90.')
  process.exit(2)
}

async function accountId(): Promise<string> {
  if (process.env.CLOUDFLARE_ACCOUNT_ID)
    return process.env.CLOUDFLARE_ACCOUNT_ID
  const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
    headers: auth,
  })
  const body = (await res.json()) as { result?: { id: string }[] }
  const only = body.result?.length === 1 ? body.result[0]?.id : undefined
  if (!only) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID.')
    process.exit(2)
  }
  return only
}
const account = await accountId()

type Row = { label: string; kind: string; count: number }

// Rows are sampled at high volume, so counts sum the sample interval.
async function tally(dataset: string): Promise<Row[]> {
  const sql = `
    SELECT blob1 AS label, blob2 AS kind, SUM(_sample_interval) AS count
    FROM ${dataset}
    WHERE timestamp > NOW() - INTERVAL '${String(days)}' DAY
    GROUP BY label, kind
    FORMAT JSON`
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    { method: 'POST', headers: auth, body: sql },
  )
  if (!res.ok) {
    // A dataset appears with its first write.
    if (
      res.status === 422 &&
      /unknown table|doesn't exist/i.test(await res.text())
    )
      return []
    throw new Error(`Cloudflare answered ${String(res.status)} for ${dataset}`)
  }
  const { data } = (await res.json()) as {
    data: { label: string; kind: string; count: string | number }[]
  }
  return data.map((r) => ({
    label: r.label,
    kind: r.kind === '' ? 'unknown' : r.kind,
    count: Number(r.count),
  }))
}

function table(title: string, rows: Row[], kinds: string[]) {
  console.log(`\n${title}`)
  if (rows.length === 0) {
    console.log('  nothing counted yet')
    return
  }
  const seen = [...new Set([...kinds, ...rows.map((r) => r.kind)])].filter(
    (k) => rows.some((r) => r.kind === k),
  )
  const labels = [...new Set(rows.map((r) => r.label))]
  const get = (label: string, kind?: string) =>
    rows
      .filter(
        (r) => r.label === label && (kind === undefined || r.kind === kind),
      )
      .reduce((n, r) => n + r.count, 0)
  labels.sort((a, b) => get(b) - get(a))
  const cell = (s: string) => s.padStart(11)
  console.log(`  ${''.padEnd(36)}${cell('total')}${seen.map(cell).join('')}`)
  for (const label of labels)
    console.log(
      `  ${label.padEnd(36)}${cell(String(get(label)))}${seen.map((k) => cell(String(get(label, k)))).join('')}`,
    )
}

console.log(
  `earnrate usage, last ${String(days)} days. Counts of actions, not people.`,
)
const site = await tally('earnrate_site_usage')
const devices = ['iphone', 'android', 'desktop', 'other']
table(
  'earnrate.dev (each at most once per visit)',
  site.filter((r) => !r.label.startsWith('pass-')),
  devices,
)
table(
  'Apple Wallet passes (pass.earnrate.dev)',
  site.filter((r) => r.label.startsWith('pass-')),
  devices,
)
const server = await tally('earnrate_mcp_usage')
table(
  'Hosted server (Claude, ChatGPT and other apps; "check" is our live check)',
  server.filter(
    (r) =>
      r.label.startsWith('tool:') ||
      r.label.startsWith('tool-error:') ||
      r.label.startsWith('wallet-') ||
      r.label.startsWith('error:'),
  ),
  [
    'claude',
    'chatgpt',
    'site',
    'local',
    'other',
    'check',
    'signed-out',
    'unknown',
  ],
)

// Public download counts; npm's include mirrors and bots.
const period = days <= 7 ? 'last-week' : 'last-month'
try {
  const npm = (await (
    await fetch(`https://api.npmjs.org/downloads/point/${period}/earnrate`)
  ).json()) as { downloads?: number }
  console.log(
    `\nnpm downloads (${period}, includes bots): ${String(npm.downloads ?? '?')}`,
  )
} catch {
  console.log('\nnpm downloads: unavailable')
}
try {
  const releases = (await (
    await fetch(
      'https://api.github.com/repos/cwasley/earnrate/releases?per_page=100',
    )
  ).json()) as { assets: { name: string; download_count: number }[] }[]
  const mcpb = releases
    .flatMap((r) => r.assets)
    .filter((a) => a.name.endsWith('.mcpb'))
    .reduce((n, a) => n + a.download_count, 0)
  console.log(
    `Claude Desktop bundle downloads (all releases, all time): ${String(mcpb)}`,
  )
} catch {
  console.log('Claude Desktop bundle downloads: unavailable')
}
console.log('Page visits: Cloudflare dashboard → Web Analytics → earnrate.dev')
