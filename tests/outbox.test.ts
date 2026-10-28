import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppContext } from '@main/app-context'
import type { PolicyState } from '@shared/types'

/**
 * Офлайн-очередь отправки: письмо ставится в очередь, помечается ошибкой,
 * повторяется и в итоге помечается отправленным. Без сети и Java.
 */
const policy: PolicyState = { managed: false, source: 'none', values: {}, locked: [], errors: [] }

describe('очередь исходящих писем', () => {
  let ctx: AppContext
  let accountId = ''

  beforeAll(() => {
    ctx = new AppContext(policy)
    const account = ctx.accounts.add({
      email: 'queue@example.com',
      displayName: 'Queue',
      imap: { host: '127.0.0.1', port: 993, security: 'tls' },
      smtp: { host: '127.0.0.1', port: 465, security: 'tls' },
      authKind: 'password'
    })
    accountId = account.id
  })

  afterAll(() => {
    ctx?.close()
  })

  it('ставит письмо в очередь и возвращает его как pending', () => {
    const id = ctx.outbox.enqueue(accountId, JSON.stringify({ subject: 'offline' }))
    expect(id).toBeTruthy()
    const pending = ctx.outbox.pending(accountId)
    expect(pending.length).toBe(1)
    expect(pending[0]?.status).toBe('queued')
  })

  it('после ошибки уходит из pending, а retry возвращает обратно', () => {
    const pending = ctx.outbox.pending(accountId)
    const id = pending[0]!.id
    ctx.outbox.markFailed(id, 'SMTP timeout')
    expect(ctx.outbox.pending(accountId).length).toBe(0)
    ctx.outbox.retry(id)
    expect(ctx.outbox.pending(accountId).length).toBe(1)
  })

  it('после успешной отправки больше не pending', () => {
    const pending = ctx.outbox.pending(accountId)
    ctx.outbox.markSent(pending[0]!.id)
    expect(ctx.outbox.pending(accountId).length).toBe(0)
  })
})
