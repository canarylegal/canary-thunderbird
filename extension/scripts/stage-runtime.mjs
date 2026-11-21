import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const addinRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function stageRuntime(channel = 'listed') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canary-tb-package-'))
  const files = JSON.parse(fs.readFileSync(path.join(addinRoot, 'scripts/runtime-files.json'), 'utf8'))
  for (const name of files) {
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(addinRoot, name), target)
  }
  if (channel === 'listed') {
    const file = path.join(dir, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    delete manifest.applications.gecko.update_url
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  }
  return dir
}
