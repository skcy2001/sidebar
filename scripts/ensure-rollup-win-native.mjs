/**
 * npm sometimes skips Rollup's platform optional deps (npm/cli#4828).
 * If we're on win32 and the native binary is missing, install it to match rollup's version.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (process.env.SKIP_ROLLUP_NATIVE_ENSURE === '1') process.exit(0)
if (process.platform !== 'win32') process.exit(0)

const packageByArch = {
  arm64: '@rollup/rollup-win32-arm64-msvc',
  ia32: '@rollup/rollup-win32-ia32-msvc',
  x64: '@rollup/rollup-win32-x64-msvc',
}

const nativePackageName = packageByArch[process.arch]

if (!nativePackageName) process.exit(0)

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))

try {
  require.resolve(`${nativePackageName}/package.json`, { paths: [root] })
  process.exit(0)
} catch {
  // continue
}

const rollupPkgPath = path.join(root, 'node_modules', 'rollup', 'package.json')
if (!existsSync(rollupPkgPath)) {
  console.warn('[ensure-rollup-win-native] rollup not installed yet; skip')
  process.exit(0)
}

const { version } = JSON.parse(readFileSync(rollupPkgPath, 'utf8'))
const spec = `${nativePackageName}@${version}`

console.warn(`[ensure-rollup-win-native] installing missing ${spec}`)

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['install', spec, '--no-save', '--no-audit', '--no-fund'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SKIP_ROLLUP_NATIVE_ENSURE: '1' },
})

process.exit(result.status === 0 ? 0 : 1)
