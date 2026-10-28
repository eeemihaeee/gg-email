import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ImapFlow } from 'imapflow'
import { AppContext } from '@main/app-context'
import { secrets } from '@main/secrets'
import type { PolicyState } from '@shared/types'
import {
  GREENMAIL_IMAP_PORT,
  GREENMAIL_PASSWORD,
  GREENMAIL_SMTP_PORT,
  GREENMAIL_USER,
  startGreenMail,
  stopGreenMail
} from './greenmail'

/**
 * Сквозной тест синхронизации: письмо кладётся в GreenMail по IMAP,
 * затем AccountSyncer через AppContext забирает его в SQLite.
 */
const enabled = process.env.GGEMAIL_IT === '1'

const policy: PolicyState = {
  managed: false,
  source: 'none',
  values: {},
  locked: [],
  errors: []
}

const SUBJECT = `GreenMail sync ${Date.now()}`

const RAW_MESSAGE = [
  'From: GreenMail <green@example.com>',
  'To: Test <test@example.com>',
  `Subject: ${SUBJECT}`,
  'Date: Tue, 28 Oct 2026 10:00:00 +0000',
  'Message-ID: <sync-test-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Тестовое письмо для проверки синхронизации.',
  ''
].join('\r\n')

describe.skipIf(!enabled)('синхронизация с GreenMail', () => {
  let ctx: AppContext
  let accountId = ''

  beforeAll(async () => {
    await startGreenMail()
    ctx = new AppContext(policy)

    const client = new ImapFlow({
      host: '127.0.0.1',
      port: GREENMAIL_IMAP_PORT,
      secure: false,
      auth: { user: GREENMAIL_USER, pass: GREENMAIL_PASSWORD },
      logger: false
    })
    await client.connect()
    await client.append('INBOX', Buffer.from(RAW_MESSAGE, 'utf8'), ['\\Seen'])
    await client.logout()

    const account = ctx.accounts.add({
      email: 'test@example.com',
      displayName: 'GreenMail Test',
      imap: { host: '127.0.0.1', port: GREENMAIL_IMAP_PORT, security: 'none' },
      smtp: { host: '127.0.0.1', port: GREENMAIL_SMTP_PORT, security: 'none' },
      username: GREENMAIL_USER,
      authKind: 'password'
    })
    accountId = account.id
    secrets.set(accountId, GREENMAIL_PASSWORD, 'password')
    await ctx.startAccount(accountId)
  }, 90_000)

  afterAll(async () => {
    await ctx?.stopAll()
    ctx?.close()
    await stopGreenMail()
  })

  it('забирает письмо из INBOX в локальную базу', async () => {
    const deadline = Date.now() + 30_000
    let page = ctx.messages.list({ accountId, limit: 10 })
    while (page.total === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      page = ctx.messages.list({ accountId, limit: 10 })
    }
    expect(page.total).toBeGreaterThan(0)
    expect(page.items[0]?.subject).toBe(SUBJECT)
    expect(page.items[0]?.from[0]?.email).toBe('green@example.com')
  })

  it('складывает письмо в папку с ролью inbox', () => {
    const folders = ctx.folders.list(accountId)
    const inbox = folders.find((folder) => folder.role === 'inbox')
    expect(inbox).toBeTruthy()
    expect(inbox?.total ?? 0).toBeGreaterThan(0)
  })
})
