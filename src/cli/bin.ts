#!/usr/bin/env node
import { styleText } from 'node:util'
import { CLI_NAME, WALLET_ENV_VAR } from '../brand.ts'
import { localToday } from '../engine/periods.ts'
import { run } from './run.ts'

if (process.argv[2] === 'mcp' && /^(-h|--help)$/.test(process.argv[3] ?? '')) {
  process.stdout.write(`Usage: ${CLI_NAME} mcp

Runs earnrate as an MCP server over stdio, for an AI assistant to start. It
uses the same wallet file as the command line (${WALLET_ENV_VAR}, or
~/.earnrate/wallet.yaml).
`)
} else if (process.argv[2] === 'mcp') {
  const { serveMcp } = await import('../mcp/serve.ts')
  await serveMcp(process.env)
} else {
  process.exitCode = await run(process.argv.slice(2), {
    env: process.env,
    today: localToday(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    style: (format, text) => styleText(format, text),
  })
}
