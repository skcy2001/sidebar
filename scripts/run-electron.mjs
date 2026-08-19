import { spawn } from 'node:child_process'
import electronPath from 'electron'

const electron = spawn(electronPath, process.argv.slice(2), {
  stdio: 'inherit',
})

electron.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
