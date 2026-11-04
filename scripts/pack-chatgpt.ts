// Builds earnrate-chatgpt.zip, the package uploaded to OpenAI's plugin
// portal: chatgpt/plugin.json and mcp.json, plus the site's app icon.
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const BUILD = path.join(ROOT, '.chatgpt-build')
const ZIP = path.join(ROOT, 'earnrate-chatgpt.zip')

await rm(BUILD, { recursive: true, force: true })
await rm(ZIP, { force: true })
await mkdir(path.join(BUILD, 'assets'), { recursive: true })
for (const file of ['plugin.json', 'mcp.json'])
  await copyFile(path.join(ROOT, 'chatgpt', file), path.join(BUILD, file))
const icon = path.join(ROOT, 'site/public/icon-512.png')
for (const name of ['logo.png', 'icon.png'])
  await copyFile(icon, path.join(BUILD, 'assets', name))
execFileSync('zip', ['-qrX', ZIP, '.'], { cwd: BUILD })
await rm(BUILD, { recursive: true, force: true })
console.log(`Wrote ${path.relative(ROOT, ZIP)}`)
