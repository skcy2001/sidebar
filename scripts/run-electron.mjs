import { spawn } from 'node:child_process'
import electronPath from 'electron'

// `--dev-server <url>` travels to the main process as an environment variable,
// never as argv: the app treats a stray http(s) argument as a URL to open in a
// tab, so passing it through would launch the dev server as a page.
const args = process.argv.slice(2)
const flag = args.indexOf('--dev-server')
const devServerUrl = flag === -1 ? null : args[flag + 1]
if (flag !== -1) args.splice(flag, devServerUrl ? 2 : 1)

const electron = spawn(electronPath, args, {
  stdio: 'inherit',
  env: devServerUrl ? { ...process.env, SIDEBAR_DEV_SERVER_URL: devServerUrl } : process.env,
})

electron.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
