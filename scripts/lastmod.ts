// When each tracked file last changed, from git, for the sitemap's lastmod.
// A file with uncommitted changes, or no git at all, counts as changed today.
import { execFileSync } from 'node:child_process'

export function changeDates(
  root: string,
  paths: string[],
  today: string,
): (file: string) => string {
  const dates = new Map<string, string>()
  try {
    const log = execFileSync(
      'git',
      ['log', '--format=%x00%cs', '--name-only', '--', ...paths],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    let date = today
    for (const line of log.split('\n')) {
      if (line.startsWith('\0')) date = line.slice(1)
      else if (line !== '' && !dates.has(line)) dates.set(line, date)
    }
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--', ...paths],
      { cwd: root, encoding: 'utf8' },
    )
    for (const line of dirty.split('\n'))
      if (line.length > 3) dates.set(line.slice(3).trim(), today)
  } catch {
    return () => today
  }
  return (file) => dates.get(file) ?? today
}

// When each entry of a YAML file's top-level list (one store, category or
// currency) last changed, from git blame, so a page follows only the entries
// it shows and not every edit to the shared file. Comments and blank lines
// don't count. Undefined for an id the file has no entry for.
export function entryDates(
  root: string,
  file: string,
  today: string,
): (id: string) => string | undefined {
  const dates = new Map<string, string>()
  let blame: string
  try {
    blame = execFileSync('git', ['blame', '--line-porcelain', '--', file], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return () => today
  }
  let time = 0
  let zone = '+0000'
  let committed = true
  let block: { lines: string[]; date: string } | null = null
  const close = () => {
    const id = block && /\bid:\s*['"]?([\w.-]+)/.exec(block.lines.join('\n'))
    if (block && id?.[1])
      dates.set(id[1], latest([dates.get(id[1]) ?? '', block.date]))
  }
  for (const line of blame.split('\n')) {
    if (/^[0-9a-f]{40} \d+ \d+/.test(line)) committed = !/^0{40} /.test(line)
    else if (line.startsWith('committer-time ')) time = Number(line.slice(15))
    else if (line.startsWith('committer-tz ')) zone = line.slice(13)
    else if (line.startsWith('\t')) {
      const text = line.slice(1)
      if (text.trim() === '' || text.trimStart().startsWith('#')) continue
      const sign = zone.startsWith('-') ? -1 : 1
      const offset =
        sign * (Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(3, 5)) * 60)
      const day = !committed
        ? today
        : new Date((time + offset) * 1000).toISOString().slice(0, 10)
      if (text.startsWith('- ')) {
        close()
        block = { lines: [], date: '' }
      }
      if (!block) continue
      block.lines.push(text)
      block.date = latest([block.date, day > today ? today : day])
    }
  }
  close()
  return (id) => dates.get(id)
}

export const latest = (dates: string[]) =>
  dates.reduce((a, b) => (b > a ? b : a), '')
