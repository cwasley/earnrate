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

export const latest = (dates: string[]) =>
  dates.reduce((a, b) => (b > a ? b : a), '')
