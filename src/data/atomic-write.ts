import {
  chmod,
  mkdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

// Replaces a file in one step. A symlinked file is written through to its
// target, so the link survives; the file keeps its permissions, and a new
// one is readable only by its owner.
export async function writeFileAtomic(
  file: string,
  text: string,
): Promise<void> {
  const target = await realpath(file).catch(() => file)
  const mode = await stat(target).then(
    (s) => s.mode & 0o777,
    () => 0o600,
  )
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const tmp = `${target}.${String(process.pid)}.tmp`
  await writeFile(tmp, text, { mode })
  await chmod(tmp, mode) // writeFile's mode is narrowed by the umask
  await rename(tmp, target)
}
