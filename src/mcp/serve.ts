import { readFile } from 'node:fs/promises'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { loadCatalog, walletPath } from '../data/load.ts'
import { localToday as today } from '../engine/periods.ts'
import { llmEnabled, openLlmSession } from '../merchants/from-env.ts'
import { createEarnrateServer } from './server.ts'

// stdout carries the protocol, so diagnostics go to stderr only.
export async function serveMcp(env: NodeJS.ProcessEnv): Promise<void> {
  const { version } = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  const catalog = await loadCatalog()
  let llm = null
  if (llmEnabled(env)) {
    const opened = await openLlmSession({ env, today })
    if (opened.kind === 'error') {
      process.stderr.write(`${opened.message}\n`)
      process.exit(2)
    }
    for (const n of opened.notices) process.stderr.write(`${n}\n`)
    llm = opened.session
  }

  serveStdio(() =>
    createEarnrateServer({
      catalog,
      walletFile: walletPath(env),
      today,
      llm,
      version,
    }),
  )
}
