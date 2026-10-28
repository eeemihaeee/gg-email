import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testImapConnection } from '@main/mail/imap'
import { testSmtpConnection } from '@main/mail/smtp'
import {
  GREENMAIL_IMAP_PORT,
  GREENMAIL_PASSWORD,
  GREENMAIL_SMTP_PORT,
  GREENMAIL_USER,
  startGreenMail,
  stopGreenMail
} from './greenmail'

/**
 * Интеграционные тесты против реального почтового сервера GreenMail.
 * Запуск: GGEMAIL_IT=1 npm run test:integration
 * Без переменной GGEMAIL_IT тесты пропускаются, чтобы `npm test` был быстрым.
 */
const enabled = process.env.GGEMAIL_IT === '1'

describe.skipIf(!enabled)('IMAP/SMTP против GreenMail', () => {
  beforeAll(async () => {
    await startGreenMail()
  }, 90_000)

  afterAll(() => {
    stopGreenMail()
  })

  it('IMAP: верный пароль принимается, видны папки', async () => {
    const result = await testImapConnection(
      { host: '127.0.0.1', port: GREENMAIL_IMAP_PORT, security: 'none' },
      { user: GREENMAIL_USER, pass: GREENMAIL_PASSWORD }
    )
    expect(result.ok).toBe(true)
    expect(result.folders ?? 0).toBeGreaterThan(0)
  })

  it('IMAP: неверный пароль отклоняется с ошибкой', async () => {
    const result = await testImapConnection(
      { host: '127.0.0.1', port: GREENMAIL_IMAP_PORT, security: 'none' },
      { user: GREENMAIL_USER, pass: 'wrong' }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('SMTP: верные учётные данные принимаются', async () => {
    const result = await testSmtpConnection(
      { host: '127.0.0.1', port: GREENMAIL_SMTP_PORT, security: 'none' },
      GREENMAIL_USER,
      GREENMAIL_PASSWORD
    )
    expect(result.ok).toBe(true)
  })

  it('SMTP: неверный пароль отклоняется', async () => {
    const result = await testSmtpConnection(
      { host: '127.0.0.1', port: GREENMAIL_SMTP_PORT, security: 'none' },
      GREENMAIL_USER,
      'wrong'
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
