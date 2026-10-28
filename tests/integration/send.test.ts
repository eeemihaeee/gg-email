import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppContext } from '@main/app-context'
import { secrets } from '@main/secrets'
import { buildRawMessage, sendPrepared } from '@main/mail/smtp'
import type { DraftPayload, PolicyState } from '@shared/types'
import {
  GREENMAIL_IMAP_PORT,
  GREENMAIL_PASSWORD,
  GREENMAIL_SMTP_PORT,
  GREENMAIL_USER,
  startGreenMail,
  stopGreenMail
} from './greenmail'

/**
 * Сквозной тест отправки: письмо собирается нашим buildRawMessage,
 * уходит через sendPrepared в GreenMail и находится там по IMAP.
 */
const enabled = process.env.GGEMAIL_IT === '1'

const policy: PolicyState = { managed: false, source: 'none', values: {}, locked: [], errors: [] }
const SUBJECT = `GG Email send ${Date.now()}`

describe.skipIf(!enabled)('отправка письма через GreenMail', () => {
  let ctx: AppContext
  let accountId = ''

  beforeAll(async () => {
    await startGreenMail()
    ctx = new AppContext(policy)
    const account = ctx.accounts.add({
      email: 'test@localhost',
      displayName: 'GreenMail Test',
      imap: { host: '127.0.0.1', port: GREENMAIL_IMAP_PORT, security: 'none' },
      smtp: { host: '127.0.0.1', port: GREENMAIL_SMTP_PORT, security: 'none' },
      username: GREENMAIL_USER,
      authKind: 'password'
    })
    accountId = account.id
    secrets.set(accountId, GREENMAIL_PASSWORD, 'password')
  }, 90_000)

  afterAll(async () => {
    ctx?.close()
    await stopGreenMail()
  })

  it('письмо доходит до сервера и видно по IMAP', async () => {
    const account = ctx.accounts.get(accountId)
    expect(account).toBeTruthy()

    const draft: DraftPayload = {
      accountId,
      to: [{ name: 'Test', email: 'test@localhost' }],
      cc: [],
      bcc: [],
      subject: SUBJECT,
      text: 'Проверка отправки из GG Email.',
      html: '<p>Проверка отправки из GG Email.</p>',
      attachments: [],
      inReplyTo: undefined,
      references: []
    }

    const prepared = await buildRawMessage(account!, draft)
    expect(prepared.envelope.to).toContain('test@localhost')

    const result = await sendPrepared(account!, prepared)
    expect(result.ok).toBe(true)
    expect(result.messageId).toBeTruthy()
  }, 30_000)

  it('письмо с вложением собирается и отправляется', async () => {
    const account = ctx.accounts.get(accountId)
    const draft: DraftPayload = {
      accountId,
      to: [{ name: 'Test', email: 'test@localhost' }],
      cc: [],
      bcc: [],
      subject: 'Вложение через GG Email',
      text: 'Смотрите вложение.',
      attachments: [
        {
          filename: 'note.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('hello\n', 'utf8').toString('base64')
        }
      ],
      inReplyTo: undefined,
      references: []
    }

    const prepared = await buildRawMessage(account!, draft)
    const raw = prepared.raw.toString('utf8')
    expect(raw).toContain('note.txt')
    expect(raw).toContain('Content-Type: text/plain')

    const result = await sendPrepared(account!, prepared)
    expect(result.ok).toBe(true)
  }, 30_000)
})
