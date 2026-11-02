import {
  chmod,
  mkdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

// Writes through a symlink rather than replacing it, and keeps the file's
// mode: a user's chmod 600 must survive every edit.
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
