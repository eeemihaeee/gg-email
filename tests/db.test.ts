import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../src/main/db/database'
import {
  AccountsRepo,
  FoldersRepo,
  MessagesRepo,
  flagsToMask,
  messageRowId
} from '../src/main/db/repos'

let db: Database
let accounts: AccountsRepo
let folders: FoldersRepo
let messages: MessagesRepo

const accountInput = {
  email: 'test@company.ru',
  displayName: 'Тест',
  imap: { host: 'imap.company.ru', port: 993, security: 'tls' as const },
  smtp: { host: 'smtp.company.ru', port: 465, security: 'tls' as const }
}

beforeEach(() => {
  db = new Database(':memory:')
  accounts = new AccountsRepo(db)
  folders = new FoldersRepo(db)
  messages = new MessagesRepo(db, db.fts5)
})

afterEach(() => db.close())

function seed() {
  const account = accounts.add(accountInput)
  const inbox = folders.upsert(account.id, 'INBOX', 'Inbox', '/', 'inbox')
  const sent = folders.upsert(account.id, 'Sent', 'Sent', '/', 'sent')
  messages.upsertMany([
    {
      accountId: account.id,
      folderId: inbox.id,
      uid: 1,
      subject: 'Бюджет на квартал',
      from: [{ name: 'Анна', email: 'anna@company.ru' }],
      to: [{ name: 'Тест', email: 'test@company.ru' }],
      date: Date.now() - 60_000,
      flags: 0,
      snippet: 'Направляю смету'
    },
    {
      accountId: account.id,
      folderId: inbox.id,
      uid: 2,
      subject: 'Плановые работы',
      from: [{ name: 'Поддержка', email: 'support@company.ru' }],
      to: [{ name: 'Тест', email: 'test@company.ru' }],
      date: Date.now() - 120_000,
      flags: flagsToMask({ seen: true }),
      snippet: 'В субботу с 02:00'
    },
    {
      accountId: account.id,
      folderId: sent.id,
      uid: 3,
      subject: 'Re: Бюджет на квартал',
      from: [{ name: 'Тест', email: 'test@company.ru' }],
      to: [{ name: 'Анна', email: 'anna@company.ru' }],
      date: Date.now() - 30_000,
      flags: flagsToMask({ seen: true }),
      snippet: 'Согласовано'
    }
  ])
  folders.recomputeCounts(inbox.id)
  return { account, inbox, sent }
}

describe('локальный кеш', () => {
  it('создаёт схему и включает FTS5', () => {
    expect(db.fts5).toBe(true)
    expect(messages.list({ limit: 10 }).total).toBe(0)
  })

  it('сохраняет письма и считает непрочитанные', () => {
    const { inbox } = seed()
    const page = messages.list({ folderId: inbox.id, limit: 10 })
    expect(page.total).toBe(2)
    expect(page.items[0].subject).toBe('Бюджет на квартал')
    const folder = folders.get(inbox.id)
    expect(folder?.unread).toBe(1)
    expect(folder?.total).toBe(2)
  })

  it('фильтрует по роли (объединённый ящик)', () => {
    seed()
    const page = messages.list({ role: 'inbox', limit: 10 })
    expect(page.total).toBe(2)
  })

  it('ищет по заголовку через FTS', () => {
    seed()
    const page = messages.list({ query: 'бюджет', limit: 10 })
    expect(page.total).toBe(2)
    expect(page.items.every((item) => item.subject.toLowerCase().includes('бюджет'))).toBe(true)
  })

  it('фильтрует непрочитанные', () => {
    seed()
    const page = messages.list({ unreadOnly: true, limit: 10 })
    expect(page.total).toBe(1)
    expect(page.items[0].flags.seen).toBe(false)
  })

  it('меняет флаги и перемещает письма', () => {
    const { inbox, sent } = seed()
    const item = messages.list({ folderId: inbox.id, limit: 1 }).items[0]
    messages.setFlags(item.id, flagsToMask({ seen: true, flagged: true }))
    expect(messages.get(item.id)?.flags).toEqual({
      seen: true,
      flagged: true,
      answered: false,
      forwarded: false,
      draft: false,
      deleted: false
    })

    const movedId = messages.move(item.id, sent.id, 42)
    expect(messages.get(item.id)).toBeUndefined()
    expect(movedId).toBe(messageRowId(sent.id, 42))
    expect(messages.get(movedId)?.folderId).toBe(sent.id)
  })

  it('сохраняет тело письма сжатым и отдаёт обратно', () => {
    const { account, inbox } = seed()
    const item = messages.list({ folderId: inbox.id, limit: 1 }).items[0]
    const html = `<p>${'Очень длинный текст письма. '.repeat(200)}</p>`
    messages.saveBody(
      item.id,
      inbox.id,
      { text: 'Очень длинный текст письма.', html, attachments: [], headers: {} },
      []
    )
    const detail = messages.get(item.id)
    expect(detail?.bodyFetched).toBe(true)
    expect(detail?.htmlBody).toBe(html)
    expect(messages.bodyBytes()).toBeLessThan(Buffer.byteLength(html, 'utf8'))
    expect(db.get<{ account_id: string }>('SELECT account_id FROM messages WHERE id = ?', item.id)?.account_id).toBe(account.id)
  })

  it('вытесняет тела писем по возрасту', () => {
    const { inbox } = seed()
    const item = messages.list({ folderId: inbox.id, limit: 1 }).items[0]
    messages.saveBody(item.id, inbox.id, { text: 'текст', html: '<b>текст</b>', attachments: [], headers: {} }, [])
    db.run('UPDATE messages SET body_fetched_at = ? WHERE id = ?', Date.now() - 10 * 86_400_000, item.id)
    const removed = messages.evictBodies(Date.now() - 86_400_000)
    expect(removed).toBe(1)
    expect(messages.get(item.id)?.bodyFetched).toBe(false)
  })

  it('удаляет письма каскадно вместе с папкой', () => {
    const { inbox } = seed()
    folders.remove(inbox.id)
    expect(messages.list({ folderId: inbox.id, limit: 10 }).total).toBe(0)
  })

  it('ведёт уникальность адресов учётных записей', () => {
    accounts.add(accountInput)
    expect(() => accounts.add(accountInput)).toThrow()
  })
})
