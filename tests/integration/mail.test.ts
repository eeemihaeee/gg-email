import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testImapConnection } from '@main/mail/imap'
import { testSmtpConnection } from '@main/mail/smtp'

/**
 * Интеграционные тесты против реального почтового сервера GreenMail.
 * Запуск: GGEMAIL_IT=1 npm run test:integration
 * Без переменной GGEMAIL_IT тесты пропускаются, чтобы `npm test` был быстрым.
 */
const enabled = process.env.GGEMAIL_IT === '1'
const IMAP_PORT = 3143
const SMTP_PORT = 3025
const USER = 'test'
const PASSWORD = 'secret'
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

describe.skipIf(!enabled)('IMAP/SMTP против GreenMail', () => {
  beforeAll(async () => {
    const download = spawnSync(process.execPath, ['tools/fetch-greenmail.mjs'], {
      stdio: 'inherit'
    })
    if (download.status !== 0) throw new Error('не удалось скачать GreenMail')

    server = spawn(
      'java',
      [
        '-Dgreenmail.setup.test.all',
        `-Dgreenmail.users=${USER}:${PASSWORD}`,
        '-Dgreenmail.startup.timeout=20000',
        '-jar',
        jar
      ],
      { stdio: 'ignore' }
    )
    await Promise.all([waitPort(IMAP_PORT), waitPort(SMTP_PORT)])
    await new Promise((resolve) => setTimeout(resolve, 500))
  }, 60_000)

  afterAll(() => {
    server?.kill()
    server = null
  })

  it('IMAP: верный пароль принимается, видны папки', async () => {
    const result = await testImapConnection(
      { host: '127.0.0.1', port: IMAP_PORT, security: 'none' },
      { user: USER, pass: PASSWORD }
    )
    expect(result.ok).toBe(true)
    expect(result.folders ?? 0).toBeGreaterThan(0)
  })

  it('IMAP: неверный пароль отклоняется с ошибкой', async () => {
    const result = await testImapConnection(
      { host: '127.0.0.1', port: IMAP_PORT, security: 'none' },
      { user: USER, pass: 'wrong' }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('SMTP: верные учётные данные принимаются', async () => {
    const result = await testSmtpConnection(
      { host: '127.0.0.1', port: SMTP_PORT, security: 'none' },
      USER,
      PASSWORD
    )
    expect(result.ok).toBe(true)
  })

  it('SMTP: неверный пароль отклоняется', async () => {
    const result = await testSmtpConnection(
      { host: '127.0.0.1', port: SMTP_PORT, security: 'none' },
      USER,
      'wrong'
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
