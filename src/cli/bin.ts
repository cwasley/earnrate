#!/usr/bin/env node
import { styleText } from 'node:util'
import { localToday } from '../engine/periods.ts'
import { run } from './run.ts'

if (process.argv[2] === 'mcp') {
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
