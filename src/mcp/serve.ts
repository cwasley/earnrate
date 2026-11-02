import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { FileWalletStore } from '../data/file-store.ts'
import { loadCatalog, walletPath } from '../data/load.ts'
import { localToday as today } from '../engine/periods.ts'
import { llmEnabled, openLlmSession } from '../merchants/from-env.ts'
import { missedPath, missLogAt } from '../merchants/missed.ts'
import { packageVersion } from '../version.ts'
import { createEarnrateServer } from './server.ts'

// stdout carries the protocol, so diagnostics go to stderr only.
export async function serveMcp(env: NodeJS.ProcessEnv): Promise<void> {
  const version = await packageVersion()
  const catalog = await loadCatalog()
  const missedFile = missedPath(env)
  const missed = missedFile === null ? null : missLogAt(missedFile)
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
      store: new FileWalletStore(catalog, walletPath(env)),
      savedWallets: 'file',
      today,
      llm,
      missed,
      version,
    }),
  )
}
