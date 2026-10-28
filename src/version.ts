import { readFile } from 'node:fs/promises'

export async function packageVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  return pkg.version
}
