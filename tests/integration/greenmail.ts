import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { join } from 'node:path'

/**
 * Локальный почтовый сервер GreenMail для интеграционных тестов.
 * Порты — стандартные для GreenMail: IMAP 3143, SMTP 3025.
 */
export const GREENMAIL_USER = 'test'
export const GREENMAIL_PASSWORD = 'secret'
export const GREENMAIL_IMAP_PORT = 3143
export const GREENMAIL_SMTP_PORT = 3025

const jar = join(process.cwd(), '.cache', 'greenmail-standalone-2.1.0.jar')
let server: ChildProcess | null = null

function waitPort(port: number, timeout = 30_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - started > timeout) reject(new Error(`порт ${port} не открылся`))
        else setTimeout(attempt, 300)
      })
    }
    attempt()
  })
}

export async function startGreenMail(): Promise<void> {
  const download = spawnSync(process.execPath, ['tools/fetch-greenmail.mjs'], {
    stdio: 'inherit'
  })
  if (download.status !== 0) throw new Error('не удалось скачать GreenMail')

  server = spawn(
    'java',
    [
      '-Dgreenmail.setup.test.all',
      `-Dgreenmail.users=${GREENMAIL_USER}:${GREENMAIL_PASSWORD}`,
      '-Dgreenmail.startup.timeout=20000',
      '-jar',
      jar
    ],
    { stdio: 'ignore' }
  )
  await Promise.all([waitPort(GREENMAIL_IMAP_PORT), waitPort(GREENMAIL_SMTP_PORT)])
  // Даём серверу закончить инициализацию пользователей.
  await new Promise((resolve) => setTimeout(resolve, 800))
}

export function stopGreenMail(): void {
  server?.kill()
  server = null
}
