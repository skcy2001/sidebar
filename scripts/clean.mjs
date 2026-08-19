/**
 * Removes generated output before a build.
 *
 * This matters here beyond the usual hygiene: the project lives inside a
 * OneDrive-synced folder, and OneDrive drops conflict copies (`main-csamyak.js`)
 * next to compiled output. Those have no matching source file, so `tsc` never
 * overwrites them and they get swept into the packaged app.
 */
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

for (const dir of ['dist', 'dist-electron']) {
  rmSync(path.join(root, dir), { recursive: true, force: true })
  console.log(`[clean] removed ${dir}/`)
}
